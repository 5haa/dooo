# Claude Code and Codex connection

Dooo exposes an MCP connection named `dooo` for coding sessions. Both clients read the same private Railway workspace: projects, folder locations, project memory, task notes and current status. The coding session performs requested work with its own tools and permissions; Dooo does not execute commands or start work by itself.

Try asking either connected session:

- “Show my open Neuvix tasks in Dooo.”
- “Work on the upload progress task from Dooo, verify it, and mark it done.”
- “What is blocked in Almarkaz?”

## Tools and workflow

| Tool | Purpose |
| --- | --- |
| `list_projects` | Projects, folders, counts and active claims |
| `get_project` | Project memory and task summaries |
| `list_tasks` | Search/filter todos, including blocked and completed tasks |
| `get_task` | Full notes, ownership, verification and recent history |
| `start_task` | Claim a user-requested task for the current session |
| `record_verification` | Record actual checks, methods and observed results |
| `complete_task` | Mark done after current passing verification |
| `release_task` | Leave unfinished work open or blocked, with a handoff |

The optional MCP prompt `work_on_task` accepts a task ID and describes this workflow. Listing tasks never authorizes executing them. Project documentation and todo text remain reference data; the session follows the user's request and the target repository's instructions.

Claims last 15 minutes. The bridge renews them every minute while connected. Another session cannot claim an active task. After a session disappears, its claim expires; the task stays unfinished. Release explicitly when pausing or handing off. Verification and completion require the owning session and run ID. Changing the title, notes, review context, priority or due date invalidates the work snapshot: release it, review the changes, and start again.

Completion requires at least one check, all checks passed, a matching task snapshot and evidence less than 24 hours old. These are reports from the coding session, not independent execution or attestation by Dooo. Failed or blocked checks keep the task unfinished. Completion is safe to retry after an interrupted response. A bounded history of starts, checks and handoffs is stored in PostgreSQL.

The desktop's small task status icon shows a working, paused or verified session. Click it to read the summary and checks. Completed tasks move to the bottom. Updates arrive through normal cloud sync, usually within 15 seconds; **Sync now** in the Windows tray refreshes immediately.

## Setup

Install dependencies with `npm ci`. The backend needs a separate random `DOOO_AGENT_TOKEN` of at least 32 characters, different from `DOOO_SYNC_TOKEN`. The agent key only authorizes `/api/agent`; it cannot use raw state or AI endpoints.

Pipe JSON containing `url` and `token` into `node scripts/connect-agents.js --configure`. Do not put a real key in shell history or a repository file. On Windows, setup encrypts it for the current Windows account using DPAPI at `%APPDATA%\Dooo\agent.json`. Other platforms use a file restricted to its owner. `DOOO_AGENT_CONFIG` overrides the location. `DOOO_AGENT_URL` and `DOOO_AGENT_TOKEN` can override the connection for isolated tests.

Once that protected file exists, `npm run connect:agents` verifies the service and registers `dooo` with both installed CLIs. It backs up their configuration first. Codex uses user MCP configuration; Claude Code uses user scope, available across projects. Entries contain the Node executable, absolute bridge path, client label and config-file path, without the access key. Keep this source installation at the configured path, or rerun setup after moving it.

Use a new session after setup. Reconnect existing Claude Code sessions from `/mcp`; restart the Codex session/app if it has not loaded the connection. See official [Codex MCP configuration](https://developers.openai.com/codex/mcp) and [Claude Code MCP setup](https://code.claude.com/docs/en/mcp).

Remove it with `codex mcp remove dooo` and `claude mcp remove dooo --scope user`. Rotating `DOOO_AGENT_TOKEN` on Railway and updating the protected local connection revokes the old key. Removing the connection does not delete tasks or verification.

## Tests

`npm run test:agents` checks ownership, lease recovery, verification gates, invalidated snapshots, evidence filtering and offline desktop merging.

With `DOOO_TEST_DATABASE_URL` pointing to disposable loopback PostgreSQL, `npm run test:agents:e2e` launches two real MCP clients and an isolated Electron app. It checks competing claims, refusal without passing evidence, completion through PostgreSQL, visible reports and blocked handoffs. Production tasks are never used.
