# WebUI Control Console Runbook

Operator runbook for the Provider Pool WebUI control console. Covers every
panel, action, confirmation flow, and audit boundary so that routine Codex
orchestration can exit and humans can operate the full loop from the browser.

> **Closes:** [#659](https://github.com/taoyu051818-sys/lian-nest-server/issues/659)

---

## Overview

The WebUI control console is the human-facing surface for monitoring and
controlling the self-cycle orchestration loop. It replaces raw JSON inspection
and CLI guard invocations with a live dashboard backed by the same policy/state
files the scripts read.

```
┌──────────────────────────────────────────────────────────────┐
│  WebUI Control Console  (http://127.0.0.1:3210)              │
│                                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ Provider View │ │  Worker View │ │  Queue View          │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ Pressure     │ │ Action Panel │ │  Audit Log           │ │
│  │ Gauge        │ │ (confirm)    │ │                      │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Security:** Loopback-only (`127.0.0.1`), admin-token gated, no secrets
in any response. See [provider-pool-webui-security.md](provider-pool-webui-security.md).

---

## Starting the Console

```bash
# Start the WebUI server
node tools/provider-pool-webui/server.js

# Custom port
node tools/provider-pool-webui/server.js --port 4000

# Background mode
node tools/provider-pool-webui/server.js --daemon
```

The server prints the bound URL on startup:

```
[webui] Listening on http://127.0.0.1:3210 (loopback only)
```

### Authentication

All endpoints require a Bearer token:

| Source | Priority | Notes |
|--------|:--------:|-------|
| `PROVIDER_POOL_ADMIN_TOKEN` env var | 1 | Set before starting the server |
| `.github/ai-state/.webui-token` file | 2 | Auto-generated if env var is absent |

Pass the token in every request:

```bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:3210/api/state
```

The dashboard HTML sets the token from the URL hash or prompts on first load.

---

## Provider View

The provider view shows every configured provider, its status, concurrency
utilization, and cooldown state. Data comes from
`.github/ai-state/provider-pool.json` merged with
`.github/ai-policy/provider-pool-policy.json`.

### Provider Status Indicators

| Status | Color | Meaning |
|--------|-------|---------|
| `available` | Green | Has capacity; can accept new workers |
| `exhausted` | Yellow | Quota or rate limit hit; in cooldown |
| `disabled` | Red | Auth failure or manually disabled |

### Provider Card Fields

| Field | Source | Description |
|-------|--------|-------------|
| `id` | state file | Logical provider identifier |
| `label` | policy file | Human-readable name |
| `status` | state file | Current status (available/exhausted/disabled) |
| `currentConcurrency` | state file | Workers currently assigned |
| `maxConcurrency` | policy file | Concurrency cap for this provider |
| `cooldownExpiresAt` | state file | Countdown timer; `null` when not cooling |
| `lastFailureClass` | state file | `exhaustion`, `auth`, `runtime`, or `null` |

### Concurrency Bar

Each provider card shows a horizontal bar:

| Fill Level | Condition | Color |
|------------|-----------|-------|
| Low | < 60% of max | Green |
| Mid | 60-85% of max | Yellow |
| High | > 85% of max | Red |

### Global Pool Summary

Above the provider grid, summary cards show:

| Metric | Field | Description |
|--------|-------|-------------|
| Total Providers | `global.totalProviders` | Configured provider count |
| Available | `global.availableProviders` | Providers with capacity |
| Exhausted | `global.exhaustedProviders` | Providers in cooldown |
| Disabled | `global.disabledProviders` | Providers with auth failure or manual disable |
| Active Workers | `global.totalActiveWorkers` | Sum across all providers |
| Global Max | `global.globalMaxWorkers` | System-wide concurrency ceiling |

---

## Worker View

The worker view lists all active worker assignments. Data comes from
`provider-pool-webui.json` state projection.

### Worker Card Fields

| Field | Description |
|-------|-------------|
| `issue` | GitHub issue number the worker is processing |
| `branch` | Git branch or worktree name |
| `conflictGroup` | Conflict group from the task contract |
| `providerId` | Assigned provider id |
| `startedAt` | Dispatch timestamp |
| `status` | `running`, `cooling-down`, or `draining` |

### Worker Status Colors

| Status | Color | Meaning |
|--------|-------|---------|
| `running` | Green | Actively executing the task |
| `cooling-down` | Yellow | Provider exhausted mid-task; waiting for cooldown |
| `draining` | Blue | Task complete; tearing down worktree |

### Worker State Transitions

```
dispatched
    │
    ▼
 running ──────────► draining
    │                    │
    │ (exhaustion hit)   │ (task complete)
    ▼                    ▼
cooling-down          removed
    │
    │ (cooldown expires)
    ▼
 running (recovered)
```

### Worker Heartbeat

Each worker card shows elapsed time since dispatch. A worker that has not
produced output for 60 seconds enters `running:no-output` state (heartbeat
docs: [worker-heartbeat.md](worker-heartbeat.md)). After 5 minutes with no
output the worker is `stale`. The WebUI does not kill workers — see
[Human-Required Boundaries](#human-required-boundaries).

---

## Queue View

The queue view shows pending tasks and why they are blocked. Data comes from
the `queue` section of the WebUI state projection.

### Queue State Lifecycle

```
queued → launching → running → pr-created → done
                       ↓ ↑         ↓
                    blocked    (direct done)
```

| State | Meaning |
|-------|---------|
| `queued` | Waiting for dispatch; no worker assigned |
| `launching` | Launcher preparing worktree and deps |
| `running` | Worker executing the task |
| `pr-created` | PR opened; awaiting review and merge |
| `blocked` | Waiting on dependency or external action |
| `done` | Terminal: merged, closed, or abandoned |

### Queue Depth Cards

| Card | Field | Description |
|------|-------|-------------|
| Pending | `queue.pendingTasks` | Total tasks waiting to dispatch |
| Blocked (Exhaustion) | `queue.blockedByExhaustion` | All providers exhausted |
| Blocked (Conflict) | `queue.blockedByConflict` | Conflict group overlap with active worker |
| Blocked (Capacity) | `queue.blockedByCapacity` | Global max workers reached |

### Queue Entry Detail Table

When the WebUI state projection includes `queueEntries`, a detail table shows:

| Column | Field | Description |
|--------|-------|-------------|
| Issue | `issueNumber` | GitHub issue |
| State | `state` | Current lifecycle state |
| Conflict Group | `conflictGroup` | From task contract |
| Role | `actorRole` | Worker role (e.g. `docs-worker`, `backend-runtime-worker`) |
| Blocked By | `blockedBy` | Issue/PR numbers blocking progress |
| Reason | `reason` | Human-readable explanation |
| Updated | `updatedAt` | Last state transition timestamp |

---

## Pressure Gauge

The pressure gauge is a top-level indicator of system-wide resource
utilization.

| Level | Condition | Indicator |
|-------|-----------|-----------|
| `normal` | utilization < 60% and no exhausted providers | Green, no animation |
| `elevated` | utilization >= 60% or any provider exhausted | Yellow, slow pulse |
| `critical` | utilization >= 90% or all providers exhausted/disabled | Red, fast pulse |

The gauge also shows:

- **Utilization percentage** — `totalActiveWorkers / globalMaxWorkers * 100`
- **Nearest cooldown expiry** — earliest upcoming cooldown end, or "none"

---

## Action Panel (Preview / Execute Confirmations)

The action panel provides controlled mutation surfaces. All mutations
default to **preview (dry-run)** and require explicit confirmation to execute.

### Available Actions

| Action | Target | Preview Shows | Execute Does |
|--------|--------|---------------|--------------|
| Disable provider | `provider.status` | Current status, impact on active workers | Sets status to `disabled` |
| Enable provider | `provider.status` | Whether auth failure blocks re-enable | Sets status to `available` |
| Reset cooldown | `provider.cooldownExpiresAt` | Current expiry time | Clears cooldown immediately |
| Adjust max concurrency | `provider.maxConcurrency` | Current vs proposed value | Writes new limit to state |
| Adjust global max | `global.globalMaxWorkers` | Current vs proposed value | Writes new limit to state |

### Confirmation Flow

Every mutation follows a two-step pattern:

```
1. Operator clicks action button
        │
        ▼
2. Preview panel appears showing:
   - Current value
   - Proposed value
   - Affected workers / queue entries
   - Guard validation result
        │
        ▼
3. Operator clicks "Confirm Execute"
        │
        ▼
4. Action executes; audit log entry written
        │
        ▼
5. Dashboard refreshes via SSE push
```

### Guard Integration

Before any mutation executes, the WebUI calls the provider pool guard
(`check-provider-pool.js`) to validate:

- The mutation does not violate policy constraints
- No running workers would be orphaned
- The resulting state is internally consistent

If the guard rejects the mutation, the preview panel shows the violation
reason and the execute button is disabled.

### Forbidden Actions

The following actions are **never** available through the WebUI:

| Action | Reason |
|--------|--------|
| Set/modify API keys or tokens | Secrets boundary — local config only |
| Modify secret source paths | Policy-level decision |
| Add or remove providers | Requires policy file + orchestrator coordination |
| Modify failure classification | Policy-level decision |
| Modify exhaustion triggers | Policy-level decision |
| Cancel or kill running workers | Human-required (see below) |
| Edit policy file | Policy mutation — file-level edit only |

---

## Audit Log

All mutations performed through the WebUI are logged to
`provider-ui-audit.ndjson`. The audit log is append-only and never
contains secrets.

### Log Entry Format

```json
{
  "timestamp": "2026-05-11T14:30:00Z",
  "action": "reset-cooldown",
  "target": "provider-default.cooldownExpiresAt",
  "actor": "operator",
  "previousValue": "2026-05-11T15:00:00Z",
  "newValue": null,
  "guardResult": "pass"
}
```

### What Gets Logged

| Event | Logged Fields |
|-------|---------------|
| Provider disable/enable | action, target, previousValue, newValue |
| Cooldown reset | action, target, previousValue, newValue |
| Concurrency limit change | action, target, previousValue, newValue |
| Global max change | action, target, previousValue, newValue |
| Guard rejection | action, target, guardResult (with reason) |

### What Never Gets Logged

| Artifact | Status |
|----------|--------|
| API keys, tokens, credentials | NEVER |
| Raw provider responses | NEVER |
| `.env` file contents | NEVER |
| Worker secret sources | NEVER |
| Admin token value | NEVER |

### Reading the Audit Log

```bash
# View recent entries
tail -20 .github/ai-state/provider-ui-audit.ndjson

# Filter by action type
grep '"action":"reset-cooldown"' .github/ai-state/provider-ui-audit.ndjson

# Filter by provider
grep '"provider-default"' .github/ai-state/provider-ui-audit.ndjson
```

---

## Human-Required Boundaries

The WebUI respects the same human-owned decision boundaries defined in
[codex-retirement-runbook.md](codex-retirement-runbook.md#human-owned-decisions).
The following actions are **not automated** and require human judgment.

### Merge / Block a PR

The WebUI shows PR status but does not merge. Merge decisions are
human-owned because architectural mismatch, scope drift, or security
risk may not be detectable by automation.

**What the WebUI shows:** PR number, linked issue, conflict group, review
status, guard check results.

**What the operator does:** Review the PR diff, apply the
[worker acceptance checklist](worker-acceptance-checklist.md), then merge
via CLI:

```powershell
./scripts/ai/merge-clean-pr-batch.ps1 -PRs <N> -Repo owner/name -Execute -RunGuards -RunHealthGate
```

### Launch or Defer a Wave

The WebUI shows the queue and proposed batch but does not launch. Wave
boundaries are human-owned because wave dependencies require diff review.

**What the WebUI shows:** Proposed batch from `plan-next-batch.ps1`,
launch gate report, conflict group analysis.

**What the operator does:** Review the plan, then execute:

```powershell
./scripts/ai/run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name -Execute
```

### Override Health Gate

If the health gate misclassifies a flake as red, the operator can manually
override. The WebUI shows the current health state but does not override.

**What the WebUI shows:** Current health state (green/yellow/red/black),
last check timestamp, failed checks.

**What the operator does:**

```powershell
./scripts/ai/write-main-health-state.ps1 -State green -Checks "tsc,build,prisma"
```

### Kill a Stale Worker

The WebUI shows worker heartbeat state but does not kill workers
(no-kill guarantee from [worker-heartbeat.md](worker-heartbeat.md)).

**What the WebUI shows:** Worker status, elapsed time, last output
timestamp, stale indicator.

**What the operator does:** Check the worktree for partial progress,
then kill manually if needed:

```powershell
# Check worktree
git worktree list

# Kill the worker process (operator identifies PID)
# Then clean up the worktree
./scripts/ai/worktree-janitor.ps1 -RemoveMerged
```

### Auth or Database Cutover

These decisions have irreversible production impact and require
`architect` + `security-reviewer` sign-off. The WebUI does not surface
cutover controls.

---

## Integration with Self-Cycle Runner

The WebUI complements the self-cycle runner by providing visual oversight
of the same data the runner reads.

### Mapping: Runner Step → WebUI Panel

| Runner Step | WebUI Panel | What the Operator Sees |
|-------------|-------------|------------------------|
| Step 1: Plan-first proposal | Queue View | Proposed batch, conflict groups |
| Step 2: Health check | Pressure Gauge | Health state, readiness |
| Step 3: Launch gate | Queue View + Provider View | Gate report, blocked reasons |
| Step 4: Batch launch | Worker View | Launched workers, assignments |
| Step 5: Cycle summary | All panels | Full system state |

### Pre-Cycle Checklist (WebUI-Assisted)

Before starting a self-cycle run, verify in the WebUI:

- [ ] **Pressure gauge is normal or elevated** — not critical
- [ ] **No providers in disabled state** (or recovery is planned)
- [ ] **Queue shows no stale entries** — all `done` or actively progressing
- [ ] **Worker count is at or below expected** — no orphaned workers
- [ ] **Cooldown timers are reasonable** — no stuck cooldowns

Then proceed with the CLI cycle:

```powershell
./scripts/ai/run-self-cycle.ps1 -PlanFirst -IssueLabel "agent:codex-action-needed" -Repo owner/name
```

### Post-Merge Checklist (WebUI-Assisted)

After PRs merge, verify in the WebUI:

- [ ] **Worker count decreased** — merged workers removed from active list
- [ ] **Pressure level dropped** or is stable
- [ ] **No new exhausted providers** from the merge batch
- [ ] **Queue entries advanced** — `pr-created` entries moved to `done`

Then run post-merge maintenance:

```powershell
node scripts/post-merge-health-gate.js --quick
./scripts/ai/write-main-health-state.ps1 -State <state> -Checks "tsc,build"
./scripts/ai/worktree-janitor.ps1 -RemoveMerged
./scripts/ai/state-reconciler.ps1 -Repo owner/name
```

---

## SSE Live Updates

The dashboard subscribes to `/api/events` (Server-Sent Events) for live
state updates. When the file watcher detects changes to state or policy
files, the dashboard re-renders the affected panels without manual refresh.

### SSE Event Types

| Event | Trigger | Panels Updated |
|-------|---------|----------------|
| `state-changed` | `provider-pool.json` modified | Provider View, Pressure Gauge |
| `webui-state-changed` | `provider-pool-webui.json` modified | Worker View, Queue View |
| `policy-changed` | `provider-pool-policy.json` modified | Provider View (limits) |

### Reconnection

If the SSE connection drops, the dashboard automatically reconnects with
exponential backoff (1s, 2s, 4s, max 30s). A "reconnecting" indicator
appears in the header.

---

## Troubleshooting

### Dashboard Shows No Data

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "No providers configured" | State file missing or empty | Run self-cycle to populate state |
| "Connection refused" | Server not started | `node tools/provider-pool-webui/server.js` |
| 401 on all requests | Token mismatch | Check `PROVIDER_POOL_ADMIN_TOKEN` env var or `.webui-token` file |
| Stale data (old `capturedAt`) | File watcher not running | Restart the server |

### Provider Shows Exhausted Indefinitely

| Step | Action |
|------|--------|
| 1 | Check `cooldownExpiresAt` — is it in the past? |
| 2 | If past, the state updater should have cleared it. Run `state-reconciler.ps1`. |
| 3 | If still stuck, use the action panel to reset cooldown (with confirmation). |

### Worker Shows Stale

| Step | Action |
|------|--------|
| 1 | Check elapsed time — has it exceeded 5 minutes with no output? |
| 2 | Check the worktree for uncommitted changes: `git worktree list` |
| 3 | If the worker is truly stuck, kill the process and clean up the worktree |
| 4 | Relaunch the task via the self-cycle runner |

### Queue Shows Blocked Entries

| Block Reason | Operator Action |
|-------------|-----------------|
| Exhaustion | Wait for cooldown to expire, or reset via action panel |
| Conflict | Wait for conflicting worker to finish, or rescope the task |
| Capacity | Wait for active workers to complete, or raise `globalMaxWorkers` |

---

## Data Sources Summary

| Panel | Primary Source | Secondary Source |
|-------|----------------|------------------|
| Provider View | `.github/ai-state/provider-pool.json` | `.github/ai-policy/provider-pool-policy.json` |
| Worker View | `.github/ai-state/provider-pool-webui.json` | Worker heartbeats |
| Queue View | `.github/ai-state/provider-pool-webui.json` | Queue state projection |
| Pressure Gauge | `.github/ai-state/provider-pool-webui.json` | Computed by state reconciler |
| Action Panel | Guard script output | Policy constraints |
| Audit Log | `.github/ai-state/provider-ui-audit.ndjson` | Append-only |

---

## Security Recap

| Rule | Enforcement |
|------|-------------|
| Loopback only | Server rejects non-`127.0.0.1` bind |
| Admin token required | All endpoints check Bearer token |
| No secrets in responses | State files never contain credentials |
| No secret logging | Log scrubbing removes any accidental secrets |
| Worker secret isolation | WebUI and workers use separate secret paths |
| Read-only policy | WebUI never writes to policy files |
| Mutation audit | All writes logged to `provider-ui-audit.ndjson` |

---

## References

- [Provider Pool WebUI Architecture](provider-pool-webui-architecture.md) — component overview
- [Provider Pool WebUI API](provider-pool-webui-api.md) — endpoint definitions
- [Provider Pool WebUI Security](provider-pool-webui-security.md) — security model
- [Provider Pool WebUI State Contract](provider-pool-webui-state-contract.md) — state projection schema
- [Provider Pool WebUI Worker View](provider-pool-webui-worker-view.md) — worker dashboard panels
- [Provider Pool WebUI Read-Only Mode](provider-pool-webui-readonly-mode.md) — read-only boundaries
- [Provider UI Policy](provider-ui-policy.md) — display and mutation rules
- [WebUI Queue State Schema](webui-queue-state-schema.md) — queue lifecycle schema
- [Self-Cycle Operator Checklist](self-cycle-operator-checklist.md) — CLI checklist companion
- [Codex Retirement Runbook](codex-retirement-runbook.md) — exit criteria and fallback
- [Loop Model](loop-model.md) — self-cycle runner phases
- [Worker Heartbeat](worker-heartbeat.md) — process monitoring
- [Main Health Policy](main-health-policy.md) — health states and permissions
