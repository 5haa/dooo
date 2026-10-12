# Dooo

Floating project cards for your Windows desktop.

![Dooo](docs/screenshot.png)

## Using Dooo

- **Open tasks:** click a project card to expand its task list. Click its header again to collapse it.
- **Move:** drag a card by its header. Each project is a separate native window and moves independently.
- **Plus controls:** drag the plus anywhere on the desktop; near the left or right edge it snaps into a small tab. Click it for a compact icon tray. Hover an icon for its label. Use the folder-plus to create a project, the colored folder icons to restore one, and the eye, minus, chevrons, or grid to show, minimize, expand, collapse, or arrange cards. The gear reveals settings.
- **Add:** type in the bottom input and press Enter. Click empty space in the task list or press Ctrl+N to focus task entry.
- **Complete:** click a task's circle, or focus the row and press Space. The check, strike-through, and progress ring animate; the task stays in the same place. Click again to restore it.
- **Optional details:** click the sliders icon for priority, date, or time. Only assigned details appear on a task. The eraser icon removes all three.
- **Edit:** click a task, edit it in the bottom input, and press Enter or the check icon. The cancel icon restores any unfinished new-task draft. Collapsing a card preserves its draft.
- **Rename:** expand the card and click its pencil icon.
- **Reorder:** drag an unfinished task onto another, or focus it and press Alt+Up / Alt+Down. Completed tasks stay in place.
- **Delete:** hover or focus a row to reveal its delete button, or press Delete on the row. An undo icon appears in the toolbar briefly after a change, without moving the task list.
- **Clear completed:** use the project's ellipsis menu. This affects only that project and offers Undo.
- **Drop text:** drop text into an expanded card to create one task per line, up to 20 lines.
- **Minimize:** use the small minus revealed at the top-right of a card, its options menu, or Alt+F4. Restore it through the edge controls or tray.
- **Resize:** expand a card and drag its bottom-right handle. Arrow keys on the handle resize by 10 px, or 40 px with Shift.

Each card has a white surface, a thin dark outline, and a small offset shadow. There is no shared dashboard background. Rings show actual completed tasks as a percentage of that project's total. Completed rows remain visible until you explicitly delete or clear them. Motion respects the system's reduced-motion preference.

## Window and settings

Expanded cards support widths from 300 to 800 px, constrained to the display, and heights from 280 px to the available screen height. Collapsed cards are 120 px tall including transparent margins. Each project's position, size, visibility, and expansion state are saved separately. The plus position is also saved. Opening its icon tray keeps the plus in place and chooses the side with room.

The edge control stays available while cards are minimized. **Arrange projects** shows and collapses the cards into rows and columns. **Show all tasks** expands them at their current positions; you can then move them wherever you want.

**Keep on top** and **Launch at startup** are available under the gear in the icon tray, and in the Windows tray. Packaged builds open at sign-in by default, without stealing focus. Clicking the tray icon or launching Dooo again shows all cards. Use Quit in the tray menu to exit.

## Keyboard shortcuts

With cloud AI configured, new tasks save immediately and Claude Haiku simplifies their wording in the background. The small sparkle button toggles this on or off. Editing an existing task always keeps your exact wording. Undo restores the original text; hovering a rewritten title also shows what you typed. If AI is unavailable, the original task stays saved.

When you create a project, Dooo looks for an exactly matching folder on your Desktop (including folders inside `projects`). It saves the folder location and builds a compact memory from README/architecture documents, package manifests and filenames. The project menu's folder icon lets you link or change a folder when there is no unique match; hover it to see the saved path. The refresh icon rebuilds that project's context. Context refreshes on use after five minutes. AI combines this memory with the project's existing tasks; it does not read every source file or execute code.

| Keys | Action |
| --- | --- |
| Arrows on the plus | Move it by 10 px, or 40 px with Shift |
| Ctrl+N | Expand the project and focus task entry |
| Enter | Add/save a task, or edit a focused row |
| Space on a task | Complete or restore it |
| Up / Down on a task | Focus the previous / next task |
| Alt+Up / Alt+Down | Reorder an unfinished task |
| Delete on a task | Delete it |
| Esc | Close the menu, cancel editing, hide details, or collapse the card |
| Arrows on the resize handle | Resize by 10 px, or 40 px with Shift |

## Install

Requires Windows 10/11 and Node.js 20+ (built with Node 24).

```
npm install
npm run dist
```

