# Agent Command Dispatcher

Reads agent commands from `agent-commands.ndjson` and dispatches them
to the appropriate handler scripts. The agent writes decisions to the
command queue; this dispatcher executes them mechanically.

---

## Problem

The bootstrap agent makes decisions (search, compile, launch, evaluate)
but has no execution bridge to the mechanical scripts. Without a
dispatcher, the agent would need to shell out to each script directly,
mixing decision logic with execution plumbing.

## Solution

`agent-command-dispatcher.js` reads newline-delimited JSON commands from
`.github/ai-state/agent-commands.ndjson`, matches each command to a
handler, executes the handler, and writes results to
`.github/ai-state/agent-command-results.ndjson`.

The dispatcher is stateless between runs -- it processes all commands
in the file on each invocation.

---

## Command Format

Each line in `agent-commands.ndjson` is a JSON object:

```json
{"command": "<handler-name>", "args": { ... }}
```

### Supported Commands

| Command | Handler | Description |
|---------|---------|-------------|
| `search-and-ingest` | `search-and-ingest.js` | Search the web and ingest results as external facts |
| `compile-and-launch` | `compile-issues-to-tasks.js` + `batch-launch.ps1` | Compile issues by label and launch workers |
| `evaluate-workers` | (inline) | Count completed/failed/running workers from active-workers.json |
| `top-up-queue` | `top-up-self-cycle-queue.js` | Compute dispatch plan for ready lane top-up |
| `web-search` | `web-search.js` | Raw web search via MiMo API |

### Command Examples

```json
{"command": "search-and-ingest", "args": {"query": "AI agent orchestration", "live": true}}
{"command": "compile-and-launch", "args": {"label": "agent:codex-action-needed", "parallel": 30}}
{"command": "evaluate-workers", "args": {}}
{"command": "top-up-queue", "args": {}}
{"command": "web-search", "args": {"query": "nest.js testing patterns", "limit": 5}}
```

---

## Handler Details

### search-and-ingest

Delegates to `search-and-ingest.js`. Passes `query`, `topics`, and
`live` args through. Timeout: 60s.

### compile-and-launch

Multi-step handler that:

1. Resets `active-workers.json` to empty state
2. Cleans stale worktrees matching `claude/issue-*` pattern
3. Cleans stale branches matching `claude/issue-*` pattern
4. Runs `compile-issues-to-tasks.js` with the specified label
5. Writes compiled tasks to `compiled-tasks.json`
6. Launches workers via `batch-launch.ps1` with parallel execution

Default label: `agent:codex-action-needed`. Default parallelism: 30.

### evaluate-workers

Reads `active-workers.json` and returns counts by status:
`completed`, `failed`, `running`, `total`.

### top-up-queue

Delegates to `top-up-self-cycle-queue.js` with `--stdout` flag.

### web-search

Delegates to `web-search.js` with `--stdout` flag. Passes `query`,
`maxKeywords`, and `limit` args through.

---

## Result Format

Results are appended to `agent-command-results.ndjson`:

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-13T12:00:00.000Z",
  "commandsProcessed": 3,
  "results": [
    {"command": "search-and-ingest", "status": "success", "output": "..."},
    {"command": "evaluate-workers", "status": "success", "output": "{\"completed\":5,\"failed\":1,\"running\":24,\"total\":30}"},
    {"command": "unknown-cmd", "status": "unknown-command", "error": "No handler for \"unknown-cmd\""}
  ]
}
```

### Status Values

| Status | Meaning |
|--------|---------|
| `success` | Handler executed without error |
| `error` | Handler threw an exception |
| `unknown-command` | No handler registered for the command |
| `dry-run` | Command matched but `--dry-run` was set |

Output is truncated to 500 characters per result.

---

## Usage

```bash
# Process all commands in the queue
node scripts/ai/agent-command-dispatcher.js

# Dry-run mode -- logs commands without executing
node scripts/ai/agent-command-dispatcher.js --dry-run

# Custom state directory
node scripts/ai/agent-command-dispatcher.js --state-dir /path/to/ai-state

# Show help
node scripts/ai/agent-command-dispatcher.js --help
```

---

## Integration Points

| System | Interaction |
|--------|------------|
| [Search and Ingest](search-and-ingest.md) | `search-and-ingest` command handler |
| [Top-Up Controller](self-cycle-top-up-controller.md) | `top-up-queue` command handler |
| [Issue-to-Task Compiler](issue-to-task-compiler.md) | `compile-and-launch` uses `compile-issues-to-tasks.js` |
| [Batch Launcher](batch-launch.md) | `compile-and-launch` uses `batch-launch.ps1` |
| Agent bootstrap | Agent writes commands; dispatcher executes them |

---

## Design Decisions

- **Stateless between runs.** Each invocation processes the full
  command file. No cursor or offset tracking.
- **Append-only results.** Results are appended to
  `agent-command-results.ndjson`, not overwritten.
- **Fail-open per command.** A failing handler does not block
  subsequent commands in the same batch.
- **No secrets in output.** Results are truncated to 500 chars and
  contain no tokens or credentials.
