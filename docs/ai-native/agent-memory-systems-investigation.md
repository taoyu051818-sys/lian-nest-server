# Agent Memory Systems Investigation

Investigates how MemGPT's tiered memory architecture applies to the
AI-native control plane and identifies concrete improvements to
fact retrieval and prioritization for issue production and worker
dispatch.

> **Closes:** [#1434](https://github.com/taoyu051818-sys/lian-nest-server/issues/1434)
>
> **Source:** Packer et al. "MemGPT: Towards LLMs as Operating Systems"
> (arXiv:2404.11584). Source reliability: medium. Captured: 2026-05-13.
>
> **Task type:** Research. If this investigation finds no actionable
> improvement, close the issue with a summary of findings.
>
> **See also:**
> [organization-memory-policy.md](organization-memory-policy.md) for
> experiment memory rules,
> [external-source-trust-score.md](external-source-trust-score.md) for
> numeric trust scoring,
> [context-bundles.md](context-bundles.md) for worker context assembly.

---

## MemGPT Core Concepts

MemGPT treats an LLM agent like a process with virtual memory. Three
tiers manage information flow:

| Tier | MemGPT Term | Role | Size | Access |
|------|-------------|------|------|--------|
| **T1** | In-context memory | Working memory visible to the LLM | Small (context window) | Direct |
| **T2** | Recall memory | Full interaction history, searchable | Medium (grows with conversation) | On-demand search |
| **T3** | Archival memory | Long-term knowledge, semantic search | Large (persistent) | Similarity or keyword search |

The agent actively decides what to promote from T2 to T1, what to
store in T3, and what to forget. This "active management" is the
key insight — the agent is not a passive consumer of fixed context.

---

## Current LIAN Memory Surfaces

The control plane has six memory surfaces that map partially to
MemGPT's tiers:

| Surface | File | MemGPT Tier | Read Pattern |
|---------|------|-------------|--------------|
| Context bundles | `bundle-<issue>.json` | T1 | Direct — per-issue manifest |
| Meta signals | `meta-signals.json` | T1 | Direct — aggregate health snapshot |
| Fact events | `fact-events.ndjson` | T2 | Linear scan or grep |
| Gap events | `gap-ledger.ndjson` | T2 | Linear scan or grep |
| Knowledge updates | `knowledge-updates.ndjson` | T3 | Linear scan or grep |
| External facts | `external-facts.ndjson` | T3 | Linear scan or grep |

The existing external fact from the MemGPT paper (entry 8 in
`external-facts.ndjson`) captures the core observation:

> "LIAN meta-signals.json and fact-events.ndjson provide raw memory
> but no retrieval or prioritization layer."

---

## Gap Analysis

### What Works

- **T1 coverage is adequate.** Context bundles give workers a bounded
  snapshot of docs, schemas, policies, and state. Meta signals provide
  aggregate health. Both are read directly — no retrieval needed.

- **Storage exists for T2 and T3.** Four NDJSON ledgers accumulate
  facts, events, knowledge, and gaps. The append-only pattern is
  simple and safe.

- **Organization memory policy defines write rules.** Experiments
  must record outcomes. Rejected approaches become anti-patterns.
  Accepted approaches become precedent.

### What Is Missing

| Gap | Impact | Severity |
|-----|--------|----------|
| No retrieval layer for T2/T3 | Consumers must scan entire ledgers or use brittle grep | High |
| No relevance ranking | All matching facts treated equally; no task-scoped scoring | High |
| No cross-ledger search | Finding "all facts about auth" requires grepping 4 files | Medium |
| No staleness enforcement | `expiresAt` on external facts is advisory only | Medium |
| No agent-side memory management | Workers are stateless between invocations | Low (defer) |
| No tags on fact-events or gap-ledger | Cannot filter by domain on two of four ledgers | Low |

### What This Changes (and What It Does Not)

| Aspect | Status | Rationale |
|--------|--------|-----------|
| Append-only ledgers | **Unchanged** | Retrieval is a reader concern |
| Writer scripts | **Unchanged** | No new write paths |
| Gate authority | **Unchanged** | Retrieved facts remain evidence, not commands |
| Schemas | **Unchanged** | No schema modifications needed for retrieval |
| Seed constitution | **Unchanged** | No new boundaries |

---

## Proposed Improvements

### Priority 1: Retrieval Script (Low Effort, High Impact)

Implement `scripts/ai/retrieve-relevant-facts.js` — a read-only
script that scores facts across all ledgers by relevance to a given
task context.

**Relevance formula** (deterministic, no LLM calls):

```
relevance = keywordScore * 0.25
          + tagScore * 0.20
          + trustScore * 0.20
          + recencyScore * 0.15
          + outcomeScore * 0.20
```

| Component | Source | Computation |
|-----------|--------|-------------|
| `keywordScore` | Fact `subject`/`claim` vs. issue title/labels | Jaccard similarity on tokenized text |
| `tagScore` | Fact `tags` vs. task domain tags | Exact set intersection |
| `trustScore` | `sourceReliability` or `reliabilityTier` | Mapped: verified=1.0, observed=0.75, reported=0.5, rumor=0.25 |
| `recencyScore` | `capturedAt` timestamp | `1 / (1 + ageHours/24)` |
| `outcomeScore` | Knowledge entry tags | accepted=1.0, rejected=-0.5, neutral=0.5 |

**Contract:**

```
Input:
  --issue <n>              Issue number for task context
  --domain <tags>          Comma-separated domain tags
  --limit <n>              Max results (default: 20)
  --minScore <0-1>         Relevance threshold (default: 0.3)
  --ledgers <list>         Which ledgers to search (default: all)

Output:
  JSON array of ranked facts, each with:
    - source: ledger name
    - entry: original NDJSON entry
    - relevanceScore: 0-1
    - matchReason: human-readable score breakdown
```

### Priority 2: Context Bundle Integration (Medium Effort)

Extend `generate-context-bundle.js` to include relevant facts in
the bundle manifest. Workers would receive memory-backed context
instead of just documentation context.

New field in bundle manifest (version 3):

```jsonc
{
  "version": 3,
  "relevantFacts": [
    {
      "source": "knowledge-updates",
      "entry": { /* original entry */ },
      "relevanceScore": 0.82,
      "matchReason": "tag match: agent-memory; keyword: retrieval"
    }
  ]
}
```

### Priority 3: Planning Loop Integration (Medium Effort)

The planning loop (`plan-next-batch.ps1`) currently checks the
knowledge ledger linearly for rejected experiments. With the
retrieval layer, it could:

1. Query for relevant accepted experiments (reuse guidance).
2. Query for relevant rejected experiments (anti-patterns).
3. Rank proposed tasks by how much relevant precedent exists.

### Deferred: Agent-Managed Memory

Full MemGPT-style active memory management (store, retrieve, forget
tools) requires significant orchestration changes. Not justified at
current ledger scale (hundreds of entries). Revisit if ledgers grow
beyond 10K entries or if workers report memory-related failures.

---

## Current State Assessment

| Criterion | Status | Evidence |
|-----------|--------|----------|
| MemGPT source ingested | Done | External fact entry 8 in `external-facts.ndjson` |
| Organization memory policy | Done | `organization-memory-policy.md` |
| Retrieval design documented | Done | This doc (below) |
| Retrieval script implemented | **Not done** | `retrieve-relevant-facts.js` does not exist |
| Context bundle integration | **Not done** | `generate-context-bundle.js` still uses directory scan only |
| Planning loop integration | **Not done** | `plan-next-batch.ps1` still uses linear scan |

---

## Recommendation

The gap is **implementation**, not design. The proposed retrieval
architecture above (relevance scoring, cross-ledger search, context
bundle integration) is well-defined. Concrete next steps:

1. **Implement `scripts/ai/retrieve-relevant-facts.js`** following
   the contract defined in the Proposed Improvements section above.
   This is the highest-value, lowest-effort change.

2. **Add a `relevantFacts` field** to context bundle manifest v3
   by integrating the retrieval script into
   `generate-context-bundle.js`.

3. **Wire the retrieval script** into `plan-next-batch.ps1` so the
   planning loop consults ranked memory before proposing tasks.

These three changes close the gap between "facts exist in ledgers"
and "facts are found when relevant" without modifying any write
paths, schemas, or governance boundaries.

---

## References

- Packer et al. "MemGPT: Towards LLMs as Operating Systems"
  arXiv:2404.11584 (2024)
- [Organization Memory Policy](organization-memory-policy.md) —
  experiment memory rules
- [Fact Event Ledger](fact-event-ledger.md) — episodic event log
- [Knowledge Update Writer](knowledge-update-writer.md) — PR-merge
  knowledge ledger
- [External Facts Schema](external-facts-schema.md) — external
  evidence schema
- [External Source Trust Score](external-source-trust-score.md) —
  numeric trust scoring
- [Context Bundles](context-bundles.md) — worker context assembly
- [Gap Ledger](gap-ledger.md) — deviation event log
- [Meta Signals](meta-signals.md) — aggregate health signals
