# Reflexion Investigation: Self-Reflection for Failure Recovery

> **Closes:** [#1366](https://github.com/taoyu051818-sys/lian-nest-server/issues/1366)
>
> **Source:** [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2308.11432) (Shinn et al., 2023)
>
> **Source reliability:** medium
>
> **See also:**
> [knowledge-driven-scaling-rule.md](knowledge-driven-scaling-rule.md) for the
> self-improvement rule,
> [gap-ledger.md](gap-ledger.md) for the friction tracking ledger,
> [meta-signals.md](meta-signals.md) for aggregate signal computation,
> [classify-self-cycle-failure.js](../../scripts/ai/classify-self-cycle-failure.js)
> for the failure classifier.

---

## Summary

Reflexion agents improve by generating verbal self-critiques after task
failures, storing them in episodic memory, and referencing them in
subsequent attempts. This creates a learning loop without weight updates.

LIAN's current failure recovery pipeline classifies errors (deterministic
regex), tracks friction patterns (gap ledger), and computes aggregate
signals (meta-signals). The gap: **LIAN classifies failures but does not
generate actionable self-critiques for future cycles.** Adding a
reflection step that produces structured critiques would enable the
system to avoid repeating the same mistakes at the individual-failure
level, not just the aggregate level.

---

## Reflexion Mechanism (Paper Summary)

The Reflexion framework has three components:

1. **Actor.** An LLM agent that executes a task and produces a result.
2. **Evaluator.** A function that scores the result (success/failure +
   signal).
3. **Self-Reflection.** The LLM generates a verbal critique of what went
   wrong and what to try differently. This critique is stored in
   episodic memory and injected into the prompt on the next attempt.

The key insight: the self-critique is *verbal* (natural language), not a
scalar reward. This makes it retrievable and interpretable by both the
agent and humans. The episodic memory is a sliding window of recent
reflections, not a growing corpus.

### What a Self-Critique Looks Like

Given a failure with error class `TASK_CONTRACT_INVALID` and text
"missing required field: rolePacket.actorRole", a reflexion-style
critique would be:

> The task contract was compiled without the rolePacket.actorRole field.
> The compile script does not default this field when the issue body
> lacks a Role Packet section. On the next attempt, check that the
> issue body contains a Role Packet before compiling, or add a default
> actorRole of "research-worker" to the compiler.

