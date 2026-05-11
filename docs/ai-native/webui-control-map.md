# WebUI Control Map

**Scope:** Mapping from every WebUI button to its backing script, risk gate chain, and audit event.
**Audience:** Control-plane operators, AI workers, and reviewers verifying WebUI operation readiness.

## Principles

1. **Preview-first** — every mutating action exposes a `/api/actions/preview` dry-run path before `/api/actions/execute`.
2. **No secrets** — all payloads and audit entries pass through `sanitizeObject`; patterns matching `api_key`, `token`, `secret`, `password`, `credential`, `auth`, and long alphanumeric strings are redacted.
3. **Loopback-only** — the WebUI server binds to `127.0.0.1`; remote access is not possible.
4. **Human gate on high-risk** — actions marked `dangerous: true` or `humanRequired: true` require typed confirmation and cannot be auto-executed.

---

## Action Map

Every action module lives in `tools/provider-pool-webui/actions/` and
exports both `preview()` and `execute()`. Mutating actions default to
dry-run; the caller must pass `confirm: true` to execute.

### Task Planning

| Action ID | Label | Risk | Endpoint | Backing Script | Description |
|-----------|-------|------|----------|----------------|-------------|
| `compile-tasks` | Compile Tasks | Low | `POST /api/actions/execute` | `tools/provider-pool-webui/actions/compile-tasks.js` | Compile issue JSON into worker task contracts; non-destructive |
| `plan.next.batch` | Plan Next Batch | Low | `POST /api/actions/execute` | `tools/provider-pool-webui/actions/plan-next-batch.js` | Preview next batch: queued issues matched to provider capacity |

### Issue Management

| Action ID | Label | Risk | Endpoint | Backing Script | Description |
|-----------|-------|------|----------|----------------|-------------|
| `create-issues` | Create Issues | High | `POST /api/actions/execute` | `tools/provider-pool-webui/actions/create-issues.js` | Propose and create GitHub issues from gap analysis |
| `issue-state` | Issue State Control | High | `POST /api/actions/execute` | `tools/provider-pool-webui/actions/issue-state.js` | Reconcile issue labels/PRs and close done issues |

### Batch Execution

| Action ID | Label | Risk | Endpoint | Backing Script | Description |
|-----------|-------|------|----------|----------------|-------------|
| `launch-batch` | Launch Batch | High | `POST /api/actions/execute` | `tools/provider-pool-webui/actions/launch-batch.js` | Run launch gate and dispatch queued tasks |
| `merge-prs` | Merge PRs | High | `POST /api/actions/execute` | `tools/provider-pool-webui/actions/merge-prs.js` | Merge explicit PR allowlist with guard checks |

### Provider & Worker

| Action ID | Label | Risk | Endpoint | Backing Script | Description |
|-----------|-------|------|----------|----------------|-------------|
| `provider-rotation` | Provider Key Rotation | High | `POST /api/actions/execute` | `tools/provider-pool-webui/actions/provider-rotation.js` | Reset provider to available; clears cooldown and failure counters |
| `worker.control` | Worker Control | High | `POST /api/actions/execute` | `tools/provider-pool-webui/actions/worker-control.js` | List or stop workers with explicit targeting |

### Dashboard Readiness

The `actionReadiness` section of the dashboard state snapshot (schema v2)
surfaces readiness signals. The WebUI reads these before enabling buttons.

| Readiness ID | Description | Blocked When |
|--------------|-------------|--------------|
| `launch-worker` | Dispatch a new Codex worker | Health not green, no available providers, or trust below `minTrustToLaunch` |
| `merge-pr` | Merge a ready PR | Health not green or risk score > 80 |
| `retry-failed` | Retry failed queue entries | Health not green or no failed entries |
| `drain-queue` | Drain the task queue | Health not green, queue empty, or no providers |

---

## Risk Gate Chain

Every execute call passes through this chain, in order:

```
1. Client: typed confirmation phrase matches?
   └─ No → button stays disabled

2. Server: sanitizeObject(payload)
   └─ Scrubs secret-shaped fields

3. Server: dangerous flag check
   └─ dangerous=true && confirm!=true → 409 Conflict

4. Server: guard validation
   └─ Same guard rules as CLI (allowedFiles, policy files)

5. Launch gate (dispatch actions only)
   ├─ Main health state vs. worker-type permission matrix
   ├─ Duplicate conflictGroup within batch
   ├─ sharedLocks overlap between tasks
   └─ Running-worker conflict detection

6. Action readiness check
   └─ Dashboard state v2: health, providers, trust, risk score
```

### Visual Safety Signals

| Signal | Meaning |
|--------|---------|
| Blue border/badge | Preview mode — no mutation |
| Red border/badge | Execute mode — state will change |
| Green border/badge | Safe / read-only action |
| 45% opacity | Disabled — action unavailable |
| Pulsing red dot | Confirmation needed |

---

## Audit Trail

### Server-Side (persistent per session)

Every `POST /api/actions/execute` writes an audit entry:

```json
{
  "id": "uuid",
  "actionId": "provider-rotation",
  "startedAt": "2026-05-12T00:30:00Z",
  "completedAt": "2026-05-12T00:30:01Z",
  "status": "success",
  "payload": { "providerId": "***" },
  "result": { "enabled": true },
  "confirmationToken": "RETRY"
}
```

Retrieved via `GET /api/audit`. All fields pass through `sanitizeObject`.

### Client-Side (session-only, exportable)

Each executed action records: `timestamp`, `action`, `riskLevel`, `target`, `payload`, `mode` ("execute"), `status` ("dispatched"). Export via `global.exportAudit` button.

