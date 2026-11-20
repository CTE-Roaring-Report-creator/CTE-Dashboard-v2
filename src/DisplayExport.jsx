import { useState, useEffect, useMemo } from "react";
import { Download, Monitor, AlertTriangle, Check } from "lucide-react";
import {
  buildWeekExport, displayClassForCourse, agendaLines,
  DEFAULT_STANDING_AGENDA, weekdaysOf,
} from "./displayExport";

const D = {
  bg1: "#161b27", bg2: "#1e2436", bg3: "#252b40",
  border0: "#1e2436", border1: "#2a3050",
  text0: "#f0ede8", text1: "#9ca3b8", text2: "#5a6380",
};

const btn = {
  display: "inline-flex", alignItems: "center", gap: 7,
  padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
  border: `1.5px solid ${D.border1}`, cursor: "pointer",
  background: D.bg2, color: D.text1, fontFamily: "inherit", whiteSpace: "nowrap",
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

const STATUS_TEXT = { sub: "Sub day", event: null, noClass: null };

export default function DisplayExport({
  selectedCourse, mondayStr, curricula, mappings, calendarConfig, subDays,
  displaySettings, onDisplaySettingsChange, pathwayColor,
}) {
  const displayClass = displayClassForCourse(selectedCourse);
  const standing = displaySettings?.agendas?.[displayClass?.id] || DEFAULT_STANDING_AGENDA;

  const [draft, setDraft] = useState(standing.join("\n"));
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    setDraft(standing.join("\n"));
    setDirty(false);
  }, [displayClass?.id, displaySettings]);

  useEffect(() => { setResult(null); }, [mondayStr]);

  const built = useMemo(() => buildWeekExport({
    mondayStr, curricula, mappings, calendarConfig, subDays, displaySettings,
  }), [mondayStr, curricula, mappings, calendarConfig, subDays, displaySettings]);

  if (!displayClass) return null;

  const saveStanding = () => {
    const steps = agendaLines(draft);
    const next = {
      ...(displaySettings || {}),
      agendas: { ...(displaySettings?.agendas || {}), [displayClass.id]: steps.length ? steps : DEFAULT_STANDING_AGENDA },
    };
    onDisplaySettingsChange(next);
    setDirty(false);
  };

  const doExport = () => {
    const blob = new Blob([JSON.stringify(built.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `classroom-display-week-${mondayStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const dayCount = Object.keys(built.data.days).length;
    setResult({
      kind: built.warnings.length ? "warn" : "ok",
      text: `Saved ${a.download}: ${built.data.classes.length} class${built.data.classes.length !== 1 ? "es" : ""}, ${dayCount} day${dayCount !== 1 ? "s" : ""}.`,
    });
  };

  const dates = weekdaysOf(mondayStr);

  return (
    <div style={{
      marginTop: 20, borderRadius: 12, border: `1.5px solid ${D.border1}`,
      background: D.bg1, overflow: "hidden",
    }}>
      <div style={{
        padding: "12px 18px", borderBottom: `1px solid ${D.border0}`,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <Monitor size={15} color={pathwayColor} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: D.text0 }}>Classroom Display</div>
          <div style={{ fontSize: 11, color: D.text2 }}>
            What the TV shows for {displayClass.name} this week
          </div>
        </div>
        <button onClick={doExport} disabled={dirty}
          title={dirty ? "Save the standing agenda first" : "Exports all three classes"}
          style={{ ...btn, background: pathwayColor, color: "white", borderColor: pathwayColor, fontWeight: 600,
                   opacity: dirty ? 0.5 : 1, cursor: dirty ? "not-allowed" : "pointer" }}>
          <Download size={13} /> Export week for display
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 2.2fr", gap: 0 }}>
        {/* Standing agenda */}
        <div style={{ padding: "14px 18px", borderRight: `1px solid ${D.border0}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: D.text2, letterSpacing: "0.06em",
                        textTransform: "uppercase", marginBottom: 6 }}>
            Standing agenda
          </div>
          <textarea
            value={draft}
            onChange={e => { setDraft(e.target.value); setDirty(true); }}
            style={{
              width: "100%", boxSizing: "border-box", minHeight: 96, resize: "vertical",
              padding: "8px 10px", borderRadius: 7, fontSize: 13, lineHeight: 1.6,
              border: `1.5px solid ${dirty ? pathwayColor : D.border1}`,
              background: D.bg3, color: D.text0, fontFamily: "inherit", outline: "none",
            }}
          />
          <div style={{ fontSize: 11, color: D.text2, marginTop: 4, lineHeight: 1.5 }}>
            One step per line. <code style={{ color: D.text1 }}>{"{lesson}"}</code> becomes the day's lesson.
            Change a single day from its detail panel.
          </div>
          {dirty && (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={saveStanding}
                style={{ ...btn, padding: "5px 12px", fontSize: 12, color: pathwayColor, borderColor: `${pathwayColor}60` }}>
                Save agenda
              </button>
              <button onClick={() => { setDraft(standing.join("\n")); setDirty(false); }}
                style={{ ...btn, padding: "5px 12px", fontSize: 12 }}>
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Week preview */}
        <div style={{ padding: "10px 0" }}>
          {dates.map((dateKey, i) => {
            const entry = built.data.days[dateKey]?.[displayClass.id];
            return (
              <div key={dateKey} style={{
                display: "grid", gridTemplateColumns: "44px 1fr", gap: 10,
                padding: "8px 18px", borderBottom: i < 4 ? `1px solid ${D.border0}` : "none",
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: D.text1, paddingTop: 1 }}>{DAY_NAMES[i]}</div>
                <PreviewRow entry={entry} pathwayColor={pathwayColor} />
              </div>
            );
          })}
        </div>
      </div>

      {(result || built.warnings.length > 0) && (
        <div style={{ padding: "10px 18px", borderTop: `1px solid ${D.border0}`, fontSize: 12, lineHeight: 1.6 }}>
          {result && (
            <div style={{ display: "flex", gap: 7, alignItems: "center",
                          color: result.kind === "ok" ? "#22c55e" : "#f59e0b" }}>
              {result.kind === "ok" ? <Check size={13} /> : <AlertTriangle size={13} />}
              {result.text}
            </div>
          )}
          {built.warnings.map((w, i) => (
            <div key={i} style={{ color: "#f59e0b" }}>· {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewRow({ entry, pathwayColor }) {
  if (!entry) {
    return <div style={{ fontSize: 12, color: D.text2, fontStyle: "italic" }}>Nothing planned — the display uses its own settings</div>;
  }
  if (entry.status === "noClass" || entry.status === "event") {
    return <div style={{ fontSize: 13, color: "#f97316" }}>{entry.label}</div>;
  }
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: D.text0 }}>
        {entry.lesson}
        {entry.totalDays > 1 && (
          <span style={{ fontWeight: 400, color: D.text2 }}> · Day {entry.day} of {entry.totalDays}</span>
        )}
        {STATUS_TEXT[entry.status] && (
          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#f59e0b" }}>{STATUS_TEXT[entry.status]}</span>
        )}
        {entry.slidesUrl && (
          <span style={{ marginLeft: 8, fontSize: 11, color: pathwayColor }}>Slides ✓</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: entry.objective ? D.text1 : "#f59e0b", marginTop: 2 }}>
        {entry.objective || "No objective"}
      </div>
      <div style={{ fontSize: 12, color: D.text2, marginTop: 2 }}>
        {entry.agenda.join("  →  ")}
      </div>
    </div>
  );
}
