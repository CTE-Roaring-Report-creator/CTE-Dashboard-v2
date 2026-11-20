# Changes — Nov 19, 2026

Storage rewrite (IndexedDB + GitHub sync) from August, plus fixes found in review.

## Data safety
- **Screens refresh when storage changes underneath them.** Connecting a device, importing from Drive, restoring a backup, or a background pull with changes from another device now reloads the app (or shows a "Reload now" banner if you were mid-edit). Previously the screens kept an old copy and the next edit saved it over newer data.
- **App always holds the current curricula.** Phase 1 now reports every edit to App, and App saves only the course that changed. Previously Phase 2 edits saved a startup copy of all four courses over Phase 1 work.
- **No pushes until a device's first pull fully succeeds.** A partly failed first connection can no longer send seed data to GitHub.
- **One save timer per course** in Phase 1 and Phase 2, so switching courses quickly can't drop an edit.
- **Drive import asks first**, and warns if it has already been run.
- **Leftover changes are sent on startup** instead of waiting for the next edit.

## Smaller fixes
- Dates use local time, not UTC ("today" was tomorrow after 4 PM).
- A device with no token shows "Read-only" and no longer warns on every close.
- Conflict notes say whether both versions were kept or the newest one won.
- `vite.config.js` base is `./`, so the build works under any repo name or on Netlify.
- Removed the duplicate `fontSize` key in the Add Unit button.

## Files changed
`src/driveStorage.js`, `src/App.jsx`, `src/SyncPanel.jsx`, `src/BellRingerPush.jsx`, `src/Phase3.jsx`,
`src/Phase2.jsx`, `src/CTECurriculumDashboard.jsx`, `vite.config.js`.