The installer is created at `dist\Dooo-Setup-1.0.0.exe`. It installs for the current user, creates shortcuts, and launches Dooo. The installer is unsigned, so Windows SmartScreen may display a warning.

Uninstall through Windows Settings > Apps. Uninstalling removes the startup entry and keeps your task data.

## Development

| Command | Action |
| --- | --- |
| `npm start` | Run from source |
| `npm run test:unit` | Check geometry, project isolation, migration, and startup integration |
| `npm run test:e2e` | Test real Electron windows with disposable data |
| `npm run start:server` | Run the PostgreSQL-backed cloud sync API |
| `npm run test:cloud` | Test merge rules, authentication, offline replay and PostgreSQL sync |
| `npm run test:cloud:e2e` | Test Electron → API → PostgreSQL and incoming cloud updates |
| `npm run test:ai` | Check folder discovery, context filtering, AI validation and authenticated requests |
| `npm run test:ai:e2e` | Check real Electron rewriting, immediate saving, undo, offline fallback and folder linking |
| `npm run pack` | Build the unpacked app in `dist\win-unpacked\` |
| `npm run dist` | Build the Windows installer |

End-to-end tests cover the screen-edge dock, floating windows, expanded task entry, retained completed rows, animated state changes, concurrent project edits, independent dragging, minimize/restore/arrange, optional details, editing, resizing, text drop, settings, and restart persistence. Screenshots go to `test-results\`.

In development, F12 or Ctrl+Shift+I opens DevTools; Ctrl+R reloads the current card.

## Your data

Tasks and projects sync to your private Railway service when cloud sync is configured. The desktop retains a durable local cache, so it works offline and retries automatically. Window positions and app preferences stay on this computer. Packaged builds use `%APPDATA%\Dooo\`; development uses `%APPDATA%\Dooo-dev\`.

- `tasks.json`: tasks, completion, project membership, and optional details.
- `settings.json`: projects, each floating window's layout, the plus position, and application settings.
- `window-state.json`: retained legacy single-window layout data.
- `cloud.json`: the sync service URL and access key (encrypted with Windows protection on startup).
- `cloud-state.json`: the last acknowledged cloud snapshot, used to merge offline changes safely.

Writes are atomic and retain a `.bak` copy. Each renderer can save only its own project's tasks. The main process handles authenticated HTTPS sync; renderer web requests remain blocked and the access key is never exposed to a card. Check the Windows tray menu for cloud status or use **Sync now**.

The server checks a revision before saving. Concurrent edits to different fields or tasks are merged, and unchanged local records adopt remote changes and deletions. For simultaneous edits to the same field, the pending local edit wins on retry. Changes made during a request are retained for the next sync. Existing task notes and review context are preserved.

See [Cloud deployment and connection](docs/cloud.md) for Railway setup, connecting another computer, recovery, and integration-test commands. This deploys the cloud backend; the floating-window interface remains a native Windows app.

Set `DOOO_USER_DATA_DIR=<folder>` for isolated data and `DOOO_DISABLE_AUTOSTART=1` to leave startup registration alone. Development runs already leave startup registration alone.

Set `DOOO_PROJECT_ROOT=<folder>` to use an isolated desktop for discovery tests, or `DOOO_DISABLE_PROJECT_DISCOVERY=1` to disable filesystem discovery. Folder locations and sanitized project memory sync to PostgreSQL; machine-local folder mappings remain in settings. A path received from the cloud is never automatically opened on another computer. Documentation context is sent to OpenRouter only when rewriting a task. Environment/credential files, dependencies, generated artifacts, repository instructions and symlinks are excluded. Recognizable credential strings in documentation are redacted; keep private credentials in environment files rather than project documentation.

## Project layout

| Path | Contents |
| --- | --- |
| `src/main/` | Floating-window coordinator, scoped persistence, tray, startup |
| `src/preload/` | Sandboxed renderer API |
| `src/renderer/` | Project card, task dropdown, edge controls, styles, bundled font |
| `src/server/` | Authenticated sync API and PostgreSQL persistence |
| `src/shared/` | Workspace validation and three-way merge rules |
| `src/assets/` | App and tray icons |
| `build/` | Installer resources |
| `tests/` | Unit and multi-window end-to-end checks |

## Credits

[Electron](https://www.electronjs.org), [electron-builder](https://www.electron.build), [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) (SIL Open Font License), and [Lucide](https://lucide.dev)-style icons (ISC License).
