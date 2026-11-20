// ─────────────────────────────────────────────────────────────────────────────
// Weekly Post Pack
//
// Replaces the old "Push to Google Form & Classroom" automation, which depended
// on the Apps Script processPush pipeline. This builds the same text the script
// used to write and hands it over for pasting into the Form and Classroom.
//
// Filename kept as BellRingerPush.jsx so Phase2's import doesn't change.
// Props are unchanged. driveReady is accepted and ignored.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, Check, AlertTriangle, Copy, ClipboardCheck, Settings, X, ExternalLink } from "lucide-react";
import { loadPushConfig, savePushConfig } from './driveStorage';

// ─── THEME (mirrors Phase 2) ──────────────────────────────────────────────────

const D = {
  bg0: "#0f1117", bg1: "#161b27", bg2: "#1e2436", bg3: "#252b40",
  border0: "#1e2436", border1: "#2a3050", border2: "#3a4468",
  text0: "#f0ede8", text1: "#9ca3b8", text2: "#5a6380",
};

const btnStyle = {
  display: "inline-flex", alignItems: "center", gap: 7,
  padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
  border: `1.5px solid ${D.border1}`, cursor: "pointer",
  background: D.bg2, color: D.text1, fontFamily: "inherit", whiteSpace: "nowrap",
};

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "8px 11px",
  border: `1.5px solid ${D.border1}`, borderRadius: 7,
  fontSize: 13, background: D.bg3, color: D.text0,
  outline: "none", fontFamily: "inherit",
};

