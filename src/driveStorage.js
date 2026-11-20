// ─────────────────────────────────────────────────────────────────────────────
// CTE Dashboard — Storage Layer
// Local-first (IndexedDB) with optional GitHub sync.
//
// Reads are ALWAYS local and instant. On boot, initStorage() pulls the remote
// state into IndexedDB. Every save writes locally first, then queues a
// debounced push to GitHub. Nothing in the UI ever waits on the network.
//
// Filename kept as driveStorage.js so existing imports don't change.
// Google Drive / Apps Script is retained ONLY as a one-time migration source.
// ─────────────────────────────────────────────────────────────────────────────

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const DB_NAME     = 'cte-dashboard';
const DB_VERSION  = 1;
const STORE       = 'kv';
const DATA_DIR    = 'data';
const LS_SYNC_KEY = 'cte-sync-config';

// Legacy Apps Script endpoint — used by migrateFromAppsScript() only.
const LEGACY_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxm-oCufPdG60N2I-9ZkGlHfU1KPftMmOJ3oM6KEJxn74PX9tGVEWQ8XFTKvZTsBvK-cA/exec';

const COURSE_IDS = ['intro-tech', 'digital-innovation', 'media-a', 'media-b'];

// Every key the app can store. Used for the boot pull and migration.
export const ALL_KEYS = [
  'app-settings',
  'custom-standards',
  'calendar-config',
  'sub-days',
  'display-settings',
  ...COURSE_IDS.flatMap(id => [
    `curriculum-${id}`,
    `weekly-data-${id}`,
    `lesson-mapping-${id}`,
    `bell-push-config-${id}`,
    `bell-push-log-${id}`,
    `classroom-push-log-${id}`,
  ]),
];

// Keys where a blind last-write-wins could silently eat work done on another
// device. These get a union merge instead (see mergeValues).
const UNION_MERGE = new Set([
  'sub-days',
  ...COURSE_IDS.map(id => `weekly-data-${id}`),
]);

const PUSH_DEBOUNCE_MS = 2500;

// ─── SYNC CONFIG (device-local — never synced, holds the token) ──────────────

export function getSyncConfig() {
  try {
    const raw = localStorage.getItem(LS_SYNC_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (!cfg.owner || !cfg.repo) return null;
    return { branch: 'main', deviceName: 'this device', ...cfg };
  } catch (_) { return null; }
}

export function setSyncConfig(cfg) {
  try {
    if (!cfg) localStorage.removeItem(LS_SYNC_KEY);
    else localStorage.setItem(LS_SYNC_KEY, JSON.stringify(cfg));
  } catch (e) { console.error('[Storage] setSyncConfig failed:', e); }
  emitStatus();
}

function deviceLabel() {
  return getSyncConfig()?.deviceName || 'unknown device';
}

// A device that has never pulled from this repo has no authored history — only
// whatever defaults the app wrote while booting. On that first pull the remote
// is the source of truth, or seed data silently overwrites real curriculum.
function adoptedKey(cfg) {
  return `cte-sync-adopted:${cfg.owner}/${cfg.repo}`;
}

function hasAdopted(cfg) {
  try { return localStorage.getItem(adoptedKey(cfg)) === '1'; }
  catch (_) { return false; }
}

function markAdopted(cfg) {
  try { localStorage.setItem(adoptedKey(cfg), '1'); } catch (_) {}
}

// ─── STATUS BROADCAST ────────────────────────────────────────────────────────

let statusState = {
  state:      'starting',  // starting | local | syncing | synced | readonly | error | offline
  pending:    0,
  lastSync:   null,
  message:    '',
  conflicts:  [],
};

const statusListeners = new Set();

export function onSyncStatus(cb) {
  statusListeners.add(cb);
  cb(statusState);
  return () => statusListeners.delete(cb);
}

export function getSyncStatus() { return statusState; }

function setStatus(patch) {
  statusState = { ...statusState, ...patch };
  emitStatus();
}

function emitStatus() {
  statusListeners.forEach(cb => { try { cb(statusState); } catch (_) {} });
}

// ─── EXTERNAL CHANGES ────────────────────────────────────────────────────────
// The screens hold their own copy of the data in React state. When a pull
// brings in another device's changes after the app has booted, that copy is
// out of date, and the next edit would save it over the newer data. App
// listens here and reloads (or warns) so that can't happen.

let booted = false;
const externalListeners = new Set();

export function onExternalChange(cb) {
  externalListeners.add(cb);
  return () => externalListeners.delete(cb);
}

function emitExternalChange(keys) {
  externalListeners.forEach(cb => { try { cb(keys); } catch (_) {} });
}

let suppressUnloadWarning = false;

// Reload without the "leave this page?" prompt. Use only when nothing is
// waiting to save, or after the user has chosen to reload.
export function reloadApp() {
  suppressUnloadWarning = true;
  window.location.reload();
}

// Status to show when there's nothing to do: a device without a token can
// read but never send its changes anywhere.
function idleState(cfg) {
  return cfg && !cfg.token ? 'readonly' : 'synced';
}

// ─── INDEXEDDB ───────────────────────────────────────────────────────────────

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    try { result = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error);
  }));
}

