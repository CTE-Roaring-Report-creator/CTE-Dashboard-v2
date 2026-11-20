import { useState, useRef, useEffect, useCallback } from "react";
import Phase1 from "./CTECurriculumDashboard";
import Phase2 from "./Phase2";
import Phase3 from "./Phase3.jsx";
import SyncPanel from "./SyncPanel";
import { initStorage, saveCurriculum, onExternalChange, hasPendingWrites, reloadApp } from './driveStorage';

const PHASES = [
  { id: 1, label: "📚 Master Builder",   sub: "Phase 1" },
  { id: 2, label: "📅 Weekly Dashboard", sub: "Phase 2" },
  { id: 3, label: "🗓 Monthly Calendar", sub: "Phase 3" },
];

function loadSettingsSync() {
  try {
    const val = localStorage.getItem("app-settings");
    if (val) return JSON.parse(val);
  } catch (_) {}
  return { selectedCourse: "intro-tech", mediaYear: "media-a" };
}

function saveSettingsSync(s) {
  try {
    localStorage.setItem("app-settings", JSON.stringify(s));
  } catch (_) {}
}

export default function App() {
  const [phase, setPhase] = useState(3);
  const focusedWeekRef = useRef(null);

  // Storage boot state. `storageReady` is passed down as `driveReady` so the
  // phase components keep their existing prop contract — they use it to know
  // when it's safe to read.
  const [storageReady, setStorageReady] = useState(false);
  const [bootError, setBootError] = useState(null);

  // Lifted course state — shared between Phase 2 and Phase 3
  const [selectedCourse, setSelectedCourse] = useState(() => loadSettingsSync().selectedCourse || "intro-tech");
  const [mediaYear, setMediaYear]           = useState(() => loadSettingsSync().mediaYear    || "media-a");

  // Lifted curricula state — Phase 1 populates this, Phase 2 and 3 read from it
  const [curricula, setCurricula] = useState({});

  // Open the local database and pull the latest from GitHub before rendering.
  useEffect(() => {
    let cancelled = false;
    initStorage()
      .then(ok => {
        if (cancelled) return;
        if (!ok) setBootError("Local storage is unavailable. If you're in a private window, open the dashboard in a normal one.");
        setStorageReady(true);
      })
      .catch(err => {
        if (cancelled) return;
        console.error("[App] storage boot failed:", err);
        setBootError(err.message || "Could not start local storage.");
        setStorageReady(true); // let the app run on whatever is cached
      });
    return () => { cancelled = true; };
  }, []);

  // Phase 1 keeps this current on every edit (see onCurriculaLoaded), so it is
  // never a stale startup copy.
  const curriculaRef = useRef({});
  const handleCurriculaLoaded = useCallback((next) => {
    curriculaRef.current = next;
    setCurricula(next);
  }, []);

  // Called by Phase 2 when Bell Work, Classroom Instructions or resources are
  // edited. Saves only the course(s) that actually changed.
  const handleCurriculaChange = useCallback(async (newCurricula) => {
    const prev = curriculaRef.current;
    curriculaRef.current = newCurricula;
    setCurricula(newCurricula);
    for (const [courseId, data] of Object.entries(newCurricula)) {
      if (prev[courseId] !== data) await saveCurriculum(courseId, data);
    }
  }, []);

  // When another device's changes arrive in the background, the screens are
  // showing an old copy. Reload if it's safe; otherwise ask before editing.
  const [staleBanner, setStaleBanner] = useState(false);
  const lastInputAt = useRef(0);
  useEffect(() => {
    const mark = () => { lastInputAt.current = Date.now(); };
    window.addEventListener("keydown", mark, true);
    window.addEventListener("input", mark, true);
    const off = onExternalChange(async () => {
      const typingRecently = Date.now() - lastInputAt.current < 4000;
      if (!typingRecently && !(await hasPendingWrites())) reloadApp();
      else setStaleBanner(true);
    });
    return () => {
      off();
      window.removeEventListener("keydown", mark, true);
      window.removeEventListener("input", mark, true);
    };
  }, []);

  // Keep app-settings in sync whenever course changes
  useEffect(() => {
    const existing = loadSettingsSync();
    saveSettingsSync({ ...existing, selectedCourse, mediaYear });
  }, [selectedCourse, mediaYear]);

  // Increments whenever Phase 3 saves a calendar change — triggers Phase 2 to re-read
  const [calendarVersion, setCalendarVersion] = useState(0);
  const handleCalendarSaved = () => setCalendarVersion(v => v + 1);

  // Called by Phase 2 or Phase 3 when the user picks a different course
  const handleCourseChange = (courseId, newMediaYear) => {
    setSelectedCourse(courseId);
    if (newMediaYear) setMediaYear(newMediaYear);
  };

  // Called by Phase 3 day-click — jump to that week in Phase 2
  const handleGoToWeek = (dateStr) => {
    focusedWeekRef.current = dateStr;
    setPhase(2);
  };

  // Called by Phase 3 right-click → Open in Master Builder
  const focusedLessonRef = useRef(null);
  const handleGoToLesson = (courseId, lessonId) => {
    focusedLessonRef.current = { courseId, lessonId };
    setPhase(1);
  };

  // ── Boot screen — only while the local database is opening
  if (!storageReady) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', height: '100vh', background: '#0f1117', gap: 14 }}>
        <div style={{ fontSize: 26, fontWeight: 700, color: '#f0ede8' }}>CTE Curriculum Dashboard</div>
        <div style={{ fontSize: 14, color: '#9ca3b8' }}>Loading your curriculum…</div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", background: "#0f1117", minHeight: "100vh" }}>

      {bootError && (
        <div style={{
          padding: "10px 16px", background: "#2d1a0d", borderBottom: "1px solid #6b3a1a",
          color: "#f97316", fontSize: 13,
        }}>
          {bootError}
        </div>
      )}

      {staleBanner && (
        <div style={{
          position: "sticky", top: 0, zIndex: 9999,
          padding: "10px 16px", background: "#2d2000", borderBottom: "1px solid #6b4a00",
          color: "#f59e0b", fontSize: 13, display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ flex: 1 }}>
            Changes arrived from another device. Reload before editing so you don't save over them.
          </span>
          <button onClick={reloadApp} style={{
            padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer",
            background: "#f59e0b", color: "#1a1200", fontWeight: 700, fontSize: 13, fontFamily: "inherit",
          }}>
            Reload now
          </button>
        </div>
      )}

      {/* All phases stay mounted so storage stays in sync */}
      <div style={{ display: phase === 1 ? "block" : "none" }}>
        <Phase1
          isActive={phase === 1}
          focusedLesson={focusedLessonRef.current}
          onLessonFocused={() => { focusedLessonRef.current = null; }}
          onCurriculaLoaded={handleCurriculaLoaded}
          driveReady={storageReady}
        />
      </div>
      <div style={{ display: phase === 2 ? "block" : "none" }}>
        <Phase2
          isActive={phase === 2}
          calendarVersion={calendarVersion}
          selectedCourse={selectedCourse}
          mediaYear={mediaYear}
          curricula={curricula}
          driveReady={storageReady}
          onCurriculaChange={handleCurriculaChange}
          onCourseChange={handleCourseChange}
          focusedWeek={focusedWeekRef.current}
          onWeekFocused={() => { focusedWeekRef.current = null; }}
        />
      </div>
      <div style={{ display: phase === 3 ? "block" : "none" }}>
        <Phase3
          isActive={phase === 3}
          selectedCourse={selectedCourse}
          mediaYear={mediaYear}
          curricula={curricula}
          onCourseChange={handleCourseChange}
          onCalendarSaved={handleCalendarSaved}
          onGoToWeek={handleGoToWeek}
          onGoToLesson={handleGoToLesson}
        />
      </div>

      {/* Floating phase switcher */}
      <div style={{
        position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
        display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
        background: "#161b27", border: "1.5px solid #2a3050",
        borderRadius: 40, boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        zIndex: 9998,
      }}>
        {PHASES.map(p => (
          <button key={p.id} onClick={() => setPhase(p.id)} style={{
            padding: "8px 20px", borderRadius: 32, fontSize: 13,
            fontWeight: phase === p.id ? 700 : 400,
            border: "none", cursor: "pointer", fontFamily: "inherit",
            background: phase === p.id ? "#1a56c4" : "transparent",
            color: phase === p.id ? "white" : "#5a6380",
            transition: "all 0.15s",
          }}>
            {p.label}
          </button>
        ))}

        <div style={{ width: 1, height: 20, background: "#2a3050" }} />
        <SyncPanel />
      </div>

    </div>
  );
}