### Launch Plan Audit

Structured JSON per scheduling decision:

```json
{
  "planVersion": 2,
  "capturedAt": "2026-05-12T00:30:00Z",
  "mainHealth": "green",
  "selectedTasks": ["task-001"],
  "rejectedTasks": [
    { "taskId": "task-002", "reason": "conflict-group-duplicate" }
  ],
  "locksAcquired": ["app-module:auth"],
  "allAllowed": false
}
```

Decision rules are machine-readable: `health-state-blocked`, `conflict-group-duplicate`, `shared-lock-overlap`, `running-worker-conflict`.

---

## Planning Loop Visibility

The planning loop cycles through:

```
Task queue read → Launch gate → Worker dispatch → PR + review gate → Health gate → Next wave
```

Each stage emits state to `.github/ai-state/` which the WebUI reads via SSE file-watcher push. Operators see:

| Loop Stage | WebUI Surface | State File |
|------------|---------------|------------|
| Task queue | Queue tab — pending, running, blocked counts | `provider-pool-webui.json` → `queue` |
| Launch gate | Action readiness panel | `control-plane-dashboard-state.json` → `actionReadiness` |
| Worker dispatch | Workers tab — active worker list | `active-workers.json` |
| PR + review gate | Review gate status in dashboard | `health-state.json` |
| Health gate | Health indicator (green/yellow/red/black) | `main-health.json` |

### Human-Owned Boundaries

These loop transitions require human decision and cannot be auto-triggered:

- Issue creation
- PR approval
- Next-wave boundary
- Health gate override

---

## Read-Only Mode Baseline

Phase 1 ships with zero mutation surface. The following are blocked:

- Edit credentials
- Enable/disable providers
- Override concurrency
- Trigger/cancel workers
- Modify cooldowns
- Edit policy

All action buttons are disabled (45% opacity) in read-only mode. Preview endpoints still work.

---

## Preview-First Safety Contract

Every action module exports both `preview()` and `execute()`:

```js
// tools/provider-pool-webui/actions/<name>.js
module.exports = {
  id: 'provider-rotation',
  label: 'Provider Key Rotation',
  description: 'Reset provider to available; clears cooldown and failure counters',
  dangerous: true,
  preview(payload) { /* dry-run, no side effects */ },
  execute(payload) { /* mutates state, writes audit */ }
};
```

The `/api/actions/preview` endpoint calls `preview()` and returns the projected result without writing audit or mutating state. The UI shows the preview result with a blue badge before allowing execute.

---

## Security

| Control | Detail |
|---------|--------|
| Binding | `127.0.0.1` only |
| Auth | Bearer token via `PROVIDER_POOL_ADMIN_TOKEN` env or `.github/ai-state/.webui-token` |
| Rate limit | 10 failed attempts / 5 min → 15 min block |
| Secret scrubbing | `sanitizeObject` on all payloads and audit entries |
| Worker isolation | Workers run in git worktrees under `.claude/worktrees/`, cannot push to remote |

---

## npm Script Mapping

| Script | Default | Mutate Flag | WebUI Trigger |
|--------|---------|-------------|---------------|
| `ops:self-cycle` | dry-run | `-Execute` | Via control-plane dashboard |
| `ops:webui` | starts server | — | Launches WebUI |
| `ops:resource-sample` | dry-run | `-Execute` | Resource sampling |
| `ops:state-reconcile` | dry-run | `--execute` | Automatic on state drift |
| `ops:merge-queue` | dry-run | `--execute` | `drain-queue` readiness action |
| `ops:webui:console-issue` | dry-run | `--execute` | `issue-state` action module |
| `ops:webui:console-launch` | dry-run | `-Execute` | `launch-batch` action module |
| `ops:webui:console-merge` | dry-run | `-Execute` | `merge-prs` action module |
| `ops:webui:control-workers` | dry-run | `--execute` | `worker.control` action module |
| `ops:plan-next-batch` | dry-run | `--execute` | `plan.next.batch` action module |

All write-capable scripts default to dry-run. The WebUI never passes mutate flags directly; the server-side action module decides whether to call the script with or without the flag based on the `confirm` field.

---

## Cross-References

- [Provider Pool WebUI Architecture](provider-pool-webui-architecture.md)
- [WebUI Actions API](provider-pool-webui-actions-api.md)
- [WebUI Action Styles](provider-pool-webui-action-styles.md)
- [WebUI Action Registry](webui-action-registry.md)
- [Operation Console](provider-pool-webui-operation-console.md)
- [WebUI Security](provider-pool-webui-security.md)
- [Read-Only Mode](provider-pool-webui-readonly-mode.md)
- [Control-Plane Dashboard State Actions](control-plane-dashboard-state-actions.md)
- [Control-Plane npm Scripts](control-plane-npm-scripts.md)
- [Launch Gate](launch-gate.md)
- [Parallel Work Policy](parallel-work-policy.md)
- [Planning Loop](planning-loop.md)
- [Loop Model](loop-model.md)
- [Orchestration](orchestration.md)
- [Compile Tasks Action](webui-action-compile-tasks.md)
- [Create Issues Action](webui-action-create-issues.md)
- [Issue State Action](webui-action-issue-state.md)
- [Launch Batch Action](webui-action-launch-batch.md)
- [Merge PRs Action](webui-action-merge-prs.md)
- [Plan Next Batch Action](webui-action-plan-next-batch.md)
- [Provider Rotation Action](webui-action-provider-rotation.md)
- [Worker Control Action](webui-action-worker-control.md)