const DAY_NAMES   = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DAY_SHORT   = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const MONTH_NAMES = ["January","February","March","April","May","June",
                     "July","August","September","October","November","December"];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateStr(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addDays(dateString, n) {
  const d = parseDate(dateString);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}

function getMondayOf(dateString) {
  const d = parseDate(dateString);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return dateStr(d);
}

function formatDateLabel(input) {
  const d = parseDate(input);
  const idx = d.getDay() - 1;
  const name = DAY_NAMES[idx] || d.toLocaleDateString("en-US", { weekday: "long" });
  return `${name} - ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

function formatWeekLabel(mondayStr) {
  const mon = parseDate(mondayStr);
  const fri = new Date(mon); fri.setDate(fri.getDate() + 4);
  const monLabel = `${MONTH_NAMES[mon.getMonth()]} ${mon.getDate()}`;
  const friLabel = mon.getMonth() === fri.getMonth()
    ? String(fri.getDate())
    : `${MONTH_NAMES[fri.getMonth()]} ${fri.getDate()}`;
  return `${monLabel} – ${friLabel}`;
}

function getBellRinger(lesson, dayIndex) {
  if (!lesson) return "";
  if (Array.isArray(lesson.bellRingers)) return lesson.bellRingers[(dayIndex || 1) - 1] || "";
  if (typeof lesson.bellRinger === "string" && lesson.bellRinger) return dayIndex === 1 ? lesson.bellRinger : "";
  return "";
}

function computeWeekNumber(mondayStr, calendarConfig) {
  if (!calendarConfig?.startDate || !mondayStr) return null;
  const mon = parseDate(mondayStr);
  const niSet = new Set(calendarConfig.nonInstructional || []);

  let startMonday;
  if (calendarConfig.semester2StartDate) {
    const s2Start = parseDate(calendarConfig.semester2StartDate);
    if (mon >= s2Start) startMonday = getMondayOf(calendarConfig.semester2StartDate);
  }
  if (!startMonday) startMonday = getMondayOf(calendarConfig.startDate);

  let weekNum = 0;
  let cursor = startMonday;
  while (cursor <= mondayStr) {
    let hasInstructionalDay = false;
    for (let d = 0; d < 5; d++) {
      if (!niSet.has(addDays(cursor, d))) { hasInstructionalDay = true; break; }
    }
    if (hasInstructionalDay) weekNum++;
    cursor = addDays(cursor, 7);
  }
  return weekNum >= 1 ? weekNum : null;
}

function buildFormName(weekNum) {
  return `Week ${weekNum} Bell Work`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    // The Clipboard API is blocked on some managed browsers — fall back.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (_) { return false; }
  }
}

// ─── COPY BLOCK ──────────────────────────────────────────────────────────────

function CopyBlock({ title, hint, text }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(text);
    if (ok) { setCopied(true); setFailed(false); setTimeout(() => setCopied(false), 2000); }
    else setFailed(true);
  };

  return (
    <div style={{ border: `1px solid ${D.border0}`, borderRadius: 8, overflow: "hidden", background: D.bg0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                    borderBottom: `1px solid ${D.border0}`, background: D.bg1 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: D.text0 }}>{title}</div>
          {hint && <div style={{ fontSize: 11, color: D.text2, marginTop: 1 }}>{hint}</div>}
        </div>
        <button onClick={handleCopy} style={{
          ...btnStyle, padding: "5px 11px", fontSize: 12,
          background: copied ? "#0d2d1a" : D.bg2,
          color: copied ? "#22c55e" : D.text1,
          borderColor: copied ? "#1a5433" : D.border1,
        }}>
          {copied ? <ClipboardCheck size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre style={{
        margin: 0, padding: "11px 13px", fontSize: 12, lineHeight: 1.65,
        color: D.text1, whiteSpace: "pre-wrap", wordBreak: "break-word",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        maxHeight: 260, overflowY: "auto",
      }}>{text}</pre>
      {failed && (
        <div style={{ padding: "7px 13px", fontSize: 11, color: "#f59e0b", borderTop: `1px solid ${D.border0}` }}>
          This browser blocked the clipboard. Select the text above and copy it manually.
        </div>
      )}
    </div>
  );
}

// ─── CONFIG MODAL ─────────────────────────────────────────────────────────────

function ConfigModal({ courseName, config, onSave, onClose }) {
  const [bellWorkFolderUrl, setBellWorkFolderUrl] = useState(config?.bellWorkFolderUrl || "");
  const [classroomUrls,     setClassroomUrls]     = useState(config?.classroomUrls     || "");

  const handleSave = () => {
    onSave({
      ...(config || {}),
      bellWorkFolderUrl: bellWorkFolderUrl.trim(),
      classroomUrls:     classroomUrls.trim(),
    });
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.65)",
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
         onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: D.bg2, border: `1.5px solid ${D.border1}`, borderRadius: 12,
        width: "100%", maxWidth: 520, maxHeight: "calc(100vh - 40px)", overflowY: "auto",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
      }}>
        <div style={{ padding: "16px 20px 12px", borderBottom: `1.5px solid ${D.border1}`,
                      display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: D.text0 }}>Post Pack shortcuts</div>
            <div style={{ fontSize: 12, color: D.text2, marginTop: 2 }}>{courseName}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: D.text1, padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ padding: "12px 14px", borderRadius: 8, background: "#0d1f3d",
                        border: "1px solid #1a3a6b", fontSize: 12, color: "#7aabf0", lineHeight: 1.7 }}>
            Optional. These put working links at the top of the pack so you aren't hunting
            through tabs on Monday morning.
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: D.text2, letterSpacing: "0.06em",
                            textTransform: "uppercase", display: "block", marginBottom: 6 }}>
              Bell Work folder link
            </label>
            <input style={inputStyle} value={bellWorkFolderUrl} onChange={e => setBellWorkFolderUrl(e.target.value)}
                   placeholder="https://drive.google.com/drive/folders/…" />
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: D.text2, letterSpacing: "0.06em",
                            textTransform: "uppercase", display: "block", marginBottom: 6 }}>
              Classroom links
            </label>
            <input style={inputStyle} value={classroomUrls} onChange={e => setClassroomUrls(e.target.value)}
                   placeholder="https://classroom.google.com/c/… , https://classroom.google.com/c/…" />
            <div style={{ fontSize: 11, color: D.text2, marginTop: 4 }}>
              Comma-separated, one per section.
            </div>
          </div>
        </div>

        <div style={{ padding: "12px 20px", borderTop: `1.5px solid ${D.border1}`,
                      display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={btnStyle}>Cancel</button>
          <button onClick={handleSave} style={{ ...btnStyle, background: "#1a56c4", color: "white",
                                                borderColor: "#1a56c4", fontWeight: 600 }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function BellRingerPush({
  courseId,
  courseName,
  weekDates,
  mapping,
  lessonMap,
  niSet,
  calendarConfig,
  pathwayColor,
  mondayStr,
  driveReady, // accepted for compatibility, no longer used
}) {
  const [expanded,   setExpanded]   = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [config,     setConfig]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadPushConfig(courseId).then(cfg => { if (!cancelled) setConfig(cfg); });
    return () => { cancelled = true; };
  }, [courseId]);

  // ── This week's data ────────────────────────────────────────────────────────
  const weekData = weekDates.map((d, i) => {
    if (niSet.has(d)) return { date: d, dayName: DAY_NAMES[i], type: "ni" };
    const dayMeta = mapping?.[d];
    if (!dayMeta || dayMeta.type === "block") {
      return { date: d, dayName: DAY_NAMES[i], type: dayMeta?.type || "empty", label: dayMeta?.label };
    }
    const lesson = lessonMap[dayMeta.lessonId];
    return {
      date: d,
      dayName: DAY_NAMES[i],
      type: "lesson",
      bellRinger: getBellRinger(lesson, dayMeta.dayIndex || 1),
      lessonTitle: lesson?.title || "",
      dayIndex: dayMeta.dayIndex || 1,
      totalDays: dayMeta.totalDays || 1,
    };
  });

  const instructionalDays = weekData.filter(d => d.type === "lesson");
  const daysWithQ         = instructionalDays.filter(d => d.bellRinger);
  const daysWithoutQ      = instructionalDays.filter(d => !d.bellRinger);
  const allFilled         = daysWithoutQ.length === 0 && daysWithQ.length > 0;

  const weekNum    = computeWeekNumber(mondayStr, calendarConfig);
  const weekLabel  = formatWeekLabel(mondayStr);
  const topicLabel = weekNum ? `Week ${weekNum}: ${weekLabel}` : `Week of ${weekLabel}`;
  const formName   = weekNum ? buildFormName(weekNum) : `Bell Work – ${weekLabel}`;

  // ── Build the pack ──────────────────────────────────────────────────────────

  const formQuestionsText = instructionalDays.length === 0
    ? "No lessons scheduled this week."
    : weekData
        .filter(d => d.type === "lesson")
        .map(d => `${formatDateLabel(d.date)}\n${d.bellRinger || "[ no bell ringer written yet ]"}`)
        .join("\n\n");

  const classroomText = (() => {
    const lines = [topicLabel, "", `Bell work for this week: ${formName}`, ""];
    weekData.forEach(d => {
      if (d.type === "ni")    { lines.push(`${d.dayName} — no school`); return; }
      if (d.type === "block") { lines.push(`${d.dayName} — ${d.label || "no class"}`); return; }
      if (d.type === "empty") { lines.push(`${d.dayName} — no lesson scheduled`); return; }
      const dayTag = d.totalDays > 1 ? ` (day ${d.dayIndex} of ${d.totalDays})` : "";
      lines.push(`${d.dayName} — ${d.lessonTitle || "Untitled lesson"}${dayTag}`);
    });
    return lines.join("\n");
  })();

  const checklistText = (() => {
    const lines = [`${courseName} · ${topicLabel}`, ""];
    if (config?.bellWorkFolderUrl) lines.push(`Bell Work folder: ${config.bellWorkFolderUrl}`);
    (config?.classroomUrls || "").split(",").map(s => s.trim()).filter(Boolean)
      .forEach((u, i) => lines.push(`Classroom ${i + 1}: ${u}`));
    if (lines.length > 2) lines.push("");
    lines.push(`1. Copy last week's form, rename it "${formName}"`);
    lines.push(`2. Paste the bell ringer questions into the form`);
    lines.push(`3. Set the date picker to show only days up to today`);
    lines.push(`4. Post the week overview to Classroom under topic "${topicLabel}"`);
    lines.push(`5. Attach the form to the Classroom post`);
    return lines.join("\n");
  })();

  const everythingText = [
    `═══ ${courseName} · ${topicLabel} ═══`, "",
    "── BELL RINGER QUESTIONS ──", formQuestionsText, "",
    "── CLASSROOM POST ──", classroomText, "",
    "── CHECKLIST ──", checklistText,
  ].join("\n");

  const classroomLinks = (config?.classroomUrls || "").split(",").map(s => s.trim()).filter(Boolean);

  return (
    <>
      {showConfig && (
        <ConfigModal
          courseName={courseName}
          config={config}
          onSave={(cfg) => { setConfig(cfg); savePushConfig(courseId, cfg); }}
          onClose={() => setShowConfig(false)}
        />
      )}

      <div style={{ marginTop: 10, borderRadius: 10, border: `1.5px solid ${D.border1}`,
                    overflow: "hidden", background: D.bg1 }}>

        {/* Header */}
        <div onClick={() => setExpanded(e => !e)} style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px", cursor: "pointer", userSelect: "none",
          borderBottom: expanded ? `1px solid ${D.border0}` : "none",
        }}>
          <span style={{ fontSize: 15 }}>📋</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: D.text0, flex: 1 }}>
            Weekly Post Pack
          </span>

          {!expanded && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {allFilled
                ? <span style={{ fontSize: 11, color: "#22c55e", display: "flex", alignItems: "center", gap: 4 }}>
                    <Check size={11} /> Ready
                  </span>
                : daysWithoutQ.length > 0
                  ? <span style={{ fontSize: 11, color: "#f59e0b", display: "flex", alignItems: "center", gap: 4 }}>
                      <AlertTriangle size={11} /> {daysWithoutQ.length} missing
                    </span>
                  : null}
              <span style={{ fontSize: 11, color: D.text2 }}>{formName}</span>
            </div>
          )}

          <button
            onClick={e => { e.stopPropagation(); setShowConfig(true); }}
            title="Set folder and Classroom links"
            style={{ background: "none", border: "none", cursor: "pointer", color: D.text2, padding: 4, display: "flex" }}
          >
            <Settings size={14} />
          </button>
          {expanded ? <ChevronUp size={15} color={D.text2} /> : <ChevronDown size={15} color={D.text2} />}
        </div>

        {/* Expanded */}
        {expanded && (
          <div>

            {/* Week readout */}
            <div style={{ padding: "9px 16px", borderBottom: `1px solid ${D.border0}`, background: D.bg0,
                          display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: D.text2 }}>
                Form name:&nbsp;<strong style={{ color: D.text0 }}>{formName}</strong>
              </span>
              <span style={{ fontSize: 11, color: D.text2 }}>
                Week:&nbsp;
                <strong style={{ color: weekNum ? D.text1 : "#f97316" }}>
                  {weekNum ?? "set the semester start date in Calendar Setup"}
                </strong>
              </span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: allFilled ? "#22c55e" : daysWithoutQ.length > 0 ? "#f59e0b" : D.text2 }}>
                {daysWithQ.length}/{instructionalDays.length} bell ringers written
              </span>
            </div>

            {/* Day grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)" }}>
              {weekData.map((day, i) => {
                const isLast = i === weekData.length - 1;
                const hasQ = day.type === "lesson" && !!day.bellRinger;
                const noQ  = day.type === "lesson" && !day.bellRinger;
                return (
                  <div key={day.date} style={{
                    padding: "10px 12px",
                    borderRight: isLast ? "none" : `1px solid ${D.border0}`,
                    borderBottom: `1px solid ${D.border0}`,
                    background: day.type === "ni" ? "#130a0a" : D.bg1,
                    minHeight: 90, display: "flex", flexDirection: "column", gap: 5,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: D.text2,
                                     letterSpacing: "0.06em", textTransform: "uppercase" }}>
                        {DAY_SHORT[i]}
                      </span>
                      {hasQ && <Check size={12} color="#22c55e" />}
                      {noQ  && <AlertTriangle size={12} color="#f59e0b" />}
                    </div>
                    {day.type !== "ni" && (
                      <div style={{ fontSize: 10, color: D.text2 }}>
                        {formatDateLabel(day.date).split(" - ")[1]}
                      </div>
                    )}
                    {day.type === "ni"    && <span style={{ fontSize: 11, color: D.text2, fontStyle: "italic" }}>No school</span>}
                    {day.type === "block" && <span style={{ fontSize: 11, color: "#f97316", fontStyle: "italic" }}>{day.label || "Blocked"}</span>}
                    {day.type === "empty" && <span style={{ fontSize: 11, color: D.text2, fontStyle: "italic" }}>No lesson</span>}
                    {day.type === "lesson" && (
                      day.bellRinger
                        ? <p style={{ margin: 0, fontSize: 12, color: D.text0, lineHeight: 1.5, flex: 1 }}>{day.bellRinger}</p>
                        : <p style={{ margin: 0, fontSize: 11, color: "#f59e0b", fontStyle: "italic", flex: 1 }}>Missing — add in Phase 1</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Copy blocks */}
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: D.text2 }}>
                  Paste these into the Form and Classroom — about five minutes.
                </span>
                <div style={{ flex: 1 }} />
                {classroomLinks.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noopener noreferrer"
                     style={{ ...btnStyle, textDecoration: "none", padding: "5px 11px", fontSize: 12 }}>
                    <ExternalLink size={12} /> Classroom {classroomLinks.length > 1 ? i + 1 : ""}
                  </a>
                ))}
                {config?.bellWorkFolderUrl && (
                  <a href={config.bellWorkFolderUrl} target="_blank" rel="noopener noreferrer"
                     style={{ ...btnStyle, textDecoration: "none", padding: "5px 11px", fontSize: 12 }}>
                    <ExternalLink size={12} /> Bell Work folder
                  </a>
                )}
              </div>

              <CopyBlock
                title="Bell ringer questions"
                hint={`For the form titled "${formName}"`}
                text={formQuestionsText}
              />

              <CopyBlock
                title="Classroom post"
                hint={`Topic: ${topicLabel}`}
                text={classroomText}
              />

              <CopyBlock
                title="Checklist"
                hint="The order to do it in"
                text={checklistText}
              />

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <CopyEverything text={everythingText} accent={pathwayColor} />
              </div>

            </div>
          </div>
        )}
      </div>
    </>
  );
}

function CopyEverything({ text, accent }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        const ok = await copyText(text);
        if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
      }}
      style={{
        ...btnStyle, fontWeight: 600,
        background: copied ? "#0d2d1a" : accent,
        color: copied ? "#22c55e" : "white",
        borderColor: copied ? "#1a5433" : accent,
      }}
    >
      {copied ? <ClipboardCheck size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : "Copy the whole pack"}
    </button>
  );
}
