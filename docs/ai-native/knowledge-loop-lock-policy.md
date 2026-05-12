# Knowledge Loop Shared Lock Policy

Defines which knowledge-loop tasks may run concurrently and which
require serialization or human gating. Applies the governed-parallelism
principle: independent fact changes can run in parallel; shared truth
and high-risk boundaries remain serialized.

> **Closes:** [#1049](https://github.com/taoyu051818-sys/lian-nest-server/issues/1049)
> **See also:** [parallel-work-policy.md](parallel-work-policy.md) for
> conflict groups, [launch-locks-schema.md](launch-locks-schema.md) for
> lock state, [docs-authority-map.md](docs-authority-map.md) for folder
> authority.

---

## Scope

This policy governs tasks that update knowledge artifacts in the
self-cycle loop:

| Artifact | Writer | File |
|----------|--------|------|
| Knowledge entries | `write-knowledge-update.ps1` | `.github/ai-state/knowledge-updates.ndjson` |
| Fact events | `write-fact-event.ps1` | `.github/ai-state/fact-events.ndjson` |
| Gap ledger entries | `write-gap-ledger.ps1` | `.github/ai-state/gap-ledger.ndjson` |
| Docs authority map | Worker PR | `docs/ai-native/docs-authority-map.md` |
| ADR documents | Worker PR | `docs/architecture/*.md` |
| Source-of-truth docs | Worker PR | `docs/contracts/*.md`, `docs/architecture/*.md` |
| External intake docs authority | Worker PR | `docs/ai-native/external-intake-docs-authority.md` |

---

## Risk Tiers

Knowledge-loop changes are classified into three tiers. Tier determines
lock behavior.

| Tier | Artifacts | Risk | Concurrency |
|------|-----------|------|-------------|
| **T1 — Append-only state** | Knowledge entries, fact events, gap ledger | Low | Parallel allowed (append-only, no merge conflict) |
| **T2 — Governance docs** | Docs authority map, external intake docs authority, lock policies | Medium | Serialized via `knowledge-governance` shared lock |
| **T3 — Source-of-truth** | ADRs, canonical contracts, architecture decisions | High | Serialized + human-gated |

---

## Lock Definitions

### `knowledge-append` (T1)

Protects append-only NDJSON state files. Multiple workers may hold this
lock concurrently because append operations are conflict-free at the
file level (each worker appends distinct lines).

| Field | Value |
|-------|-------|
| Lock name | `knowledge-append` |
| Files | `.github/ai-state/knowledge-updates.ndjson`, `.github/ai-state/fact-events.ndjson`, `.github/ai-state/gap-ledger.ndjson` |
| Max concurrent holders | Unlimited |
| Conflict detection | None — append-only |
| Human gate | No |

### `knowledge-governance` (T2)

Protects governance docs that define how knowledge flows through the
system. Only one worker may modify these docs at a time to prevent
contradictory policy changes.

| Field | Value |
|-------|-------|
| Lock name | `knowledge-governance` |
| Files | `docs/ai-native/docs-authority-map.md`, `docs/ai-native/external-intake-docs-authority.md`, `docs/ai-native/knowledge-loop-lock-policy.md` |
| Max concurrent holders | 1 |
| Conflict detection | Conflict group overlap |
| Human gate | No (but requires `ai-architecture-reviewer` review) |

### `source-of-truth` (T3)

Protects canonical architecture and contract docs. Changes to these
files affect downstream workers' assumptions and require human approval.

| Field | Value |
|-------|-------|
| Lock name | `source-of-truth` |
| Files | `docs/architecture/*.md`, `docs/contracts/*.md` |
| Max concurrent holders | 1 |
| Conflict detection | Conflict group overlap + shared lock check |
| Human gate | Yes — requires `architect` review and repo-owner approval |

---

## Route Parity Matrix

The matrix shows which knowledge-loop task pairs may run concurrently.

| | Knowledge append | Knowledge governance | Source-of-truth | Code workers | Docs-only workers |
|---|---|---|---|---|---|
| **Knowledge append** | Parallel | Parallel | Parallel | Parallel | Parallel |
| **Knowledge governance** | Parallel | **Serial** | **Serial** | Parallel | Parallel |
| **Source-of-truth** | Parallel | **Serial** | **Serial** | **Serial*** | **Serial*** |
| **Code workers** | Parallel | Parallel | **Serial*** | Per conflict group | Parallel |
| **Docs-only workers** | Parallel | Parallel | **Serial*** | Parallel | Per conflict group |

\* Source-of-truth changes are serialized with code and docs workers
that reference the affected files. A code worker reading
`docs/architecture/auth-slice-2-guards-plan.md` must not run concurrent
with a worker modifying that file.

---

## Concurrency Rules

### Rule 1: Append-Only State Is Lock-Free

Workers appending to NDJSON state files (`knowledge-updates.ndjson`,
`fact-events.ndjson`, `gap-ledger.ndjson`) do not need exclusive access.
Each append is an independent line. The launcher does not block on
`knowledge-append` conflicts.

### Rule 2: Governance Docs Serialize

Only one worker may modify governance docs (T2) in a batch. If two
tasks claim `knowledge-governance`, the launch gate rejects the batch.
The orchestrator must sequence them.

### Rule 3: Source-of-Truth Requires Human Gate

Changes to ADRs, canonical contracts, and architecture docs (T3) must:

1. Be serialized (no concurrent source-of-truth writers).
2. Pass through the standard review gate with `architect` + `repo-owner` approval.
3. Not be auto-merged — controlled merge with human confirmation.

### Rule 4: Cross-Tier Ordering

When a batch contains tasks across tiers, the launcher applies this
ordering:

```
T1 (append)  ──▶  can start anytime
T2 (governance)  ──▶  after T1 tasks in same batch complete
T3 (source-of-truth)  ──▶  after T2 tasks complete, human gate required
```

This prevents a governance doc update from racing with a knowledge
entry that references the old governance state.

### Rule 5: No Mixed-Tier PRs

A single PR must not combine changes from different tiers. If a task
requires both a knowledge entry (T1) and a governance doc update (T2),
split into two separate tasks/PRs.

---

## Conflict Detection

The launch gate checks knowledge-loop conflicts using the existing lock
mechanism from [launch-locks-schema.md](launch-locks-schema.md):

| Check | Condition | Result |
|-------|-----------|--------|
| `knowledge-governance` overlap | Two tasks claim the lock | BLOCK |
| `source-of-truth` overlap | Two tasks claim the lock | BLOCK |
| `source-of-truth` + writeSet overlap | Code/docs worker's `allowedFiles` intersects a held `source-of-truth` lock's files | BLOCK |
| `knowledge-append` overlap | Two tasks claim the lock | ALLOW (no-op) |

---

## ADR Integration

Architecture Decision Records follow the T3 lock tier. When an ADR is
created or modified:

1. The worker claims `source-of-truth` in its task JSON `sharedLocks`.
2. The launch gate enforces serialization.
3. The PR requires `architect` review.
4. Knowledge entries referencing the ADR (T1) may be written in parallel
   but must reference the committed SHA, not the in-progress PR.

### ADR Lifecycle Lock Points

| ADR Phase | Lock Required | Concurrent Writes Allowed |
|-----------|---------------|--------------------------|
| Draft | `source-of-truth` | No |
| Under review | `source-of-truth` (held) | Knowledge entries referencing draft (with caveat) |
| Accepted | Lock released | Knowledge entries referencing final SHA |
| Superseded | `source-of-truth` on new ADR | Knowledge entries for both old and new |

---

## Worker Task JSON Examples

### T1: Knowledge Entry (Parallel-Safe)

```json
{
  "taskType": "execution",
  "risk": "low",
  "conflictGroup": "knowledge-append",
  "sharedLocks": ["knowledge-append"],
  "allowedFiles": [".github/ai-state/knowledge-updates.ndjson"]
}
```

### T2: Governance Doc Update (Serialized)

```json
{
  "taskType": "execution",
  "risk": "medium",
  "conflictGroup": "knowledge-governance",
  "sharedLocks": ["knowledge-governance"],
  "allowedFiles": ["docs/ai-native/docs-authority-map.md"]
}
```

### T3: ADR (Serialized + Human-Gated)

```json
{
  "taskType": "execution",
  "risk": "high",
  "conflictGroup": "source-of-truth",
  "sharedLocks": ["source-of-truth"],
  "allowedFiles": ["docs/architecture/new-decision.md"]
}
```

---

## Design Decisions

- **Append-only state is lock-free.** NDJSON append operations are
  inherently conflict-free. Requiring exclusive access would serialize
  unnecessarily and reduce throughput.

- **Governance docs serialize but do not require human gate.** Policy
  changes are reviewable by automated roles (`ai-architecture-reviewer`)
  and are low-risk compared to source-of-truth changes.

- **Source-of-truth always human-gated.** Architecture decisions and
  canonical contracts shape downstream worker behavior. Incorrect changes
  propagate widely. Human review is the safety net.

- **No mixed-tier PRs.** Separating tiers into distinct PRs simplifies
  review, rollback, and conflict detection. A governance change bundled
  with a knowledge entry creates ambiguous rollback semantics.

- **Cross-tier ordering prevents stale references.** A knowledge entry
  that references a governance doc must see the final version, not a
  concurrent draft.

---

## References

- [Parallel Work Policy](parallel-work-policy.md) — Conflict groups and shared lock definitions
- [Launch Locks Schema](launch-locks-schema.md) — Lock state projection schema
- [Launch Gate](launch-gate.md) — Pre-launch validation consuming locks
- [Docs Authority Map](docs-authority-map.md) — Folder-level authority
- [External Intake Docs Authority](external-intake-docs-authority.md) — Intake doc ownership
- [Knowledge Update Writer](knowledge-update-writer.md) — NDJSON knowledge ledger
- [Fact Event Ledger](fact-event-ledger.md) — NDJSON fact event log
- [Gap Ledger](gap-ledger.md) — NDJSON gap ledger
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema with `sharedLocks`
- [Resource Slot Scheduling](resource-slot-scheduling.md) — Slot allocation interacts with lock serialization
- [Controlled Auto-Merge](controlled-auto-merge.md) — T3 changes excluded from auto-merge
