# Curator: Background Self-Improvement Separate from Execution

Investigates the Hermes Curator pattern — a background task that reviews
agent-created content when the system is idle, separate from the main
execution loop. The curator consolidates duplicate knowledge, prunes stale
signals, and patches low-quality entries without blocking task dispatch.

> **Closes:** [#1439](https://github.com/taoyu051818-sys/lian-nest-server/issues/1439)
>
> **Source:** External research — Hermes Curator (`external-doc` tier)
>
> **See also:**
> [knowledge-driven-scaling-rule.md](knowledge-driven-scaling-rule.md) for
> the self-improvement rule,
> [gap-ledger.md](gap-ledger.md) for the gap ledger schema,
> [control-skill-registry.md](control-skill-registry.md) for the skill
> model,
> [external-research-intake-loop.md](external-research-intake-loop.md) for
> the evidence intake pipeline,
> [self-cycle-top-up-controller.md](self-cycle-top-up-controller.md) for
> the closest existing background pattern.

---

## Problem

LIAN's self-improvement currently happens in three places, all coupled
to the main execution loop:

| Subsystem | Trigger | What It Does |
|-----------|---------|--------------|
| `propose-self-cycle-issues.js` | Manual or scheduled | Scans system facts, generates proposed issues |
| `classify-self-cycle-failure.js` | After worker failure | Classifies failures into error classes, suggests recovery |
| Self-healing pipeline | After health gate fail | Detects failures, creates follow-up issues |

These subsystems share a common limitation: they run **during or after**
execution, not while the system is idle. When the system is busy
dispatching workers, self-improvement competes for the same attention
window. When the system is idle, nothing reviews accumulated knowledge.

The gap ledger accumulates entries, the fact event ledger grows, and
knowledge entries pile up — but no process reviews them for quality,
consolidation, or staleness. The knowledge-driven scaling rule
(`knowledge-driven-scaling-rule.md`) defines sedimentation targets and
quality criteria, but enforcement is reactive (flagged in daily brief)
rather than proactive (reviewed by a background process).

---

## Current Self-Improvement Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    main execution loop                          │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ propose  │  │ classify │  │ self-    │  │ knowledge    │   │
│  │ issues   │  │ failure  │  │ healing  │  │ writeback    │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│       │              │              │               │           │
│       ▼              ▼              ▼               ▼           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  gap-ledger.ndjson  │  fact-events.ndjson  │  knowledge │  │
│  │                     │                      │  updates   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  meta-signals calculator  │  state reconciler            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

                     (no background review)
```

### What's Missing

1. **No idle-time processing.** When active workers drop to zero, the
   system does nothing. The gap between cycles is wasted.

2. **No knowledge consolidation.** Duplicate knowledge entries
   accumulate. Three workers solving the same validation failure produce
   three separate knowledge entries with no deduplication.

3. **No staleness pruning.** Opportunity signals in `draft` state for
   30+ days are never reviewed. Fact events from retired sources sit
   indefinitely.

4. **No quality enforcement.** The knowledge-driven scaling rule defines
   quality criteria (specificity, actionability, scope), but enforcement
   is limited to flagging in the daily brief. No automated process
   patches or archives low-quality entries.

5. **No pinned-skill bypass.** The control skill registry has no concept
   of pinning skills to bypass lifecycle transitions.

---

## Hermes Curator Pattern

The Hermes Curator (from the reference implementation) operates as a
background agent with these properties:

| Property | Value |
|----------|-------|
| **Timing** | Runs when system is idle (no active workers, no pending dispatch) |
| **Scope** | Agent-created content only (knowledge entries, gap reflections, opportunity signals) |
| **Actions** | Pin, archive, consolidate, patch |
| **Deletion** | Never auto-deletes — archives instead |
| **Pinned bypass** | Pinned entries skip staleness transitions |
| **Governance** | Changes are preview-only until human approves |

### Actions

| Action | What It Does | When |
|--------|-------------|------|
| **Pin** | Marks an entry as permanent, bypasses staleness checks | Entry is foundational (e.g., seed constitution reference) |
| **Archive** | Moves entry from active to archived state | Entry is stale (no reference in 30+ days) or superseded |
| **Consolidate** | Merges N duplicate entries into one canonical entry | Same gap type + description appears 3+ times |
| **Patch** | Fixes low-quality entries to meet sedimentation criteria | Entry fails specificity or actionability check |

### Idle Detection

The curator needs a signal that the system is idle. The closest existing
pattern is the top-up controller (`self-cycle-top-up-controller.md`),
which reads active-worker count. The curator extends this:

```
idle = (activeWorkerCount == 0)
   AND (pendingDispatch == 0)
   AND (healthGate != red AND healthGate != black)
   AND (no held launch locks)
```

---

## Mapping to LIAN Components

| Hermes Concept | LIAN Equivalent | Gap |
|----------------|-----------------|-----|
| Agent-created skills | Knowledge entries in `knowledge-updates.ndjson` | No lifecycle state field |
| Skill review | Knowledge quality check (sedimentation rule) | No automated enforcement |
| Pin | Not implemented | Need `pinned: true` field on entries |
| Archive | Not implemented | Need `archived: true` field on entries |
| Consolidate | Not implemented | Need dedup logic for gap ledger + knowledge |
| Patch | Not implemented | Need quality-patch capability |
| Idle detection | Top-up controller reads worker count | Need idle trigger mechanism |
| Background execution | Self-cycle runner (but manual) | Need unattended mode |

### Knowledge Entry Lifecycle (Proposed)

Current knowledge entries have no lifecycle state. The curator introduces
a state field:

```
active → consolidated → archived
   │
   └── pinned (bypasses transitions)
```

| State | Meaning | Transitions From |
|-------|---------|-----------------|
| `active` | Entry is current and referenced | Initial state |
| `pinned` | Entry is foundational, never archived | Manual pin |
| `consolidated` | Entry was merged into a canonical entry | Curator consolidate |
| `archived` | Entry is stale or superseded | Curator archive |

---

## Proposed Curator Algorithm

### Phase 1: Idle Gate

```text
if activeWorkerCount > 0: exit
if pendingDispatch > 0: exit
if healthGate in (red, black): exit
if heldLocks > 0: exit
→ proceed to Phase 2
```

### Phase 2: Knowledge Review

Read `knowledge-updates.ndjson`. For each entry:

1. **Quality check** — Does the entry meet sedimentation criteria
   (specificity, actionability, scope)? If not, flag for patch.

2. **Staleness check** — Has the entry been referenced by a worker,
   gate, or reconciler in the last 30 days? If not, flag for archive.

3. **Duplicate check** — Do N entries share the same gap type +
   description? If so, flag for consolidation.

4. **Pin check** — Is the entry pinned? If so, skip staleness and
   archive checks.

### Phase 3: Gap Ledger Review

Read `gap-ledger.ndjson`. For each entry:

1. **Reflection quality** — Does `meta.reflection` meet the Reflexion
   schema criteria? If not, flag for patch.

2. **Resolution check** — Is the gap resolved (subsequent entry shows
   fix)? If resolved and older than 7 days, flag for archive.

3. **Pattern detection** — Same gap type + description 3+ times? Flag
   for consolidation + improvement proposal.

### Phase 4: Opportunity Signal Review

Read `.github/ai-state/opportunity-signals/`. For each signal:

1. **Draft staleness** — Signal in `draft` state for 30+ days? Flag
   for archive or rejection.

2. **Evidence staleness** — Source fact events older than 90 days?
   Flag signal as stale.

### Phase 5: Output

The curator produces a **curation report** — never auto-applies changes.
The report is a preview artifact that a human reviews.

```jsonc
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-13T12:00:00Z",
  "idleSignals": {
    "activeWorkerCount": 0,
    "pendingDispatch": 0,
    "healthGate": "green",
    "heldLocks": 0
  },
  "actions": {
    "patch": [
      { "entryId": "kup-abc123", "reason": "missing specificity", "field": "resolution" }
    ],
    "consolidate": [
      { "entryIds": ["kup-def456", "kup-ghi789"], "canonical": "kup-def456", "reason": "same gap type + description" }
    ],
    "archive": [
      { "entryId": "kup-jkl012", "reason": "stale: no reference in 35 days" }
    ],
    "pin": []
  },
  "summary": {
    "patched": 0,
    "consolidated": 0,
    "archived": 0,
    "pinned": 0,
    "totalReviewed": 47
  }
}
```

---

## Integration Points

### Existing Consumers

| Consumer | Interaction |
|----------|------------|
| Top-up controller | Curator reads same active-worker signal |
| Meta-signals calculator | Curator reads gap ledger for friction patterns |
| State reconciler | Curator reads same drift detection data |
| Command Steward daily brief | Curator report is surfaced in brief |
| Knowledge-driven scaling rule | Curator enforces quality criteria from this rule |

### New Artifacts

| Artifact | Path | Format |
|----------|------|--------|
| Curation report | `.github/ai-state/curation-report.json` | JSON (overwritten each run) |
| Curator log | `.github/ai-state/curator-log.ndjson` | NDJSON (append-only) |
| Knowledge lifecycle field | Inline in `knowledge-updates.ndjson` | `lifecycleState` field |

### Script Integration

The curator would be a new script: `scripts/ai/run-curator.js`

```
run-curator.js
  ├── reads: active-workers.json
  ├── reads: task-board.json (pending dispatch)
  ├── reads: main-health.json
  ├── reads: launch-locks.json
  ├── reads: knowledge-updates.ndjson
  ├── reads: gap-ledger.ndjson
  ├── reads: opportunity-signals/
  ├── writes: .github/ai-state/curation-report.json
  └── writes: .github/ai-state/curator-log.ndjson
