# Curator Separate from Execution

Investigates whether the self-cycle's self-improvement logic should run as a
background task distinct from the main execution loop.

> **Closes:** [#1416](https://github.com/taoyu051818-sys/lian-nest-server/issues/1416)
> **Source pattern:** Hermes Curator (`external-agent-research/hermes-agent/agent/curator.py`)
> **Source reliability:** medium

---

## Current State

The self-cycle runner (`run-self-cycle.ps1`) interleaves execution and
self-improvement in the same pass:

```
run-self-cycle.ps1
  Step 0   plan-next-batch.ps1          (self-improvement: gap detection, issue proposal)
  Step 0b  compile-issues-to-tasks.js   (self-improvement: issue → task translation)
  Step 1   state-reconciler.ps1         (self-improvement: drift detection)
  Step 2   health marker read           (execution gate)
  Step 3   check-launch-gate.ps1        (execution gate)
  Step 4   batch-launch.ps1             (execution: worker dispatch)
  Step 5   cycle summary                (reporting)
```

The issue producer lane (`propose-self-cycle-issues.js`,
`reduce-gaps-to-issues.js`) also runs inline — it reads system state,
generates gap candidates, deduplicates, applies policy gates, and emits
proposed issues in the same invocation as the planning loop.

This coupling means:

1. **Self-improvement blocks execution.** A slow gap analysis or proposal
   generation delays worker dispatch.
2. **Execution blocks self-improvement.** Workers must finish before the
   next round of gap detection runs.
3. **Shared failure surface.** A bug in the issue producer can crash the
   entire self-cycle.

---

## Hermes Curator Pattern

The Hermes Curator (`curator.py`) runs as a background task separate from
the main agent execution loop:

| Property | Hermes Curator | LIAN Current |
|----------|---------------|-------------|
| When it runs | Idle time, background | Inline with execution loop |
| What it touches | Agent-created skills only | Gap ledger, meta-signals, task board |
| Deletion policy | Archive, never delete | No archival concept |
| Pinned items | Bypass transitions | No pin concept |
| Consolidation | Merges duplicate skills | Deduplication in issue producer |
| Patching | In-place skill updates | Re-issues from scratch |

The curator reviews agent-created content when the main loop is idle. It can
pin (protect from archival), archive (soft-delete), consolidate (merge
duplicates), and patch (update in-place) skills. Pinned skills bypass
state transitions.

---

## Gap Analysis

### What LIAN Already Separates

| Component | Runs As | Separation Quality |
|-----------|---------|-------------------|
| Gap ledger writer | Called by other scripts | Good — append-only, no coupling |
| Meta-signals calculator | Standalone script | Good — reads NDJSON, writes JSON |
| Issue producer lane | Standalone script | Good — reads state, writes proposals |
| State reconciler | Standalled script | Good — reads state, writes report |
| Top-up controller | Standalone script | Good — reads queue, writes plan |

Each self-improvement script is already independently invocable. The coupling
is in the orchestrator (`run-self-cycle.ps1`) which chains them sequentially
with execution steps.

### What LIAN Misses vs. the Curator Pattern

| Curator Concept | LIAN Equivalent | Gap |
|----------------|-----------------|-----|
| Background scheduling | None — manual invocation only | Self-improvement runs only when an operator triggers the cycle |
| Idle-time execution | None — blocks on execution | No mechanism to run curation while workers are busy |
| Archival | None — issues are closed or left open | No soft-delete for stale gap entries or superseded proposals |
| Pinning | None | No way to protect high-value knowledge entries from consolidation |
| In-place patching | Re-issue from scratch | Consolidation creates new issues rather than updating existing ones |
| Review scope boundary | Implicit in allowedFiles | Curator has no explicit "review scope" separate from execution scope |

---

## Recommendation

The self-improvement scripts are already well-separated at the script level.
The orchestrator is the coupling point. The fix is architectural, not
code-level: run self-improvement on a separate schedule from execution.

### Proposed Architecture

```
┌──────────────────────────────────┐     ┌─────────────────────────────────┐
│  Execution Loop                  │     │  Curator Loop (background)       │
│                                  │     │                                  │
│  task queue → gate → dispatch    │     │  gap-ledger review               │
│  → worker → PR → health gate    │     │  → meta-signal analysis          │
│  → next wave                     │     │  → opportunity signal scan       │
│                                  │     │  → knowledge consolidation       │
│                                  │     │  → stale proposal archival       │
│                                  │     │  → issue producer lane           │
│                                  │     │  → top-up controller             │
└──────────┬───────────────────────┘     └──────────┬────────────────────────┘
           │                                        │
           ▼                                        ▼
  .github/ai-state/                   .github/ai-state/
  (writes: active-workers,            (writes: gap-ledger, meta-signals,
   compiled-tasks, health)             opportunity-signals, proposed-issues,
                                       external-facts, knowledge-updates)
```

### Scheduling Options

| Option | Mechanism | Trade-off |
|--------|-----------|-----------|
| **A. Separate cron** | `run-curator.ps1` on a timer (e.g., every 30 min) | Simple, but may collide with execution writes |
| **B. Post-cycle trigger** | Curator runs after each execution cycle completes | Natural boundary, but still sequential |
| **C. Idle detection** | Curator polls `active-workers.json`; runs when no workers active | True background, but needs a daemon or frequent cron |
| **D. Merge-triggered** | Curator runs after each PR merge | Tight feedback loop, but may be too frequent |

**Recommended: Option C (idle detection).** The curator checks
`active-workers.json` and only runs when no workers are dispatching or
executing. This mirrors the Hermes pattern of running during idle time.

### Scope Boundary

The curator should review only these state files:

| File | Curator Action |
|------|---------------|
| `gap-ledger.ndjson` | Read entries, detect stale gaps, consolidate duplicates |
| `meta-signals.json` | Read signals, detect trends, propose corrective actions |
| `opportunity-signals.ndjson` | Read signals, rank by impact, propose issues |
| `external-facts.ndjson` | Read facts, detect staleness, propose refresh |
| `knowledge-updates.ndjson` | Read entries, consolidate duplicates, archive stale |
| `contribution-ledger.ndjson` | Read entries, detect patterns, propose improvements |

The curator must NOT touch execution state (`active-workers.json`,
`compiled-tasks.json`, `launch-locks.json`).

### Archival Policy

Following the Hermes pattern — never auto-delete, archive instead:

| Action | Trigger | Behavior |
|--------|---------|----------|
| **Archive stale gap** | Gap entry older than 7 days, no linked open issue | Move to `gap-ledger-archive.ndjson` |
| **Archive superseded proposal** | Proposal's conflictGroup has a merged PR | Mark as `superseded` in audit log |
| **Archive stale knowledge** | Knowledge entry older than 30 days, no references | Move to `knowledge-archive.ndjson` |
| **Pin high-value entry** | Entry linked to 3+ successful PRs | Add `pinned: true`, exempt from archival |

### Pinning

Pinned entries bypass archival and consolidation:

```jsonc
{
  "entryVersion": 1,
  "recordedAt": "2026-05-13T12:00:00Z",
  "gapType": "worker-failed",
  "severity": "high",
  "description": "Worker exited code 1",
  "meta": {
    "pinned": true,
    "pinnedReason": "Linked to 3 successful recovery PRs",
    "pinnedAt": "2026-05-13T12:00:00Z"
  }
}
```

---

## Implementation Path

### Phase 1: Orchestrator Split (low risk)

Split `run-self-cycle.ps1` into two entry points:

1. `run-self-cycle.ps1` — execution only (Steps 2–5)
2. `run-curator.ps1` — self-improvement only (gap review, issue production, top-up)

Both read from the same `.github/ai-state/` directory. No schema changes needed.

### Phase 2: Idle Detection (medium risk)

Add a curator scheduler that:

1. Reads `active-workers.json` before running.
2. Skips if any workers are in `dispatching` or `running` state.
3. Runs the curator pipeline if idle.
4. Logs actions to a new `curator-events.ndjson`.

### Phase 3: Archival and Pinning (medium risk)

Add archival scripts:

1. `archive-stale-gaps.js` — moves old gap entries to archive.
2. `archive-stale-knowledge.js` — moves old knowledge entries to archive.
3. `pin-entry.js` — marks high-value entries as pinned.

Update gap-ledger schema to support `meta.pinned`.

### Phase 4: Consolidation (low risk)

Add a consolidation script:

1. `consolidate-knowledge.js` — merges duplicate knowledge entries.
2. `consolidate-gap-entries.js` — merges duplicate gap entries for the same issue.

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Curator writes collide with execution writes | Medium | Use idle detection; NDJSON append is concurrency-safe |
| Curator archives valuable entries | Medium | Pin mechanism; archival is soft (archive file, not delete) |
| Curator proposes issues that conflict with in-flight workers | Low | Dedup already checks open PRs and conflict groups |
| Curator runs too frequently, wastes API budget | Low | Idle detection limits runs; configurable interval |

---

## Conclusion

The self-improvement scripts are already well-decomposed at the script level.
The coupling is in the orchestrator, not the scripts. The curator pattern is
achievable by:

1. Splitting the orchestrator into execution and curator entry points.
2. Adding idle detection so the curator runs during execution gaps.
3. Adding archival (not deletion) for stale state.
4. Adding pinning for high-value entries.

No schema changes are needed for Phase 1. Phases 2–4 require minor schema
extensions (archive files, `meta.pinned` field).

The key insight from the Hermes pattern: **self-improvement should be a
background concern, not a foreground step.** The execution loop should focus
on dispatching workers and monitoring health. The curator should focus on
reviewing what happened and proposing what should happen next.

---

## References

- [Loop Model](loop-model.md) — Current self-cycle phases
- [Self-Cycle Runner](self-cycle-runner.md) — Orchestrator documentation
- [Gap Ledger](gap-ledger.md) — Append-only gap event log
- [Gap-to-Issue Reducer](gap-to-issue-reducer.md) — Gap → issue pipeline
- [Issue Producer Lane](issue-producer-lane.md) — Autonomous issue production
- [Meta Signals](meta-signals.md) — Aggregate health signals
- [External Reality Intake](external-reality-intake.md) — External evidence intake
- [Contribution Ledger](contribution-ledger.md) — Agent contribution tracking
- [#1416](https://github.com/taoyu051818-sys/lian-nest-server/issues/1416) — This investigation
