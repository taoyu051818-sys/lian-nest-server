# Knowledge-Driven Scaling

Defines Knowledge-Driven Scaling as a macro long-term rule for the
AI-native control plane. Effective work must become reusable knowledge,
repeated friction must become system improvement, and scale must grow
only with reliability.

> **Closes:** [#1170](https://github.com/taoyu051818-sys/lian-nest-server/issues/1170)
>
> **Authority:** This rule operates at the same level as the seed
> constitution's five sections. It does not override them; it adds a
> sixth invariant that governs how the system learns from its own work.
>
> **See also:**
> [seed-constitution.md](seed-constitution.md) for immutable boundaries,
> [constitutional-rule-tiers.md](constitutional-rule-tiers.md) for the
> tier classification, [knowledge-update-writer.md](knowledge-update-writer.md)
> for the NDJSON knowledge ledger, [knowledge-loop-lock-policy.md](knowledge-loop-lock-policy.md)
> for concurrency rules on knowledge artifacts.

---

## Purpose

The control plane produces work — PRs, docs, scripts, fixes. That work
has two consumers: the immediate task and the system's future self.
Knowledge-Driven Scaling ensures the second consumer is never forgotten.

Three failure modes appear when scaling without a knowledge rule:

1. **Lost work** — A worker solves a problem, but the solution lives
   only in a merged PR. The next worker hitting the same problem starts
   from scratch.
2. **Repeated friction** — The same gate failure, the same misconfigured
   task JSON, the same provider exhaustion pattern recurs across weeks
   because no one wrote it down in a form the system can consume.
3. **Unreliable scale** — Worker count grows but reliability stays flat.
   More workers means more failures, more rework, more human escalation —
   not more throughput.

This rule prevents all three by making knowledge writeback a precondition
for scaling.

---

## Relationship to the Three Laws

Knowledge-Driven Scaling derives from the three meta-governance laws in
[constitutional-rule-tiers.md](constitutional-rule-tiers.md). Each hard
rule below maps to one or more laws.

| Law | Application to Scaling |
|-----|----------------------|
| **Reality Before Judgment** | Scale decisions must be grounded in verifiable knowledge artifacts — not in assumptions about worker capability or system health. A worker that completed a task is a fact only when the knowledge entry, fact event, or health gate confirms it. |
| **Selection Before Memory** | When multiple scaling signals conflict (e.g., gap ledger says "too many stale workers" but fact events show "all workers active"), the most specific, most recent signal takes precedence. Stale knowledge does not override live state. |
| **Governed Recursion** | No automation may declare itself "ready to scale" without external verification. A worker cannot write its own readiness entry. The orchestrator cannot grant itself more dispatch slots. Scale authority lives outside the automation requesting it. |

---

## Hard Rules

### Rule 1 — Knowledge Writeback

Every completed work unit MUST produce at least one knowledge artifact
before the next equivalent work unit may launch.

| Completed Work Type | Required Artifact | Writer | Verification |
|---------------------|-------------------|--------|--------------|
| Merged PR (code change) | Knowledge entry in `knowledge-updates.ndjson` | `write-knowledge-update.ps1` | Entry exists with matching `commitSha` |
| Merged PR (docs change) | Knowledge entry OR fact event | `write-knowledge-update.ps1` or `write-fact-event.ps1` | Entry exists with matching `prNumber` |
| Resolved gate failure | Gap ledger entry in `gap-ledger.ndjson` | `write-gap-ledger.js` | Entry exists with matching gap type |
| Health state transition | Fact event in `fact-events.ndjson` | `write-fact-event.js` | Entry exists with matching event type |
| Worker launch/exit | Fact event | `write-fact-event.js` | Entry exists with matching worker ID |

**Enforcement:** The launch gate checks whether the previous batch's
knowledge artifacts exist before dispatching the next batch. If the
knowledge ledger has no entry for the previous batch's completed work,
the gate reports a `knowledge-writeback-missing` warning. For the first
three batches after this rule is adopted, the warning is non-blocking.
After that, it becomes a blocking gate.

**Why:** Without writeback, scaling amplifies ignorance. Ten workers
repeating the same mistake is worse than one worker making it once.

---

### Rule 2 — Repeated Failure Escalation

When the same failure pattern appears three or more times within a
rolling seven-day window, the system MUST escalate the pattern from
an operational issue to a structural improvement.

| Failure Signal | Detection Source | Threshold | Required Action |
|----------------|-----------------|-----------|-----------------|
| Same gap type fires 3+ times | `gap-ledger.ndjson` | 3 occurrences of identical `gapType` in 7 days | Issue filed for root-cause fix |
| Same gate blocks 3+ workers | Launch gate logs | 3+ `BLOCK` results for same gate in 7 days | Gate documentation updated or gate fixed |
| Same validation command fails 3+ times | Worker PR bodies | 3+ PRs with same `validationCommand` failure | Validation command fixed or task compiler updated |
| Same provider exhaustion pattern | Fact events (`provider.exhausted`) | 3+ exhaustion events for same provider in 7 days | Provider rotation policy reviewed |

**Escalation path:**

1. The meta-signal engine detects the repeated pattern from the gap
   ledger or fact event ledger.
2. A gap ledger entry with gap type `repeated-failure-pattern` is
   written, including the count, window, and affected artifacts.
3. The Command Steward surfaces the pattern in the daily brief.
4. If no human action is taken within 48 hours of surfacing, an issue
   is auto-filed with the `repeated-failure` label.

**Enforcement:** The gap ledger writer (`write-gap-ledger.js`) includes a
rolling-window counter for each `gapType`. When the counter hits 3, the
writer emits a `repeated-failure-pattern` entry in addition to the
original gap entry.

**Why:** A failure that happens once is an incident. A failure that
happens three times is a system defect. Scaling without fixing repeated
failures multiplies waste.

---

### Rule 3 — Governed Scale

Worker dispatch count MUST NOT increase when system reliability is
declining. Scale is gated on reliability, not on queue depth.

| Metric | Source | Threshold | Gate |
|--------|--------|-----------|------|
| Health state | `.github/ai-state/main-health.json` | `green` | Required for any scale increase |
| Recent failure rate | `gap-ledger.ndjson` | < 10% of last 20 tasks | Required for scale increase beyond current max |
| Stale worker count | `.claude/worktrees/` scan | 0 stale workers | Required for launching additional workers |
| Knowledge writeback compliance | `knowledge-updates.ndjson` | 100% of last batch | Required for next batch dispatch |

**Scale tiers:**

| Tier | Max Concurrent Workers | Required Health | Required Failure Rate |
|------|----------------------|-----------------|----------------------|
| Conservative (default) | 1–2 | green or yellow | < 20% |
| Moderate | 3–5 | green | < 10% |
| Aggressive | 6+ | green for 3+ consecutive cycles | < 5% |

**Enforcement:** The launch gate reads the current health state, gap
ledger, and knowledge writeback status. If any threshold is not met,
the gate blocks new worker launches and reports which threshold failed.

**Why:** Scaling unreliable workers produces more failures, more rework,
and more human escalation. Reliability must precede scale — this is the
Governed Recursion law applied to throughput.

---

### Rule 4 — Verifiable Value

Every work unit MUST produce verifiable value — not just output. Value
is measured by the consumer, not the producer.

| Value Type | Verification Method | Consumer |
|------------|-------------------|----------|
| Code change compiles | `npm run check` exits 0 | Health gate |
| Code change is correct | Tests pass, PR approved | Human reviewer |
| Knowledge is captured | Entry in `knowledge-updates.ndjson` | Future workers reading the ledger |
| Gap is documented | Entry in `gap-ledger.ndjson` | Meta-signal engine, planning loop |
| Health is maintained | Health state stays green post-merge | Launch gate |

**Anti-patterns — NOT verifiable value:**

| Claim | Why It Fails |
|-------|-------------|
| "Worker exited with code 0" | Exit code 0 does not prove the change is correct or useful |
| "Worker produced output" | Output without merge or knowledge entry is ephemeral |
| "Task was assigned" | Assignment is a precondition, not a value proof |
| "PR was opened" | An open PR is a proposal, not an outcome |

**Enforcement:** The Command Steward daily brief includes a
"value-verified" column in the worker summary. Workers that exited but
produced no merged PR and no knowledge artifact are flagged as
`unverified-value`. The state reconciler (`state-reconciler.ps1`)
includes a check for unverified-value workers in its drift report.

**Why:** A system that scales on output volume rather than verified value
will grow noisy, expensive, and untrustworthy. Each unit of scale must
earn its cost with provable value.

---

## Knowledge Artifact Types

This rule references four artifact types maintained by existing
infrastructure:

| Artifact | File | Writer | Lock Tier |
|----------|------|--------|-----------|
| Knowledge entry | `.github/ai-state/knowledge-updates.ndjson` | `write-knowledge-update.ps1` | T1 (append-only) |
| Fact event | `.github/ai-state/fact-events.ndjson` | `write-fact-event.js` | T1 (append-only) |
| Gap ledger entry | `.github/ai-state/gap-ledger.ndjson` | `write-gap-ledger.js` | T1 (append-only) |
| Health state | `.github/ai-state/main-health.json` | `write-main-health-state.ps1` | T1 (append-only) |

All four are append-only NDJSON files with schema versioning, dry-run
defaults, and token sanitization. See
[knowledge-loop-lock-policy.md](knowledge-loop-lock-policy.md) for
concurrency rules and [knowledge-update-writer.md](knowledge-update-writer.md)
for the knowledge entry schema.

---

## Gate Integration

Knowledge-Driven Scaling plugs into the existing gate stack:

| Gate | Check Added | Behavior |
|------|-------------|----------|
| Launch gate | Knowledge writeback compliance for previous batch | Warn (first 3 batches), then block |
| Launch gate | Reliability threshold for scale tier | Block if threshold not met |
| Health gate | Post-merge knowledge artifact existence | Report in health checks |
| State reconciler | Unverified-value worker detection | Include in drift report |
| Command Steward brief | Repeated failure pattern surfacing | Include in daily brief |

---

## Relationship to Existing Roles

| Role | Interaction |
|------|------------|
| Command Steward | Surfaces repeated failure patterns and unverified-value workers in the daily brief. Proposes scale-tier changes for human approval. |
| Orchestrator | Enforces knowledge writeback gate before dispatching next batch. Respects scale-tier limits. |
| Workers | Produce knowledge artifacts as part of task completion. Cannot self-declare value verified. |
| Human operator | Approves scale-tier changes. Acts on repeated failure escalation issues. Final authority on what constitutes verifiable value. |

---

## Non-Goals

This rule does **not**:

- Replace or modify the seed constitution's five existing sections.
- Define new knowledge artifact schemas (those are in
  knowledge-update-writer.md, fact-event-ledger.md, gap-ledger.md).
- Automate scale-tier promotion (always requires human approval).
- Govern worker timeout budgets or resource allocation (those are
  operational policies in Tier 3).

---

## Enforcement Summary

| Rule | Gate | First Enforcement | Escalation |
|------|------|-------------------|------------|
| Knowledge writeback | Launch gate | Warning (non-blocking for first 3 batches) | Becomes blocking gate after grace period |
| Repeated failure | Gap ledger writer + Command Steward brief | Auto-issue filed after 48h without human action | `repeated-failure` label on auto-filed issue |
| Governed scale | Launch gate | Block new launches when threshold fails | Command Steward surfaces blocker in daily brief |
| Verifiable value | State reconciler + Command Steward brief | Flag in drift report | Human reviews unverified-value workers |

---

## Tier Classification

Knowledge-Driven Scaling is a **Tier 0** rule — it defines how the
control plane learns and scales. Violating it does not cause immediate
data loss (Tier 1), but it degrades the system's ability to improve,
which is a foundational invariant.

| Property | Value |
|----------|-------|
| Tier | 0 — Seed |
| Blast radius | Total — scaling without knowledge produces compounding waste |
| Amendment authority | Human-authored PR + architecture-review + repo owner |
| Enforcement | Launch gate, state reconciler, gap ledger writer |
| Escape hatch | None. The grace period (first 3 batches) is a transition aid, not a bypass. |

---

## References

- [seed-constitution.md](seed-constitution.md) — Immutable boundaries this rule extends
- [constitutional-rule-tiers.md](constitutional-rule-tiers.md) — Tier classification and three laws
- [knowledge-update-writer.md](knowledge-update-writer.md) — NDJSON knowledge entry schema
- [knowledge-loop-lock-policy.md](knowledge-loop-lock-policy.md) — Concurrency rules for knowledge artifacts
- [fact-event-ledger.md](fact-event-ledger.md) — NDJSON fact event log
- [gap-ledger.md](gap-ledger.md) — NDJSON gap ledger
- [command-steward-agent.md](command-steward-agent.md) — Human-facing control-plane interface
- [command-steward-brief-contract.md](command-steward-brief-contract.md) — Daily brief field definitions
- [codex-exit-readiness-gate.md](codex-exit-readiness-gate.md) — Gate decision rules and acceptance tests
- [launch-gate.md](launch-gate.md) — Pre-launch validation
- [main-health-policy.md](main-health-policy.md) — Health states and launch permissions
- [failure-taxonomy-policy.md](failure-taxonomy-policy.md) — Failure classification
- [#1170](https://github.com/taoyu051818-sys/lian-nest-server/issues/1170) — This rule