```

The script is read-only on all input state. It produces a preview
report, never mutates the inputs. A separate `apply-curation.js` script
would execute approved actions with human confirmation.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|:--------:|------------|
| Curator archives valuable knowledge | Medium | Archive never deletes; all archived entries remain readable |
| Consolidation loses nuance | Medium | Consolidated entries link to originals; human reviews before apply |
| Idle detection false positive | Low | Conservative signals (all four must pass) |
| Curator competes for file locks | Low | Read-only on inputs; writes only to curator-specific artifacts |
| Pinned entries accumulate indefinitely | Low | Pin requires human action; curator surfaces unbounded pin count |

---

## Relationship to Existing Rules

| Rule | Curator Interaction |
|------|-------------------|
| Knowledge-driven scaling | Curator enforces the quality criteria this rule defines |
| Self-improvement rule | Curator detects recurring patterns and surfaces improvement proposals |
| Bounded experiment policy | Curator reviews experiment-bound opportunity signals for staleness |
| Evidence reliability policy | Curator checks evidence staleness windows |
| Seed constitution | Curator never modifies constitution files; pinned constitution entries bypass review |

---

## Non-Goals

- The curator does not auto-apply changes. All actions require human
  review or an explicit `apply-curation.js` invocation.
- The curator does not modify `src/**`, `prisma/**`, or `package.json`.
- The curator does not create GitHub issues or PRs.
- The curator does not override any gate (launch, health, review,
  constitution).
- The curator does not delete entries. Archive is a state transition,
  not a deletion.

---

## Implementation Phases

### Phase 1: Research (This Document)

- Map Hermes Curator to LIAN architecture.
- Identify gaps in existing components.
- Propose curator algorithm and output schema.

### Phase 2: Schema Extension

- Add `lifecycleState` field to knowledge entry schema.
- Add `pinned` flag to knowledge entries and gap reflections.
- Update `write-gap-ledger.js` and knowledge writer with lifecycle
  defaults.

### Phase 3: Curator Script

- Implement `scripts/ai/run-curator.js` with idle detection, quality
  review, staleness detection, and duplicate detection.
- Implement `scripts/ai/apply-curation.js` for executing approved
  actions.
- Add tests with fixture-based dry-run.

### Phase 4: Integration

- Add curator to the self-cycle runner as an optional pre-cycle step.
- Surface curation report in the Command Steward daily brief.
- Add curator status to the WebUI status bundle.

---

## References

- [Knowledge Sedimentation and Self-Improvement Rule](knowledge-driven-scaling-rule.md) — Quality criteria the curator enforces
- [Gap Ledger](gap-ledger.md) — NDJSON gap ledger the curator reviews
- [Control Skill Registry](control-skill-registry.md) — Skill model the curator could extend
- [External Research Intake Loop](external-research-intake-loop.md) — Evidence pipeline with staleness rules
- [Self-Cycle Top-Up Controller](self-cycle-top-up-controller.md) — Closest existing background pattern
- [Reflexion Investigation](reflexion-investigation.md) — Failure reflection schema
- [Opportunity Signal Schema](opportunity-signal-schema.md) — Signal lifecycle
- [Fact Event Ledger](fact-event-ledger.md) — Fact event schema
- [Evidence Reliability Policy](evidence-reliability-policy.md) — Staleness windows
- [#1439](https://github.com/taoyu051818-sys/lian-nest-server/issues/1439) — This investigation