function idbGet(key) {
  return tx('readonly', store => ({ __req: store.get(key) }));
}

function idbPut(record) {
  return tx('readwrite', store => { store.put(record); return true; });
}

function idbAll() {
  return tx('readonly', store => ({ __req: store.getAll() }));
}

// ─── LOCAL RECORD SHAPE ──────────────────────────────────────────────────────
// { key, value, updatedAt, device, sha, dirty }

async function localRead(key) {
  try {
    const rec = await idbGet(key);
    return rec ? rec.value : undefined;   // undefined = never stored
  } catch (e) {
    console.error('[Storage] localRead failed:', key, e);
    return undefined;
  }
}

async function localWrite(key, value, opts = {}) {
  const rec = {
    key,
    value,
    updatedAt: opts.updatedAt || new Date().toISOString(),
    device:    opts.device    || deviceLabel(),
    sha:       opts.sha !== undefined ? opts.sha : (await idbGet(key))?.sha ?? null,
    dirty:     opts.dirty !== undefined ? opts.dirty : true,
  };
  await idbPut(rec);
  return rec;
}

// ─── GITHUB TRANSPORT ────────────────────────────────────────────────────────

function ghHeaders(cfg) {
  const h = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (cfg.token) h['Authorization'] = `Bearer ${cfg.token}`;
  return h;
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Envelope written to each JSON file so we can compare devices and times.
function wrap(key, value, updatedAt) {
  return JSON.stringify({
    key,
    updatedAt: updatedAt || new Date().toISOString(),
    device:    deviceLabel(),
    value,
  }, null, 2);
}

function unwrap(text, key) {
  const parsed = JSON.parse(text);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && 'value' in parsed && 'updatedAt' in parsed) {
    return { value: parsed.value, updatedAt: parsed.updatedAt, device: parsed.device || '' };
  }
  // Bare file (hand-placed or migrated): treat whole document as the value.
  return { value: parsed, updatedAt: '1970-01-01T00:00:00.000Z', device: 'unknown' };
}

// One API call — returns { name, sha, download_url } for every data file.
async function ghListDir(cfg) {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${DATA_DIR}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(url, { headers: ghHeaders(cfg) });
  if (res.status === 404) return [];          // data dir doesn't exist yet
  if (!res.ok) throw new Error(`GitHub list failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

async function ghGetFile(cfg, entry) {
  // download_url is raw.githubusercontent — no API rate limit cost.
  const url = entry.download_url + (entry.download_url.includes('?') ? '&' : '?') + 't=' + Date.now();
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fetch ${entry.name} failed (${res.status})`);
  return res.text();
}

