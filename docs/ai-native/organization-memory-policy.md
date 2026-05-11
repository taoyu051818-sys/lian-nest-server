# Organization Memory Policy for Experiments

Defines how experiment outcomes are written into organizational memory and how
that memory shapes future planning. Experiments include architecture trials,
migration approaches, tooling changes, process adjustments, and any bounded
change with a measurable outcome.

> **Reference:** [knowledge-update-writer.md](knowledge-update-writer.md) for
> the PR-merge knowledge ledger, [fact-event-ledger.md](fact-event-ledger.md)
> for observable facts, [gap-ledger.md](gap-ledger.md) for deviation events.
>
> **Closes:** [#908](https://github.com/taoyu051818-sys/lian-nest-server/issues/908)

---

## Scope

This policy applies to every experiment the project runs — whether launched by
a human, the self-cycle runner, or the planning loop. An **experiment** is any
bounded change with an observable outcome: a new guard, a migration approach, a
process tweak, a tooling swap, or a configuration change.

The policy does **not** govern routine worker tasks (e.g. fixing a failing test,
adding an endpoint). Those follow the standard task lifecycle and are recorded
via the knowledge-update-writer on merge.

---

## Experiment Lifecycle States

```
PROPOSED  →  RUNNING  →  ACCEPTED  |  REJECTED  |  INCONCLUSIVE
```

| State | Meaning | Who Transitions |
|-------|---------|-----------------|
| **PROPOSED** | Experiment is defined but not yet started. Has a hypothesis, scope, and success criteria. | Human or planner |
| **RUNNING** | Experiment is in progress. Workers are executing bounded changes. | Self-cycle runner or human |
| **ACCEPTED** | Experiment succeeded. Outcome meets or exceeds success criteria. | Health gate + human review |
| **REJECTED** | Experiment failed. Outcome does not meet success criteria or introduced regressions. | Health gate + human review |
| **INCONCLUSIVE** | Outcome is ambiguous. Data is insufficient to accept or reject. | Human review only |

---

## Memory Recording Rules

### What Gets Recorded

Every experiment that reaches a terminal state (ACCEPTED, REJECTED, or
INCONCLUSIVE) **MUST** produce at least one organizational memory entry. The
entry captures:

| Field | Description |
|-------|-------------|
| Outcome | Accepted / Rejected / Inconclusive |
| Hypothesis | What was being tested |
| Evidence | Observable results (health scores, test outcomes, PR metrics) |
| Decision rationale | Why the outcome was classified as it was |
| Future implications | How this result should influence subsequent work |

### Where Memory Is Recorded

Experiments write to multiple memory surfaces depending on outcome:

| Surface | When to Write | Writer | File |
|---------|---------------|--------|------|
| **Knowledge ledger** | Always — every terminal experiment outcome | `write-knowledge-update.ps1` | `.github/ai-state/knowledge-updates.ndjson` |
| **Fact event ledger** | When the experiment produces an observable fact (health change, provider event) | `write-fact-event.js` | `.github/ai-state/fact-events.ndjson` |
| **Gap ledger** | When the experiment is rejected or reveals a gap | `write-gap-ledger.js` | `.github/ai-state/gap-ledger.ndjson` |
| **GitHub issue comment** | Always — human-readable summary on the source issue | Orchestrator or human | GitHub |

### Recording by Outcome

#### Accepted Experiments

```
Knowledge entry (category: depends on domain)
  → summary: what worked
  → tags: experiment name, domain, approach
  → details: success criteria met, evidence, reuse guidance

Fact event (if observable state changed)
  → eventType: experiment.accepted
  → facts: { experiment, domain, outcome }
```

Accepted experiments become **precedent**. Future planners MUST consult
knowledge entries for accepted experiments before proposing similar work.

#### Rejected Experiments

```
Knowledge entry (category: depends on domain)
  → summary: what was tried and why it failed
  → tags: experiment name, domain, anti-pattern
  → details: failure mode, evidence, what to do instead

Gap entry (gapType: experiment-rejected)
  → description: failure summary
  → severity: based on blast radius

Fact event
  → eventType: experiment.rejected
  → facts: { experiment, domain, failureMode }
```

Rejected experiments become **anti-patterns**. Future planners MUST NOT repeat
a rejected approach without new evidence that conditions have changed.

#### Inconclusive Experiments

```
Knowledge entry (category: policy)
  → summary: what was tested and why the result was ambiguous
  → tags: experiment name, domain, needs-follow-up
  → details: what data was missing, what would resolve ambiguity
```

Inconclusive experiments are flagged for **re-evaluation**. The planning loop
should surface them when conditions that caused ambiguity may have changed.

---

## Memory Consumption Rules

### Planning Loop Integration

The planning loop (`plan-next-batch.ps1`) MUST consult organizational memory
before proposing tasks:

1. **Check knowledge ledger** for entries tagged with the proposed domain or
   approach. If a matching rejected experiment exists, the planner MUST either:
   - Skip the approach, or
   - Justify why conditions have changed (recorded as a new experiment).
2. **Check knowledge ledger** for accepted experiments in the same domain.
   If a matching precedent exists, the planner SHOULD reuse the validated
   approach.
3. **Check gap ledger** for unresolved experiment gaps. If one exists, the
   planner SHOULD prioritize resolving it before starting new experiments.

### Context Bundle Integration

The context bundle generator (`generate-context-bundle.js`) SHOULD include
relevant organizational memory entries when bundling context for workers:

- Recent accepted experiments in the worker's domain (reuse guidance).
- Recent rejected experiments in the worker's domain (anti-patterns to avoid).
- Unresolved inconclusive experiments (awareness of open questions).

### Worker Behavioral Rules

Workers encountering a task that overlaps with a recorded experiment:

| Memory State | Worker Action |
|--------------|---------------|
| Accepted precedent exists | Follow the validated approach. Cite the knowledge entry. |
| Rejected anti-pattern exists | Do NOT repeat the approach. If the task requires it, stop and flag the conflict on the issue. |
| Inconclusive experiment exists | Proceed with caution. Flag the open question in the PR body. |

---

## Experiment Registration

Before an experiment runs, a knowledge entry SHOULD be created in PROPOSED
state. This establishes the hypothesis and success criteria before execution
begins, preventing post-hoc rationalization of outcomes.

```
write-knowledge-update.ps1 `
  -Category policy `
  -Summary "EXPERIMENT [proposed]: <name> — <hypothesis>" `
  -IssueNumber <n> `
  -Tags "experiment,<name>,proposed"
```

When the experiment reaches a terminal state, a second entry records the
outcome with the same experiment tag.

---

## Integration Map

```
Human / Planner
      |
      v
Experiment proposed (knowledge entry: proposed)
      |
      v
Self-cycle runner dispatches workers
      |
      v
Workers execute bounded changes
      |
      v
Health gate + human review
      |
      v
Terminal state reached
      |
      +---> Knowledge ledger (always)
      +---> Fact event ledger (if observable change)
      +---> Gap ledger (if rejected)
      +---> GitHub issue comment (always)
      |
      v
Planning loop reads memory before next batch
      |
      v
Context bundle includes memory for workers
```

---

## Design Decisions

- **All outcomes are recorded.** Accepted, rejected, and inconclusive
  experiments all produce memory entries. Silence is not an option — an
  unrecorded experiment is a lost learning.
- **Anti-patterns have equal weight to precedents.** Knowing what NOT to
  repeat is as valuable as knowing what works. Rejected experiments are
  first-class memory entries, not buried in gap logs alone.
- **Memory is consulted before planning.** The planning loop reads memory
  as a mandatory step, not an optional enhancement. This prevents the
  project from repeating known failures.
- **No secrets in memory entries.** All entries follow the existing
  sanitization rules. Experiment memory contains structural metadata
  (approach, domain, outcome), never tokens or credentials.
- **Dry-run default.** Consistent with all AI-native writers. Memory
  entries are previewed before writing.

---

## References

- [Knowledge Update Writer](knowledge-update-writer.md) — PR-merge knowledge ledger
- [Fact Event Ledger](fact-event-ledger.md) — Observable facts append-only log
- [Gap Ledger](gap-ledger.md) — Gap event recording
- [Meta Signals](meta-signals.md) — Aggregate health signals
- [Planning Loop](planning-loop.md) — Batch planning that consumes memory
- [Context Bundles](context-bundles.md) — Worker context assembly
- [Loop Model](loop-model.md) — Self-cycle runner phases
