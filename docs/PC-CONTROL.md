# Phone and PC control

Dooo can control an awake, unlocked Windows PC using UI-TARS 1.5 7B through OpenRouter. Claude Code and Codex are optional. Keep the Dooo desktop app running; no inbound PC ports, tunnel, or running coding session is needed.

## Connect your phone

1. On the PC, open Dooo's floating **+ → Settings → phone icon** to generate a fresh pairing code. **Connect phone** in the system-tray menu does the same thing. Reopen it whenever a code expires.
2. Open your Dooo service URL on the phone and enter the one-time code. It expires after ten minutes.
3. Install the web app using the browser menu. On iPhone, use **Share → Add to Home Screen**, then launch it from the Home Screen.
4. Tap the bell to enable approval notifications. The operating system must grant permission; notification delivery also depends on the phone's network and notification settings.
5. Use **Computer** to request a screen preview or give a short instruction. A task's play icon starts that task on the connected PC.

Choose **Browser** (the default) for a separate, persistent Chromium session. Its virtual pointer and keyboard act inside that browser without moving the Windows pointer or replacing the system clipboard. The browser stays hidden while working; **Open automation browser** in the PC tray lets you sign in to sites yourself between requests. This profile is separate from your normal Chrome/Edge sessions. Choose **Desktop** for native Windows apps; that mode uses the shared Windows mouse and keyboard. A second independent pointer for arbitrary native apps requires a separate Windows session or VM and is not provided here.

Routine clicks, typing, searches and navigation continue automatically. A small Haiku vision check examines the screenshot and proposed target before potentially consequential input. Actual deletion, sending messages, publishing, purchases, private-file sharing and security changes require one-use phone approval and trigger a notification. Clear delete targets and non-text Delete shortcuts always require approval. Unclear consequences also pause; failed classification stops the request without sending input. This is a model-based consequence check, not a guarantee that every sensitive action can be recognized. Each decision is followed by a fresh screen/target check. Approval expires after ten minutes and cannot be replayed.

Use **Stop** on the phone, **Pause PC control** in the tray, or **Ctrl + Alt + Esc** on Windows. An input action already handed to Windows cannot be undone by Stop. Locking Windows, sleeping, losing the connection, or editing/reclaiming a task stops further actions; interrupted runs are never replayed automatically.

A model saying `finished` creates **Ready to review**, leaving the todo open. Review the visible result and explicitly mark it done. Model success is not proof that a transaction or task succeeded. Tasks added to a project do not run automatically.

## Optional Claude Code and Codex

The existing Dooo MCP connection now exposes `computer_status`, `run_computer`, `get_computer_run`, and `stop_computer` alongside task/project tools. Reload the coding session to discover newly added tools. `get_computer_run` with `includeScreen: true` returns the latest PC screenshot for visual inspection, with its capture time. Only ask it to operate the PC when intended. It can hand short GUI steps to UI-TARS, using `mode: "browser"` by default or `mode: "desktop"` for native apps. Sensitive steps pause on the phone. It must record actual verification before using `complete_task`. The MCP tools cannot grant phone approvals.

## Monorepo

| Workspace | Role |
| --- | --- |
| `apps/desktop` | Electron entry scripts; established UI/main sources remain in `src/` to preserve packaging and existing MCP paths |
| `apps/api` | Railway API and PostgreSQL jobs; implementation in `src/server` |
| `apps/web` | Installable phone web app, served by the API |
| `apps/worker` | Local Windows host, approval policy, screenshot and action adapter |
| `packages/control` | Shared identifiers, validation, token comparison |
| `packages/ui-tars` | Build adapter for the pinned upstream SDK and native operator |
| `vendor/ui-tars` | Unmodified SDK, shared definitions, parser and NutJS operator from ByteDance; Apache-2.0 |

Upstream: [UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop), pinned at `3ac2cb8d946d78d5ff92ad17b318eaafa18c178c`. This includes the computer-use libraries, not another copy of the full upstream desktop application. See `vendor/ui-tars/UPSTREAM.md` and `LICENSE`. `npm run build:ui-tars` bundles the source; desktop start and packaging run it automatically.

## Configuration

