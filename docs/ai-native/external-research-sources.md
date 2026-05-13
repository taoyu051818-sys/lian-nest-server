# External Research Sources

Registry of canonical external research intake sources. Each source
defines how external research enters the AI-native control plane as
evidence-backed opportunities — never as direct execution commands.

> **Closes:** [#1218](https://github.com/taoyu051818-sys/lian-nest-server/issues/1218)
>
> **See also:**
> [external-research-intake-loop.md](external-research-intake-loop.md)
> for the full intake loop,
> [evidence-reliability-policy.md](evidence-reliability-policy.md) for
> reliability tiers.

---

## Source Registry

| Source ID | Name | URL | Source Class | Default Tier | Research Category | Intake Cadence |
|-----------|------|-----|:------------:|:------------:|-------------------|----------------|
| `ai-papers-weekly` | dair-ai/AI-Papers-of-the-Week | [GitHub](https://github.com/dair-ai/AI-Papers-of-the-Week) | `external-doc` | B | `ai-papers-digest` | Weekly (per digest commit) |
| `crewai` | CrewAI | [GitHub](https://github.com/crewAIInc/crewAI) | `external-doc` | B | `agent-pattern` | Per-investigation (ad-hoc) |

---

## Source: ai-papers-weekly

### Identity

- **Repository:** [dair-ai/AI-Papers-of-the-Week](https://github.com/dair-ai/AI-Papers-of-the-Week)
- **Local research clone:** `F:\26.3.13\lian-current\external-agent-research\AI-Papers-of-the-Week`
- **Source class:** `external-doc` — structured and maintained but not
  version-pinned to LIAN
- **Default reliability tier:** B
- **Research category:** `ai-papers-digest`

### Scope

This source provides weekly curated lists of notable AI research papers
covering LLM, agent, evaluation, tool use, memory, and planning domains.
Each weekly digest is the intake unit — individual papers within a digest
are not separately captured as fact events.

### Intake Boundary

This source is evidence input only. Weekly paper entries follow the full
intake loop defined in
[external-research-intake-loop.md](external-research-intake-loop.md):

1. Source Capture → fact event (`evidence.intake`)
2. Evidence Score → Tier B with 30-day staleness window
3. Pattern Extract → LIAN-specific pattern claims (not all papers produce claims)
4. Opportunity Signal → falsifiable hypothesis with experiment spec
5. Bounded Experiment → scoped, gated
6. Gate → agent idea review + human gate
7. Result Writer → knowledge entry

No paper or digest may directly create an execution task.

### Staleness

Weekly digests use the fast-moving domain staleness window (30 days). A
digest older than 30 days with no version pin is flagged stale at the
evidence scoring stage.

### Fact Event Shape

```bash
node scripts/ai/write-fact-event.js \
  --type evidence.intake \
  --subject "AI Papers of the Week — Week N" \
  --actor "research-intake" \
  --live \
  --facts '{
    "sourceClass":"external-doc",
    "sourceUrl":"https://github.com/dair-ai/AI-Papers-of-the-Week/blob/main/week-N.md",
    "reliabilityTier":"B",
    "rawHash":"<sha256-of-weekly-file>",
    "researchCategory":"ai-papers-digest"
  }'
```

### Pattern Extraction Scope

Only papers whose techniques map to a LIAN surface produce pattern claims:

| LIAN Surface | Example Paper Topics |
|--------------|---------------------|
| Agent orchestration | Multi-agent coordination, tool routing |
| Tool use | Structured tool definitions, function calling |
| Evaluation | Benchmarks, metrics, scoring |
| Memory | Context management, retrieval |
| Planning | Task decomposition, reasoning chains |

Papers outside these surfaces are recorded as observations but produce
no pattern claim and no opportunity signal.

### Hypothesis Template

> "If LIAN adopts **[specific technique]** from **[paper title]**
> (via dair-ai/AI-Papers-of-the-Week), then **[measurable outcome]**
> will improve because **[mechanism]**."

---

## Source: crewai

### Identity

- **Repository:** [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI)
- **Source class:** `external-doc` — structured and maintained but not
  version-pinned to LIAN
- **Default reliability tier:** B
- **Research category:** `agent-pattern`

### Scope

CrewAI is a multi-agent orchestration framework that assigns agents
specific roles (researcher, writer, reviewer) with explicit delegation
chains. A manager agent can delegate subtasks to specialized agents,
each with their own tools and constraints. Supports sequential,
parallel, and hierarchical execution modes.

### Intake Boundary

This source is evidence input only. CrewAI patterns follow the full
intake loop. See
[delegation-and-oversight-investigation.md](delegation-and-oversight-investigation.md)
for the initial investigation result.

### Pattern Extraction Scope

Only CrewAI patterns that map to a LIAN surface produce pattern claims:

| LIAN Surface | CrewAI Pattern |
|--------------|---------------|
| Worker dispatch | Role-based agent assignment |
| Task decomposition | Manager delegation chains |
| Parallel execution | Sequential/parallel/hierarchical process modes |
| Tool scoping | Per-agent tool restrictions |
| Orchestrator | Crew lifecycle management |

---

## Adding New Sources

To register a new external research source:

1. Add a row to the Source Registry table above.
2. Add a source-specific section below with identity, scope, intake
   boundary, staleness rules, and fact event shape.
3. Update
   [external-research-intake-loop.md](external-research-intake-loop.md)
   to add a research example showing the source's pattern extraction flow.
4. Ensure the source does not claim execution authority — all sources are
   evidence input only.

---

## References

- [External Research Intake Loop](external-research-intake-loop.md) — Full intake loop stages
- [Evidence Reliability Policy](evidence-reliability-policy.md) — Reliability tiers for external sources
- [External Reality Intake](external-reality-intake.md) — Intake boundary contract
- [Bounded Experiment Policy](bounded-experiment-policy.md) — Experiment scoping rules
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Idea promotion criteria
- [#1218](https://github.com/taoyu051818-sys/lian-nest-server/issues/1218) — This registration
