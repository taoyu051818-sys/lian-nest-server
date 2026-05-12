# WebUI Command Steward Console

Defines the Command Steward console view for the WebUI operation
console. Surfaces system status brief, recommended actions,
human-required decisions, preview-first action buttons, and full
audit visibility.

> **Closes:** [#1133](https://github.com/taoyu051818-sys/lian-nest-server/issues/1133)
> **Scope:** Docs only. No runtime changes.

---

## Overview

The Command Steward console is a dedicated screen in the WebUI left-nav
shell that gives operators a single view of the orchestration command
layer. It aggregates state from five API endpoints into a coherent
status brief, surfaces context-aware recommended actions, gates
human-required decisions behind typed confirmation, and exposes
full audit visibility.

```
┌─────────────────────────────────────────────────────────────┐
│  [Header] Command Steward           [Health: green ●]       │
├────────────┬────────────────────────────────────────────────┤
│  Left Nav  │  Command Steward Content                       │
│            │                                                │
│  • Dashboard│  ┌──────────────────────────────────────────┐ │
│  • Steward ◄│  │  Status Brief (system health snapshot)  │ │
│  • Workers │  └──────────────────────────────────────────┘ │
│  • Planning│  ┌──────────────────────────────────────────┐ │
│  • Merge Q │  │  Recommended Actions (context-aware)     │ │
│  • Providers│ └──────────────────────────────────────────┘ │
│  • Audit   │  ┌──────────────────────────────────────────┐ │
│  •Governance│ │  Human-Required Decisions                │ │
│            │  └──────────────────────────────────────────┘ │
│            │  ┌──────────────────────────────────────────┐ │
│            │  │  Preview Buttons (action panels)         │ │
│            │  └──────────────────────────────────────────┘ │
│            │  ┌──────────────────────────────────────────┐ │
│            │  │  Audit Trail (recent executions)         │ │
│            │  └──────────────────────────────────────────┘ │
├────────────┴────────────────────────────────────────────────┤
│  [Footer] Audit count · Session ID · Version                │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Sources

The Command Steward console reads from five API endpoints:

| Section | Primary Endpoint | Secondary Endpoint | Refresh |
|---------|------------------|--------------------|---------|
| Status Brief | `GET /api/state` | `GET /api/queue` | SSE `state-changed` |
| Recommended Actions | `GET /api/state` | `GET /api/planning` | SSE `webui-state-changed` |
| Human-Required Decisions | `GET /api/state` | `GET /api/actions` | SSE `state-changed` |
| Preview Buttons | `POST /api/actions/preview` | — | On click |
| Audit Trail | `GET /api/audit` | — | On action execute |

### Endpoint Mapping

| Endpoint | Data Provided | Key Fields |
|----------|--------------|------------|
| `/api/state` | Provider pool, workers, global metrics, health | `global`, `providers`, `actionReadiness` |
| `/api/planning` | Task candidates, readiness, batch preview | `proposedBatch`, `launchPlan` |
| `/api/queue` | Queue entries, depth, blocked reasons | `pendingTasks`, `blockedByExhaustion`, `blockedByConflict` |
| `/api/actions` | Available action modules, risk levels | Action registry with `preview()` / `execute()` |
| `/api/audit` | Execution history, sanitized payloads | Entries with `actionId`, `status`, `payload`, `result` |

---

## Section 1: Status Brief

A compact system health snapshot drawn from `/api/state` and
`/api/queue`.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Status Brief                                                     │
├──────────┬──────────┬──────────┬──────────┬──────────┬───────────┤
│  Health  │Providers │ Workers  │  Queue   │  Trust   │  Pressure │
│  ● green │ 3/4 up   │ 2/6 act. │ 5 pending│   72     │  normal   │
│          │ 1 exh.   │ 0 cooling│ 1 blocked│          │           │
└──────────┴──────────┴──────────┴──────────┴──────────┴───────────┘
```

### Fields

| Field | Source | Description |
|-------|--------|-------------|
| Health | `/api/state` → `mainHealth.state` | Current main branch health (green/yellow/red/black) |
| Providers | `/api/state` → `global` | `availableProviders` / `totalProviders` with exhausted count |
| Workers | `/api/state` → `global` | `totalActiveWorkers` / `globalMaxWorkers` with cooling count |
| Queue | `/api/queue` → `pendingTasks` | Pending count plus total blocked count |
| Trust | `/api/state` → `actionReadiness` or meta signals | Current trust score (0–100) |
| Pressure | `/api/state` → computed | Utilization level: normal / elevated / critical |

### Color Coding

| Field | Green | Yellow | Red |
|-------|-------|--------|-----|
| Health | green | yellow | red / black |
| Providers | all available | any exhausted | all exhausted / disabled |
| Workers | < 60% max | 60–85% max | > 85% max |
| Queue | 0 blocked | 1–3 blocked | > 3 blocked |
| Trust | >= 70 | 40–69 | < 40 |
| Pressure | normal | elevated | critical |

---

## Section 2: Recommended Actions

Context-aware action suggestions based on current system state.
Each recommendation includes the action, why it is recommended,
and a preview button.

### Recommendation Logic

| Condition | Recommended Action | Rationale |
|-----------|--------------------|-----------|
| Health green + queue has ready tasks + providers available | **Launch Batch** | System is healthy and has capacity |
| Health green + queue has blocked tasks (exhaustion) | **Provider Rotation** | Exhausted providers blocking progress |
| Health green + merge queue has pending PRs | **Process Merge Queue** | Approved PRs waiting to merge |
| Health green + issues with `agent:done` label | **Issue State Control** | Done issues eligible for close |
| Health yellow/red | **Review Health Gate** | System degraded; review before acting |
| Trust < 40 | **Export Audit** | Low trust; review recent actions |
| All providers disabled | **Provider Retry** | No capacity; restore providers |
| No recommended actions | — | System is idle and healthy |

### Recommendation Card

Each recommendation renders as a card:

```
┌──────────────────────────────────────────────────────────────────┐
│  ● RECOMMENDED                                                    │
│  Launch Batch                                                     │
│  3 tasks ready, 2 providers available, health green               │
│  [Preview]                                                        │
└──────────────────────────────────────────────────────────────────┘
```

| Element | Description |
|---------|-------------|
| Badge | `RECOMMENDED` (green) or `BLOCKED` (gray with 45% opacity) |
| Title | Action name |
| Reason | One-line explanation of why this action is suggested |
| Preview button | Opens the preview panel for this action |

### Blocked Recommendations

When a recommendation cannot proceed, the card shows why:

```
┌──────────────────────────────────────────────────────────────────┐
│  ○ BLOCKED                                                        │
│  Launch Batch                                                     │
│  Health is red — resolve health gate before launching workers     │
│  [Preview disabled]                                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Section 3: Human-Required Decisions

Certain orchestration decisions cannot be automated and require
explicit human judgment. This section surfaces pending decisions
that need operator attention.

### Decision Categories

| Decision | Trigger | Source | Confirmation |
|----------|---------|--------|-------------|
| Merge / Block a PR | PR ready for review | `/api/state` → `actionReadiness` → `merge-pr` | Review diff, then merge via Merge Control screen |
| Launch or Defer a Wave | Tasks ready but wave boundary reached | `/api/planning` → `launchPlan` | Review batch, then launch via Operations screen |
| Override Health Gate | Health misclassified | `/api/state` → `mainHealth` | Manual state write (CLI) |
| Kill a Stale Worker | Worker stale > 5 min | `/api/state` → workers | Check worktree, then kill (CLI) |
| Auth / Database Cutover | Cutover decision pending | Governance policy | Architect + security-reviewer sign-off |

### Decision Card

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚠ HUMAN DECISION REQUIRED                                       │
│  Merge PR #456                                                    │
│  Risk score: 62 · Guards: pass · Health: green                   │
│  This action requires your review and explicit approval.          │
│  [Go to Merge Control]                                            │
└──────────────────────────────────────────────────────────────────┘
```

| Element | Description |
|---------|-------------|
| Warning badge | `HUMAN DECISION REQUIRED` (pulsing red dot) |
| Title | Decision summary |
| Context | Risk score, guard results, health state |
| Explanation | Why this cannot be automated |
| Action link | Navigates to the relevant control screen |

---

## Section 4: Preview Buttons

Each recommended or available action has a preview button that
opens a preview panel before any mutation occurs. All mutating
actions are preview-first.

### Preview Panel

Clicking a preview button opens an inline panel:

```
┌──────────────────────────────────────────────────────────────────┐
│  [blue badge: PREVIEW]                                            │
│  Action: Launch Batch                                             │
│  Current state: 5 tasks queued, 2 providers available             │
│  Projected outcome: 3 tasks dispatched, 2 deferred (conflict)     │
│  Affected targets: #689, #712, #734                               │
│  Guard validation: pass                                           │
├──────────────────────────────────────────────────────────────────┤
│  [confirmation input]  [Execute button (disabled until confirmed)]│
└──────────────────────────────────────────────────────────────────┘
```

### Preview API Call

```json
POST /api/actions/preview
{
  "actionId": "launch-batch",
  "payload": { "issueNumbers": [689, 712, 734] }
}
```

### Preview Content

| Section | Content |
|---------|---------|
| Current state | Target entities before mutation |
| Projected outcome | What `execute()` will produce |
| Affected targets | Entities that will change |
| Guard validation | Pass/fail with reason |
| Confirmation input | Typed phrase for high-risk actions |
| Execute button | Disabled until confirmation matches |

### Action-to-Confirmation Mapping

| Action ID | Risk | Confirmation Phrase |
|-----------|------|---------------------|
| `compile-tasks` | Low | Single click |
| `plan.next.batch` | Low | Single click |
| `create-issues` | High | Type `CREATE` |
| `issue-state` | High | Type `CLOSE` |
| `launch-batch` | High | Type `LAUNCH` |
| `merge-prs` | High | Type `MERGE` |
| `provider-rotation` | High | Type `RETRY` |
| `worker.control` | High | Type worker ID |

---

## Section 5: Audit Trail

The audit trail shows recent action executions with filtering
and export capabilities.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Audit Trail                          [Export Audit] [Filter ▼]   │
├──────────────┬──────────────┬──────────┬──────────┬──────────────┤
│  Timestamp   │  Action      │  Status  │  Target  │  Result      │
├──────────────┼──────────────┼──────────┼──────────┼──────────────┤
│  10:20:06    │  merge-prs   │  success │  PR #42  │  merged      │
│  10:15:01    │  issue-state │  success │  #683    │  closed      │
│  10:10:00    │  launch-batch│  error   │  batch   │  gate blocked│
└──────────────┴──────────────┴──────────┴──────────┴──────────────┘
```

### Data Source

`GET /api/audit` with optional query params:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `actionId` | string | — | Filter by action ID |
| `status` | string | — | Filter: `success`, `error` |
| `limit` | number | 20 | Max entries (max 500) |

### Entry Fields

| Field | Source | Description |
|-------|--------|-------------|
| `id` | server-generated | Unique audit entry ID |
| `actionId` | action module | Action that was executed |
| `startedAt` | server timestamp | Execution start time |
| `completedAt` | server timestamp | Execution end time |
| `status` | server result | `success` or `error` |
| `payload` | sanitized | Action input (secrets redacted) |
| `result` | sanitized | Action output (secrets redacted) |
| `confirmationToken` | client-supplied | Confirmation phrase provided |

### Sanitization

All `payload` and `result` fields pass through `sanitizeObject`:

| Pattern | Replacement |
|---------|-------------|
| Fields matching `api_key`, `token`, `secret`, `password` | `***REDACTED***` |
| Long alphanumeric strings (> 20 chars) | `***REDACTED***` |
| GitHub PATs (`ghp_*`) | `[redacted-gh-token]` |
| Strings > 500 chars | Truncated |

### Export

Clicking **Export Audit** downloads the full session audit log as
JSON. The export is client-side — no additional API call needed.

---

## Visual Signals

| Signal | Meaning |
|--------|---------|
| Blue border/badge | Preview mode — no mutation |
| Red border/badge | Execute mode — state will change |
| Green border/badge | Safe / read-only action |
| 45% opacity | Disabled — action unavailable |
| Pulsing red dot | Confirmation needed or human decision pending |
| Yellow badge | Warning — action requires review |

---

## Left-Nav Entry

| Field | Value |
|-------|-------|
| Label | Steward |
| Icon | command |
| Route | `/steward` |
| Active indicator | Highlighted border when selected |
| Badge | Count of pending human decisions |

---

## Blocked States

| Condition | UI Behavior |
|-----------|-------------|
| Health red/black | All mutating previews disabled; show health gate warning |
| All providers disabled | Launch actions disabled; show provider retry recommendation |
| Trust < 40 | High-risk actions disabled; show audit export recommendation |
| No recommended actions | Show "System idle — no actions needed" |
| Server unreachable | Show "Connection lost — check server status" |

---

## Safety Rules

| Rule | Enforcement |
|------|-------------|
| Preview-first | All mutating actions require preview before execute |
| Typed confirmation | High-risk actions require exact phrase match |
| No secrets | All rendered data passes through `sanitizeObject` |
| Loopback only | Server binds to `127.0.0.1`; no remote access |
| Admin token | All endpoints require Bearer token |
| Audit every execute | Every `POST /api/actions/execute` writes audit entry |
| Dangerous flag gate | Server requires `confirm: true` for dangerous actions |

---

## Integration

The Command Steward console is the second tab in the WebUI left-nav
shell:

1. **Dashboard** — At-a-glance system health overview
2. **Command Steward** — Status brief, recommendations, decisions (this view)
3. **Workers** — Active worker monitoring
4. **Planning** — Task candidates and batch planning
5. **Merge Queue** — PR merge ordering and processing
6. **Providers** — Provider status and concurrency
7. **Audit** — Full execution history
8. **Governance** — Policy boundaries and constraints

### Relationship to Other Screens

| Screen | Relationship |
|--------|-------------|
| Dashboard | Steward aggregates dashboard data into actionable recommendations |
| Operations | Steward links to Operations for action execution |
| Planning | Steward reads planning data for batch recommendations |
| Merge Queue | Steward links to Merge Control for PR merge decisions |
| Audit | Steward surfaces recent audit entries; full audit in dedicated screen |

---

## Non-Goals

- No direct mutation from the Steward screen (actions link to dedicated screens)
- No real-time WebSocket updates (SSE-based file watcher push)
- No credential or secret display
- No server-side endpoint changes (reads existing APIs)
- No autonomous action execution (all actions require human confirmation)

---

## Cross-References

- [WebUI Control Console](webui-control-console.md) — full panel/action runbook
- [WebUI Control Console Information Architecture](webui-control-console-information-architecture.md) — navigation and layout
- [WebUI Merge & Issue Control Screens](webui-merge-issue-control-screens.md) — sibling control screens
- [WebUI Planning Console View](webui-planning-console-view.md) — planning visibility
- [WebUI Operation Runbook](webui-operation-runbook.md) — step-by-step operator guide
- [WebUI Control Map](webui-control-map.md) — action-to-endpoint mapping
- [Loop Model](loop-model.md) — self-cycle runner phases
- [Constitution Steward Layer](constitution-steward-layer.md) — governance steward concept