async function ghPutFile(cfg, key, contentString, sha) {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${DATA_DIR}/${key}.json`;
  const body = {
    message: `Update ${key} from ${deviceLabel()}`,
    content: utf8ToBase64(contentString),
    branch:  cfg.branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 409 || res.status === 422) {
    const err = new Error('sha-conflict');
    err.__conflict = true;
    throw err;
  }
  if (!res.ok) throw new Error(`GitHub write failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  return json.content?.sha || null;
}

// ─── MERGE ───────────────────────────────────────────────────────────────────

function mergeValues(key, localVal, remoteVal, localTime, remoteTime) {
  if (UNION_MERGE.has(key)
      && localVal && remoteVal
      && typeof localVal === 'object' && typeof remoteVal === 'object'
      && !Array.isArray(localVal) && !Array.isArray(remoteVal)) {
    // Date-keyed maps: keep every entry from both sides. On an entry present
    // in both, the more recently saved device wins.
    const localWins = !remoteTime || localTime >= remoteTime;
    return localWins ? { ...remoteVal, ...localVal } : { ...localVal, ...remoteVal };
  }
  if (!remoteTime) return localVal;
  if (!localTime)  return remoteVal;
  return localTime >= remoteTime ? localVal : remoteVal;
}

// ─── PULL ────────────────────────────────────────────────────────────────────

export async function pullAll({ silent = false, notify = true } = {}) {
  const cfg = getSyncConfig();
  if (!cfg) { setStatus({ state: 'local', message: 'Sync not set up' }); return { pulled: 0 }; }
  if (!navigator.onLine) { setStatus({ state: 'offline', message: 'No connection' }); return { pulled: 0 }; }

  if (!silent) setStatus({ state: 'syncing', message: 'Checking for changes…' });

  const firstPull = !hasAdopted(cfg);

  try {
    const entries = await ghListDir(cfg);
    const wanted  = entries.filter(e => e.name.endsWith('.json') && !e.name.startsWith('_'));

    const results = await Promise.allSettled(wanted.map(async entry => {
      const key = entry.name.replace(/\.json$/, '');
      const text = await ghGetFile(cfg, entry);
      const { value: remoteVal, updatedAt: remoteTime } = unwrap(text, key);

      const existing  = await idbGet(key);
      const localTime = existing?.updatedAt || null;

      // First contact with this repo — adopt the remote copy wholesale.
      if (firstPull) {
        await localWrite(key, remoteVal, { updatedAt: remoteTime, sha: entry.sha, dirty: false });
        return { key, action: existing ? 'adopted' : 'added' };
      }

      if (!existing) {
        await localWrite(key, remoteVal, { updatedAt: remoteTime, sha: entry.sha, dirty: false });
        return { key, action: 'added' };
      }

      if (existing.dirty) {
        const merged = mergeValues(key, existing.value, remoteVal, localTime, remoteTime);
        const changed = JSON.stringify(merged) !== JSON.stringify(existing.value);
        await localWrite(key, merged, {
          updatedAt: changed ? new Date().toISOString() : localTime,
          sha: entry.sha,
          dirty: true,
        });
        return { key, action: changed ? 'merged' : 'kept-local' };
      }

      if (remoteTime && remoteTime !== localTime) {
        await localWrite(key, remoteVal, { updatedAt: remoteTime, sha: entry.sha, dirty: false });
        return { key, action: 'updated' };
      }

      await localWrite(key, existing.value, { updatedAt: localTime, sha: entry.sha, dirty: false });
      return { key, action: 'unchanged' };
    }));

    const failed = results.filter(r => r.status === 'rejected');
    const changedKeys = results
      .filter(r => r.status === 'fulfilled'
        && ['added', 'updated', 'merged', 'adopted'].includes(r.value.action))
      .map(r => r.value.key);
    const pulled = changedKeys.length;

    if (failed.length) {
      // Not marked as adopted, so this device won't push anything until a
      // first pull succeeds completely (see flushPending).
      setStatus({ state: 'error', message: `${failed.length} file(s) failed to load` });
    } else {
      // An empty repo counts too: the first device to connect establishes it.
      if (firstPull) markAdopted(cfg);
      setStatus({ state: idleState(cfg), lastSync: new Date().toISOString(), message: '' });
    }
    if (notify && booted && pulled > 0) emitExternalChange(changedKeys);
    return { pulled, failed: failed.length };
  } catch (err) {
    console.error('[Storage] pullAll failed:', err);
    setStatus({ state: 'error', message: err.message || 'Could not reach GitHub' });
    return { pulled: 0, error: err.message };
  }
}

