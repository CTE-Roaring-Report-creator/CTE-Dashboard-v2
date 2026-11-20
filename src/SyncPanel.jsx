import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Cloud, CloudOff, RefreshCw, Check, AlertTriangle, X, Download, Upload, HardDrive } from "lucide-react";
import {
  getSyncConfig, setSyncConfig, onSyncStatus,
  pullAll, flushPending, migrateFromAppsScript,
  exportAll, importAll, clearConflicts,
  reloadApp, getMigratedAt,
} from './driveStorage';

const D = {
  bg0: "#0f1117", bg1: "#161b27", bg2: "#1e2436", bg3: "#252b40",
  border0: "#1e2436", border1: "#2a3050",
  text0: "#f0ede8", text1: "#9ca3b8", text2: "#5a6380",
};

const btn = {
  display: "inline-flex", alignItems: "center", gap: 7,
  padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
  border: `1.5px solid ${D.border1}`, cursor: "pointer",
  background: D.bg2, color: D.text1, fontFamily: "inherit", whiteSpace: "nowrap",
};

const input = {
  width: "100%", boxSizing: "border-box", padding: "8px 11px",
  border: `1.5px solid ${D.border1}`, borderRadius: 7,
  fontSize: 13, background: D.bg3, color: D.text0,
  outline: "none", fontFamily: "inherit",
};

const label = {
  fontSize: 11, fontWeight: 700, color: D.text2, letterSpacing: "0.06em",
  textTransform: "uppercase", display: "block", marginBottom: 6,
};

const STATE_META = {
  starting: { color: D.text2,   text: "Starting"      },
  local:    { color: "#f59e0b", text: "This device only" },
  syncing:  { color: "#4d8ef0", text: "Syncing"       },
  synced:   { color: "#22c55e", text: "Synced"        },
  readonly: { color: "#f59e0b", text: "Read-only"     },
  error:    { color: "#f97316", text: "Sync problem"  },
  offline:  { color: "#f59e0b", text: "Offline"       },
};

export default function SyncPanel() {
  const [status, setStatus] = useState({ state: "starting", pending: 0, conflicts: [] });
  const [open, setOpen] = useState(false);

  useEffect(() => onSyncStatus(setStatus), []);

  const meta = STATE_META[status.state] || STATE_META.local;
  // A read-only device always has "pending" changes that never leave, so the
  // count would be misleading. Say what's actually going on instead.
  const showPending = status.pending > 0 && status.state !== "readonly";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Sync settings"
        style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          padding: "8px 14px", borderRadius: 32, border: "none",
          background: "transparent", color: meta.color,
          fontSize: 12, cursor: "pointer", fontFamily: "inherit",
        }}
      >
        {status.state === "syncing"
          ? <RefreshCw size={13} style={{ animation: "cte-spin 1s linear infinite" }} />
          : status.state === "synced" ? <Cloud size={13} />
          : status.state === "local" || status.state === "readonly" ? <HardDrive size={13} />
          : <CloudOff size={13} />}
        {showPending ? `${status.pending} unsaved` : meta.text}
      </button>

      <style>{`@keyframes cte-spin { to { transform: rotate(360deg); } }`}</style>

      {open && <SyncModal status={status} onClose={() => setOpen(false)} />}
    </>
  );
}

