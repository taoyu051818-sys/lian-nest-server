# External Intake Docs Authority

Maps source-of-truth ownership for external intake documentation.
Prevents duplicate truth sources and guides workers to the correct
canonical doc for each intake sub-topic.

> **Closes:** [#951](https://github.com/taoyu051818-sys/lian-nest-server/issues/951)
> **See also:** [docs-authority-map.md](docs-authority-map.md) for
> folder-level authority, [external-reality-intake.md](external-reality-intake.md)
> for the intake flow itself.

---

## Source Docs

| Doc | Canonical For | Authority Level | Mutability |
|-----|---------------|-----------------|------------|
| [external-reality-intake.md](external-reality-intake.md) | Source classification, evidence scoring, sanitization rules, reliability tiers, prompt-injection boundaries | **Canonical** for intake flow | Stable; changes require repo-owner approval |
| [agent-idea-review-gate.md](agent-idea-review-gate.md) | Idea promotion criteria, novelty checks, scope feasibility, architectural fit | **Canonical** for idea review decisions | Stable; changes require repo-owner approval |
| [fact-event-ledger.md](fact-event-ledger.md) | Append-only event log schema, `evidence.*` event types | **Canonical** for evidence persistence | Append-only schema; new event types require architect review |
| [knowledge-update-writer.md](knowledge-update-writer.md) | Promoted evidence capture as structured knowledge entries | **Canonical** for knowledge promotion | Stable; changes require repo-owner approval |
| [context-bundles.md](context-bundles.md) | How evidence reaches workers in context bundles | **Canonical** for worker evidence delivery | Stable; changes require repo-owner approval |
| [seed-constitution.md](seed-constitution.md) | Immutable boundaries the intake layer enforces | **Constitutional** — overrides all other docs | Immutable; requires full governance review |

---

## Topic Ownership Matrix

Each external-intake sub-topic has exactly one canonical source.
Workers MUST read the canonical doc; other docs may reference the topic
but must defer to the canonical source on conflicts.

| Topic | Canonical Source | Secondary References |
|-------|-----------------|---------------------|
| Source class definitions | `external-reality-intake.md` § Source Classes | — |
| Reliability tier matrix | `external-reality-intake.md` § Evidence Intake Flow | — |
| Sanitization patterns | `external-reality-intake.md` § Step 4: Sanitize | — |
| Prompt-injection boundaries | `external-reality-intake.md` § Prompt-Injection Boundaries | — |
| Evidence intake pipeline | `external-reality-intake.md` § Evidence Intake Flow | `context-bundles.md` (delivery side) |
| Fact event recording | `fact-event-ledger.md` | `external-reality-intake.md` § Fact Log Outputs (overview) |
| Idea review gate criteria | `agent-idea-review-gate.md` § Gate Criteria | — |
| Gate decision matrix | `agent-idea-review-gate.md` § Decision Matrix | — |
| Promotion to issue | `agent-idea-review-gate.md` § Evaluation Workflow | `SOP.md` (lifecycle overview) |
| Knowledge promotion from evidence | `knowledge-update-writer.md` | `external-reality-intake.md` § Integration Points |
| Worker evidence consumption | `context-bundles.md` | `external-reality-intake.md` § Worker Guidance |
| Constitutional boundaries | `seed-constitution.md` | `external-reality-intake.md` § Hard Rules (enforcement details) |

---

## Duplicate Avoidance Rules

1. **Intake flow vs. gate decisions.** `external-reality-intake.md` governs
   how evidence enters the system. `agent-idea-review-gate.md` governs how
   ideas are evaluated after evidence is available. Do not duplicate gate
   criteria in the intake doc or intake rules in the gate doc.

2. **Fact events vs. knowledge entries.** `fact-event-ledger.md` owns raw
   evidence records. `knowledge-update-writer.md` owns promoted knowledge.
   The intake doc describes *when* events are created; the ledger doc
   describes *how* they are stored.

3. **Constitutional vs. enforcement.** `seed-constitution.md` states
   immutable rules. `external-reality-intake.md` implements enforcement
   details. If a new hard rule is needed, add the principle to the
   constitution and the enforcement to the intake doc.

4. **Worker guidance.** `external-reality-intake.md` § Worker Guidance
   covers how workers handle evidence. `context-bundles.md` covers how
   evidence is delivered. Keep these separate — do not merge delivery
   logic into guidance or vice versa.

---

## Integration With Folder Authority

This map is scoped to `docs/ai-native/`. The parent
[docs-authority-map.md](docs-authority-map.md) assigns `docs/ai-native/`
as the **Governance** folder for process docs. All docs listed here are
governance docs under that authority.

If an external intake topic requires a contract or architecture doc
(e.g., an API schema for the intake endpoint), that doc belongs in
`docs/contracts/` or `docs/architecture/` respectively — not here.

---

## References

- [Docs Authority Map](docs-authority-map.md) — Folder-level authority and worker context selection
- [External Reality Intake](external-reality-intake.md) — Intake flow, classification, and sanitization
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Idea promotion criteria and workflow
- [Fact Event Ledger](fact-event-ledger.md) — Append-only evidence log
- [Knowledge Update Writer](knowledge-update-writer.md) — Structured knowledge capture
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
