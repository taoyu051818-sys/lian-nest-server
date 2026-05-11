# Planning Console Action Policy

Documents how the Planning Console relates to the WebUI action system,
what the selected/rejected launch plan summary means, and how preview-first
safety applies to the planning loop.

> **Closes:** [#819](https://github.com/taoyu051818-sys/lian-nest-server/issues/819)

---

## Console Mode

The Planning Console is **view-only**. It renders planning loop state but
exposes zero mutation buttons. All action surfaces (preview/execute) live
in the Operation Console tab.

| Tab | Mode | Actions |
|-----|------|---------|
| Dashboard | read-only | None |
| Operation Console | preview + execute | All action modules |
| Planning Console | read-only | None |

Despite being view-only, the Planning Console surfaces the **output** of
action policy decisions — particularly the launch gate — so operators can
audit what the system decided before any dispatch occurs.

---

## Launch Plan Summary

The Planning Console renders a compact summary widget at the top of the
tab, followed by a detailed Batch Preview section.

### Summary Widget

| Field | Meaning |
|-------|---------|
| **Selected** | Count of tasks cleared for dispatch by the launch gate. |
| **Rejected** | Count of tasks blocked by the gate. Yellow when > 0. |
| **Locks** | Shared locks acquired by selected tasks. |
| **Status** | `CLEAR` when `allAllowed` is true; `BLOCKED` otherwise. |
| **Health** | Main branch health badge (GREEN / YELLOW / RED / BLACK). |

### Batch Preview

The detailed view below the summary shows:

- **Main Health** — state, timestamp, and reason
- **Budget** — task count, max files, max lines, soft/hard time limits
- **Selected Tasks** — issue, type, risk, conflict group, worker type, locks
- **Rejected Tasks** — same columns plus the blocking rule
- **Acquired Locks** — lock name, holder issue, conflict group

### Rejection Rules

Every rejected task carries a machine-readable `decision.rule`:

| Rule | Meaning |
|------|---------|
| `health-state-blocked` | Worker type not permitted in current main health state. |
| `conflict-group-duplicate` | Two tasks share the same non-doc conflict group. |
| `shared-lock-overlap` | Two tasks claim the same shared lock. |
| `running-worker-conflict` | Task conflicts with an already-active worker. |

These rules are produced by `runGateCheck()` in the launch-batch action
module and surfaced verbatim in the Planning Console.

---

## Preview-First Safety

All mutating actions in the WebUI follow a preview-first contract. This
applies to the Operation Console (where actions live), not the Planning
Console directly — but the Planning Console displays the **result** of
preview evaluations.

### How It Works

1. **Preview** (`POST /api/actions/preview`) — calls `mod.preview(payload)`,
   returns projected effects with `dryRun: true`. No side effects, no audit
   written. UI shows a blue badge.
2. **Execute** (`POST /api/actions/execute`) — calls `mod.execute(payload)`.
   Requires `confirm: true` for dangerous actions (server returns 409
   otherwise). Writes an audit entry.

### Risk Escalation

| Risk Level | UI Behavior |
|------------|-------------|
| `low` | No confirmation needed. |
| `medium` | Single confirmation dialog. |
| `high` | Confirmation dialog with effect preview. |
| `critical` | Typed confirmation phrase required. |

### Launch Gate Chain

Every dispatch action passes through this gate before execution:

```
1. Client: typed confirmation phrase matches?
2. Server: sanitizeObject(payload) — scrub secrets
3. Server: dangerous flag check — 409 if confirm != true
4. Server: guard validation — allowedFiles, policy files
5. Launch gate: health matrix, conflict groups, locks, running workers
6. Action readiness: health, providers, trust, risk score
```

Steps 5-6 produce the selected/rejected data that the Planning Console
displays. The console is the operator's window into gate decisions.

---

## Read-Only State Emitter

The planning console state emitter (`emit-planning-console-state.js`) also
follows preview-first:

- **Default mode** — dry-run (prints preview to stdout, no file written)
- **Live mode** — `--live` flag required to write `.github/ai-state/planning-console.json`

This ensures the emitter itself cannot silently corrupt state.

---

## Operator Workflow

1. Open the Planning Console tab.
2. Review **Meta Signals** — trust, failure, friction, risk, cost, pain.
3. Check **Gap Ledger** — recent failures and their severity.
4. Inspect **Proposed Batch** — task candidates and readiness status.
5. Audit **Batch Preview** — which tasks are selected vs. rejected, why,
   and what locks are held.
6. If the gate shows `BLOCKED`, investigate rejection rules before
   attempting dispatch from the Operation Console.

The Planning Console never mutates state. It is the audit surface for
understanding what the system decided and why.

---

## Cross-References

- [WebUI Planning Console View](webui-planning-console-view.md) — Tab specification
- [Launch Plan Schema](launch-plan-schema.md) — Selected/rejected schema
- [WebUI Control Map](webui-control-map.md) — Action map and risk gate chain
- [WebUI Action Contract](webui-action-contract.md) — Preview/execute schemas
- [Planning Loop](planning-loop.md) — Dry-run planner
- [Main Health Policy](main-health-policy.md) — Health states and worker permissions
- [Parallel Work Policy](parallel-work-policy.md) — Conflict groups and shared locks
