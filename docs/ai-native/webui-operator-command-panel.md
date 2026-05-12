# WebUI Operator Command Panel

Chat-like command panel for the Provider Pool WebUI operation console.
Inspired by llama.cpp interactive sessions: typed input, structured
output, scrollable transcript, and assistant-style feedback.

> **Closes:** [#1117](https://github.com/taoyu051818-sys/lian-nest-server/issues/1117)

---

## Overview

The command panel replaces or supplements the button-grid action model
with a conversational, transcript-driven interface. Operators type
commands, the system responds with previews and confirmations, and the
full exchange is preserved as a scrollable execution transcript.

```
┌──────────────────────────────────────────────────────────────┐
│  Operator Command Panel                                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ [system] Command panel ready. Type "help" for commands.  ││
│  │                                                          ││
│  │ > provider.retry provider-default                        ││
│  │                                                          ││
│  │ [preview] provider-default                               ││
│  │   current status:  exhausted                             ││
│  │   projected:        available                            ││
│  │   cooldown:         12 min remaining → cleared           ││
│  │   active workers:   0                                    ││
│  │   [blue badge: PREVIEW — no mutation yet]                ││
│  │                                                          ││
│  │ > confirm RETRY                                          ││
│  │                                                          ││
│  │ [execute] provider.retry → provider-default              ││
│  │   status: available                                      ││
│  │   cooldownCleared: true                                  ││
│  │   auditId: audit-1715500000000-abc123                    ││
│  │   [green badge: EXECUTED]                                ││
│  │                                                          ││
│  │ [system] Action complete. Type next command.             ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ > _                                                     ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## Design Principles

### 1. Chat-Like Interaction

Commands are typed, not clicked. The panel maintains a scrollable
transcript of every exchange — command, preview, confirmation, and
result. This mirrors the llama.cpp REPL model: input at the bottom,
history scrolls upward.

### 2. Preview-First

Every mutating command first produces a preview response. The preview
is rendered inline in the transcript with a blue badge. No state changes
until the operator explicitly confirms.

### 3. Assistant-Like Feedback

Responses are structured but conversational. The system explains what
it found, what will change, and what the operator should do next.
Errors include recovery suggestions.

```
[error] provider "unknown-id" not found.
        Available providers: provider-default, provider-backup
        Try: provider.retry provider-default
```

### 4. Execution Transcript

The transcript is the primary output surface. Every interaction is
appended in order and remains visible for the session. The transcript
supports:

- Scrollback to any prior exchange
- Filtering by status (preview / execute / error / system)
- Export as JSON via `export` command

### 5. No Secrets

The command panel never displays, logs, or accepts secrets. All
provider identifiers, payloads, and results pass through
`sanitizeObject`. If a command would expose a secret-shaped field,
the response shows `***REDACTED***` instead.

---

## Command Syntax

Commands follow a verb-noun pattern with optional flags:

```
<action-id> [target] [--flag value]
```

| Component | Required | Example |
|-----------|----------|---------|
| action-id | Yes | `provider.retry`, `queue.clearStale`, `plan.next.batch` |
| target | Depends on action | `provider-default`, `queue` |
| flags | No | `--dry-run`, `--limit 10` |

### Meta Commands

| Command | Description |
|---------|-------------|
| `help` | List all available commands with descriptions |
| `help <action-id>` | Show detailed help for a specific action |
| `status` | Show current system health, provider summary, queue depth |
| `history` | Show transcript summary (count by status) |
| `export` | Download full transcript as JSON |
| `clear` | Clear the transcript display (does not delete history) |
| `confirm <phrase>` | Confirm the most recent preview |

### Action Commands

Every registered action module is available as a command. The command
maps directly to the `/api/actions/preview` and `/api/actions/execute`
endpoints.

| Command | Preview | Confirm Phrase | Risk |
|---------|---------|---------------|------|
| `compile-tasks` | Task compilation plan | — | Low |
| `plan.next.batch` | Next batch candidates | — | Low |
| `create-issues` | Proposed issues from gaps | `CREATE` | High |
| `issue-state` | Issue label/PR reconciliation | `RECONCILE` | High |
| `launch-batch` | Launch gate + dispatch plan | `LAUNCH` | High |
| `merge-prs <PR#...>` | PR merge preview | `MERGE` | High |
| `provider-rotation <id>` | Provider credential rotation | `ROTATE` | High |
| `worker.control list` | Active worker list | — | Low |
| `worker.control stop <id>` | Worker stop preview | `STOP` | High |

---

## Transcript Format

Each transcript entry has a role and structured content:

### Entry Roles

| Role | Icon | Meaning |
|------|------|---------|
| `system` | `[system]` | Panel lifecycle messages (ready, cleared, exported) |
| `input` | `>` | Operator command input |
| `preview` | `[preview]` | Action preview result (blue badge) |
| `execute` | `[execute]` | Action execution result (green badge) |
| `error` | `[error]` | Command or execution failure (red badge) |
| `confirm` | `[confirm]` | Confirmation attempt (matches or mismatches) |

### Entry Schema

```json
{
  "role": "preview",
  "timestamp": "2026-05-12T10:00:00.000Z",
  "actionId": "provider.retry",
  "target": "provider-default",
  "badge": "blue",
  "content": {
    "currentStatus": "exhausted",
    "projectedStatus": "available",
    "cooldownRemaining": "12 min → cleared",
    "activeWorkers": 0
  }
}
```

### Visual Badges

Transcript entries use the same badge system as the button-grid
console:

| Badge | Color | Meaning |
|-------|-------|---------|
| Preview | Blue | Dry-run, no mutation |
| Executed | Green | Action completed successfully |
| Blocked | Red | Action rejected by guard or validation |
| Warning | Yellow | Action completed with caveats |
| System | Gray | Informational, no action |

---

## Confirmation Flow

The command panel enforces the same typed-confirmation model as the
button-grid console, but expressed as a command:

```
> provider.retry provider-default

[preview] provider-default
  current status:  exhausted
  projected:       available
  cooldown:        12 min remaining → cleared
  [blue badge: PREVIEW]

> confirm RETRY

[execute] provider.retry → provider-default
  status: available
  cooldownCleared: true
  auditId: audit-1715500000000-abc123
  [green badge: EXECUTED]
```

### Confirmation Rules

| Risk Level | Behavior |
|------------|----------|
| Low | No confirmation needed; preview auto-executes or executes on `confirm` |
| Medium | Must type exact phrase (`CLEAR`, `RETRY`) |
| High | Must type exact phrase + optional reason text |
| Critical | Must type exact phrase + reason (both required) |

If the confirmation phrase does not match:

```
> confirm WRONG

[error] Confirmation mismatch.
        Expected: RETRY
        Received: WRONG
        The execute button remains disabled until confirmation matches.
```

---

## Assistant Feedback Patterns

The command panel provides structured, actionable feedback at every
step. This mirrors an assistant conversation — the system tells the
operator what it found, what it recommends, and what to do next.

### Successful Preview

```
[preview] plan.next.batch
  candidates: 3 tasks ready to launch
  providers:  2 available (capacity: 6 workers)
  conflict groups: no overlaps detected
  recommendation: safe to launch
  [blue badge: PREVIEW — type "confirm LAUNCH" to proceed]
```

### Guard Rejection

```
[error] launch-batch blocked by launch gate.
        Reason: health state is "red" — launches require green or yellow.
        Fix: resolve failing checks or override health state manually.
        See: docs/ai-native/main-health-policy.md
```

### Ambiguous Command

```
[error] Ambiguous target "prov".
        Matches: provider-default, provider-backup
        Try: provider.retry provider-default
```

### Recovery Suggestion

```
[error] provider "provider-x" is disabled (auth failure).
        Cannot retry — credential rotation required.
        Try: provider-rotation provider-x
        Or: fix the credential in the policy file and run refresh.
```

---

## Layout Integration

The command panel is rendered as a panel within the existing operation
console tab, alongside the button-grid action modules. It does not
replace the button grid — both surfaces are available.

```
┌──────────────────────────────────────────────────────────────┐
│  [Dashboard]  [Operation Console]  [Command Panel]           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────┐  ┌────────────────────────────────┐│
│  │ Action Modules       │  │ Command Panel Transcript       ││
│  │ (button grid)        │  │                                ││
│  │                      │  │ [system] Ready.                ││
│  │ Provider Actions     │  │ > provider.retry prov-def     ││
│  │ Queue Actions        │  │ [preview] ...                  ││
│  │ Global Actions       │  │ > confirm RETRY               ││
│  │                      │  │ [execute] ...                  ││
│  └─────────────────────┘  │                                ││
│                           │ > _                             ││
│                           └────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### Responsive Behavior

| Viewport | Layout |
|----------|--------|
| Wide (>1200px) | Side-by-side: button grid left, transcript right |
| Standard (800-1200px) | Stacked: button grid above, transcript below |
| Narrow (<800px) | Tab switcher between button grid and transcript |

---

## Security Boundaries

| Rule | Enforcement |
|------|-------------|
| No secrets in transcript | All entries pass through `sanitizeObject` |
| No secrets in input echo | Typed commands are echoed but secret-shaped args are masked |
| Localhost only | Command panel uses same `/api/actions` endpoints, same `127.0.0.1` binding |
| Confirmation gate | High-risk commands require typed phrase before execute |
| Audit trail | Every execute writes to the same audit log as button-grid actions |
| No auto-execute | Preview is always shown first; no command auto-mutates |

---

## Non-Goals

- No natural language processing — commands are structured, not freeform
- No server-side changes — uses existing `/api/actions/preview` and
  `/api/actions/execute` endpoints
- No persistent transcript storage — session-only, export on demand
- No secret input or display — all values sanitized
- No remote access — localhost-only, same as the rest of the WebUI

---

## References

- [Operation Console](provider-pool-webui-operation-console.md) — button-grid console design
- [WebUI Operation Runbook](webui-operation-runbook.md) — step-by-step operator guide
- [WebUI Control Map](webui-control-map.md) — action-to-endpoint mapping
- [WebUI Action Contract](webui-action-contract.md) — schema and policy for actions
- [Provider Pool WebUI API](../contracts/provider-pool-webui-api.md) — API contract
- [WebUI Action Confirmation Policy](webui-action-confirmation-policy.md) — confirmation phrases
