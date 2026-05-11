# WebUI Operation Runbook

Step-by-step runbook for human operators using the WebUI control-plane
to preview, confirm, execute, and roll back controlled actions.

> **Closes:** [#732](https://github.com/taoyu051818-sys/lian-nest-server/issues/732)

---

## Audience

Operators (human) interacting with the local WebUI dashboard to manage
providers, queue entries, workers, and global orchestration state.

---

## Preconditions

Before any WebUI action:

1. **Server running** — `npm run ops:webui` launched and listening on
   `http://localhost:3000`.
2. **Health state valid** — `.github/ai-state/main-health.json` shows
   `green` or `yellow`.
3. **No secrets exposed** — verify no `.env` values or API keys appear
   in the browser console or audit log.
4. **Audit log empty or exported** — if resuming a session, export
   prior audit via `global.exportAudit` before starting.

---

## Action Lifecycle

Every mutating action follows this lifecycle:

```
Preview  →  Confirm  →  Execute  →  Audit  →  (Rollback if needed)
```

### 1. Preview

All actions start in **preview mode** (blue badge). The preview shows:

- The exact payload that will be sent.
- Current state of the target.
- Projected outcome.

No state changes occur during preview.

### 2. Confirm

Typed confirmation is required before execute. Each action has a
specific confirmation phrase:

| Risk Level | Confirmation | UI Behavior |
|------------|-------------|-------------|
| Low | Single click | Button enabled after preview |
| Medium | Type `CLEAR` or `RETRY` | Text input must match exactly |
| High | Type `DISABLE` + reason | Text input + justification required |
| Critical | Type exact phrase + reason | Full confirmation dialog |

The execute button stays **disabled** until the confirmation matches.

### 3. Execute

After confirmation, the action passes through the server-side risk
gate chain:

1. `sanitizeObject` scrubs secret-shaped fields.
2. Dangerous-flag check blocks unconfirmed high-risk actions.
3. Guard validation enforces `allowedFiles` and policy boundaries.
4. Launch gate checks health, conflict groups, and shared locks.
5. Action readiness check verifies dashboard state v2 conditions.

If any gate fails, the action is **blocked** and an error is returned
without mutation.

### 4. Audit

Every execute writes an audit entry (server-side, persistent per
session). Fields include `actionId`, `status`, `payload` (sanitized),
`confirmationToken`, and timestamps.

Retrieve via `GET /api/audit`. Export via `global.exportAudit` button.

---

## Provider Operations

### Retry an Exhausted Provider

**When:** Provider shows `exhausted` or `disabled` status.

| Step | Action |
|------|--------|
| 1 | Open Operation Console tab |
| 2 | Find the provider in the Provider Actions section |
| 3 | Click **Retry** — preview mode shows current status and projected state |
| 4 | Verify the preview shows `status: available` |
| 5 | Type `RETRY` in the confirmation field |
| 6 | Click **Execute** |

**Rollback:** Use `provider.disable` to re-disable if the provider
should not be active.

### Clear Provider Cooldown

**When:** Provider has an active cooldown timer.

| Step | Action |
|------|--------|
| 1 | Open Operation Console tab |
| 2 | Find the provider with cooldown |
| 3 | Click **Clear Cooldown** — preview shows cooldown expiry time |
| 4 | Verify the preview shows `cooldownExpiresAt: null` |
| 5 | Type `CLEAR` in the confirmation field |
| 6 | Click **Execute** |

**Rollback:** Cooldowns re-apply automatically on the next provider
failure. No manual rollback needed.

### Disable a Provider (High Risk)

**When:** Provider needs manual shutdown (e.g., credential rotation,
cost control).

| Step | Action |
|------|--------|
| 1 | Open Operation Console tab |
| 2 | Find the provider to disable |
| 3 | Click **Disable** — red badge, warning banner shown |
| 4 | Review the preview: in-flight workers will drain, no new assignments |
| 5 | Type `DISABLE` and provide a reason |
| 6 | Click **Execute** |

**Rollback:** Use `provider.retry` to re-enable after the issue is
resolved.

---

## Queue Operations

### Retry Blocked Tasks

**When:** Queue shows entries in `blocked` status.

| Step | Action |
|------|--------|
| 1 | Open Operation Console tab |
| 2 | Find **Queue Actions** section |
| 3 | Click **Retry Blocked** — preview shows count of blocked entries |
| 4 | Verify the preview lists affected task IDs |
| 5 | Type `RETRY` in the confirmation field |
| 6 | Click **Execute** |

**Rollback:** Tasks that fail again return to `blocked` state
automatically. Investigate the root cause before re-retrying.

### Clear Stale Entries

**When:** Queue has entries older than 2 hours in non-terminal state.

| Step | Action |
|------|--------|
| 1 | Open Operation Console tab |
| 2 | Find **Queue Actions** section |
| 3 | Click **Clear Stale** — preview shows entries older than 2h |
| 4 | Verify the preview lists affected task IDs and ages |
| 5 | Type `CLEAR` in the confirmation field |
| 6 | Click **Execute** |

**Rollback:** Stale entries are permanently removed. Re-create tasks
from issues if needed.

---

## Merge Queue Operations

The merge queue manages PR merges via `.ai/merge-queue.json`.
Operators interact with it through the Operation Console.

### View Merge Queue Status

**When:** Checking which PRs are queued, processed, or failed.

| Step | Action |
|------|--------|
| 1 | Open Operation Console tab |
| 2 | Find **Merge Queue** section |
| 3 | Queue status shows: pending PRs, processed PRs, failed PRs, and current state (`idle` / `running`) |

Status is read-only — no confirmation required.

### Add PRs to the Queue

**When:** PRs are approved and ready to merge in order.

| Step | Action |
|------|--------|
| 1 | Open Operation Console tab |
| 2 | Find **Merge Queue** section |
| 3 | Click **Add to Queue** — preview shows PR numbers and priority order |
| 4 | Verify the preview lists the correct PRs |
| 5 | Type `ADD` in the confirmation field |
| 6 | Click **Execute** |

PRs are added to `.ai/merge-queue.json` with ascending priority.
The queue file supports priority ordering — lower numbers merge first.

**Rollback:** Edit `.ai/merge-queue.json` directly to remove unwanted entries.

### Process the Merge Queue

**When:** Merging queued PRs in priority order.

| Step | Action |
|------|--------|
| 1 | Verify health is **green** |
| 2 | Check the **Action Readiness** panel — `drain-queue` must not be blocked |
| 3 | Open Operation Console tab |
| 4 | Find **Merge Queue** section |
| 5 | Click **Process Queue** — preview shows the batch plan (PRs, priority, provider) |
| 6 | Verify the preview lists the expected PRs in priority order |
| 7 | Type `MERGE` in the confirmation field |
| 8 | Click **Execute** |

Processing runs `ops:merge-queue` with `--execute`. PRs are merged
sequentially with `--squash --delete-branch`. Processing stops on the
first failure.

**Blocked when:** Health not green, queue empty, or PRs have `FAILURE`/`CANCELLED` checks.

**Rollback:** Use `git revert` on main. Merge manifests in
`.ai/merge-batch-manifests/` record each batch for traceability.

### Retry Failed Merge Entries

**When:** Merge queue state shows failed PRs that should be retried.

| Step | Action |
|------|--------|
| 1 | Open Operation Console tab |
| 2 | Find **Merge Queue** section |
| 3 | Click **Retry Failed** — preview shows the failed PR list |
| 4 | Verify the failed PRs have been fixed (checks passing, mergeable) |
| 5 | Type `RETRY` in the confirmation field |
| 6 | Click **Execute** |

**Rollback:** Failed PRs remain in the failed list. Investigate root
cause before re-retrying.

### Reset Merge Queue State

**When:** Queue state is stale or corrupted after an interruption.

| Step | Action |
|------|--------|
| 1 | Open Operation Console tab |
| 2 | Find **Merge Queue** section |
| 3 | Click **Reset Queue** — preview shows current state and what will be cleared |
| 4 | Type `RESET` in the confirmation field |
| 5 | Click **Execute** |

This clears `.ai/merge-queue-state.json`, allowing all PRs in the
queue file to be reprocessed. Queue file entries are preserved.

**Rollback:** Not needed — queue file is unchanged; only tracking
state is reset.

---

## Global Operations

### Refresh State

**When:** State files may be stale after external changes.

| Step | Action |
|------|--------|
| 1 | Open Operation Console tab |
| 2 | Find **Global Actions** section |
| 3 | Click **Refresh State** |
| 4 | Type `REFRESH` |
| 5 | Click **Execute** |

**Rollback:** Not needed — this is a read-only refresh of cached state.

### Export Audit Log

**When:** End of session or before a risky operation.

| Step | Action |
|------|--------|
| 1 | Open Operation Console tab |
| 2 | Find **Global Actions** section |
| 3 | Click **Export Audit** |
| 4 | Type `EXPORT` |
| 5 | Click **Execute** — downloads JSON file |

**Rollback:** Not applicable — read-only export.

---

## Control-Plane Dashboard Actions

These actions appear on the control-plane dashboard and follow the same
preview-first, confirmation-gated model.

### Launch Worker

| Step | Action |
|------|--------|
| 1 | Verify health is **green** |
| 2 | Check the **Action Readiness** panel — `launch-worker` must not be blocked |
| 3 | Click **Launch Worker** — preview shows task, provider, and worktree |
| 4 | Confirm the task and provider assignment |
| 5 | Execute |

**Blocked when:** Health not green, no available providers, or trust
below `minTrustToLaunch`.

**Rollback:** Cancel the worker via `cancel-worker` (high risk, human
required). Clean up the worktree via worktree janitor.

### Merge PR

| Step | Action |
|------|--------|
| 1 | Verify health is **green** |
| 2 | Check the **Action Readiness** panel — `merge-pr` must not be blocked |
| 3 | Click **Merge PR** — preview shows PR number, title, and risk score |
| 4 | Verify risk score is below 80 |
| 5 | Execute |

**Blocked when:** Health not green or risk score > 80.

**Rollback:** Use `git revert` on main. The merge manifest in
`.ai/merge-batch-manifests/` records the merge for traceability.

### Retry Failed

| Step | Action |
|------|--------|
| 1 | Verify health is **green** |
| 2 | Click **Retry Failed** — preview shows failed queue entries |
| 3 | Confirm retry scope |
| 4 | Execute |

**Blocked when:** Health not green or no failed entries.

### Drain Queue

| Step | Action |
|------|--------|
| 1 | Verify health is **green** |
| 2 | Click **Drain Queue** — preview shows queue depth and providers |
| 3 | Confirm drain scope |
| 4 | Execute |

**Blocked when:** Health not green, queue empty, or no providers.

---

## Rollback Procedures

### Action-Level Rollback

Each action section above includes a **Rollback** note. Follow the
specific rollback step for the action that was executed.

### Session-Level Rollback

If multiple actions were executed in a session and the system is in an
unexpected state:

1. **Export the audit log** — `global.exportAudit` to capture what
   happened.
2. **Check health** — `node scripts/post-merge-health-gate.js --quick`.
3. **Reconcile state** — `./scripts/ai/state-reconciler.ps1 -Repo owner/name`.
4. **Review audit entries** — identify the last known-good state from
   the audit log.
5. **Manually revert** — use the inverse action (e.g., disable a
   provider that was incorrectly enabled).

### Emergency Stop

If the system is in a bad state and no individual rollback applies:

1. **Pause orchestration** — `pause-orchestration` action (high risk,
   human required, type `PAUSE`).
2. **Export audit** — capture the full session log.
3. **Run health gate** — `node scripts/post-merge-health-gate.js --full`.
4. **Write health marker** — if health is red, write the marker to
   block further launches.
5. **Investigate** — review audit log, state files, and worker
   worktrees.

---

## Safety Reminders

- **Never bypass typed confirmation.** The confirmation phrase exists
  to prevent accidental mutations.
- **Always preview before execute.** The preview shows exactly what
  will change.
- **Export audit before risky operations.** The audit log is
  session-only and not persisted server-side.
- **Check health before launching.** Red or black health blocks all
  worker types except recovery.
- **No secrets in the console.** All payloads are sanitized. If you
  see a raw key or token, report it as a security issue.

---

## Quick Reference

### Confirmation Phrases

| Action | Phrase |
|--------|--------|
| `provider.retry` | `RETRY` |
| `provider.clearCooldown` | `CLEAR` |
| `provider.disable` | `DISABLE` |
| `queue.retryBlocked` | `RETRY` |
| `queue.clearStale` | `CLEAR` |
| `mergeQueue.add` | `ADD` |
| `mergeQueue.process` | `MERGE` |
| `mergeQueue.retryFailed` | `RETRY` |
| `mergeQueue.reset` | `RESET` |
| `global.refreshState` | `REFRESH` |
| `global.exportAudit` | `EXPORT` |

### Visual Signals

| Signal | Meaning |
|--------|---------|
| Blue border/badge | Preview mode — no mutation |
| Red border/badge | Execute mode — state will change |
| Green border/badge | Safe / read-only action |
| 45% opacity | Disabled — action unavailable |
| Pulsing red dot | Confirmation needed |

### Key Files

| Path | Contents |
|------|----------|
| `.github/ai-state/main-health.json` | Main branch health marker |
| `.ai/merge-queue.json` | Merge queue PR list with priorities |
| `.ai/merge-queue-state.json` | Merge queue tracking state |
| `.ai/merge-batch-manifests/` | Merge batch manifests |
| `.ai/webui-merge-manifests/` | WebUI merge control manifests |
| `.claude/worktrees/` | Worker worktrees |
| `docs/ai-native/` | Governance docs |

---

## Cross-References

- [WebUI Control Map](webui-control-map.md) — full action-to-endpoint
  mapping and risk gate chain
- [Operation Console](provider-pool-webui-operation-console.md) —
  client-side console design and safety model
- [Action Contract](webui-action-contract.md) — schema and policy for
  all action types
- [Self-Cycle Operator Checklist](self-cycle-operator-checklist.md) —
  CLI-level operator checklist
- [Controlled Auto-Merge](controlled-auto-merge.md) — batch merge
  script safety guarantees
- [Auto-Merge Queue Mode](auto-merge-queue-mode.md) — queue-based
  merge processing and state management
- [Merge Queue Assistant](merge-queue-assistant.md) — PR eligibility
  discovery and merge commands
- [WebUI Merge Control](webui-merge-control.md) — preview-first
  merge control wrapper for the WebUI console
- [Planning Console](webui-planning-console-view.md) — planning
  visibility surface
