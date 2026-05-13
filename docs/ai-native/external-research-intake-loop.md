# External Research Intake Loop

Defines how external projects, papers, and open-source research enter
the AI-native control plane as evidence-backed opportunities — never as
direct execution commands. External research passes through source
capture, evidence scoring, pattern extraction, opportunity signal
creation, and bounded experiment gating before it can produce a task.

> **Closes:** [#1213](https://github.com/taoyu051818-sys/lian-nest-server/issues/1213)
>
> **Updated by:** [#1218](https://github.com/taoyu051818-sys/lian-nest-server/issues/1218)
>
> **See also:**
> [external-reality-intake.md](external-reality-intake.md) for the intake
> boundary contract,
> [evidence-reliability-policy.md](evidence-reliability-policy.md) for
> reliability tiers,
> [external-intake-executable-loop.md](external-intake-executable-loop.md)
> for the executable intake pipeline,
> [bounded-experiment-policy.md](bounded-experiment-policy.md) for
> experiment scoping,
> [agent-idea-review-gate.md](agent-idea-review-gate.md) for idea
> promotion criteria,
> [knowledge-driven-scaling.md](knowledge-driven-scaling.md) for the
> knowledge writeback invariant.

---

## Purpose

The control plane needs to learn from external projects and research —
agent frameworks, orchestration patterns, open-source tools — without
letting unverified external claims drive execution. This document defines
the loop that transforms external research into system-local opportunity
signals with falsifiable hypotheses and bounded experiments.

Three failure modes this loop prevents:

1. **Ad-hoc adoption** — An operator reads about a project and directly
   modifies code or policy without evidence that the pattern fits LIAN.
2. **Copy-paste integration** — External text enters the repo verbatim
   instead of being synthesized into LIAN-specific policy.
3. **Unfalsifiable enthusiasm** — A research observation becomes a task
   without a measurable success criterion or rollback plan.

---

## Loop Stages

```
┌─────────────────────────────────────────────────────────────────────┐
│                   external research intake loop                     │
│                                                                     │
│  ┌────────────┐  ┌────────────┐  ┌───────────┐  ┌───────────────┐  │
│  │ 1. Source   │─▶│ 2. Evidence│─▶│ 3. Pattern│─▶│ 4. Opportunity│  │
│  │   Capture   │  │   Score    │  │  Extract  │  │    Signal     │  │
│  └─────┬──────┘  └────────────┘  └───────────┘  └───────┬───────┘  │
│        │                                                 │          │
│        ▼                                                 ▼          │
│  fact event ledger                              .github/ai-state/   │
│  (.github/ai-state/                             opportunity-signals/│
│   fact-events.ndjson)                                                  │
│                                                                     │
│  ┌────────────────┐  ┌────────────┐  ┌───────────────────────┐     │
│  │ 5. Bounded     │─▶│ 6. Gate    │─▶│ 7. Result Writer      │     │
│  │   Experiment    │  │   (human)  │  │    (accept/reject)    │     │
│  └────────────────┘  └────────────┘  └───────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

| Stage | Input | Output | Governing Doc |
|-------|-------|--------|---------------|
| **Source Capture** | External project/paper/repo | Fact event (`evidence.intake`) | [external-reality-intake.md](external-reality-intake.md) |
| **Evidence Score** | Raw source metadata | Reliability tier (A/B/C/D) | [evidence-reliability-policy.md](evidence-reliability-policy.md) |
| **Pattern Extract** | Scored evidence | LIAN-specific pattern claim | This doc |
| **Opportunity Signal** | Pattern claim + evidence refs | Signal file with hypothesis | [opportunity-signal-schema.md](opportunity-signal-schema.md) |
| **Bounded Experiment** | Accepted signal | Scoped experiment spec | [bounded-experiment-policy.md](bounded-experiment-policy.md) |
| **Gate** | Experiment + human-gate boundaries | Promote / block / reject | [external-intake-human-gate.md](external-intake-human-gate.md) |
| **Result Writer** | Experiment outcome | Fact event + knowledge entry | [external-intake-result-writer.md](external-intake-result-writer.md) |

---

## Stage 1: Source Capture

External research enters the system as a fact event. The source is
classified using the standard source class matrix.

### Source Classes for Research

| Source Class | Examples | Default Tier | Notes |
|-------------|----------|:------------:|-------|
| `external-doc` | Project README, API docs, paper abstract | B | Structured but not version-pinned to LIAN |
| `web-scan` | GitHub trending, npm registry, HN/Lobste.rs | C | Requires cross-verification |
| `user-paste` | Operator pasted link or summary | C | Manual review gate |
| `opaque-external` | Unstructured blog, cached page | D | Quarantine until promoted |

### Capture Rule

Every research observation produces exactly one fact event. The fact
event records the source URL, a SHA-256 hash of the raw content, and the
source class. No external text is stored verbatim in the fact event —
only sanitized summaries.

```bash
node scripts/ai/write-fact-event.js \
  --type evidence.intake \
  --subject "Karpathy Skills pattern" \
  --actor "research-intake" \
  --live \
  --facts '{
    "sourceClass":"external-doc",
    "sourceUrl":"https://github.com/karpathy/skills",
    "reliabilityTier":"B",
    "rawHash":"a1b2c3...",
    "researchCategory":"agent-pattern"
  }'
```

---

## Stage 2: Evidence Score

Research evidence is scored using the standard reliability tiers from
[evidence-reliability-policy.md](evidence-reliability-policy.md). The
additional scoring dimension for research is **applicability** — how
directly the external pattern maps to LIAN's architecture.

### Applicability Matrix

| Score | Meaning | Gate Behavior |
|-------|---------|---------------|
| **Direct** | Pattern maps 1:1 to an existing LIAN component or workflow | Auto-promote to opportunity signal |
| **Partial** | Pattern applies to a LIAN subsystem with adaptation | Promote with adaptation notes |
| **Analogous** | Pattern solves a similar problem in a different domain | Promote as research signal (lower priority) |
| **Aspirational** | Pattern is interesting but no current LIAN surface matches | Record only; no signal created |

### Staleness Rule

Research evidence older than 90 days with no version pin is flagged
stale. Stale research may still be recorded but carries a staleness
marker that downstream consumers must evaluate. Fast-moving domains
(agent frameworks, LLM tooling) use a 30-day window.

---

## Stage 3: Pattern Extract

Pattern extraction converts external evidence into a LIAN-specific
claim. This is the critical transformation step — the output is a
synthesized pattern, not a copy of external text.

### Extraction Rules

1. **Synthesize, don't copy.** The pattern claim must be written in
   LIAN's vocabulary, referencing LIAN components and workflows. External
   terminology is mapped to LIAN equivalents.

2. **Ground in evidence.** Every pattern claim must reference at least
   one fact event by ID. Claims without evidence are rejected.

3. **Identify the LIAN surface.** The pattern must name the specific
   LIAN component, workflow, or policy it applies to (e.g., "the
   opportunity signal lifecycle", "the launch gate policy", "the
   knowledge writeback invariant").

4. **State what LIAN lacks.** If the external pattern addresses a gap
   in LIAN, the claim must describe the gap explicitly — not assume
   the gap exists because an external project implements something.

### Extraction Output Format

```jsonc
{
  "patternId": "pat-<short-hash>",
  "sourceFactIds": ["evt-abc123", "evt-def456"],
  "externalProject": "Project Name",
  "lianSurface": "component or workflow name",
  "claim": "LIAN-specific description of what the pattern does and why it matters",
  "gapDescription": "What LIAN lacks that this pattern addresses (or null)",
  "applicability": "direct|partial|analogous|aspirational",
  "extractedAt": "2026-05-12T10:00:00Z",
  "extractedBy": "research-intake"
}
```

---

## Stage 4: Opportunity Signal

When a pattern extraction has `applicability` of `direct` or `partial`,
it produces an opportunity signal. The signal carries a falsifiable
hypothesis and a bounded experiment proposal.

### Signal Fields (Research-Specific)

| Field | Type | Description |
|-------|------|-------------|
| `sourceFacts` | array | At least one fact event ID from Stage 1 |
| `patternId` | string | Reference to the pattern extraction from Stage 3 |
| `hypothesis` | string | Falsifiable claim: "If LIAN adopts X from project Y, then Z will improve" |
| `experiment` | object | Minimal bounded action to validate the hypothesis |
| `acceptanceGate` | object | Criteria that must pass before promotion to task |
| `externalProject` | string | Source project name (for traceability) |
| `lianSurface` | string | Which LIAN component this affects |

### Hypothesis Format

Every hypothesis MUST follow this structure:

> "If LIAN adopts **[specific pattern]** from **[project]**, then
> **[measurable outcome]** will improve by **[observable metric]**."

Examples:

- "If LIAN adds structured tool definitions to opportunity signals
  (inspired by Karpathy Skills), then signal quality scores will
  increase because workers receive more precise experiment specs."
- "If LIAN adds multi-provider fallback to the launch gate (inspired by
  QwenPaw), then provider exhaustion blocks will decrease because
  workers can retry on alternate providers."
- "If LIAN adds trace-based result logging to the intake loop (inspired
  by Hermes), then experiment audit completeness will increase because
  every intake-to-result path is recorded."

### Lifecycle

```
draft → validated → accepted → scheduled
                ↘ rejected
```

A research signal starts as `draft`. It moves to `validated` when the
evidence score and pattern extraction pass review. It reaches `accepted`
when a human approves the bounded experiment. It reaches `scheduled`
when the planning loop assigns it to a task.

---

## Research Examples

The following examples illustrate how external projects enter the loop.
Each example shows the pattern claim — not the external project's
documentation.

### Karpathy Skills — Structured Tool Definitions

**External observation:** Karpathy's Skills project uses structured
tool definitions with explicit input/output schemas and example traces.

**Pattern claim:** LIAN's opportunity signals could carry structured
experiment specs (input schema, expected output schema, example traces)
instead of free-form hypothesis text. This would improve the issue-to-task
compiler's ability to auto-generate `validationCommands`.

**LIAN surface:** Opportunity signal schema, issue-to-task compiler.

**Applicability:** Partial — LIAN already has structured task JSON; the
extension is richer signal metadata.

### QwenPaw — Multi-Provider Orchestration

**External observation:** QwenPaw implements provider-aware routing with
fallback chains and cost tracking across multiple LLM providers.

**Pattern claim:** LIAN's launch gate could incorporate provider health
state into its allow/block decision, enabling automatic fallback when the
primary provider is exhausted.

**LIAN surface:** Launch gate policy, provider pool state.

**Applicability:** Partial — LIAN tracks provider state but does not
route launches based on provider availability.

### Hermes — Trace-Based Observability

**External observation:** Hermes traces every agent action from input to
output with structured spans, enabling replay and audit.

**Pattern claim:** LIAN's external intake loop could emit trace spans at
each stage boundary (capture, score, extract, signal, experiment, gate,
result), enabling end-to-end audit of how external research became a
merged PR.

**LIAN surface:** Fact event ledger, intake loop stages.

**Applicability:** Direct — LIAN already has fact events; the extension
is structured trace correlation.

### Refly — Knowledge Graph for Research

**External observation:** Refly builds a knowledge graph from research
sources, linking claims to evidence and tracking confidence scores over
time.

**Pattern claim:** LIAN's knowledge ledger could link knowledge entries
to their originating external fact events, creating a traceable chain
from external observation to system-local knowledge.

**LIAN surface:** Knowledge update writer, fact event ledger.

**Applicability:** Partial — LIAN records knowledge entries but does not
explicitly link them back to external source fact IDs.

### AI Papers of the Week — Weekly Paper Digest Intake

**Source:** [`dair-ai/AI-Papers-of-the-Week`](https://github.com/dair-ai/AI-Papers-of-the-Week)

**External observation:** The dair-ai/AI-Papers-of-the-Week repository
publishes a weekly curated list of notable AI research papers with titles,
links, and brief descriptions. Each weekly entry is a structured digest
covering multiple papers across LLM, agent, and ML domains.

**Evidence classification:** This source is classified as
[external-research-sources.md](external-research-sources.md) entry
`ai-papers-weekly`. Each weekly digest is a Tier B `external-doc` —
structured and maintained but not version-pinned to LIAN.

**Weekly paper entry → opportunity signal flow:**

1. **Source Capture (Stage 1):** Each new weekly digest commit produces a
   fact event of type `evidence.intake` with `sourceClass: "external-doc"`
   and `researchCategory: "ai-papers-digest"`. The raw hash covers the
   weekly markdown file.

2. **Evidence Score (Stage 2):** The digest receives a default reliability
   tier of B. Individual papers within the digest are not separately scored
   — the digest is the intake unit. Staleness applies at the weekly level:
   a digest older than 30 days (fast-moving domain) is flagged stale.

3. **Pattern Extract (Stage 3):** A research-intake worker reads the
   weekly digest and extracts LIAN-relevant patterns. Not every paper
   produces a pattern claim — only papers whose techniques map to a LIAN
   surface (`agent orchestration`, `tool use`, `evaluation`, `memory`,
   `planning`) generate extraction output. Papers outside LIAN's scope
   are recorded as observations but produce no pattern claim.

4. **Opportunity Signal (Stage 4):** Pattern claims with `applicability`
   of `direct` or `partial` produce opportunity signals. Each signal
   references the weekly digest fact event ID and carries a falsifiable
   hypothesis.

5. **Gate (Stages 5-7):** Signals pass through the standard agent idea
   review gate and human gate before any task creation.

**Hard boundary:** Weekly paper entries are evidence input only. No paper
or digest may directly create an execution task. All downstream processing
requires the full intake loop: fact event → evidence score → pattern
extraction → opportunity signal → bounded experiment → gate → task.

**Hypothesis example (illustrative):**

> "If LIAN adopts structured evaluation benchmarks for agent tool-use
> (inspired by papers from dair-ai/AI-Papers-of-the-Week week 20),
> then opportunity signal quality will improve because signals will
> carry measurable success criteria derived from peer-reviewed metrics."

---

### Symphony — Multi-Agent Coordination

**External observation:** Symphony coordinates multiple specialized
agents with shared context and explicit handoff protocols.

**Pattern claim:** LIAN's worker dispatch could include explicit handoff
context from the intake loop (pattern extraction output, evidence
reliability scores) in the context bundle, giving workers richer
background for research-originated tasks.

**LIAN surface:** Context bundles, worker dispatch.

**Applicability:** Analogous — LIAN's workers are already specialized by
layer; the extension is richer context passing.

### AutoGen — Conversational Agent Collaboration

**Source:** [`microsoft/autogen`](https://github.com/microsoft/autogen)

**External observation:** AutoGen enables multi-agent collaboration
through structured conversations. Agents negotiate task allocation,
share context through message history, and can request human feedback
at decision points. Supports nested conversations for subtask
decomposition.

**Pattern claim:** LIAN workers currently operate in complete isolation
with no inter-worker communication. The only actionable gap is the lack
of runtime observation sharing — a read-only, append-only observation
log scoped to batches could improve post-batch reconciliation without
violating the isolation model. The structured conversation and
self-organization patterns from AutoGen do not apply because LIAN uses
a central orchestrator for dispatch and maintains strict worktree
isolation.

**LIAN surface:** Worker task contract, context bundles, state
reconciler.

**Applicability:** Partial — the observation log concept adapts to
LIAN's isolation model; the conversation/negotiation patterns conflict
with it.

**Full analysis:** [conversational-agent-collaboration-analysis.md](conversational-agent-collaboration-analysis.md)

---

## Gate Integration

Research opportunity signals pass through two gates before becoming
tasks.

### Gate 1: Agent Idea Review

The standard idea review gate
([agent-idea-review-gate.md](agent-idea-review-gate.md)) evaluates
research signals against the same five criteria: signal quality, novelty,
scope feasibility, architectural fit, and resource availability.

Research-specific additions:

| Criterion | Research Check |
|-----------|---------------|
| Signal quality | Source fact exists and is not stale |
| Novelty | No existing signal covers the same `lianSurface` + `externalProject` pair |
| Scope feasibility | Pattern claim names a specific LIAN surface (not "the whole system") |

### Gate 2: Human Gate

Research signals that touch high-risk, policy, auth/DB/security, or
broad-direction boundaries are blocked for human review
([external-intake-human-gate.md](external-intake-human-gate.md)).

Research-specific human-gate boundary:

| Boundary | Why | Examples |
|----------|-----|----------|
| External project cited as sole authority | No single external source should drive policy | "Refly does it this way, so LIAN must too" |
| Pattern requires new module or domain | Architectural commitment | Adding a new `src/modules/research/**` |
| Hypothesis is unfalsifiable | Cannot be validated by experiment | "This will make LIAN better" |

---

## Hard Boundaries

1. **External research is evidence, not command.** No external project,
   paper, or pattern may directly create an execution task. Tasks require
   a valid opportunity signal, bounded experiment spec, and gate passage.

2. **No verbatim external text in policy.** Pattern claims must be
   synthesized into LIAN vocabulary. External project names appear only
   as traceability references, not as policy authorities.

3. **No external source is sole authority.** Even Tier A evidence from a
   first-party external project must be validated against LIAN's existing
   architecture before influencing policy or code.

4. **Falsifiable hypotheses only.** Every opportunity signal must state
   a hypothesis that can be confirmed or rejected by a bounded experiment.
   Unfalsifiable signals are rejected at the idea review gate.

5. **Bounded experiments only.** Research-originated experiments follow
   the same scoping rules as any other experiment: `allowedFiles`,
   `validationCommands`, success metrics, and rollback plan.

---

## Integration with Knowledge-Driven Scaling

Research intake feeds the knowledge writeback invariant defined in
[knowledge-driven-scaling.md](knowledge-driven-scaling.md):

| Knowledge-Driven Scaling Rule | Research Intake Interaction |
|-------------------------------|----------------------------|
| Knowledge writeback | Accepted research experiments produce knowledge entries linking back to the source fact ID |
| Repeated failure escalation | If the same external pattern is proposed and rejected 3+ times, the system surfaces the rejection reasons for human review |
| Verifiable value | Research-originated tasks must produce verifiable value (merged PR + knowledge entry), not just "explored external pattern" |

---

## Key Files

| Path | Purpose |
|------|---------|
| `.github/ai-state/fact-events.ndjson` | Evidence records for research sources |
| `.github/ai-state/opportunity-signals/` | Per-signal files with research hypothesis |
| `.github/ai-state/knowledge-updates.ndjson` | Accepted research learnings |
| `.github/ai-state/external-facts.ndjson` | External fact ledger (research sources) |

---

## References

- [External Reality Intake](external-reality-intake.md) — Intake boundary contract
- [External Research Sources](external-research-sources.md) — Canonical intake sources registry
- [Evidence Reliability Policy](evidence-reliability-policy.md) — Reliability tiers for external sources
- [External Intake Executable Loop](external-intake-executable-loop.md) — Full intake pipeline stages
- [External Intake Source Matrix](external-intake-source-matrix.md) — Source classification
- [Bounded Experiment Policy](bounded-experiment-policy.md) — Experiment scoping rules
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Idea promotion criteria
- [External Intake Human Gate](external-intake-human-gate.md) — Human review boundaries
- [External Intake Result Writer](external-intake-result-writer.md) — Result recording contract
- [Opportunity Signal Schema](opportunity-signal-schema.md) — Signal fields and lifecycle
- [Knowledge-Driven Scaling](knowledge-driven-scaling.md) — Knowledge writeback invariant
- [Command Steward Agent](command-steward-agent.md) — Human-facing control-plane interface
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
- [Conversational Agent Collaboration Analysis](conversational-agent-collaboration-analysis.md) — AutoGen multi-agent investigation
- [#1213](https://github.com/taoyu051818-sys/lian-nest-server/issues/1213) — This feature
