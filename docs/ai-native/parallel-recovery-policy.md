# Parallel Recovery Task Policy

Defines how the orchestrator decomposes recovery work into independent,
parallel-safe tasks. Recovery tasks follow the same governed parallelism
rules as feature work — only independent fact changes run concurrently;
shared truth and high-risk boundaries remain serialized or human-gated.

> **Closes:** [#1048](https://github.com/taoyu051818-sys/lian-nest-server/issues/1048)

---

## Recovery Categories

Six recovery categories, each with a risk tier and parallelism rule:

| Category | Risk Tier | Parallelism | Rationale |
|----------|-----------|-------------|-----------|
| Timeout | low | parallelizable | Each worker's timeout is an independent fact |
| State drift | medium | parallelizable with shared-lock guard | Drift may touch shared projections |
| Docs conflict | low | parallelizable | Docs files are independent per directory |
| Generated stale | low | parallelizable | Regeneration is idempotent per artifact |
| Route parity missing | medium | serialized per module | Parity fixes touch shared route registrations |
| Human-required high-risk | high | always serialized | Auth, data migration, public API — human review required |

---

## Recovery Task Decomposition

### Principle: writeSet Isolation

A recovery task is parallelizable if and only if its `writeSet` (the set of
files it modifies) does not intersect with any other concurrent recovery
task's `writeSet`. The orchestrator computes writeSet from `allowedFiles`
before dispatch.

```
Task A writeSet: { docs/ai-native/foo.md }
Task B writeSet: { docs/ai-native/bar.md }

Intersection: {} → parallel OK

Task C writeSet: { src/modules/auth/auth.service.ts }
Task D writeSet: { src/modules/auth/auth.guard.ts }

Intersection: {} but shared lock: auth-module → serialize
```

### Principle: sharedLocks for Implicit Dependencies

When two recovery tasks modify different files that semantically depend on
each other (e.g., a service and its guard, a module and its route), they
declare a shared lock. The launch gate serializes tasks claiming the same
lock, even when file paths do not overlap.

See [Parallel Work Policy](parallel-work-policy.md#rule-5-shared-locks-for-common-resources)
for the shared lock model.

---

## Category Policies

### 1. Timeout Recovery

**Trigger:** Worker exceeds `hardTimeMinutes` from its task contract.

**Policy:**
- Timeout is per-worker — each timeout is an independent fact.
- The orchestrator may launch timeout recovery for multiple expired workers
  simultaneously.
- Recovery tasks write only to the timed-out worker's branch or issue
  comment — no shared file mutation.
- If the timed-out worker left partial changes on a branch, recovery
  creates a new branch from `main` and cherry-picks completed commits.

**Parallelism:** Fully parallelizable across workers.

**Recovery actions:**
1. Record timeout event in worker state.
2. Free the worker's resource slot.
3. If partial progress exists: open a draft PR with completed work, comment
   blocker on the issue.
4. If no progress: comment blocker, re-queue task for next wave.

**Validation:** `npm run check` on the recovery branch.

---

### 2. State Drift Recovery

**Trigger:** State projection (active-workers, provider-pool) diverges from
actual runtime state.

**Policy:**
- Drift in independent projections (e.g., active-workers vs. provider-pool)
  may be corrected in parallel.
- Drift within a single projection is serialized — last-write-wins would
  lose corrections.
- Recovery tasks declare the projection name as a shared lock.

**Parallelism:** Parallelizable across projections; serialized within a
projection.

**Shared locks:**

| Projection | Lock name |
|------------|-----------|
| Active workers | `state:active-workers` |
| Provider pool | `state:provider-pool` |
| Merge manifests | `state:merge-manifests` |

**Recovery actions:**
1. Read current projection state.
2. Read actual runtime state (process list, provider status).
3. Compute diff.
4. Write corrected state.
5. Log drift event with before/after snapshot.

**Validation:** Projection JSON schema validation.

---

### 3. Docs Conflict Recovery

**Trigger:** Two docs PRs modify the same file or section, producing a
merge conflict.

**Policy:**
- Docs files are independent per directory — conflicts within a single file
  are rare and caused by overlapping edits.
- Recovery is a rebase + manual conflict resolution task.
- Each docs conflict recovery targets exactly one file — parallelizable
  across files.

**Parallelism:** Parallelizable across files; serialized for the same file.

**Recovery actions:**
1. Rebase the later PR on `main` (which includes the earlier merged PR).
2. Resolve conflicts preserving both intents.
3. Run `npm run check`.
4. Force-push rebased branch.

**Validation:** `npm run check`, manual review of merged content.

---

### 4. Generated Stale Recovery

**Trigger:** Generated artifacts (Prisma client, type definitions) are out
of date with their source (schema, config).

**Policy:**
- Regeneration is idempotent — running the generator twice produces the
  same output.
- Each artifact type is independent (Prisma client vs. type definitions).
- Recovery tasks regenerate and commit the fresh artifact.

**Parallelism:** Parallelizable across artifact types.

**Shared locks:**

| Artifact | Lock name | Source |
|----------|-----------|--------|
| Prisma client | `generated:prisma` | `prisma/schema.prisma` |
| Type defs | `generated:types` | Config or schema |

**Recovery actions:**
1. Run the artifact generator.
2. Diff against committed state.
3. If changed: commit updated artifact with regenerate note.
4. If unchanged: no-op (stale signal was false positive).

**Validation:** `npm run build`, generated file diff review.

---

### 5. Route Parity Missing Recovery

**Trigger:** A NestJS module exists but is not registered in `app.module.ts`
or its routes are not wired.

**Policy:**
- Route registration is a shared-resource operation — `app.module.ts` is a
  single-writer file.
- Multiple route parity fixes MUST serialize via the `app-module` shared lock.
- Each fix is scoped to one module's wiring.

**Parallelism:** Serialized via `app-module` lock.

**Recovery actions:**
1. Add module to `app.module.ts` imports.
2. Verify route registration with `npm run build`.
3. Run `npm run check`.

**Validation:** `npm run build`, `npm run check`, route parity test.

---

### 6. Human-Required High-Risk Recovery

**Trigger:** Recovery touches auth, data migration, public API surface, or
other high-risk boundaries.

**Policy:**
- ALWAYS serialized — never parallelized.
- Requires human review from the designated role before merge.
- Recovery task opens a PR with full handoff sections and tags the required
  reviewer.

**Parallelism:** Never parallel. Single-task, human-gated.

**Risk boundaries:**

| Area | Required reviewer |
|------|-------------------|
| Auth/security | security-reviewer |
| Data migration | migration-auditor |
| Public API surface | architect |
| Dependencies | repo-owner |

**Recovery actions:**
1. Create recovery branch from `main`.
2. Make minimal fix.
3. Open PR with all seven handoff sections.
4. Tag required reviewer.
5. Block merge until human approval.

**Validation:** Full health gate (`npm run build`, `npm run check`).

---

## Decomposition Flow

The orchestrator follows this flow when a recovery event triggers:

```
Recovery event detected
       │
       ▼
  Classify category (timeout | drift | docs | generated | parity | high-risk)
       │
       ▼
  Compute writeSet from allowedFiles
       │
       ▼
  Check sharedLocks
       │
       ├── No shared locks + no writeSet intersection → PARALLEL
       │
       ├── Shared lock claimed by another task → SERIAL (queue behind holder)
       │
       └── High-risk category → SERIAL + HUMAN GATE
       │
       ▼
  Dispatch recovery task(s) within slot budget
       │
       ▼
  Validate (category-specific validation commands)
       │
       ├── PASS → merge or report success
       │
       └── FAIL → escalate to orchestrator
```

---

## Rollback Policy

Each recovery task must define a rollback path before execution:

| Category | Rollback action |
|----------|----------------|
| Timeout | Delete recovery branch, re-queue original task |
| State drift | Re-read projection from last known-good snapshot |
| Docs conflict | `git revert` the conflict resolution commit |
| Generated stale | `git checkout HEAD~1 -- <generated-path>` |
| Route parity | Remove module import from `app.module.ts` |
| High-risk | `git revert` + human review of revert PR |

Rollback is per-task — rolling back one parallel recovery must not affect
other concurrent recoveries.

---

## Integration with Existing Policies

| Policy | Interaction |
|--------|-------------|
| [Parallel Work Policy](parallel-work-policy.md) | Recovery tasks follow the same conflict group and shared lock rules |
| [Worker Task Contract](worker-task-contract.md) | Recovery tasks use the same JSON contract schema |
| [Resource Slot Scheduling](resource-slot-scheduling.md) | Recovery tasks consume slots from the same pool |
| [Controlled Auto-Merge](controlled-auto-merge.md) | Low-risk recovery tasks may use auto-merge if eligible |
| [Launch Gate](launch-gate.md) | Recovery tasks must pass the same launch gate before dispatch |

---

## Examples

### Parallel Timeout Recovery

Three workers timeout simultaneously. The orchestrator launches three
recovery tasks in parallel:

```json
[
  { "conflictGroup": "recovery:timeout:worker-1", "writeSet": ["docs/ai-native/worker-1-partial.md"] },
  { "conflictGroup": "recovery:timeout:worker-2", "writeSet": ["src/modules/feed/feed.service.ts"] },
  { "conflictGroup": "recovery:timeout:worker-3", "writeSet": ["docs/contracts/feed-contract.md"] }
]
```

No shared locks, no writeSet intersection — all three dispatch in parallel.

### Serialized Route Parity Recovery

Three modules need wiring into `app.module.ts`:

```json
[
  { "conflictGroup": "recovery:parity:search", "sharedLocks": ["app-module"] },
  { "conflictGroup": "recovery:parity:groups", "sharedLocks": ["app-module"] },
  { "conflictGroup": "recovery:parity:topics", "sharedLocks": ["app-module"] }
]
```

All three claim `app-module` — the launch gate serializes them:
`search → groups → topics`.

### Mixed Recovery Batch

A wave produces four recovery events:

| Event | Category | Parallelism |
|-------|----------|-------------|
| Worker A timeout | timeout | parallel |
| Worker B timeout | timeout | parallel |
| Stale Prisma client | generated | parallel |
| Missing auth guard route | parity + high-risk | serialized, human-gated |

The orchestrator dispatches:
1. **Parallel batch:** Worker A recovery, Worker B recovery, Prisma regeneration
   (all independent, no shared locks).
2. **Serialized after batch:** Auth guard route fix (requires security-reviewer
   approval).

---

## Current State

This is the **planning slice** (issue #1048). The following are defined:

- [x] Six recovery categories with risk tiers
- [x] Parallelism rules per category
- [x] writeSet intersection and sharedLock model
- [x] Decomposition flow
- [x] Rollback policy per category
- [x] Integration points with existing policies

### Future Slices

- [ ] Recovery task JSON examples in [backend-task-json-examples.md](backend-task-json-examples.md)
- [ ] Orchestrator recovery detection hooks
- [ ] Automated writeSet computation from `allowedFiles`
- [ ] Recovery telemetry and metrics

---

## References

- [Parallel Work Policy](parallel-work-policy.md) — Conflict groups and shared locks
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Resource Slot Scheduling](resource-slot-scheduling.md) — Slot allocation model
- [Controlled Auto-Merge](controlled-auto-merge.md) — Low-risk merge automation
- [Launch Gate](launch-gate.md) — Pre-dispatch validation
