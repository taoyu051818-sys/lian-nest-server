# WebUI Control Console Information Architecture

Defines the navigation structure, page layout, and content hierarchy
for the local-only Provider Pool WebUI control console.

> **Closes:** [#1116](https://github.com/taoyu051818-sys/lian-nest-server/issues/1116)

---

## Principles

1. **Dense admin layout** — maximize information density; no decorative whitespace.
2. **Left-nav shell** — persistent sidebar with section grouping; active section highlighted.
3. **Preview-first actions** — every mutating button triggers preview before execute.
4. **Chat-like feedback** — command panel at the bottom streams action results and audit confirmations.
5. **No secrets** — all rendered data passes through `sanitizeObject`; no credentials, tokens, or keys appear in any view.
6. **Local-only** — binds to `127.0.0.1`; no remote access.

---

## Top-Level Shell

```
┌──────────────────────────────────────────────────────────────────────┐
│  Header Bar                                                          │
│  [health indicator] [provider summary] [worker count] [clock] [menu] │
├────────────┬─────────────────────────────────────────────────────────┤
│            │                                                         │
│  Left Nav  │  Main Content Area                                      │
│            │                                                         │
│  Dashboard │  ┌───────────────────────────────────────────────────┐  │
│  Operations│  │  Page Header (title, breadcrumb, quick actions)   │  │
│  Workers   │  ├───────────────────────────────────────────────────┤  │
│  Planning  │  │                                                   │  │
│  Merge Q   │  │  Page Content (cards, tables, action panels)      │  │
│  Providers │  │                                                   │  │
│  Audit     │  │                                                   │  │
│  Governance│  └───────────────────────────────────────────────────┘  │
│            │  ┌───────────────────────────────────────────────────┐  │
│            │  │  Command Panel (action feedback, confirmations)   │  │
│            │  └───────────────────────────────────────────────────┘  │
├────────────┴─────────────────────────────────────────────────────────┤
│  Status Bar  [audit count] [session id] [version]                    │
└──────────────────────────────────────────────────────────────────────┘
```

### Header Bar

| Element | Content | Source |
|---------|---------|--------|
| Health indicator | Green/Yellow/Red/Black dot + label | `.github/ai-state/main-health.json` |
| Provider summary | `N available / M exhausted / K disabled` | `/api/state` → `global` |
| Worker count | `X active / Y max` | `/api/state` → `global` |
| Clock | Local time + `capturedAt` age | Client-side |
| Menu | Export audit, refresh state | `global.exportAudit`, `global.refreshState` |

### Left Navigation

| Section | Route | Icon | Badge |
|---------|-------|------|-------|
| Dashboard | `/` | grid | Health color dot |
| Operations | `/operations` | play | Pending action count |
| Workers | `/workers` | cpu | Active worker count |
| Planning | `/planning` | calendar | Ready candidate count |
| Merge Queue | `/merge-queue` | git-merge | Queued PR count |
| Providers | `/providers` | server | Exhausted provider count |
| Audit | `/audit` | file-text | None |
| Governance | `/governance` | shield | None |

---

## 1. Dashboard

**Route:** `/`
**Purpose:** At-a-glance system health and readiness overview.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Pressure Gauge (full-width)                                     │
│  [normal|elevated|critical]  utilization%  nearest cooldown      │
├──────────────────┬──────────────────┬────────────────────────────┤
│  Provider Cards  │  Worker Summary  │  Queue Summary             │
│  (stacked)       │  (counts + list) │  (depth + blocked reasons) │
├──────────────────┴──────────────────┴────────────────────────────┤
│  Action Readiness Panel                                          │
│  [launch-worker] [merge-pr] [retry-failed] [drain-queue]        │
├──────────────────────────────────────────────────────────────────┤
│  Recent Activity (last 10 audit entries)                         │
└──────────────────────────────────────────────────────────────────┘
```

### Content

| Card | Data | Refresh |
|------|------|---------|
| Pressure Gauge | `totalActiveWorkers / globalMaxWorkers * 100`, health state, nearest cooldown | SSE `state-changed` |
| Provider Cards | Status, concurrency bar, cooldown timer per provider | SSE `state-changed` |
| Worker Summary | Active count, list of running workers (issue, branch, elapsed) | SSE `webui-state-changed` |
| Queue Summary | Pending, blocked (exhaustion/conflict/capacity) counts | SSE `webui-state-changed` |
| Action Readiness | `launch-worker`, `merge-pr`, `retry-failed`, `drain-queue` with blocked reasons | SSE `webui-state-changed` |
| Recent Activity | Last 10 entries from `GET /api/audit?limit=10` | Poll on action execute |

---

## 2. Operations

**Route:** `/operations`
**Purpose:** Central action execution surface with grouped action buttons and preview/confirm flow.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Operation Console                                               │
├──────────────────────────────────────────────────────────────────┤
│  Task Planning Actions                                           │
│  [Compile Tasks] [Plan Next Batch]                               │
├──────────────────────────────────────────────────────────────────┤
│  Issue Management Actions                                        │
│  [Create Issues] [Issue State Control]                           │
├──────────────────────────────────────────────────────────────────┤
│  Batch Execution Actions                                         │
│  [Launch Batch] [Merge PRs]                                      │
├──────────────────────────────────────────────────────────────────┤
│  Provider & Worker Actions                                       │
│  [Provider Rotation] [Worker Control]                            │
├──────────────────────────────────────────────────────────────────┤
│  Global Actions                                                  │
│  [Refresh State] [Export Audit]                                  │
├──────────────────────────────────────────────────────────────────┤
│  Action Preview Panel (appears on button click)                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ [blue badge: PREVIEW]                                      │  │
│  │ Current state: ...                                         │  │
│  │ Projected outcome: ...                                     │  │
│  │ Affected targets: ...                                      │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ [confirmation input]  [Execute button (disabled until OK)] │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Action Groups

| Group | Actions | Risk Levels |
|-------|---------|-------------|
| Task Planning | `compile-tasks`, `plan.next.batch` | Low |
| Issue Management | `create-issues`, `issue-state` | High |
| Batch Execution | `launch-batch`, `merge-prs` | High |
| Provider & Worker | `provider-rotation`, `worker.control` | High |
| Global | `refreshState`, `exportAudit` | Safe (read-only) |

### Action Button Behavior

| Risk Level | Button Color | Click Behavior | Confirmation |
|------------|-------------|----------------|-------------|
| Low (safe) | Green | Immediate preview | Single click |
| Low | Blue | Preview panel | Single click execute |
| High | Red | Preview panel + warning banner | Typed phrase match |
| Read-only | Green | Immediate execute | None |

### Preview Panel Contract

Each preview panel shows:

1. **Current state** — target entity before mutation
2. **Projected outcome** — what `execute()` will produce
3. **Affected targets** — entities that will change
4. **Guard validation** — pass/fail with reason
5. **Confirmation input** — text field for typed phrase
6. **Execute button** — disabled until confirmation matches

### Command Panel Feedback

The bottom command panel streams:

- Action dispatched confirmation
- Execution result (success/error)
- Audit entry ID
- Error details (sanitized)

Format: chat-like message bubbles with timestamps.

---

## 3. Workers

**Route:** `/workers`
**Purpose:** Monitor active workers, their assignments, and lifecycle state.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Worker Summary Bar                                              │
│  [active: N] [cooling: M] [draining: K] [max: X]                │
├──────────────────────────────────────────────────────────────────┤
│  Worker Table                                                    │
│  ┌────────┬────────┬──────────┬──────────┬─────────┬──────────┐ │
│  │ Issue  │ Branch │ Provider │ Conflict │ Status  │ Elapsed  │ │
│  ├────────┼────────┼──────────┼──────────┼─────────┼──────────┤ │
│  │ #689   │ w/689  │ prov-1   │ auth     │ running │ 2m 30s   │ │
│  │ #712   │ w/712  │ prov-2   │ docs     │ cooling │ 5m 10s   │ │
│  └────────┴────────┴──────────┴──────────┴─────────┴──────────┘ │
├──────────────────────────────────────────────────────────────────┤
│  Worker Detail Panel (on row select)                             │
│  [issue title] [task type] [started at] [last output]           │
│  [worktree path] [provider assignment]                           │
└──────────────────────────────────────────────────────────────────┘
```

### Worker Status Colors

| Status | Color | Meaning |
|--------|-------|---------|
| `running` | Green | Actively executing |
| `cooling-down` | Yellow | Provider exhausted mid-task |
| `draining` | Blue | Task complete, tearing down |
| `stale` | Red (pulsing) | No output for > 5 minutes |

### Worker Actions

| Action | Button | Risk | Confirmation |
|--------|--------|------|-------------|
| List workers | [List] | Safe | None |
| Stop worker | [Stop] | High | Type worker ID |

---

## 4. Planning

**Route:** `/planning`
**Purpose:** View task candidates, readiness status, and batch planning.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Planning Summary                                                │
│  [ready: N] [blocked: M] [done: K] [total: X]                   │
├──────────────────────────────────────────────────────────────────┤
│  Candidate Table                                                 │
│  ┌────────┬──────────────┬──────────┬──────┬──────────┬────────┐│
│  │ Issue  │ Title        │ Task Type│ Risk │ Conflict │ Ready  ││
│  ├────────┼──────────────┼──────────┼──────┼──────────┼────────┤│
│  │ #689   │ Implement X  │ execution│ med  │ auth     │ ready  ││
│  │ #712   │ Add tests    │ test     │ low  │ docs     │ blocked││
│  └────────┴──────────────┴──────────┴──────┴──────────┴────────┘│
├──────────────────────────────────────────────────────────────────┤
│  Batch Plan Panel                                                │
│  [Plan Next Batch] button → preview of matched tasks             │
│  Conflict group analysis                                         │
│  Provider capacity fit                                           │
└──────────────────────────────────────────────────────────────────┘
```

### Data Source

`GET /api/planning` — reads from `.github/ai-state/webui-planning-console.json`.

### Readiness States

| State | Color | Meaning |
|-------|-------|---------|
| `ready` | Green | All dependencies resolved, can be dispatched |
| `blocked` | Yellow | Waiting on dependency or external action |
| `done` | Gray | Terminal: merged, closed, or abandoned |

---

## 5. Merge Queue

**Route:** `/merge-queue`
**Purpose:** Manage PR merge ordering, processing, and retry.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Queue Status Bar                                                │
│  [state: idle|running] [pending: N] [processed: M] [failed: K]  │
├──────────────────────────────────────────────────────────────────┤
│  Queue Actions                                                   │
│  [Add to Queue] [Process Queue] [Retry Failed] [Reset Queue]    │
├──────────────────────────────────────────────────────────────────┤
│  Pending PRs Table                                               │
│  ┌────────┬──────────────┬──────────┬──────────┐                │
│  │ PR #   │ Title        │ Priority │ Status   │                │
│  ├────────┼──────────────┼──────────┼──────────┤                │
│  │ #456   │ Fix auth     │ 1        │ pending  │                │
│  │ #478   │ Add logging  │ 2        │ pending  │                │
│  └────────┴──────────────┴──────────┴──────────┘                │
├──────────────────────────────────────────────────────────────────┤
│  Failed PRs Table (if any)                                       │
│  ┌────────┬──────────────┬────────────┬──────────────┐          │
│  │ PR #   │ Title        │ Failed At  │ Error        │          │
│  ├────────┼──────────────┼────────────┼──────────────┤          │
│  │ #401   │ Old feature  │ 2h ago     │ merge conflict│         │
│  └────────┴──────────────┴────────────┴──────────────┘          │
└──────────────────────────────────────────────────────────────────┘
```

### Merge Queue Actions

| Action | Risk | Confirmation | Description |
|--------|------|-------------|-------------|
| Add to Queue | Low | `ADD` | Add PRs with priority ordering |
| Process Queue | High | `MERGE` | Merge queued PRs sequentially |
| Retry Failed | High | `RETRY` | Re-queue failed PRs |
| Reset Queue | High | `RESET` | Clear tracking state, preserve queue file |

### Data Sources

| Data | Source |
|------|--------|
| Queue entries | `.ai/merge-queue.json` |
| Queue state | `.ai/merge-queue-state.json` |
| Merge manifests | `.ai/merge-batch-manifests/` |

---

## 6. Providers

**Route:** `/providers`
**Purpose:** Monitor provider status, concurrency, and cooldowns.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Provider Summary Bar                                            │
│  [total: N] [available: M] [exhausted: K] [disabled: J]         │
├──────────────────────────────────────────────────────────────────┤
│  Provider Grid (cards)                                           │
│  ┌──────────────────┐ ┌──────────────────┐ ┌────────────────┐  │
│  │ provider-default │ │ provider-alt     │ │ provider-backup│  │
│  │ ● available      │ │ ● exhausted      │ │ ● disabled     │  │
│  │ ████░░ 4/6       │ │ ██████ 6/6       │ │ ░░░░░░ 0/4     │  │
│  │ cooldown: none   │ │ cooldown: 12m    │ │ auth failure   │  │
│  │ [Retry] [Disable]│ │ [Clear CD]       │ │ [Retry]        │  │
│  └──────────────────┘ └──────────────────┘ └────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│  Provider Detail Panel (on card select)                          │
│  [failure class] [last event] [assignment history]               │
└──────────────────────────────────────────────────────────────────┘
```

### Provider Card Fields

| Field | Source | Description |
|-------|--------|-------------|
| `id` | state file | Logical provider identifier |
| `status` | state file | available / exhausted / disabled |
| `currentConcurrency` | state file | Workers currently assigned |
| `maxConcurrency` | policy file | Concurrency cap |
| `cooldownExpiresAt` | state file | Countdown timer |
| `lastFailureClass` | state file | exhaustion / auth / runtime / null |

### Concurrency Bar

| Fill | Condition | Color |
|------|-----------|-------|
| Low | < 60% | Green |
| Mid | 60–85% | Yellow |
| High | > 85% | Red |

### Provider Actions

| Action | Risk | Confirmation | Description |
|--------|------|-------------|-------------|
| Retry | High | `RETRY` | Reset to available, clear cooldown |
| Clear Cooldown | Medium | `CLEAR` | Clear active cooldown timer |
| Disable | High | `DISABLE` + reason | Manual shutdown |

---

## 7. Audit

**Route:** `/audit`
**Purpose:** Review action execution history with filtering and export.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Audit Filter Bar                                                │
│  [action id dropdown] [status: all|success|error] [limit: 50]   │
│  [Export Audit] button                                           │
├──────────────────────────────────────────────────────────────────┤
│  Audit Table                                                     │
│  ┌──────────────┬──────────────┬──────────┬──────────┬─────────┐│
│  │ Timestamp    │ Action       │ Status   │ Payload  │ Result  ││
│  ├──────────────┼──────────────┼──────────┼──────────┼─────────┤│
│  │ 10:00:01     │ prov-rotation│ success  │ {***}    │ {ok}    ││
│  │ 10:00:00     │ merge-prs    │ error    │ {***}    │ {err}   ││
│  └──────────────┴──────────────┴──────────┴──────────┴─────────┘│
├──────────────────────────────────────────────────────────────────┤
│  Entry Detail Panel (on row select)                              │
│  [full sanitized payload] [full result] [confirmation token]     │
│  [audit id] [started at] [completed at]                          │
└──────────────────────────────────────────────────────────────────┘
```

### Data Source

`GET /api/audit` with query params: `actionId`, `status`, `limit` (max 500).

### Sanitization Rules

All displayed payloads pass through `sanitizeObject`:

| Pattern | Replacement |
|---------|-------------|
| `api_key`, `token`, `secret`, `password`, `credential`, `auth` fields | `***REDACTED***` |
| Long alphanumeric strings (> 20 chars) | `***REDACTED***` |
| GitHub PATs (`ghp_*`) | `[redacted-gh-token]` |
| AWS keys (`AKIA*`) | `[redacted-aws-key]` |
| JWT tokens | `[redacted-jwt]` |
| Strings > 500 chars | Truncated |

---

## 8. Governance

**Route:** `/governance`
**Purpose:** Display policy boundaries, human-required decisions, and system constraints.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Governance Overview                                             │
├──────────────────────────────────────────────────────────────────┤
│  Policy Boundaries                                               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Never available via WebUI:                                 │  │
│  │  - Set/modify API keys or tokens                           │  │
│  │  - Modify secret source paths                              │  │
│  │  - Add or remove providers                                 │  │
│  │  - Modify failure classification                           │  │
│  │  - Modify exhaustion triggers                              │  │
│  │  - Edit policy file                                        │  │
│  └────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│  Human-Required Decisions                                        │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Merge / Block a PR         — architectural review needed   │  │
│  │ Launch or Defer a Wave     — wave dependency review        │  │
│  │ Override Health Gate       — flake vs. real failure         │  │
│  │ Kill a Stale Worker        — check partial progress first  │  │
│  │ Auth or Database Cutover   — irreversible production impact│  │
│  └────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│  Security Controls                                               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Binding: 127.0.0.1 only                                    │  │
│  │ Auth: Bearer token                                         │  │
│  │ Rate limit: 10 fails / 5 min → 15 min block               │  │
│  │ Secret scrubbing: sanitizeObject on all I/O                │  │
│  │ Worker isolation: git worktrees under .claude/worktrees/   │  │
│  └────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│  Key Files Reference                                             │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ .github/ai-policy/provider-pool-policy.json                │  │
│  │ .github/ai-state/provider-pool.json                        │  │
│  │ .github/ai-state/main-health.json                          │  │
│  │ .ai/merge-queue.json                                       │  │
│  │ .ai/merge-queue-state.json                                 │  │
│  │ docs/ai-native/webui-operation-runbook.md                  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Content Sections

| Section | Content | Source |
|---------|---------|--------|
| Policy Boundaries | Actions never available via WebUI | Static (from control console doc) |
| Human-Required Decisions | Decisions requiring human judgment | Static (from runbook) |
| Security Controls | Active security measures and enforcement | Static + runtime state |
| Key Files Reference | Paths to policy, state, and docs | Static |

---

## Cross-References

- [WebUI Control Console Runbook](webui-control-console.md) — full panel/action documentation
- [WebUI Control Map](webui-control-map.md) — action-to-endpoint mapping
- [WebUI Operation Runbook](webui-operation-runbook.md) — step-by-step operator guide
- [Provider Pool WebUI API Contract](../contracts/provider-pool-webui-api.md) — endpoint definitions
- [Provider Pool WebUI README](../../tools/provider-pool-webui/README.md) — setup and usage
- [WebUI Action Contract](webui-action-contract.md) — action module schema
- [WebUI Action Confirmation Policy](webui-action-confirmation-policy.md) — confirmation phrases