// ─── PUSH QUEUE ──────────────────────────────────────────────────────────────

const pushTimers = new Map();
let pushing = false;

function queuePush(key) {
  if (!getSyncConfig()) return;
  clearTimeout(pushTimers.get(key));
  pushTimers.set(key, setTimeout(() => {
    pushTimers.delete(key);
    flushPending();
  }, PUSH_DEBOUNCE_MS));
  updatePendingCount();
}

async function updatePendingCount() {
  try {
    const all = await idbAll();
    const pending = all.filter(r => r.dirty).length;
    setStatus({ pending });
  } catch (_) {}
}

export async function flushPending() {
  const cfg = getSyncConfig();
  if (!cfg) return { pushed: 0, reason: 'no-config' };
  if (!cfg.token) {
    setStatus({ state: 'readonly', message: 'No access token — changes stay on this device' });
    return { pushed: 0, reason: 'no-token' };
  }
  // Never push from a device that hasn't completed a first pull. Its local
  // copy may be seed defaults, and pushing them would overwrite real data.
  if (!hasAdopted(cfg)) {
    setStatus({ state: 'error', message: 'Not connected yet — open Sync and choose Save and connect' });
    return { pushed: 0, reason: 'not-adopted' };
  }
  if (pushing) return { pushed: 0, reason: 'busy' };
  if (!navigator.onLine) { setStatus({ state: 'offline' }); return { pushed: 0, reason: 'offline' }; }

  pushing = true;
  let pushed = 0, failedCount = 0;

  try {
    const all   = await idbAll();
    const dirty = all.filter(r => r.dirty);
    if (!dirty.length) { setStatus({ state: 'synced', pending: 0, message: '' }); return { pushed: 0 }; }

    setStatus({ state: 'syncing', message: `Saving ${dirty.length} change${dirty.length !== 1 ? 's' : ''}…` });

    for (const rec of dirty) {
      try {
        const newSha = await ghPutFile(cfg, rec.key, wrap(rec.key, rec.value, rec.updatedAt), rec.sha);
        const current = await idbGet(rec.key);
        // Only clear the dirty flag if nothing changed while we were pushing.
        if (current && current.updatedAt === rec.updatedAt) {
          await idbPut({ ...current, sha: newSha, dirty: false });
        } else if (current) {
          await idbPut({ ...current, sha: newSha });
        }
        pushed++;
      } catch (err) {
        if (err.__conflict) {
          await resolveConflict(cfg, rec);
          pushed++;
        } else {
          console.error('[Storage] push failed:', rec.key, err);
          failedCount++;
        }
      }
    }

    await updatePendingCount();
    if (failedCount) setStatus({ state: 'error', message: `${failedCount} change(s) not saved to GitHub` });
    else setStatus({ state: 'synced', lastSync: new Date().toISOString(), message: '' });

    return { pushed, failed: failedCount };
  } finally {
    pushing = false;
  }
}