This is richer than the classifier output (which says "Re-compile the
issue with compile-issue-to-task-json.ps1 or fix the missing fields
manually") because it identifies the *specific* missing field, the
*root cause* (no default), and a *concrete next action* (check or
default).

---

## Current LIAN Pipeline (What Exists)

| Layer | Component | Output | Limitation |
|-------|-----------|--------|------------|
| Classification | `classify-self-cycle-failure.js` | Error class, cause, action, confidence | Deterministic; no learning from history |
| Friction tracking | `write-gap-ledger.js` | Gap entries with rolling counts | Aggregate only; no per-failure critique |
| Aggregate signals | `calculate-meta-signals.js` | failureScore, frictionScore, trust | Summary stats; no actionable detail |
| Self-improvement | `knowledge-driven-scaling-rule.md` | Structural improvement after 3x friction | Requires human approval; slow feedback loop |
| Knowledge sedimentation | `knowledge-updates.ndjson` | Durable knowledge from merged PRs | Post-hoc; not available at retry time |

### What's Missing

| Reflexion Component | LIAN Equivalent | Gap |
|--------------------|-----------------|-----|
| Verbal self-critique | `humanSummary` + `recommendedAction` | Generic, not contextualized to the specific failure instance |
| Episodic memory | Gap ledger + fact events | No retrieval mechanism for "what did I learn from the last time this error class fired?" |
| Reflection injection | Not present | The self-cycle runner does not consult past reflections before retrying |

---

## Proposed Integration: Failure Reflection Step

### Design

Add a `generate-failure-reflection.js` script that sits between
classification and gap ledger writing. It takes the classifier output
and produces a structured self-critique that can be stored and retrieved.

```
failure occurs
  -> classify-self-cycle-failure.js (existing: error class + cause)
  -> generate-failure-reflection.js (NEW: verbal critique)
  -> write-gap-ledger.js (existing: store with reflection in meta field)
  -> on next attempt, self-cycle runner reads recent reflections for the
     same error class from the gap ledger
```

### Reflection Schema

A reflection is stored in the `meta` field of a gap ledger entry with
gapType `worker-failed` and a new `reflection` key:

```jsonc
{
  "entryVersion": 1,
  "recordedAt": "2026-05-13T04:30:00Z",
  "gapType": "worker-failed",
  "severity": "high",
  "description": "Worker exited code 1: TASK_CONTRACT_INVALID",
  "issue": 1366,
  "meta": {
    "errorClass": "TASK_CONTRACT_INVALID",
    "confidence": "high",
    "reflection": {
      "critique": "The task contract was missing rolePacket.actorRole. The compile script does not default this field when the issue body lacks a Role Packet section.",
      "rootCause": "No default actorRole in compile-issue-to-task-json.ps1",
      "nextAction": "Add a default actorRole of 'research-worker' when the issue body omits the Role Packet section.",
      "similarPastCount": 2,
      "reflectionId": "refl-20260513-001"
    }
  }
}
```

### Retrieval

Before dispatching a worker, the self-cycle runner can query the gap
ledger for recent reflections matching the task's error class:

```bash
# Pseudocode: find recent TASK_CONTRACT_INVALID reflections
grep '"errorClass":"TASK_CONTRACT_INVALID"' .github/ai-state/gap-ledger.ndjson \
  | tail -5 \
  | jq '.meta.reflection'
```

This provides the "episodic memory" lookup: the worker prompt can
include recent reflections for the same failure class, enabling the
agent to avoid repeating known mistakes.

### Sliding Window

Following the paper's design, only the most recent N reflections per
error class are kept in the retrieval window. The gap ledger itself
grows monotonically (append-only), but the retrieval function should
limit to the last 5 entries per class. This prevents stale reflections
from dominating the context.

---

## Alignment with Existing Rules

### Knowledge Sedimentation Rule

The reflection output satisfies all three quality criteria:

| Criterion | How Reflection Satisfies It |
|-----------|---------------------------|
| Specificity | Names the exact field, script, and condition that caused the failure |
| Actionability | Provides a concrete next action that does not require reading the original PR |
| Scope | Scoped to one failure instance, not a summary of many |

### Self-Improvement Rule

Reflections complement the self-improvement rule. The self-improvement
rule triggers structural changes after 3+ friction occurrences.
Reflections provide the *detail* that makes those proposals actionable:

- Without reflections: "TASK_CONTRACT_INVALID fired 3 times"
- With reflections: "TASK_CONTRACT_INVALID fired 3 times, each time
  because a different optional field was missing. The compiler needs
  defaults for: rolePacket.actorRole, allowedFiles, validationCommands."

### Governed Recursion

Reflections are generated by the system but reviewed by humans (via the
gap ledger and Command Steward brief). The system cannot declare its
own reflections "verified" — they are advisory inputs to the next
attempt, not authoritative corrections.

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Reflection quality depends on classifier accuracy | Classifier confidence is already tracked; low-confidence classifications produce weaker reflections |
| Stale reflections mislead future attempts | Sliding window (last 5 per class) prevents stale data from dominating |
| Reflections could leak sensitive failure context | Reflections go through the same sanitization as gap ledger entries |
| Over-engineering for a low-frequency problem | Start with gap ledger meta field; no new file format or schema needed |

---

## Recommendation

**Actionable. Low effort. High signal-to-noise.**

The proposed integration adds one script (`generate-failure-reflection.js`)
and one documentation update (gap ledger reflection schema). It reuses
the existing gap ledger infrastructure — no new file formats, no new
state files, no new orchestrator logic.

The reflection step is optional and backward-compatible: existing
consumers of the gap ledger will ignore the `meta.reflection` field.
New consumers (self-cycle runner, Command Steward brief) can opt in
to reading reflections without changing the ledger contract.

### Implementation Order

1. Add `reflection-critique` as a recognized gap type (or use
   `worker-failed` with `meta.reflection` — recommended, no schema
   change needed).
2. Create `generate-failure-reflection.js` that takes classifier output
   and produces a structured critique.
3. Wire it into the self-cycle failure path (between classify and
   write-gap-ledger).
4. Add a retrieval helper for the self-cycle runner to read recent
   reflections by error class.
5. Document the reflection schema in gap-ledger.md.

### What This Does NOT Do

- Does not add an LLM call to generate reflections (the critique is
  deterministic, built from the classifier output + error text patterns).
  This avoids latency, cost, and non-determinism.
- Does not change the self-cycle runner orchestration (retrieval is
  opt-in).
- Does not replace the self-improvement rule (reflections complement it).
- Does not add a new NDJSON file (uses existing gap ledger).

---

## Tier Classification

| Property | Value |
|----------|-------|
| Tier | 1 — Extension |
| Blast radius | Local — enriches gap ledger entries, no orchestration change |
| Amendment authority | Human-authored PR |
| Enforcement | Gap ledger writer, self-cycle runner (opt-in retrieval) |
| Escape hatch | Remove reflection generation; ledger entries remain valid without it |

---

## References

- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2308.11432) — Shinn et al., 2023
- [knowledge-driven-scaling-rule.md](knowledge-driven-scaling-rule.md) — Self-improvement rule
- [gap-ledger.md](gap-ledger.md) — Gap ledger schema and writer
- [classify-self-cycle-failure.js](../../scripts/ai/classify-self-cycle-failure.js) — Failure classifier
- [meta-signals.md](meta-signals.md) — Aggregate signal calculator
- [self-healing.md](self-healing.md) — Self-healing pipeline overview
