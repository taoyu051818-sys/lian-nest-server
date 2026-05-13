# Codebase Index / Repo Map Investigation

Investigates whether a tree-sitter-based symbol graph (repo map) can improve
LIAN worker navigation of large modules. Sourced from Aider's `repomap.py`
implementation.

> **Closes:** [#1442](https://github.com/taoyu051818-sys/lian-nest-server/issues/1442)
>
> **Source reliability:** high — Aider's `repomap.py` (868 lines, production code)
>
> **See also:**
> [external-research-intake-loop.md](external-research-intake-loop.md) for intake pipeline,
> [generate-context-bundle.js](../../scripts/ai/generate-context-bundle.js) for current worker context

---

## Problem Statement

LIAN workers receive `allowedFiles` glob patterns (e.g. `docs/ai-native/**`)
with no structural understanding of the codebase. For large modules
(e.g. `src/posts/` with 20+ files), workers read files sequentially to find
relevant code. This is slow and wastes token budget on irrelevant files.

## How Aider's Repo Map Works

### Tag Extraction (tree-sitter)

Uses tree-sitter to parse source files into an AST, then runs `.scm` query
files to extract two kinds of tags:

- `name.definition.*` — classes, functions, methods
- `name.reference.*` — where those symbols are used

Falls back to pygments lexer for languages where tree-sitter only provides
definitions (e.g. C++).

### Graph Ranking (PageRank)

Builds a `networkx.MultiDiGraph` where:

- **Nodes** = source files
- **Edges** = connect files that share symbol references
- **Edge weights** are scaled by:
  - Naming conventions (snake_case, camelCase, kebab-case): 10x boost
  - Underscore-prefixed identifiers: 0.1x penalty
  - High-frequency definitions (>5 files): 0.1x penalty
  - Chat file references: 50x boost
  - Mentioned identifiers: 10x boost

Runs `nx.pagerank()` with personalization weights boosting files already in
the chat context or mentioned by the user.

### Map Rendering

Uses binary search to fit ranked tags into a token budget (default 1024
tokens). Renders using `grep_ast.TreeContext` to show definition lines with
surrounding context, truncated to 100 chars per line.

### Example Output

```
aider/coders/base_coder.py:
...|class Coder:
...|    abs_fnames = None
...|    @classmethod
...|    def create(self, main_model, edit_format, io, ...):
...|    def run(self, with_message=None):
```

---

## Applicability to LIAN

### Current LIAN Worker Context

LIAN workers get context via `generate-context-bundle.js`, which scans
docs/ai-native/, schemas/, and scripts/ai/ to build a bounded context
manifest. Workers do NOT receive a structural map of `src/` code.

### Where Repo Map Would Help

| Scenario | Current | With Repo Map |
|----------|---------|---------------|
| Worker needs to modify `src/posts/` | Reads all 20+ files sequentially | Gets ranked symbol map, navigates directly to relevant files |
| Worker needs to understand cross-module deps | Guesses from imports | Sees PageRank-weighted dependency graph |
| Worker token budget | Spent on irrelevant files | Focused on high-relevance symbols |

### Feasibility Assessment

| Factor | Assessment |
|--------|-----------|
| **Language support** | LIAN is TypeScript/NestJS — tree-sitter has mature TS/TSX queries |
| **Dependency cost** | `tree-sitter`, `tree-sitter-typescript`, `grep_ast`, `networkx` — all pip-installable |
| **Runtime cost** | First scan is slow on large repos; cached by file mtime (SQLite) |
| **Integration point** | Could run as a pre-task script in `scripts/ai/`, outputting a markdown map into the context bundle |
| **Token budget** | Default 1024 tokens is tight; LIAN workers could use 2-4k since they don't have chat history |

### Risks and Limitations

1. **Python dependency** — Aider's implementation is Python. A Node.js port
   would be needed for LIAN's JS-first toolchain. `tree-sitter-node` exists
   but is less mature than the Python bindings.
2. **Stale cache** — If files change between cache build and worker run, the
   map may reference deleted/moved symbols. The mtime-based cache helps but
   doesn't eliminate this.
3. **Limited to file-level granularity** — PageRank ranks files, not
   individual functions. For a 200-line file, this is fine. For a 2000-line
   file, the worker still needs to search within it.
4. **No TypeScript type awareness** — tree-sitter sees syntax, not types.
   Type-based relationships (interface implementations, generic constraints)
   are invisible.

---

## Recommendation

**Investigate further, do not implement yet.** The concept is sound but
requires a non-trivial adaptation:

1. **Prototype phase** — Build a minimal Node.js script using
   `tree-sitter-node` + `tree-sitter-typescript` that extracts definition
   tags from `src/` and outputs a ranked file list. No graph ranking needed
   for a first cut — just file-level symbol counts.
2. **Integration phase** — If the prototype proves useful, integrate into
   `generate-context-bundle.js` as an optional `--repo-map` flag.
3. **Full implementation** — Only if prototype validates the approach:
   add PageRank ranking, caching, and token-budget-aware rendering.

### Alternative: Lightweight AST Index

A simpler alternative to a full repo map: run `tree-sitter` once to build a
JSON index of `{file: [symbols]}`. Workers query this index instead of
reading every file. No graph ranking, no caching complexity, 80% of the
value for 20% of the effort.

---

## Appendix: Aider Repo Map Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| PageRank over simple reference counts | Captures transitive importance — a file referenced by highly-referenced files is itself important |
| Personalization for chat files | Map should prioritize code relevant to what the user is discussing |
| Token budget with binary search | Ensures map fits in LLM context without manual tuning |
| diskcache with mtime key | Avoids re-parsing unchanged files; survives process restarts |
| Pygments fallback for C++ | tree-sitter C++ queries only provide defs, not refs |
| 100 char line truncation | Keeps map compact; LLM doesn't need full implementations |
