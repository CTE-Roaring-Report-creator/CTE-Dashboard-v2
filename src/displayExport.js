// ─── CLASSROOM DISPLAY: WEEK EXPORT ──────────────────────────────────────────
// Builds the one-week JSON file the Classroom Display loads with "Load this
// week". Plans only: no student data, no Bell Work questions (those live in
// the Bell Work form), no due dates (the display reads those from Classroom).
//
// Everything here is pure, so it can be tested without the UI.

export const DISPLAY_FORMAT = "classroom-display-week";
export const DISPLAY_FORMAT_VERSION = 2;

// The three classes the display knows about, matched by name on its side.
// Film & Broadcasting uses whichever media year the calendar is set to.
export const DISPLAY_CLASSES = [
  { id: "intro-tech",         name: "Intro to Technology", courseIds: ["intro-tech"] },
  { id: "digital-innovation", name: "Digital Innovations", courseIds: ["digital-innovation"] },
  { id: "film",               name: "Film & Broadcasting", courseIds: ["media-a", "media-b"] },
];

export const DEFAULT_STANDING_AGENDA = ["Bell Work", "{lesson}"];

export function displayClassForCourse(courseId) {
  return DISPLAY_CLASSES.find(c => c.courseIds.includes(courseId)) || null;
}

export function courseForDisplayClass(displayClass, mediaYear) {
  return displayClass.id === "film" ? (mediaYear || "media-a") : displayClass.courseIds[0];
}

// ── Dates (local, never UTC) ─────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, "0"); }

export function localDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseLocal(ds) {
  const [y, m, d] = ds.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function weekdaysOf(mondayStr) {
  const start = parseLocal(mondayStr);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return localDateStr(d);
  });
}

// ISO timestamp with the local offset, e.g. 2026-11-20T15:04:00-08:00
export function localIsoNow(now = new Date()) {
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${localDateStr(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// ── Lesson helpers ───────────────────────────────────────────────────────────

export function buildLessonIndex(curriculum) {
  const index = {};
  for (const unit of curriculum?.units || []) {
    for (const lesson of unit.lessons || []) index[lesson.id] = { lesson, unit };
  }
  return index;
}

// Text → list of steps, one per line, blanks dropped.
export function agendaLines(text) {
  return String(text || "").split("\n").map(s => s.trim()).filter(Boolean);
}

// The day's own agenda if one was written, otherwise the class's standing
// agenda. "{lesson}" becomes the lesson name either way.
export function resolveAgenda(lesson, dayIndex, standing) {
  const override = Array.isArray(lesson?.agendas) ? lesson.agendas[(dayIndex || 1) - 1] : "";
  const steps = agendaLines(override).length
    ? agendaLines(override)
    : (standing && standing.length ? standing : DEFAULT_STANDING_AGENDA);
  return steps
    .map(s => s.split("{lesson}").join(lesson?.title || "").trim())
    .filter(Boolean);
}

export function studentObjective(lesson) {
  return (lesson?.studentObjective || "").trim() || (lesson?.objective || "").trim();
}

export function firstSlidesUrl(lesson) {
  const link = (lesson?.links || []).find(l => l.type === "slide-deck" && l.url);
  return link ? link.url : "";
}

// ── One class, one day ───────────────────────────────────────────────────────

export function buildDayEntry({ dateKey, mapping, lessonIndex, calendarConfig, subDays, standing }) {
  const ni = new Set(calendarConfig?.nonInstructional || []);
  const inYear = calendarConfig?.startDate && calendarConfig?.endDate
    && dateKey >= calendarConfig.startDate && dateKey <= calendarConfig.endDate;

  if (!inYear) return null;
  if (ni.has(dateKey)) return { status: "noClass", label: "No school" };

  const meta = mapping?.[dateKey];
  if (!meta) return null;                               // nothing planned → display uses its own settings
  if (meta.type === "block") return { status: "event", label: meta.label || "No regular class" };
  if (meta.type !== "lesson") return null;

  const found = lessonIndex[meta.lessonId];
  if (!found) return null;                              // mapping points at a deleted lesson
  const { lesson, unit } = found;

  return {
    status: subDays?.[dateKey] ? "sub" : "class",
    lesson: lesson.title || "",
    unit: unit?.title || "",
    day: meta.dayIndex || 1,
    totalDays: meta.totalDays || lesson.estimatedDays || 1,
    objective: studentObjective(lesson),
    agenda: resolveAgenda(lesson, meta.dayIndex, standing),
    slidesUrl: firstSlidesUrl(lesson),
  };
}

// ── The whole week ───────────────────────────────────────────────────────────

export function buildWeekExport({ mondayStr, curricula, mappings, calendarConfig, subDays, displaySettings, now }) {
  const mediaYear = calendarConfig?.mediaYear || "media-a";
  const dates = weekdaysOf(mondayStr);
  const classes = [];
  const days = {};
  const warnings = [];

  for (const dc of DISPLAY_CLASSES) {
    const courseId = courseForDisplayClass(dc, mediaYear);
    const curriculum = curricula?.[courseId];
    const mapping = mappings?.[courseId];
    if (!curriculum || !mapping) {
      warnings.push(`${dc.name}: no ${!curriculum ? "curriculum" : "calendar"} yet, left out`);
      continue;
    }
    classes.push({ id: dc.id, name: dc.name });
    const lessonIndex = buildLessonIndex(curriculum);
    const standing = displaySettings?.agendas?.[dc.id] || DEFAULT_STANDING_AGENDA;

    for (const dateKey of dates) {
      const entry = buildDayEntry({ dateKey, mapping, lessonIndex, calendarConfig, subDays, standing });
      if (!entry) continue;
      if (entry.status === "class" && !entry.objective) warnings.push(`${dc.name}, ${dateKey}: no objective`);
      (days[dateKey] ||= {})[dc.id] = entry;
    }
  }

  return {
    data: {
      format: DISPLAY_FORMAT,
      version: DISPLAY_FORMAT_VERSION,
      weekOf: mondayStr,
      exportedAt: localIsoNow(now),
      classes,
      days,
    },
    warnings,
  };
}