// Remote moved under us — re-read, merge, write once with the fresh sha.
async function resolveConflict(cfg, rec) {
  try {
    const entries = await ghListDir(cfg);
    const entry   = entries.find(e => e.name === `${rec.key}.json`);
    if (!entry) {
      const sha = await ghPutFile(cfg, rec.key, wrap(rec.key, rec.value, rec.updatedAt), null);
      const cur = await idbGet(rec.key);
      await idbPut({ ...cur, sha, dirty: false });
      return;
    }
    const text = await ghGetFile(cfg, entry);
    const { value: remoteVal, updatedAt: remoteTime, device: remoteDevice } = unwrap(text, rec.key);
    const merged = mergeValues(rec.key, rec.value, remoteVal, rec.updatedAt, remoteTime);
    const stamp  = new Date().toISOString();
    const sha    = await ghPutFile(cfg, rec.key, wrap(rec.key, merged, stamp), entry.sha);
    await localWrite(rec.key, merged, { updatedAt: stamp, sha, dirty: false });

    const how  = UNION_MERGE.has(rec.key) ? 'both sets of changes were kept' : 'the most recent version was kept';
    const note = `${rec.key} was also edited on ${remoteDevice || 'another device'} — ${how}`;
    setStatus({ conflicts: [...statusState.conflicts.filter(c => c !== note), note].slice(-5) });
  } catch (err) {
    console.error('[Storage] conflict resolution failed:', rec.key, err);
    throw err;
  }
}

export function clearConflicts() { setStatus({ conflicts: [] }); }

export async function hasPendingWrites() {
  try { return (await idbAll()).some(r => r.dirty); } catch (_) { return false; }
}

// ─── PUBLIC READ/WRITE HELPERS ───────────────────────────────────────────────

async function readFile(key) {
  const v = await localRead(key);
  return v === undefined ? null : v;
}

async function writeFile(key, data) {
  await localWrite(key, data);
  queuePush(key);
}

// ─── INIT ────────────────────────────────────────────────────────────────────

let initialized = false;

export async function initStorage() {
  if (initialized) return true;
  initialized = true;

  try { await openDB(); }
  catch (e) {
    console.error('[Storage] IndexedDB unavailable:', e);
    setStatus({ state: 'error', message: 'Local storage unavailable — check private browsing mode' });
    return false;
  }

  const cfg = getSyncConfig();
  if (cfg) {
    await pullAll({ notify: false });   // screens haven't loaded yet
    flushPending();                     // send anything left from last session
  } else {
    setStatus({ state: 'local', message: 'Sync not set up' });
  }

  await updatePendingCount();
  booted = true;

  // Re-sync when the tab regains focus or the network comes back.
  const resync = () => {
    if (document.visibilityState !== 'visible') return;
    pullAll({ silent: true }).then(() => flushPending());
  };
  document.addEventListener('visibilitychange', resync);
  window.addEventListener('online', resync);
  window.addEventListener('focus', resync);

  // Warn before losing unsaved work.
  // Only when changes are actually on their way somewhere. A device with no
  // token always has pending changes, so warning there would be every time.
  window.addEventListener('beforeunload', (e) => {
    if (suppressUnloadWarning) return;
    const c = getSyncConfig();
    if (c?.token && statusState.pending > 0) { e.preventDefault(); e.returnValue = ''; }
  });

  return true;
}

// ─── LEGACY AUTH STUBS (kept so old imports don't break) ─────────────────────

export function isSignedIn() { return true; }
export async function initGoogleAuth() { return initStorage(); }
export function signIn() { return Promise.resolve(true); }
export function signOut() {}

// ─── PUBLIC STORAGE API (unchanged signatures) ───────────────────────────────

export async function loadCurriculum(courseId) {
  return readFile(`curriculum-${courseId}`);
}
export async function saveCurriculum(courseId, data) {
  return writeFile(`curriculum-${courseId}`, data);
}

export async function loadSettings() {
  const val = await readFile('app-settings');
  return val || { selectedCourse: 'intro-tech', mediaYear: 'media-a' };
}
export async function saveSettings(settings) {
  return writeFile('app-settings', settings);
}

