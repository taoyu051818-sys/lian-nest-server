# Knowledge Sedimentation and Self-Improvement Rule

Defines knowledge sedimentation and self-improvement as a first-class
long-term rule. The control plane must accumulate durable knowledge from
every work cycle and must structurally improve when friction repeats.
This rule is grounded in Reality, Selection, and Governed Recursion.

> **Closes:** [#1261](https://github.com/taoyu051818-sys/lian-nest-server/issues/1261)
>
> **Authority:** This rule operates as a long-term invariant alongside
> [knowledge-driven-scaling.md](knowledge-driven-scaling.md). Where
> that document governs scaling thresholds and knowledge writeback as a
> precondition for dispatch, this rule governs the *quality* and
> *durability* of the knowledge that accumulates.
>
> **See also:**
> [knowledge-driven-scaling.md](knowledge-driven-scaling.md) for the
> macro scaling rule,
> [loop-model.md](loop-model.md) for self-cycle runner phases,
> [codex-duty-exit-checklist.md](codex-duty-exit-checklist.md) for
> exit criteria,
> [command-steward-daily-loop.md](command-steward-daily-loop.md) for
> the daily operating loop.

---

## Purpose

Every work cycle produces artifacts — merged PRs, resolved gate failures,
health transitions, worker logs. Most of these artifacts are ephemeral:
they answer the immediate task and then sit in git history, rarely read
again. Knowledge sedimentation means that the durable insight from each
cycle is extracted, structured, and deposited into a form the system can
consume in future cycles.

Without sedimentation, the system repeats itself. Workers re-discover
solutions that previous workers already found. Gate failures recur
because the fix was in a PR body, not in the gate documentation. The
human operator answers the same questions each week because the answers
never left the conversation transcript.

Self-improvement is the complementary half: when the same friction
appears repeatedly, the system must not just log it — it must change
the structure that produced it.

---

## Relationship to the Three Laws

### Reality Before Judgment

Knowledge sedimentation requires that scaling and improvement decisions
be grounded in verifiable artifacts, not assumptions. A worker that
claims to have "learned" something produces no value unless the learning
is deposited into a knowledge artifact that future workers can read.

| Reality Check | Sedimentation Requirement |
|---------------|--------------------------|
| Worker completed a task | Knowledge entry written to `knowledge-updates.ndjson` |
| Gate failure was resolved | Fix documented in gate docs or gap ledger, not just in PR body |
| Health state transitioned | Fact event written with root cause, not just the new state |
| Provider exhausted | Rotation lesson captured, not just the retry that worked |

### Selection Before Memory

Not all knowledge is equally durable. Sedimentation distinguishes
between signal and noise:

- **Signal:** A pattern that recurs across multiple cycles — same gate
  failure, same provider exhaustion, same worker confusion about task
  boundaries.
- **Noise:** A one-off event with no predictive value — a transient
  network error, a single typo in a task JSON.

Selection means the system prioritizes sedimenting signal over noise.
The gap ledger and fact event ledger provide the selection mechanism:
patterns that fire multiple times are escalated; patterns that fire
once are recorded but not amplified.

### Governed Recursion

Self-improvement requires external verification. A system that improves
itself without external oversight can drift from its original invariants.
The governed recursion constraint means:

- Workers cannot declare their own knowledge "verified."
- The orchestrator cannot grant itself permission to skip knowledge
  writeback.
- Structural improvements (gate changes, rule amendments) require human
  approval.
- The Command Steward surfaces improvement proposals; the human decides.

---

## Rule: Knowledge Sedimentation

Every completed work cycle MUST deposit durable knowledge into the
appropriate artifact. The deposit must be consumable by future workers
without requiring access to the original PR, worktree, or transcript.

### Sedimentation Targets

| Source Event | Artifact | Minimum Content |
|-------------|----------|-----------------|
| Merged PR (code) | `knowledge-updates.ndjson` | `commitSha`, file scope, change type, resolution summary |
| Merged PR (docs) | `knowledge-updates.ndjson` or `fact-events.ndjson` | `prNumber`, doc scope, what changed and why |
| Gate failure resolved | `gap-ledger.ndjson` | Gap type, root cause, resolution, recurrence count |
| Health state transition | `fact-events.ndjson` | Previous state, new state, trigger, duration |
| Worker launch/exit | `fact-events.ndjson` | Worker ID, task type, exit status, duration |
| Repeated failure pattern | `gap-ledger.ndjson` | Pattern ID, occurrence count, affected artifacts, escalation status |

### Quality Criteria

Knowledge entries that pass the writeback gate but fail quality checks
are flagged as low-quality sediment. Quality criteria:

1. **Specificity.** The entry must identify *what* happened, not just
   *that* something happened. "Worker exited" is not sediment.
   "Worker exited because validation command `npm run check` failed on
   missing dependency `@nestjs/core`" is sediment.
2. **Actionability.** A future worker reading the entry should be able
   to act on it without reading the original PR. If the entry says "see
   PR #421," it is a pointer, not knowledge.
3. **Scope boundary.** The entry must scope itself to the change it
   describes. Entries that overclaim ("improved system reliability") are
   noise.

### Enforcement

The Command Steward daily brief includes a "sediment quality" column in
the knowledge ledger summary. Entries that fail specificity or
actionability criteria are flagged. The state reconciler includes a
check for low-quality sediment in its drift report.

| Quality Gate | Check | Behavior |
|-------------|-------|----------|
| Specificity | Entry contains at least one concrete identifier (file, command, error) | Flag if generic |
| Actionability | Entry does not reference external context (PR body, transcript) | Flag if pointer-only |
| Scope | Entry describes one change, not a summary of many | Flag if overclaiming |

---

## Rule: Self-Improvement

When the same friction pattern appears three or more times within a
rolling seven-day window, the system MUST produce a structural
improvement — not just another log entry.

### Improvement Targets

| Recurring Pattern | Structural Improvement | Owner |
|-------------------|----------------------|-------|
| Same gate failure 3+ times | Gate logic or documentation updated | Human (PR review) |
| Same validation command failure 3+ times | Validation command or task compiler fixed | Human (PR review) |
| Same provider exhaustion 3+ times | Provider rotation policy adjusted | Human (policy review) |
| Same worker confusion about boundaries 3+ times | Task contract or worker docs clarified | Human (docs PR) |
| Same knowledge entry missing 3+ times | Writeback gate tightened | Human (gate config) |

### Improvement Lifecycle

```
  friction detected (gap ledger)
        │
        ▼
  count incremented (rolling window)
        │
        ▼
  threshold reached (3 occurrences)
        │
        ▼
  improvement proposal surfaced (Command Steward brief)
        │
        ▼
  human reviews and approves
        │
        ▼
  structural change merged (PR)
        │
        ▼
  knowledge entry written (sedimentation closes the loop)
```

### Enforcement

The gap ledger writer (`write-gap-ledger.js`) tracks rolling-window
counts for each gap type. When the count reaches 3, the writer emits
a `self-improvement-required` entry. The Command Steward surfaces this
in the daily brief. If no human action is taken within 48 hours, an
issue is auto-filed with the `self-improvement` label.

| Gate | Check | Behavior |
|------|-------|----------|
| Gap ledger writer | Rolling count >= 3 for same gap type | Emit `self-improvement-required` entry |
| Command Steward brief | `self-improvement-required` entries exist | Surface in daily brief |
| Issue auto-file | 48h without human action on surfaced pattern | File issue with `self-improvement` label |

---

## Interaction with Knowledge-Driven Scaling

This rule complements
[knowledge-driven-scaling.md](knowledge-driven-scaling.md). The
distinction:

| Concern | knowledge-driven-scaling.md | This rule |
|---------|---------------------------|-----------|
| Scaling preconditions | Knowledge writeback must exist before next batch | Knowledge must be *durable and specific*, not just present |
| Repeated failure | Escalation after 3 occurrences | Structural improvement after 3 occurrences |
| Governed scale | Reliability thresholds gate worker count | Quality thresholds gate knowledge amplification |
| Verifiable value | Output must be verifiable | Knowledge must be actionable |

Both rules apply simultaneously. A work cycle that satisfies the
writeback gate in knowledge-driven-scaling.md may still fail the
quality gate in this rule if the entry is generic or pointer-only.

---

## Non-Goals

- This rule does not define new artifact schemas. It uses the existing
  knowledge-updates, fact-events, and gap-ledger formats.
- This rule does not automate structural improvements. Human approval
  is always required.
- This rule does not override the seed constitution or any existing
  gate.
- This rule does not govern worker timeouts, resource allocation, or
  provider selection.

---

## Tier Classification

| Property | Value |
|----------|-------|
| Tier | 0 — Seed |
| Blast radius | Total — compounding waste without durable knowledge |
| Amendment authority | Human-authored PR + architecture-review + repo owner |
| Enforcement | Gap ledger writer, Command Steward brief, state reconciler |
| Escape hatch | None |

---

## References

- [knowledge-driven-scaling.md](knowledge-driven-scaling.md) — Macro
  scaling rule and knowledge writeback gate
- [loop-model.md](loop-model.md) — Self-cycle runner phases
- [codex-duty-exit-checklist.md](codex-duty-exit-checklist.md) —
  Exit criteria for Codex duties
- [command-steward-daily-loop.md](command-steward-daily-loop.md) —
  Daily operating loop
- [knowledge-update-writer.md](knowledge-update-writer.md) —
  NDJSON knowledge entry schema
- [knowledge-loop-lock-policy.md](knowledge-loop-lock-policy.md) —
  Concurrency rules for knowledge artifacts
- [gap-ledger.md](gap-ledger.md) — NDJSON gap ledger
- [fact-event-ledger.md](fact-event-ledger.md) — NDJSON fact event log
- [#1261](https://github.com/taoyu051818-sys/lian-nest-server/issues/1261) —
  This rule
