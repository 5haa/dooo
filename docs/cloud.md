# Dooo cloud storage

Dooo's native Windows cards connect to a private sync API backed by PostgreSQL. Railway runs the API and database. It does not run the desktop windows or expose your tasks through a public website.

## Railway

The production project is **dooo**, with **dooo-sync** and **Postgres** services. The repository contains a Dockerfile and `railway.json`; the Docker image installs only production dependencies and runs as the unprivileged `node` user. `/health` checks the database and is used for deployment health checks.

Required API service variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Reference to `${{Postgres.DATABASE_URL}}` over Railway's private network |
| `DOOO_SYNC_TOKEN` | A cryptographically random secret, at least 32 characters; never commit it |
| `PORT` | `8080`, matching the generated domain's target port |
| `NODE_ENV` | `production` |
| `OPENROUTER_API_KEY` | Server-only OpenRouter key; enables AI task wording |
| `OPENROUTER_MODEL` | `anthropic/claude-haiku-5.5` (default) |
| `DOOO_AGENT_TOKEN` | Separate random key for the Claude Code / Codex task connection; never reuse the sync key |

The database service uses a persistent volume. Startup creates `dooo_workspace` if necessary; it never clears existing data. Projects, tasks, completion state, order, due dates, priorities and scalar metadata are stored in one transactionally versioned JSONB document. Every save performs an atomic revision check. This is a private single-workspace service, not a multi-user account system.

GitHub source deployments use `5haa/dooo`, branch `main`. A manual deployment from a linked checkout can be started with `railway up --service dooo-sync`. Check deployment status and `/health` before considering it live. Task data and credentials are held outside the repository and Docker build context.

## Connect a desktop

Quit Dooo and place a `cloud.json` file in its user-data directory (`%APPDATA%\Dooo\` for installed builds, `%APPDATA%\Dooo-dev\` for source runs):

```json
{
  "url": "https://dooo-sync-production.up.railway.app",
  "token": "YOUR_PRIVATE_SYNC_KEY"
}
```

Use the service's actual secret, not the placeholder. At startup, Windows encrypts the key for the current user using Electron safeStorage. That encrypted file cannot be copied to another Windows account; configure that computer with the original key instead. Environment variables `DOOO_SYNC_URL` and `DOOO_SYNC_TOKEN` can override the connection for development.

A fresh installation downloads existing cloud projects and tasks. Connecting an installation that already contains tasks merges those records by ID. The local files remain the offline cache. Sync runs after changes and polls every 15 seconds. The Windows tray shows Synced, Syncing, changes waiting, offline, or a configuration/authentication issue. **Sync now** retries immediately.

For concurrent changes, unrelated fields are preserved. A pending local edit wins when both copies edit the same field. Keep the local `cloud-state.json` with its matching cache: it records what the cloud last acknowledged and allows offline deletions to be distinguished from new remote records. Unsynced edits stay on disk after quitting and are retried at the next launch.

To rotate credentials, change `DOOO_SYNC_TOKEN` on Railway, deploy the variable change, and replace each desktop's `cloud.json` using the new plaintext key while the app is closed. The next launch encrypts it again. The previous key immediately stops authorizing requests once the server redeploys.

## API and recovery

- `GET /health` is public and returns only service/database health.
- `GET /api/state` requires `Authorization: Bearer <key>` and returns `{revision, data, updatedAt}`.
- `PUT /api/state` requires the same key and JSON `{revision, data}`. A stale revision returns HTTP 409 with the latest snapshot; it never overwrites the database.
- `POST /api/ai/rewrite` requires the same key and `{projectId, text, project: {name, contextText}}`. It combines the desktop's current project memory with stored tasks, calls OpenRouter with a strict JSON response schema, and returns `{title, model}`. It cannot execute files or perform project tasks. Requests are limited to 30 per minute and two concurrent provider calls per workspace. Provider failures return a generic 503; the desktop keeps the original task. The OpenRouter key is never sent to the desktop or included in logs.
- Missing/incorrect credentials return 401; invalid data returns 400. Requests are size-limited and do not enable cross-origin browser access.
- `POST /api/agent` requires `DOOO_AGENT_TOKEN` and `{action, args, session: {id, client}}`. It provides scoped reads, claims, verification, completion and handoffs. Revision-checked updates preserve concurrent desktop edits. The sync key cannot use this route; the agent key cannot use raw state or AI routes. See [Agent connections](agents.md).

Before manually changing or restoring cloud state, export the authenticated GET response and back up the desktop's `tasks.json`, `settings.json`, and `cloud-state.json`. An old desktop snapshot should not be blindly uploaded over a newer cloud workspace. Keep the previous local backups until the desired data has been confirmed in both places. Protect exports like your task data; they contain private notes.

## Tests

`npm run test:cloud` runs pure merge/configuration checks. Set `DOOO_TEST_DATABASE_URL` to a **disposable local PostgreSQL database** to include live API and two-client tests. The integration tests replace the test database's workspace row, reject non-loopback database hosts, and use temporary desktop directories.

With that same test variable, `npm run test:cloud:e2e` verifies real Electron task creation reaches PostgreSQL, remote completion and project changes reach the cards without losing an unfinished draft, and state survives restarting the app. No production data is used by these tests.
