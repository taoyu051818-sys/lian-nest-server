# Tiered Memory System: MemGPT Architecture Applied to LIAN

> **Closes:** [#1441](https://github.com/taoyu051818-sys/lian-nest-server/issues/1441)
>
> **Source:** MemGPT / Letta — `letta/schemas/memory.py`
>
> **Source reliability:** authoritative
>
> **See also:**
> [reflexion-investigation.md](reflexion-investigation.md) for
> failure self-critique patterns,
> [context-bundles.md](context-bundles.md) for worker context assembly,
> [organization-memory-policy.md](organization-memory-policy.md) for
> experiment memory rules,
> [gap-ledger.md](gap-ledger.md) for friction tracking,
> [knowledge-update-writer.md](knowledge-update-writer.md) for
> PR-merge knowledge sedimentation,
> [external-research-intake-loop.md](external-research-intake-loop.md)
> for how external research enters the system.

---

## Summary

MemGPT implements a 3-tier memory architecture where the agent actively
manages what enters its working context, what persists in episodic recall,
and what sits in long-term archival storage. The agent self-edits memory
blocks between turns — it decides what to remember, what to forget, and
what to retrieve.

LIAN workers are stateless between invocations. Each worker gets a fresh
task contract with no memory of prior tasks, learned patterns, or failure
reflections. This document maps MemGPT's tiered model onto LIAN's existing
memory surfaces, identifies what already exists, what is missing, and
proposes concrete bounded improvements.

**Key finding:** LIAN already has the raw materials for all three tiers
(gap ledger reflections, knowledge updates, NDJSON ledgers) but lacks the
**retrieval and injection layer** that makes memory useful. The agent cannot
actively manage its own memory because workers have no mechanism to query
past learnings or write back new ones during execution.

---

## MemGPT's 3-Tier Memory Model

| Tier | Name | MemGPT Implementation | Characteristics |
|------|------|----------------------|-----------------|
| **1** | In-context (working) | Main context window, system prompt | Fits in prompt; self-editing memory blocks; agent can rewrite between turns |
| **2** | Recall (episodic) | Conversation history, searchable by recency/relevance | Full interaction log; queryable by semantic search; sliding window |
| **3** | Archival (long-term) | External vector store, semantic search | Persistent across sessions; agent decides what to store and retrieve |

### Active Memory Management

MemGPT's distinguishing feature is that the **agent decides** what to do
with memory. Between turns, the agent can:

- **Store** a new fact or observation into archival memory
- **Retrieve** a specific memory from recall or archival into working context
- **Forget** stale or irrelevant entries from working memory
- **Rewrite** its own working memory blocks (self-editing)

This is not passive storage — it is an agent-driven memory management
loop where the LLM uses tool calls to manage its own context.

---

## LIAN's Current Memory Surface (Mapped to MemGPT Tiers)

### Tier 1: In-Context (Working Memory)

| LIAN Component | MemGPT Equivalent | Status |
|---------------|-------------------|--------|
| Task JSON contract | System prompt metadata | Present but minimal — `sourceIssue`, `knowledgeRefs`, `promptHandoff` |
| Context bundle manifest | Memory block index | Present — flat file listing, not relevance-filtered |
| Issue body (read at runtime) | Primary working memory | Present — workers read the GitHub issue for semantic content |
| `allowedFiles`, `validationCommands` | Tool definitions | Present — bounded execution contract |

**Gap:** Workers cannot self-edit their working memory. The task JSON
contract is immutable once dispatched. A worker that discovers relevant
context mid-execution cannot update its own memory block or request
additional context.

### Tier 2: Recall (Episodic Memory)

| LIAN Component | MemGPT Equivalent | Status |
|---------------|-------------------|--------|
| Gap ledger reflections | Verbal self-critiques | Present — structured reflections stored in `meta.reflection` |
| Fact event ledger | Interaction log | Present — append-only NDJSON of all observable events |
| Task ledger | Task history | Present — task lifecycle events |

**Gap:** No retrieval mechanism. The gap ledger stores reflections but
there is no script or API that a worker can call to retrieve "what did I
learn from the last time this error class fired?" The reflexion
investigation (issue #1366) explicitly identified this gap. Reflections
are written but not read by workers.

### Tier 3: Archival (Long-Term Memory)

| LIAN Component | MemGPT Equivalent | Status |
|---------------|-------------------|--------|
| Knowledge updates ledger | Long-term facts | Present — structured knowledge from merged PRs |
| External facts ledger | External evidence | Present — scored and sanitized external observations |
| Experiment outcomes (org memory policy) | Decision precedents | Present — accepted/rejected/inconclusive experiments |

**Gap:** Knowledge sedimentation is post-hoc. Knowledge is recorded after
a PR merges, not during execution. A worker cannot benefit from knowledge
generated by a parallel worker in the same batch. There is no semantic
search over the knowledge ledger — workers must know which file to read.

---

## Gaps Analysis

### Gap 1: No Retrieval Layer (Critical)

**What MemGPT has:** The agent can call `archival_memory_search(query)` and
`conversation_search(query)` to retrieve relevant memories on demand.

**What LIAN lacks:** Workers have no tool or script to query the gap
ledger, knowledge ledger, or fact event ledger by topic, error class, or
domain. The context bundle lists file paths but does not extract relevant
entries.

**Impact:** Workers repeat known failures. The gap ledger records
reflections but workers never see them. Knowledge entries accumulate but
do not influence worker behavior.

**Bounded fix:** Add a `query-worker-memory.js` script that accepts a
domain keyword or error class and returns the last N relevant entries
from the gap ledger, knowledge ledger, and fact event ledger. Workers
invoke this script at task start to populate their working context.

### Gap 2: No Worker Writeback During Execution

**What MemGPT has:** The agent can write to archival memory at any time
via `archival_memory_insert(content)`.

**What LIAN lacks:** Workers cannot write to any ledger during execution.
Knowledge is only written post-merge by `write-knowledge-update.ps1`.
There is no mechanism for a worker to record a mid-task observation,
pattern, or learning.

**Impact:** Insights discovered during execution are lost unless they
happen to appear in the PR body. Parallel workers cannot share discoveries
within a batch.

**Bounded fix:** Allow workers to call `write-result-fact.js` with a new
event type `worker.observation` during execution. Observations are
recorded in the fact event ledger and become queryable by other workers
in the same batch.

### Gap 3: Context Bundles Are Not Relevance-Filtered

**What MemGPT has:** Working memory is small and curated. The agent
decides what enters and what is evicted.

**What LIAN lacks:** The context bundle generator enumerates ALL files
in the scan directories. Workers receive a manifest of hundreds of
file paths and must decide what is relevant — wasting context window
space and increasing the risk of missing critical files.

**Impact:** Workers may read irrelevant docs or miss critical ones. The
context bundle is a flat index, not a relevance-ranked shortlist.

**Bounded fix:** Add keyword-based filtering to `generate-context-bundle.js`.
When an issue body contains identifiable keywords (e.g., "provider",
"health-gate", "gap-ledger"), filter the manifest to include only
docs and schemas whose filenames or first-line descriptions match.

### Gap 4: No Cross-Worker Communication Within a Batch

**What MemGPT has:** Single-agent architecture — not directly applicable.
But MemGPT's self-editing memory means the agent's learnings persist
across turns within a session.

**What LIAN lacks:** Workers in the same batch are fully isolated. If
worker A discovers a pattern relevant to worker B's task, there is no
propagation mechanism.

**Impact:** Redundant discovery. Parallel workers solving related problems
may independently reach the same conclusions.

**Bounded fix:** Use the fact event ledger as a shared communication
channel. Workers write `worker.observation` events; the context bundle
generator includes recent observations from the same batch in the
manifest for subsequent workers.

### Gap 5: No Memory Eviction or Prioritization

**What MemGPT has:** The agent actively manages memory size. It can
summarize, compress, or evict entries to stay within context limits.

**What LIAN lacks:** The gap ledger, knowledge ledger, and fact event
ledger are append-only. There is no eviction, summarization, or
prioritization. Entries older than the retrieval window (last 5 per
error class) are effectively dead but consume storage.

**Impact:** Low — NDJSON files are small. But as the system matures,
unbounded growth will require attention.

**Bounded fix:** Not urgent. Document a staleness threshold (e.g.,
entries older than 90 days are excluded from retrieval queries) and
implement it in the retrieval script, not in the ledgers themselves.

---

## What Already Works

Before proposing changes, it is important to acknowledge what LIAN already
has that maps well to MemGPT's architecture:

| MemGPT Concept | LIAN Equivalent | Quality |
|---------------|-----------------|---------|
| Episodic memory (reflections) | Gap ledger `meta.reflection` | High — structured, deterministic, backward-compatible |
| Long-term facts | Knowledge updates ledger | High — structured, tagged, linked to PRs |
| External evidence | External facts + intake loop | High — scored, sanitized, gated |
| Experiment memory | Organization memory policy | High — all outcomes recorded, anti-patterns tracked |
| Memory boundaries | Seed constitution, injection rules | High — external text never a command |

The missing piece is not storage — it is **retrieval and injection**. The
ledgers exist; the agent cannot query them.

---

## Actionable Recommendations

### Priority 1: Worker Memory Retrieval Script

**What:** Create `scripts/ai/query-worker-memory.js` that accepts a
domain keyword or error class and returns relevant entries from the
gap ledger, knowledge ledger, and fact event ledger.

**Interface:**
```bash
node scripts/ai/query-worker-memory.js \
  --domain "provider-pool" \
  --error-class "TASK_CONTRACT_INVALID" \
  --limit 5 \
  --tier all
```

**Output:** JSON array of relevant memory entries, ranked by recency,
with source ledger annotation.

**Effort:** Low. Reuses existing NDJSON file reading patterns from
`write-gap-ledger.js` and `write-fact-event.js`.

**Validation:** Script runs without error on the existing ledger files.
Returns relevant entries for a known domain keyword.

### Priority 2: Worker Observation Writeback

**What:** Extend `write-result-fact.js` to support a `worker.observation`
event type that workers can call during execution.

**Interface:**
```bash
node scripts/ai/write-result-fact.js \
  --type "worker.observation" \
  --subject "discovered pattern in provider rotation" \
  --actor "worker-abc123" \
  --live \
  --facts '{"domain":"provider-pool","insight":"retry logic ignores health state","batchId":"batch-xyz"}'
```

**Effort:** Low. The `write-result-fact.js` script already supports
arbitrary event types. This adds a convention for worker observations.

**Validation:** Script runs without error. Observation appears in
`fact-events.ndjson` and is queryable by `query-worker-memory.js`.

### Priority 3: Context Bundle Keyword Filtering

**What:** Add optional `--keywords` flag to `generate-context-bundle.js`
that filters the manifest to files matching the provided keywords.

**Interface:**
```bash
node scripts/ai/generate-context-bundle.js \
  --keywords "provider,health-gate,rotation" \
  --output .github/ai-state/context-bundles/bundle-xyz.json
```

**Effort:** Low. The generator already iterates over files. Adding a
filter step is a few lines of code.

**Validation:** Filtered bundle contains only matching files. Unfiltered
bundle is unchanged (backward-compatible).

### Priority 4: Batch-Aware Context Enrichment

**What:** Extend `generate-context-bundle.js` to include recent
`worker.observation` events from the same batch ID in the context
bundle manifest.

**Effort:** Medium. Requires the generator to read the fact event
ledger and filter by batch ID.

**Validation:** Context bundle for a worker in batch X includes
observations from other workers in the same batch.

---

## What This Does NOT Propose

- **No vector embeddings or semantic search.** LIAN's memory is
  structured NDJSON with keyword matching. Semantic search is a
  future optimization, not a prerequisite.
- **No new file formats.** All recommendations reuse existing NDJSON
  ledgers and script patterns.
- **No changes to worker dispatch or orchestration.** Memory retrieval
  is opt-in — workers call the retrieval script if they choose to.
- **No LLM-generated memory entries.** Worker observations are
  structured data, not free-form text. This avoids hallucination in
  memory entries.
- **No memory eviction or compaction.** Append-only ledgers with
  retrieval-side staleness filtering. Compaction is a future concern.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Worker observations could leak sensitive context | Medium | Observations go through the same sanitization as fact events. No tokens, no credentials, no raw error text. |
| Retrieval script adds latency to worker startup | Low | NDJSON grep is fast. Script returns in <100ms for ledgers under 10MB. |
| Workers could abuse writeback to inject instructions | Medium | Injection pattern detection applies. Observations are evidence, not commands. Human gate reviews batch observations. |
| Context bundle filtering could exclude critical docs | Low | Filtering is additive — unfiltered bundle remains the fallback. Workers can still read any file. |
| Over-engineering for a low-traffic system | Low | All recommendations reuse existing infrastructure. No new modules, no new schemas, no new orchestrators. |

---

## Tier Classification

| Property | Value |
|----------|-------|
| Tier | 1 — Extension |
| Blast radius | Local — enriches existing ledgers and context bundles |
| Amendment authority | Human-authored PR |
| Enforcement | Context bundle generator, worker scripts (opt-in) |
| Escape hatch | Remove retrieval script; ledgers remain valid without it |

---

## Implementation Order

1. `query-worker-memory.js` — retrieval layer (highest impact, lowest effort)
2. `worker.observation` event type in `write-result-fact.js` — writeback
3. `--keywords` flag in `generate-context-bundle.js` — relevance filtering
4. Batch-aware context enrichment — cross-worker communication

Each step is independently deployable and backward-compatible. Steps 1-2
can ship in a single PR. Steps 3-4 can follow in a separate PR.

---

## References

- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560) — Packer et al., 2023
- [Reflexion Investigation](reflexion-investigation.md) — Failure self-critique patterns
- [Context Bundles](context-bundles.md) — Worker context assembly
- [Organization Memory Policy](organization-memory-policy.md) — Experiment memory rules
- [Gap Ledger](gap-ledger.md) — Friction tracking
- [Knowledge Update Writer](knowledge-update-writer.md) — PR-merge knowledge sedimentation
- [External Research Intake Loop](external-research-intake-loop.md) — How external research enters the system
- [Fact Event Ledger](fact-event-ledger.md) — Observable facts append-only log
- [Worker Task Contract](worker-task-contract.md) — Worker dispatch envelope
- [#1441](https://github.com/taoyu051818-sys/lian-nest-server/issues/1441) — This investigation
