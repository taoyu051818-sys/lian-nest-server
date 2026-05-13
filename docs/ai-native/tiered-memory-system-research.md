# Tiered Memory System Research: MemGPT to LIAN Mapping

Maps MemGPT's 3-tier memory architecture (in-context, recall, archival) to
LIAN's existing memory surfaces. Identifies gaps, proposes bounded improvements,
and defines an opportunity signal for the external intake loop.

> **Closes:** [#1441](https://github.com/taoyu051818-sys/lian-nest-server/issues/1441)
>
> **Source:** MemGPT/Letta memory schema (`letta/schemas/memory.py`),
> classified as `external-doc` / Tier B evidence.
>
> **See also:**
> [organization-memory-policy.md](organization-memory-policy.md) for memory
> recording and consumption rules,
> [knowledge-driven-scaling.md](knowledge-driven-scaling.md) for the knowledge
> writeback invariant,
> [context-bundles.md](context-bundles.md) for worker context assembly,
> [gap-ledger.md](gap-ledger.md) for gap event recording,
> [external-research-intake-loop.md](external-research-intake-loop.md) for the
> intake loop stages.

---

## MemGPT's 3-Tier Memory Model

MemGPT (now Letta) implements a self-editing memory architecture inspired by
operating system virtual memory. The agent manages three memory tiers and
actively decides what to store, retrieve, and forget between turns.

| Tier | MemGPT Name | Analogy | Characteristics |
|------|------------|---------|-----------------|
| **In-context** | Working memory / Core memory | RAM (fits in prompt window) | Always visible to the agent. Self-editing: agent can rewrite between turns. Size-limited by context window. |
| **Recall** | Recall memory / Conversation memory | Disk (searchable) | Full conversation history. Searchable by recency and relevance. Agent queries explicitly. |
| **Archival** | Archival memory / Archival storage | Database (semantic search) | Long-term structured storage. Semantic search over embeddings. Agent decides what to persist long-term. |

### Key MemGPT Mechanisms

1. **Self-editing memory blocks:** The agent can rewrite its own core memory
   between turns. This means the agent's "personality" and working state evolve
   over time without human intervention.

2. **Active memory management:** The agent decides what to move between tiers.
   Working context is too large? The agent archives older items. Need a fact
   from history? The agent queries recall memory explicitly.

3. **Tiered retrieval:** In-context is always available. Recall is searched by
   recency/relevance. Archival is searched semantically. Each tier has different
   latency and cost characteristics.

4. **Memory as a tool:** Memory operations (read, write, search) are exposed as
   tools the agent can call, not passive infrastructure.

---

## LIAN's Current Memory Architecture

LIAN already implements a multi-surface memory system, but it is not structured
as explicit tiers. Each surface was built for a specific operational need, not
as a coherent memory hierarchy.

### Existing Memory Surfaces

| Surface | File | Writer | Format | Access Pattern |
|---------|------|--------|--------|----------------|
| Task contract | (in-worker prompt) | Launcher | JSON envelope | Always in-context |
| Context bundle | `bundle-<issue>.json` | `generate-context-bundle.js` | JSON manifest | Scanned at worker start |
| Gap ledger | `.github/ai-state/gap-ledger.ndjson` | `write-gap-ledger.js` | NDJSON append-only | Read by meta-signals, state reconciler |
| Fact event ledger | `.github/ai-state/fact-events.ndjson` | `write-fact-event.js` | NDJSON append-only | Read by meta-signals, opportunity signals |
| External facts | `.github/ai-state/external-facts.ndjson` | `write-external-fact.js` | NDJSON append-only | Read by intake loop, opportunity signals |
| Knowledge ledger | `.github/ai-state/knowledge-updates.ndjson` | `write-knowledge-update.ps1` | NDJSON append-only | Read by planning loop, future workers |
| Health state | `.github/ai-state/main-health.json` | `write-main-health-state.ps1` | JSON snapshot | Read by launch gate, meta-signals |
| Meta-signals | `.github/ai-state/meta-signals.json` | `calculate-meta-signals.js` | JSON snapshot | Read by planning loop, command steward |

### Current Access Model

Workers access memory through two mechanisms:

1. **Task contract (always in-context):** The launcher embeds the task JSON
   directly in the worker prompt. This is the worker's "working memory" — it
   contains `allowedFiles`, `validationCommands`, `knowledgeRefs`, and
   `promptHandoff`.

2. **Context bundle (scanned at start):** The context bundle generator scans
   `docs/ai-native/`, schemas, policies, and state files. It produces a manifest
   of relevant files the worker should read. The worker reads these files at
   startup.

What workers **cannot** currently do:

- Query the gap ledger for patterns relevant to their task.
- Read knowledge entries from prior workers who solved similar problems.
- Write back what they learned during execution (beyond the PR body).
- Decide what context is relevant vs. noise.
- Edit their own working memory between turns.

---

## Tier Mapping: MemGPT to LIAN

### Tier 1: In-Context (Working Memory)

| MemGPT | LIAN Equivalent | Status |
|--------|----------------|:------:|
| Core memory blocks | Task contract (`promptHandoff`, `knowledgeRefs`, `attentionAreas`) | **Exists** |
| Self-editing between turns | Worker cannot rewrite its own context | **Gap** |
| Size-limited by context window | Context bundle has byte-size metadata but no hard cap | **Partial** |

**Current state:** The task contract serves as working memory. It is immutable
during execution — the worker cannot add new information to it.

**Gap:** Workers cannot update their own working memory. If a worker discovers
mid-task that a prior assumption was wrong, it cannot record that insight for
its own later use. It can only write to the PR body or issue comment.

**Proposed improvement:** Allow workers to write to a per-task "scratch file"
in `.github/ai-state/worker-scratch/<issue-number>.json`. This file is
append-only during execution and is read by the knowledge-update-writer on
merge. It acts as the worker's evolving working memory without modifying the
task contract.

### Tier 2: Recall Memory (Episodic, Searchable by Recency/Relevance)

| MemGPT | LIAN Equivalent | Status |
|--------|----------------|:------:|
| Conversation history | Gap ledger + fact event ledger | **Partial** |
| Search by recency | NDJSON append-only (recency = last N lines) | **Exists** |
| Search by relevance | No relevance-based retrieval | **Gap** |
| Per-task episode | No per-task episode tracking | **Gap** |

**Current state:** The gap ledger and fact event ledger record events
chronologically. The meta-signals calculator reads these to compute aggregate
scores. But there is no way to query "what happened the last time a worker
touched the `auth-core` conflict group?" or "what gap patterns are associated
with `docs/ai-native/` changes?"

**Gap:** No relevance-based retrieval. Workers cannot ask "show me the last 5
gap entries related to my conflict group" or "what knowledge entries exist for
my domain?" The organization-memory-policy says context bundles SHOULD include
relevant memory entries, but this filtering is not implemented.

**Proposed improvement:** Add a `--conflictGroup` filter to the gap ledger
reader and a `--domain` filter to the knowledge ledger reader. These are
read-only queries against existing NDJSON files — no new writers needed. The
context bundle generator can then include the most recent N matching entries
in the worker's context.

### Tier 3: Archival Memory (Long-Term, Semantic)

| MemGPT | LIAN Equivalent | Status |
|--------|----------------|:------:|
| Archival storage | Knowledge ledger (`knowledge-updates.ndjson`) | **Exists** |
| Semantic search | Keyword/tag matching only | **Partial** |
| Agent decides what to persist | Knowledge writeback is mandatory, not agent-driven | **Different** |
| Embedding-based retrieval | No embedding infrastructure | **Gap** |

**Current state:** The knowledge ledger stores structured entries from merged
PRs. The organization-memory-policy mandates that accepted experiments become
precedent and rejected experiments become anti-patterns. The planning loop
consults this before proposing tasks.

**Gap:** No semantic search. Knowledge entries are tagged with categories and
keywords, but retrieval is limited to tag matching and recency. There is no
embedding-based search over knowledge content. For the current scale (tens of
entries), this is acceptable. At scale (hundreds of entries), keyword matching
will miss relevant knowledge.

**Proposed improvement:** No change needed at current scale. When the knowledge
ledger exceeds 200 entries, add a `knowledge-search.js` script that supports
keyword-based full-text search over entry content. Semantic search via embeddings
is deferred until the system demonstrates that keyword search is insufficient.

---

## Gap Analysis Summary

| Capability | MemGPT | LIAN Status | Priority |
|-----------|:------:|:-----------:|:--------:|
| In-context working memory | Self-editing blocks | Immutable task contract | Low — task contract is sufficient for bounded workers |
| Per-task scratch memory | Built-in | Not implemented | **Medium** — enables worker learning within a task |
| Recall by recency | Full history | NDJSON last-N | Exists |
| Recall by relevance | Embedding search | Not implemented | **Medium** — enables cross-worker knowledge reuse |
| Archival long-term storage | Embedding DB | Knowledge ledger (tag-based) | Exists |
| Semantic search over archival | Embedding search | Not implemented | Low — defer until scale requires it |
| Active memory management | Agent decides what to store/forget | Policy-driven mandatory writeback | Different design choice — acceptable |
| Memory as tool | Read/write/search tools | Passive infrastructure | Low — workers read at start, write at end |

---

## Proposed Bounded Improvements

### Improvement 1: Worker Scratch File (Tier 1 Extension)

**What:** Allow workers to write observations to a per-task scratch file during
execution. The file is append-only NDJSON, scoped to the task's issue number.

**File:** `.github/ai-state/worker-scratch/<issue-number>.ndjson`
**Writer:** Worker directly (no new script needed — just append a JSON line)
**Consumer:** `write-knowledge-update.ps1` reads scratch entries on merge to
enrich the knowledge entry with worker-discovered insights.

**Schema:**
```jsonc
{
  "recordedAt": "2026-05-13T10:00:00Z",
  "type": "observation | blocker | insight | correction",
  "content": "Brief description of what the worker discovered",
  "relevance": "domain or conflict group this relates to"
}
```

**Boundary:** The scratch file is deleted after the knowledge entry is written
on merge. It is ephemeral working memory, not a persistent ledger.

### Improvement 2: Memory-Relevant Context Injection (Tier 2 Extension)

**What:** Extend `generate-context-bundle.js` to include recent gap ledger
and knowledge ledger entries filtered by the worker's conflict group or issue
labels.

**Changes:**
- Add `--conflictGroup` flag to `generate-context-bundle.js`
- Read last 10 gap entries matching the conflict group
- Read last 5 knowledge entries matching the issue's domain tags
- Include matching entries in the manifest under a new `memory` field

**Manifest extension:**
```jsonc
{
  "version": 2,
  "issue": 1441,
  "docs": [...],
  "schemas": [...],
  "memory": {
    "gaps": [...],       // recent gap entries for this conflict group
    "knowledge": [...]   // recent knowledge entries for this domain
  }
}
```

**Boundary:** This is a read-only extension to an existing script. No new
writers. No new NDJSON files. The gap ledger and knowledge ledger already
contain the data — this improvement just filters and injects it.

### Improvement 3: Knowledge Ledger Full-Text Search (Tier 3 Deferred)

**What:** A `knowledge-search.js` script that supports keyword-based search
over knowledge entry content.

**When:** Deferred until the knowledge ledger exceeds 200 entries. At current
scale, tag-based filtering (already possible) is sufficient.

**Boundary:** No embedding infrastructure. Pure keyword matching using
Node.js built-in string search. If semantic search becomes necessary, it
should be a separate experiment with its own opportunity signal.

---

## Opportunity Signal

This research produces one opportunity signal for the external intake loop.

```jsonc
{
  "signalId": "sig-tiered-memory-1441",
  "sourceFacts": ["evidence.intake from MemGPT research"],
  "patternId": "pat-tiered-memory-memgpt",
  "hypothesis": "If LIAN adds per-task worker scratch files and memory-relevant context injection (filtered gap/knowledge entries in context bundles), then cross-worker knowledge reuse will improve because workers will see relevant prior learnings without reading the full ledger.",
  "experiment": {
    "scope": "scripts/ai/generate-context-bundle.js + new scratch file convention",
    "allowedFiles": ["scripts/ai/generate-context-bundle.js", "docs/ai-native/tiered-memory-system-research.md"],
    "validationCommands": ["node scripts/ai/generate-context-bundle.js --issue 1441 --conflictGroup ai-native-docs"],
    "successCriteria": "Context bundle manifest includes a `memory` field with filtered gap and knowledge entries",
    "rollbackPlan": "Remove `memory` field from manifest, revert generator changes"
  },
  "applicability": "partial",
  "lianSurface": "context bundles, knowledge ledger, gap ledger"
}
```

---

## What This Research Does NOT Propose

1. **No embedding infrastructure.** MemGPT uses embeddings for semantic search
   over archival memory. LIAN does not need this at current scale. Adding
   embeddings would require new dependencies, storage, and maintenance — a
   separate experiment.

2. **No self-editing memory blocks.** MemGPT's agents rewrite their own core
   memory between turns. LIAN workers are stateless by design — they execute
   a bounded task and exit. Self-editing memory would require rearchitecting
   the worker lifecycle.

3. **No memory as a tool.** MemGPT exposes memory operations as agent tools.
   LIAN workers access memory passively through context bundles. Making memory
   an active tool would change the worker interaction model significantly.

4. **No changes to worker lifecycle.** Workers remain stateless between
   invocations. The scratch file is per-task ephemeral storage, not persistent
   worker state.

---

## Design Decisions

- **Workers stay stateless.** The scratch file is per-task, deleted on merge.
  This preserves the current worker lifecycle where each invocation is
  independent.

- **Context injection is read-only.** No new writers are introduced. The gap
  ledger and knowledge ledger already contain the data; the improvement is
  filtering and injection at read time.

- **No embedding search at current scale.** The knowledge ledger has tens of
  entries. Tag-based filtering is sufficient. Semantic search is a future
  experiment when scale demands it.

- **MemGPT is evidence, not command.** This research synthesizes MemGPT's
  patterns into LIAN-specific improvements. The external project is cited as
  a traceability reference, not as a policy authority.

---

## References

- [Organization Memory Policy](organization-memory-policy.md) — Memory recording and consumption rules
- [Knowledge-Driven Scaling](knowledge-driven-scaling.md) — Knowledge writeback invariant
- [Context Bundles](context-bundles.md) — Worker context assembly
- [Gap Ledger](gap-ledger.md) — Gap event recording
- [Knowledge Update Writer](knowledge-update-writer.md) — PR-merge knowledge ledger
- [Fact Event Ledger](fact-event-ledger.md) — Observable facts append-only log
- [External Research Intake Loop](external-research-intake-loop.md) — Intake loop stages
- [Bounded Experiment Policy](bounded-experiment-policy.md) — Experiment scoping rules
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema for workers
- [#1441](https://github.com/taoyu051818-sys/lian-nest-server/issues/1441) — This research