export async function loadStandards() {
  return readFile('custom-standards');
}
export async function saveStandards(standards) {
  return writeFile('custom-standards', standards);
}

export async function loadWeeklyData(courseId) {
  return (await readFile(`weekly-data-${courseId}`)) || {};
}
export async function saveWeeklyData(courseId, data) {
  return writeFile(`weekly-data-${courseId}`, data);
}

export async function loadCalendarConfig() {
  return readFile('calendar-config');
}
export async function saveCalendarConfig(config) {
  return writeFile('calendar-config', config);
}

export async function loadMapping(courseId) {
  return readFile(`lesson-mapping-${courseId}`);
}
export async function saveMapping(courseId, data) {
  return writeFile(`lesson-mapping-${courseId}`, data);
}

export async function loadSubDays() {
  return (await readFile('sub-days')) || {};
}
export async function saveSubDays(data) {
  return writeFile('sub-days', data);
}

// ─── CLASSROOM DISPLAY ────────────────────────────────────────────────────────
// Standing agenda per display class: { agendas: { 'intro-tech': [...], ... } }

export async function loadDisplaySettings() {
  return (await readFile('display-settings')) || { agendas: {} };
}
export async function saveDisplaySettings(data) {
  return writeFile('display-settings', data);
}

export async function loadPushConfig(courseId) {
  return readFile(`bell-push-config-${courseId}`);
}
export async function savePushConfig(courseId, config) {
  return writeFile(`bell-push-config-${courseId}`, config);
}

export async function loadPushLog(courseId) {
  return (await readFile(`bell-push-log-${courseId}`)) || [];
}
export async function savePushLog(courseId, log) {
  return writeFile(`bell-push-log-${courseId}`, log.slice(-20));
}

export async function loadClassroomLog(courseId) {
  return (await readFile(`classroom-push-log-${courseId}`)) || {};
}
export async function saveClassroomLog(courseId, log) {
  return writeFile(`classroom-push-log-${courseId}`, log);
}

// ─── BACKUP / RESTORE ────────────────────────────────────────────────────────

export async function exportAll() {
  const all = await idbAll();
  const out = { exportedAt: new Date().toISOString(), device: deviceLabel(), keys: {} };
  all.forEach(r => { out.keys[r.key] = { value: r.value, updatedAt: r.updatedAt }; });
  return out;
}

export async function importAll(bundle, { overwrite = true } = {}) {
  if (!bundle?.keys) throw new Error('That file is not a dashboard backup');
  let count = 0;
  for (const [key, rec] of Object.entries(bundle.keys)) {
    const existing = await idbGet(key);
    if (existing && !overwrite) continue;
    await localWrite(key, rec.value, { updatedAt: rec.updatedAt || new Date().toISOString(), dirty: true });
    count++;
  }
  await updatePendingCount();
  flushPending();
  return count;
}

// ─── ONE-TIME MIGRATION FROM APPS SCRIPT / DRIVE ─────────────────────────────

export async function migrateFromAppsScript(onProgress) {
  const report = { moved: [], empty: [], failed: [] };

  for (const key of ALL_KEYS) {
    if (onProgress) onProgress(key);
    try {
      const res = await fetch(LEGACY_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'loadData', key }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch (_) { report.failed.push({ key, reason: 'Script returned non-JSON' }); continue; }

      if (!data.ok) { report.failed.push({ key, reason: data.message || 'Script error' }); continue; }
      if (data.value === null || data.value === undefined) { report.empty.push(key); continue; }

      await localWrite(key, data.value, { dirty: true });
      report.moved.push(key);
    } catch (err) {
      report.failed.push({ key, reason: err.message });
    }
  }

  try { localStorage.setItem('cte-drive-migrated-at', new Date().toISOString()); } catch (_) {}
  await updatePendingCount();
  return report;
}

export function getMigratedAt() {
  try { return localStorage.getItem('cte-drive-migrated-at'); } catch (_) { return null; }
}