The Railway API needs the existing `DATABASE_URL`, `DOOO_SYNC_TOKEN`, `DOOO_AGENT_TOKEN`, and `OPENROUTER_API_KEY`, plus:

- `DOOO_PUBLIC_ORIGIN`: exact HTTPS origin of the phone app.
- `DOOO_WORKER_TOKEN`: a separate random secret of at least 32 characters. Never reuse the sync or agent key.
- `DOOO_VAPID_PUBLIC_KEY` and `DOOO_VAPID_PRIVATE_KEY`: a Web Push keypair, generated with `web-push.generateVAPIDKeys()`. Keep it stable after phones subscribe.

The action model is fixed to `bytedance/ui-tars-1.5-7b`. Consequence checks use the configured `OPENROUTER_MODEL` (Haiku, also used for task rewriting), with a 20-second timeout and at most 40 checks per run. OpenRouter credentials stay on the server. Only the Windows worker holds its separate worker key, encrypted for the current Windows user in `%APPDATA%\Dooo\worker.json`. A phone receives a revocable, HttpOnly, Secure cookie; it never receives these keys.

For another PC, run `npm ci` and `npm run build:ui-tars`, then pipe its worker token through standard input to `node scripts/connect-pc.js https://your-dooo-origin`. Run `npm start`. `npm run start:worker` runs an Electron background host without the task cards; use either host, not both on the same device. Restart a standalone worker after pausing it with the keyboard shortcut.

`Disconnect all phones` in the desktop tray revokes paired sessions and their push subscriptions. Phone sessions expire after 30 days. Pair codes are stored hashed, single-use, rate-limited and expire after ten minutes. Changes require same-origin requests. The worker polls outward; never expose its credentials or a general-purpose shell endpoint to the browser.

## Data and execution boundaries

PostgreSQL stores the shared tasks, device presence, run state, bounded activity logs, and approvals. Each PC permits one active run. Worker ownership uses a 30-second renewable lease; approval is bound to one action and screen. The worker checks ownership again immediately before dispatch. Task claims and fingerprints prevent stale task instructions from continuing.

Screens are captured only during explicit requests, including Preview. The model receives screenshots through the server-side OpenRouter proxy. The phone can view the latest JPEG; only one is stored per device. Images become unreadable after ten minutes and are deleted on subsequent worker/state activity. Run descriptions and approval records persist in the database. Do not request credential entry or security-setting changes.

Desktop mode works on the primary Windows display. Browser mode drives a sandboxed Chromium target through Electron’s in-process DevTools Protocol, with no remote debugging port and no Node/preload access in remote pages. It supports web navigation, clicks, typing, scroll and drag; web permissions, external app protocols, file pickers and downloads are blocked. New-window web links open in the same browser, so some popup-based sign-ins may need Desktop mode. Browser screenshots cover its viewport; Desktop screenshots cover the primary display. This is instruction-based GUI automation, not continuous remote video, unattended login, wake-on-LAN, or a remote shell. Give short, concrete instructions and review what actually happened. Windows must be awake and unlocked. A model step is bounded to 45 seconds upstream, 40 model calls per run, and 30 local loops. OS actions are not retried after an uncertain outcome.

## Validation

`npm run test:control` runs policy checks. With `DOOO_TEST_DATABASE_URL` pointing at a disposable loopback PostgreSQL database, it also tests the real UI-TARS SDK and API with a fake OS operator: routine inputs without approval, failed classification, pairing, CSRF, approval replay, notification dispatch, single-run ownership, completion review, Stop, Windows pause, changed tasks and lease expiry. **The fixture truncates its control tables and resets the workspace. Never use a real workspace database.**

`electron tests/browser-operator.js` tests real Chromium input and OS pointer/clipboard isolation. With the disposable database configured, `node tests/browser-worker.js` tests the real desktop host, SDK, safety API and browser together using deterministic model responses.

`npm run test:control:e2e` exercises the installed-browser phone UI, real PostgreSQL/API and SDK fixture, including PWA registration. `npm run test:agents:e2e` checks real MCP clients through PostgreSQL to Electron. `npm run pack` verifies the Windows bundle; the Railway Dockerfile installs only API dependencies.

Real phone notification permission/delivery must be checked on the paired handset. The automated suite does not assert a push was displayed by iOS or Android.
