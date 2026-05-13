# Reason-Act-Observe-Reflect Investigation

> **Closes:** [#1410](https://github.com/taoyu051818-sys/lian-nest-server/issues/1410)
>
> **Source:** Symphony Dynamic Solver
> (`external-agent-research/Symphony/.roo/rules-symphony-dynamic-solver/02-rules.md`)
>
> **Source reliability:** high
>
> **See also:**
> [reflexion-investigation.md](reflexion-investigation.md) for
> failure-specific self-critiques,
> [loop-model.md](loop-model.md) for the self-cycle loop model,
> [self-cycle-runner.md](self-cycle-runner.md) for the orchestrator,
> [external-research-intake-loop.md](external-research-intake-loop.md)
> for the research intake pipeline.

---

## Summary

Symphony Dynamic Solver implements a formal Reason-Act-Observe-Reflect
cycle. Before entering the loop, the agent classifies the problem type
and selects a reasoning method (Self Consistency, Tree of Thoughts,
ReAct, Direct Logic). Each cycle logs reasoning, action, observation,
and reflection with timestamps. This replaces a simple
observe-decide-execute loop with a reflective loop that learns from
each iteration.

LIAN's self-cycle loop (`self-cycle-loop.ps1`) implements
Observe-Decide-Execute. There is no Reflect phase. A Reflect step
that evaluates action outcomes and writes structured reflections would
enable the agent to learn from failures and adjust strategy across
cycles. However, LIAN already has partial reflection infrastructure
via the Reflexion investigation (failure-specific critiques) — the gap
is narrower than it first appears.

---

## Symphony Dynamic Solver Pattern (Source Summary)

The Symphony Dynamic Solver uses a four-phase cycle:

| Phase | Purpose | Output |
|-------|---------|--------|
| **Reason** | Classify problem type, select reasoning method, plan approach | Method selection + action plan |
| **Act** | Execute the planned action | Action result |
| **Observe** | Capture the outcome (success, failure, partial) | Observation log |
| **Reflect** | Evaluate what worked, what failed, what to adjust | Reflection entry for next cycle |

Key design properties:

1. **Method selection before the loop.** The agent does not use a
   single reasoning strategy. It classifies the problem (structured
   logic, open-ended exploration, multi-step planning) and selects
   from Self Consistency, Tree of Thoughts, ReAct, or Direct Logic.

2. **Reflection is mandatory per cycle.** Every cycle produces a
   reflection, not just failed ones. Successful actions also generate
   reflections ("this approach worked because X").

3. **Reflections are timestamped and sequential.** Each reflection
   references the prior cycle's reflection, forming a chain the agent
   can traverse to understand its own reasoning history.

4. **Reflections influence method selection.** If repeated reflections
   indicate a method is failing for a problem type, the agent switches
   methods before the next cycle.

---

## LIAN's Current Loop

### Observe-Decide-Execute (self-cycle-loop.ps1)

```
┌──────────────────────────────────────────────────┐
│              self-cycle-loop.ps1                  │
│                                                  │
│  ┌──────────┐   ┌──────────┐   ┌──────────────┐ │
│  │ Observe  │──▶│ Decide   │──▶│ Execute      │ │
│  │ (state)  │   │ (action) │   │ (tool call)  │ │
│  └──────────┘   └──────────┘   └──────┬───────┘ │
│       ▲                                 │        │
│       └─────────────────────────────────┘        │
│              (30s pause, then repeat)             │
└──────────────────────────────────────────────────┘
```

**Observe** gathers: mergeable PRs, closeable issues, open action
issues, ready queue size, active workers, health preflight result.

**Decide** picks the highest-priority action: merge > close > produce
> implement > wait.

**Execute** runs the chosen action and returns a result string.

**What's missing:** There is no phase that evaluates the execution
result, writes a structured reflection, or feeds that reflection into
the next cycle's decision.

### Existing Reflection Infrastructure

LIAN already has partial reflection capability:

| Component | What It Does | Limitation |
|-----------|-------------|------------|
| `classify-self-cycle-failure.js` | Classifies failures by error class | Only fires on failure; no success reflection |
| `generate-failure-reflection.js` | Produces structured self-critiques from classifier output | Failure-only; no per-cycle outcome evaluation |
| Gap ledger (`gap-ledger.ndjson`) | Stores reflections in `meta.reflection` field | Only `worker-failed` entries carry reflections |
| `reflexion-investigation.md` | Documents the Reflexion framework integration | Proposes failure critiques, not a general Reflect phase |

---

## Gap Analysis

| Symphony Phase | LIAN Equivalent | Gap |
|---------------|-----------------|-----|
| Reason (method selection) | Decide (priority-ordered action) | LIAN uses a fixed priority order; no method selection based on problem type |
| Act | Execute | Present — action is executed |
| Observe | Observe (state gathering) | Present — but only gathers *pre-action* state, not *post-action* outcomes |
| Reflect | None | **Missing.** No per-cycle reflection. Failure critiques exist but are not wired into the loop |

### The Real Gap

The gap is **not** that LIAN lacks reflection entirely. The Reflexion
investigation and `generate-failure-reflection.js` already handle
failure-specific critiques. The gap is:

1. **No success reflection.** When a cycle succeeds (PR merged, issue
   closed), no reflection is written. The system cannot learn "this
   approach worked" — only "this approach failed."

2. **No post-action observation.** The Observe phase runs *before*
   Decide, not after Execute. The loop does not capture the outcome
   of the action it just performed as a distinct observation.

3. **No reflection chain.** Reflections (when they exist) are
   isolated entries in the gap ledger. There is no mechanism to
   traverse a sequence of reflections for a given task or error class
   to understand reasoning history.

4. **No method selection.** The Decide phase uses a fixed priority
   order. It does not select between reasoning strategies based on
   the problem type or past reflection history.

---

## Proposed Integration: Reflect Phase

### Design

Add a Reflect phase between Execute and the next Observe. The
Reflect phase evaluates the execution outcome and writes a structured
reflection to a new append-only ledger.

```
┌──────────────────────────────────────────────────────────────┐
│                    self-cycle-loop.ps1 (proposed)             │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ Observe  │─▶│ Decide   │─▶│ Execute  │─▶│ Reflect     │ │
│  │ (state)  │  │ (action) │  │ (result) │  │ (evaluate)  │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────┬──────┘ │
│       ▲                                            │        │
│       └────────────────────────────────────────────┘        │
│                  (reflection feeds next Observe)             │
└──────────────────────────────────────────────────────────────┘
```

### Reflection Schema

Each reflection is a single line in `loop-reflections.ndjson`:

```jsonc
{
  "version": 1,
  "cycleNumber": 42,
  "recordedAt": "2026-05-13T10:30:00Z",
  "action": "implement",
  "actionReason": "3 open issue(s) ready",
  "outcome": "success",        // success | failure | partial | blocked
  "outcomeDetail": "Workers completed, 2 PRs opened",
  "reflection": "Implementation succeeded. The compile step produced valid task JSON for all 3 issues. Safety gate passed on first attempt.",
  "adjustment": null,           // what to try differently next cycle (null if success)
  "priorReflectionId": "refl-41"  // chain to previous cycle's reflection
}
```

### Outcome Classification

| Outcome | Condition | Example |
|---------|-----------|---------|
| `success` | Action completed without error | PRs merged, issues closed, workers completed |
| `failure` | Action exited non-zero or threw | Compile failed, launch gate blocked, worker crashed |
| `partial` | Action completed with warnings or incomplete results | 2 of 3 workers succeeded, 1 timed out |
| `blocked` | Action was blocked by a gate or policy | Safety gate blocked, health violations |

### When Reflect Fires

- **Every cycle.** Not just failures. Successful cycles also produce
  reflections ("this approach worked").
- **After Execute, before the next Observe.** The reflection captures
  the outcome of the action that just ran.

### Retrieval for Next Cycle

Before Decide, the Observe phase reads the last N reflections from
`loop-reflections.ndjson` and includes them in the state object. The
Decide function can then consider reflection history:

- If the last 3 `implement` actions failed with the same error class,
  the Decide function can switch to `produce` (generate new issues
  instead of retrying broken ones).
- If the last `merge` action succeeded, the Decide function can
  prioritize merge again (positive reinforcement).

### Relationship to Existing Failure Reflections

The Reflect phase does **not** replace `generate-failure-reflection.js`.
They serve different purposes:

| Aspect | Reflect Phase | generate-failure-reflection.js |
|--------|--------------|-------------------------------|
| Scope | Per-cycle outcome evaluation | Per-failure error classification |
| Output | `loop-reflections.ndjson` | Gap ledger `meta.reflection` |
| Triggers | Every cycle (success + failure) | Only on worker failure |
| Purpose | Strategy adjustment across cycles | Specific error diagnosis for retry |
| Consumer | Decide function in next cycle | Worker prompt on retry |

When a cycle fails, **both** fire: the Reflect phase writes a
strategy-level reflection ("implement failed 3 times, switch to
produce"), and the failure classifier writes a specific critique
("TASK_CONTRACT_INVALID: missing rolePacket.actorRole").

---

## Method Selection (Future Enhancement)

Symphony's method selection (Self Consistency, Tree of Thoughts, ReAct,
Direct Logic) maps to LIAN's action priority. A future enhancement
could make the Decide function adaptive:

| Problem Type | Current Behavior | Adaptive Behavior |
|-------------|-----------------|-------------------|
| Many mergeable PRs | Always merge first | Merge first (already optimal) |
| Repeated implement failures | Retry implement | Switch to produce (new issues) or wait (human intervention) |
| Health gate red | Wait | Switch to close (cleanup) or merge (recovery) |
| Queue empty, no open issues | Wait | Switch to produce (seeding) |

This requires the reflection chain to accumulate enough data per
problem type. The initial Reflect phase should collect data before
any method selection logic is added.

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Reflection quality is low (generic observations) | Template-based reflection (like `generate-failure-reflection.js`) ensures specificity |
| `loop-reflections.ndjson` grows unbounded | Sliding window retrieval (last 10 entries); file rotation policy |
| Reflections add latency to each cycle | Reflection is a single file append (~1ms); negligible vs. 30s cycle pause |
| Duplicate reflection infrastructure with gap ledger | Separate file (different scope: strategy vs. failure); no overlap |
| Over-engineering before validating value | Start with minimal reflection; add method selection only if data shows value |

---

## Recommendation

**Actionable. Low effort. Moderate signal-to-noise.**

The Reflect phase adds one append to `loop-reflections.ndjson` per
cycle and one read in the Observe phase. It does not change the
orchestrator, the action priority, or the existing failure reflection
pipeline.

### Implementation Order

1. Create `loop-reflections.ndjson` schema and append helper
   (`write-loop-reflection.js`).
2. Add Reflect phase to `self-cycle-loop.ps1` after Execute.
3. Add reflection retrieval to Observe phase.
4. Update `loop-model.md` to document the four-phase loop.
5. Collect 50+ cycles of reflection data before considering method
   selection.

### What This Does NOT Do

- Does not add method selection (Self Consistency, Tree of Thoughts,
  etc.) — that requires reflection data first.
- Does not replace `generate-failure-reflection.js` — they serve
  different scopes.
- Does not change the action priority order — reflection data may
  inform future changes, but the initial implementation is
  observe-only.
- Does not add an LLM call — reflections are deterministic templates
  based on action type and outcome.

---

## Tier Classification

| Property | Value |
|----------|-------|
| Tier | 1 — Extension |
| Blast radius | Local — adds one file and one phase to the loop script |
| Amendment authority | Human-authored PR |
| Enforcement | Loop script, reflection schema |
| Escape hatch | Remove Reflect phase; loop reverts to Observe-Decide-Execute |

---

## References

- [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2308.11432) — Shinn et al., 2023
- [reflexion-investigation.md](reflexion-investigation.md) — LIAN's failure-specific reflection integration
- [loop-model.md](loop-model.md) — Self-cycle loop model
- [self-cycle-runner.md](self-cycle-runner.md) — Top-level orchestrator
- [generate-failure-reflection.js](../../scripts/ai/generate-failure-reflection.js) — Failure critique generator
- [classify-self-cycle-failure.js](../../scripts/ai/classify-self-cycle-failure.js) — Failure classifier
- [gap-ledger.md](gap-ledger.md) — Gap ledger schema
- [external-research-intake-loop.md](external-research-intake-loop.md) — Research intake pipeline
- [knowledge-driven-scaling.md](knowledge-driven-scaling.md) — Self-improvement rule
- [#1410](https://github.com/taoyu051818-sys/lian-nest-server/issues/1410) — This investigation