function SyncModal({ status, onClose }) {
  const existing = getSyncConfig();
  const [owner,      setOwner]      = useState(existing?.owner      || "");
  const [repo,       setRepo]       = useState(existing?.repo       || "");
  const [branch,     setBranch]     = useState(existing?.branch     || "main");
  const [token,      setToken]      = useState(existing?.token      || "");
  const [deviceName, setDeviceName] = useState(existing?.deviceName || "");
  const [busy,       setBusy]       = useState("");
  const [result,     setResult]     = useState(null);
  const fileRef = useRef(null);

  const save = async () => {
    if (!owner.trim() || !repo.trim()) {
      setResult({ kind: "error", text: "Owner and repository name are both required." });
      return;
    }
    setSyncConfig({
      owner: owner.trim(), repo: repo.trim(),
      branch: branch.trim() || "main",
      token: token.trim(),
      deviceName: deviceName.trim() || "unnamed device",
    });
    setBusy("Connecting…");
    const pull = await pullAll({ notify: false });
    if (pull.error || pull.failed) {
      setBusy("");
      setResult({ kind: "error", text: pull.error
        || `${pull.failed} file(s) failed to load. Nothing was saved to GitHub. Try Save and connect again.` });
      return;
    }
    const push = await flushPending();
    setBusy("");
    const readOnly = !token.trim();
    setResult({
      kind: readOnly ? "warn" : "ok",
      text: `Connected. Loaded ${pull.pulled} file${pull.pulled !== 1 ? "s" : ""}, saved ${push.pushed || 0}. `
          + (readOnly ? "No token, so this device is read-only. " : "")
          + "Reloading to show the latest…",
    });
    // The screens still hold whatever they loaded before connecting.
    setTimeout(reloadApp, 1800);
  };

  const runMigration = async () => {
    if (!getSyncConfig()) {
      setResult({ kind: "error", text: "Connect to GitHub first, then run the migration." });
      return;
    }
    const prior = getMigratedAt();
    const warning = prior
      ? `Drive data was already imported on ${new Date(prior).toLocaleString()}.\n\n`
        + "Running it again replaces everything on this device and in GitHub with the Drive copy, "
        + "including any edits made since then. Continue?"
      : "This replaces the data on this device and in GitHub with the copy in Drive. Continue?";
    if (!window.confirm(warning)) return;
    setBusy("Reading from Drive…");
    const report = await migrateFromAppsScript(k => setBusy(`Reading ${k}…`));
    setBusy("Saving to GitHub…");
    const push = await flushPending();
    setBusy("");
    setResult({
      kind: report.failed.length ? "warn" : "ok",
      text: `Moved ${report.moved.length} file${report.moved.length !== 1 ? "s" : ""} from Drive. `
          + `${report.empty.length} were empty. `
          + (report.failed.length ? `${report.failed.length} failed — check the console.` : `Saved ${push.pushed || 0} to GitHub.`),
    });
    if (report.failed.length) console.table(report.failed);
    else setTimeout(reloadApp, 2500);
  };

  const doExport = async () => {
    const bundle = await exportAll();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cte-dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      const count = await importAll(bundle);
      setResult({ kind: "ok", text: `Restored ${count} file${count !== 1 ? "s" : ""}. Reloading…` });
      setTimeout(reloadApp, 1500);
    } catch (err) {
      setResult({ kind: "error", text: err.message });
    }
    e.target.value = "";
  };

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.65)",
               display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div style={{
        background: D.bg2, border: `1.5px solid ${D.border1}`, borderRadius: 12,
        width: "100%", maxWidth: 560, maxHeight: "calc(100vh - 40px)", overflowY: "auto",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
      }}>

        <div style={{ padding: "16px 20px 12px", borderBottom: `1.5px solid ${D.border1}`,
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      position: "sticky", top: 0, background: D.bg2, zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: D.text0 }}>Sync across devices</div>
            <div style={{ fontSize: 12, color: D.text2, marginTop: 2 }}>
              {STATE_META[status.state]?.text}
              {status.lastSync && ` · last check ${new Date(status.lastSync).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: D.text1, padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>

          <div style={{ padding: "12px 14px", borderRadius: 8, background: "#0d1f3d",
                        border: "1px solid #1a3a6b", fontSize: 12, color: "#7aabf0", lineHeight: 1.7 }}>
            <div style={{ fontWeight: 700, color: "#4d8ef0", marginBottom: 6 }}>How this works</div>
            Your work saves to this device instantly, then copies to a GitHub repository in the
            background. Open the dashboard on another computer and it pulls the latest version down.
            Every save is a commit, so you can recover any earlier version from the repo's history.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={label}>GitHub username</label>
              <input style={input} value={owner} onChange={e => setOwner(e.target.value)} placeholder="your-username" />
            </div>
            <div>
              <label style={label}>Data repository</label>
              <input style={input} value={repo} onChange={e => setRepo(e.target.value)} placeholder="cte-dashboard-data" />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={label}>Branch</label>
              <input style={input} value={branch} onChange={e => setBranch(e.target.value)} placeholder="main" />
            </div>
            <div>
              <label style={label}>Name this device</label>
              <input style={input} value={deviceName} onChange={e => setDeviceName(e.target.value)} placeholder="Home laptop" />
            </div>
          </div>

          <div>
            <label style={label}>Access token</label>
            <input style={input} type="password" value={token} onChange={e => setToken(e.target.value)}
                   placeholder="github_pat_…" />
            <div style={{ fontSize: 11, color: D.text2, marginTop: 4, lineHeight: 1.6 }}>
              Fine-grained token, this repository only, Contents set to Read and write.
              Leave blank to make this device read-only. The token stays in this browser and is
              never written to the repo.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={save} disabled={!!busy}
              style={{ ...btn, background: "#1a56c4", color: "white", borderColor: "#1a56c4", fontWeight: 600 }}>
              {busy || "Save and connect"}
            </button>
            <button onClick={() => { pullAll().then(() => flushPending()); }} disabled={!!busy} style={btn}>
              <RefreshCw size={13} /> Sync now
            </button>
          </div>

          {result && (
            <div style={{
              padding: "10px 13px", borderRadius: 8, fontSize: 13, lineHeight: 1.5,
              display: "flex", gap: 8, alignItems: "flex-start",
              background: result.kind === "ok" ? "#0d2d1a" : "#2d1a0d",
              border: `1px solid ${result.kind === "ok" ? "#1a5433" : "#6b3a1a"}`,
              color: result.kind === "ok" ? "#22c55e" : "#f97316",
            }}>
              {result.kind === "ok"
                ? <Check size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                : <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />}
              <span>{result.text}</span>
            </div>
          )}

          {status.conflicts?.length > 0 && (
            <div style={{ padding: "10px 13px", borderRadius: 8, background: "#2d2000",
                          border: "1px solid #6b4a00", fontSize: 12, color: "#f59e0b", lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Edited in two places</div>
              {status.conflicts.map((c, i) => <div key={i}>· {c}</div>)}
              <button onClick={clearConflicts} style={{ ...btn, marginTop: 8, padding: "4px 10px", fontSize: 11 }}>
                Dismiss
              </button>
            </div>
          )}

          <div style={{ borderTop: `1px solid ${D.border0}`, paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: D.text0, marginBottom: 4 }}>
              Bring over your Drive data
            </div>
            <div style={{ fontSize: 12, color: D.text2, marginBottom: 10, lineHeight: 1.6 }}>
              Run once, only if you didn't upload the Drive files to the repo yourself. Reads every
              file the old Apps Script backend was holding and replaces the data here and in GitHub.
              Running it again later would overwrite edits made since.
            </div>
            <button onClick={runMigration} disabled={!!busy} style={btn}>
              <Download size={13} /> Import from Drive
            </button>
          </div>

          <div style={{ borderTop: `1px solid ${D.border0}`, paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: D.text0, marginBottom: 10 }}>
              Offline backup
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={doExport} style={btn}><Download size={13} /> Download everything</button>
              <button onClick={() => fileRef.current?.click()} style={btn}><Upload size={13} /> Restore from file</button>
              <input ref={fileRef} type="file" accept="application/json" onChange={doImport} style={{ display: "none" }} />
            </div>
          </div>

        </div>
      </div>
    </div>,
    document.body
  );
}
