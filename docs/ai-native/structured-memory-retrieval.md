# Structured Memory Retrieval

Investigates how MemGPT's tiered memory model maps to the AI-native
control plane's existing memory surfaces and proposes a retrieval and
prioritization layer for fact-based decision-making.

> **Closes:** [#1369](https://github.com/taoyu051818-sys/lian-nest-server/issues/1369)
>
> **Source:** Park, J.S. et al. "MemGPT: Towards LLMs as Operating Systems"
> (arXiv:2404.11584). Source reliability: medium. Captured: 2026-05-13.
>
> **Task type:** Research. If this investigation finds no actionable
> improvement, close the issue with a summary of findings.
>
> **See also:**
> [organization-memory-policy.md](organization-memory-policy.md) for
> experiment memory rules,
> [fact-event-ledger.md](fact-event-ledger.md) for the fact event log,
> [external-source-trust-score.md](external-source-trust-score.md) for
> numeric trust scoring,
> [context-bundles.md](context-bundles.md) for worker context assembly,
> [knowledge-driven-scaling.md](knowledge-driven-scaling.md) for the
> scaling invariant.

---

## Background: MemGPT's Tiered Memory

MemGPT introduces a memory architecture inspired by operating system
virtual memory. The agent actively manages its own memory across three
tiers:

| Tier | MemGPT Term | Analogy | Characteristics |
|------|-------------|---------|-----------------|
| **T1** | In-context memory | CPU registers / L1 cache | Small, fast, directly visible to the LLM. The current conversation context. |
| **T2** | Recall memory | RAM / page cache | Full interaction history. Searchable by the agent on demand. Episodic — ordered by time. |
| **T3** | Archival memory | Disk / SSD | Long-term knowledge store. Searchable by semantic similarity or keyword. Semantic — ordered by relevance. |

The agent performs **active memory management**: it decides what to
promote from T2 to T1 (recall into context), what to store in T3
(archive for later), and what to forget. This is the key insight —
the agent is not a passive consumer of a fixed context window; it
is an active memory manager.

---

## Mapping to LIAN's Memory Surfaces

The control plane already has memory surfaces that partially cover
MemGPT's tiers. The gap is in **retrieval and prioritization** —
the "active management" layer.

### Current Memory Surfaces

| Surface | File | Write Pattern | Read Pattern | MemGPT Tier |
|---------|------|---------------|--------------|-------------|
| Fact events | `fact-events.ndjson` | Append-only, one-way | Linear scan or grep | T2 (recall) — raw episodic log |
| Knowledge entries | `knowledge-updates.ndjson` | Append-only, one-way | Linear scan or grep | T3 (archival) — structured learnings |
| Gap events | `gap-ledger.ndjson` | Append-only, one-way | Linear scan or grep | T2 (recall) — deviation log |
| External facts | `external-facts.ndjson` | Append-only, one-way | Linear scan or grep | T3 (archival) — external evidence |
| Context bundles | `bundle-<issue>.json` | Generated per-issue | Direct read | T1 (in-context) — bounded snapshot |
| Meta signals | `meta-signals.json` | Idempotent snapshot | Direct read | T1 (in-context) — aggregate health |

### Gap Analysis

```
MemGPT              LIAN Current           Gap
─────────           ───────────           ────
T1 (in-context)  ←  context bundles       OK — bounded, per-issue
T2 (recall)      ←  fact-events.ndjson    GAP — no retrieval; linear scan only
T3 (archival)    ←  knowledge-updates     GAP — no relevance ranking
                   external-facts         GAP — no cross-ledger search

Active mgmt      ←  (none)               GAP — no agent-side memory management
```

The control plane has **storage** for all three tiers but lacks
**retrieval** for T2 and T3. Facts accumulate in append-only logs;
consumers (planners, context bundles, state reconcilers) must read
the entire log or rely on brittle `grep` patterns. There is no
mechanism to rank stored facts by relevance to the current task.

---

## Current Retrieval Mechanisms

The existing read patterns are:

| Consumer | How It Reads Memory | Limitation |
|----------|-------------------|------------|
| Context bundle generator | Scans `docs/ai-native/` directory listing; includes all docs | No relevance filtering — includes everything or nothing |
| Planning loop | Reads `knowledge-updates.ndjson` linearly; checks tags | No ranking — treats all matching entries equally |
| State reconciler | Reads all four NDJSON ledgers linearly | O(n) scan for every reconciliation cycle |
| Meta signal calculator | Reads `fact-events.ndjson` for last N events | Time-window only; no semantic filtering |
| Gate checks | Read projection files (snapshots) | Projection may be stale relative to ledger |

None of these consumers rank facts by **relevance to the current task**.
The planning loop checks if a rejected experiment exists, but does not
score how relevant it is to the proposed work. The context bundle
generator includes docs by directory scan, not by topic relevance.

---

## Proposed Retrieval Architecture

### Design Principles

1. **Retrieval is a reader concern, not a writer concern.** The append-only
   ledgers stay unchanged. Retrieval is a new read-side layer that
   indexes and ranks existing data.

2. **Relevance is task-scoped.** A fact's relevance depends on the
   current task (issue number, domain tags, affected files). There is
   no global relevance score.

3. **Relevance scoring is deterministic.** No LLM calls in the hot path.
   Scoring uses keyword overlap, tag matching, trust score, and
   recency — all computable from existing fields.

4. **The retrieval layer is optional.** Existing consumers continue to
   work with linear scans. The retrieval layer is an optimization that
   consumers may opt into.

### Three-Tier Retrieval Model

```
                    ┌─────────────────────────┐
                    │   Task Context (T1)      │
                    │   bundle-<issue>.json    │
                    │   meta-signals.json      │
                    └────────────┬────────────┘
                                 │ query
                                 ▼
                    ┌─────────────────────────┐
                    │   Retrieval Layer        │
                    │   (new)                  │
                    │   relevance-scorer       │
                    │   index-builder          │
                    └──────┬──────────┬───────┘
                           │          │
              ┌────────────┘          └────────────┐
              ▼                                    ▼
┌──────────────────────────┐        ┌──────────────────────────┐
│   Recall Index (T2)      │        │   Archival Index (T3)    │
│   fact-events.ndjson     │        │   knowledge-updates      │
│   gap-ledger.ndjson      │        │   external-facts.ndjson  │
│   external-facts.ndjson  │        │                          │
└──────────────────────────┘        └──────────────────────────┘
```

### Relevance Scoring Formula

Each fact receives a relevance score for a given task context:

```
relevance = keywordScore * w1
          + tagScore * w2
          + trustScore * w3
          + recencyScore * w4
          + outcomeScore * w5
```

| Component | Source | Range | Weight | Rationale |
|-----------|--------|-------|--------|-----------|
| `keywordScore` | Jaccard similarity between fact `subject`/`claim` tokens and task issue title/labels | 0-1 | 0.25 | Topical match |
| `tagScore` | Exact match between fact `tags` and task domain tags | 0-1 | 0.20 | Domain alignment |
| `trustScore` | From `external-source-trust-score.md` or `sourceReliability` mapping | 0-1 | 0.20 | Source quality |
| `recencyScore` | `1 / (1 + ageHours/24)` — decays over days | 0-1 | 0.15 | Freshness |
| `outcomeScore` | +1.0 for accepted experiments, -0.5 for rejected, 0 for neutral | mapped to 0-1 | 0.20 | Learning signal |

Default weights (tunable):

| Parameter | Default | Rationale |
|-----------|---------|-----------|
| `w1` (keyword) | 0.25 | Topical match is important but not sufficient alone |
| `w2` (tag) | 0.20 | Domain tags are structured and reliable |
| `w3` (trust) | 0.20 | Source quality should not dominate relevance |
| `w4` (recency) | 0.15 | Recent facts are usually more relevant |
| `w5` (outcome) | 0.20 | Accepted/rejected experiments carry strong signals |

### Retrieval Script Contract

A new script `scripts/ai/retrieve-relevant-facts.js` would:

```
Input:
  --issue <n>              GitHub issue number (for task context)
  --domain <tags>          Comma-separated domain tags
  --limit <n>              Max results (default: 20)
  --minScore <0-1>         Minimum relevance threshold (default: 0.3)
  --ledgers <list>         Which ledgers to search (default: all)
  --dry-run                Print results without side effects (default)

Output:
  JSON array of ranked facts, each with:
    - source: which ledger (fact-events, knowledge, external-facts, gap)
    - entry: the original NDJSON entry
    - relevanceScore: 0-1
    - matchReason: human-readable explanation of score components
```

Example usage:

```bash
# Find facts relevant to issue #1369 about agent memory systems
node scripts/ai/retrieve-relevant-facts.js \
  --issue 1369 \
  --domain "agent-memory,external-intake,retrieval" \
  --limit 10

# Search only knowledge and external-facts ledgers
node scripts/ai/retrieve-relevant-facts.js \
  --issue 1369 \
  --ledgers "knowledge-updates,external-facts" \
  --minScore 0.5
```

### Index Building

Rather than scanning all ledgers on every query, the retrieval layer
builds a lightweight in-memory index:

1. **On first query**, read all NDJSON ledgers and build an inverted
   index mapping tokens (from `subject`, `claim`, `tags`, `eventType`)
   to entry positions.
2. **Cache the index** for the duration of the script invocation.
3. **No persistent index file** — the index is rebuilt each run. This
   avoids stale-index bugs and keeps the system append-only.

For ledgers under 10,000 entries, index build time is negligible
(< 100ms). If ledgers grow beyond that, a persistent index file
could be introduced as a follow-up.

---

## Integration Points

### Context Bundle Generator

The context bundle generator (`generate-context-bundle.js`) currently
includes docs by directory scan. With the retrieval layer, it could
optionally include relevant fact excerpts:

```
Current:  docs/ -> all docs in directory
Proposed: docs/ + top-K relevant facts from ledgers (by issue domain)
```

This would give workers memory-backed context instead of just
documentation context. The bundle would include a new field:

```jsonc
{
  "version": 3,
  "issue": 1369,
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

### Planning Loop

The planning loop (`plan-next-batch.ps1`) currently checks the
knowledge ledger for matching rejected experiments. With the
retrieval layer, it could:

1. Query for relevant accepted experiments (reuse guidance).
2. Query for relevant rejected experiments (anti-patterns).
3. Rank proposed tasks by how much relevant memory exists
   (tasks with more relevant precedent rank higher).

### Organization Memory Policy

The existing `organization-memory-policy.md` defines **what** gets
recorded. This document defines **how** recorded facts are retrieved.
The memory policy's consumption rules ("planner MUST consult memory")
would be fulfilled by the retrieval layer instead of linear scans.

---

## What This Does NOT Change

| Aspect | Status | Rationale |
|--------|--------|-----------|
| Append-only ledgers | Unchanged | Retrieval is a reader concern |
| Writer scripts | Unchanged | No new write paths needed |
| Gate authority | Unchanged | Retrieved facts remain evidence, not commands |
| Sanitization rules | Unchanged | Retrieval reads sanitized data |
| Seed constitution | Unchanged | No new boundaries or authority |
| Trust scoring model | Unchanged | Existing trust scores are consumed as-is |

---

## Feasibility Assessment

### Low-Effort Wins (do first)

1. **Keyword-overlap scorer** — Jaccard similarity on tokenized
   `subject`/`claim` vs. issue title/labels. Pure string ops, no
   dependencies. ~50 lines of JS.

2. **Tag-match scorer** — Exact set intersection between fact `tags`
   and task domain tags. Trivial.

3. **Recency decay** — `1 / (1 + ageHours/24)`. One line.

These three alone would give the planning loop and context bundle
generator a ranked view of relevant facts. No LLM calls, no
external dependencies, no schema changes.

### Medium-Effort Improvements (do next)

4. **Cross-ledger unified index** — Build a single index across
   all four NDJSON ledgers. Requires reading ~4 files and merging
   token maps. ~100 lines of JS.

5. **Outcome-aware scoring** — Parse knowledge entry tags to detect
   `experiment,accepted` vs. `experiment,rejected` and apply the
   outcome score modifier.

6. **Context bundle integration** — Add `relevantFacts` field to
   bundle manifest. Requires modifying `generate-context-bundle.js`.

### Higher-Effort Possibilities (defer)

7. **Semantic similarity** — Use embeddings for fact-to-task
   similarity. Requires an embedding model or API. High complexity,
   unclear ROI given the structured nature of the facts.

8. **Agent-managed memory** — Give the agent explicit memory
   management tools (store, retrieve, forget). This is the full
   MemGPT model but requires significant orchestration changes.

9. **Persistent index** — Write an index file alongside ledgers
   for faster repeated queries. Only needed if ledgers exceed
   10K entries.

---

## Recommendation

**Actionable:** Implement the low-effort scoring components (keyword,
tag, recency) as a `retrieve-relevant-facts.js` script. Integrate
it with the context bundle generator to give workers memory-backed
context. This closes the gap between "facts exist" and "facts are
found when relevant" without changing any write paths, schemas, or
governance boundaries.

**Deferred:** Semantic similarity and agent-managed memory are
interesting but add complexity that is not justified by the current
ledger sizes (hundreds of entries, not millions). Revisit if ledgers
grow beyond 10K entries or if workers report memory-related failures.

**Not recommended:** Building a persistent index or embedding-based
retrieval at this stage. The append-only, rebuild-per-query model
is simpler, safer, and sufficient for current scale.

---

## References

- Park, J.S. et al. "MemGPT: Towards LLMs as Operating Systems"
  arXiv:2404.11584 (2024)
- [Organization Memory Policy](organization-memory-policy.md)
- [Fact Event Ledger](fact-event-ledger.md)
- [Knowledge Update Writer](knowledge-update-writer.md)
- [External Facts Schema](external-facts-schema.md)
- [External Source Trust Score](external-source-trust-score.md)
- [Context Bundles](context-bundles.md)
- [Context Bundle Fact Projection](context-bundle-fact-projection.md)
- [Knowledge-Driven Scaling](knowledge-driven-scaling.md)
- [Gap Ledger](gap-ledger.md)
- [Meta Signals](meta-signals.md)
- [Planning Loop](planning-loop.md)
