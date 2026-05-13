# Search and Ingest

Agent tool that chains `web-search.js` to `write-external-fact.js` --
searches the web and ingests results as external facts. Supports
topic-based searching with predefined AI/agent research topics.

Requires `MIMO_API_KEY` environment variable.

---

## Problem

The external research intake pipeline needs a mechanical bridge between
web search and fact ingestion. The agent decides WHAT to search and
WHETHER to ingest, but the chaining of search results into the fact
writer is purely mechanical and should not require agent reasoning.

## Solution

`search-and-ingest.js` provides a single-command pipeline:

```
query → web-search.js → write-external-fact.js → external-facts.ndjson
```

The script handles the mechanical chaining while preserving the agent's
control over search queries and the `--live` gate for actual ingestion.

---

## Pipeline

### 1. Search

Calls `web-search.js` with the query, max keywords, and result limit.
Returns structured results with sources and content.

### 2. Ingest

Takes the top search result and builds a fact entry:

| Field | Value |
|-------|-------|
| `sourceClass` | `web-scan` |
| `sourceUrl` | Top result URL |
| `actor` | `web-search-intake` |
| `reliabilityTier` | `medium` |
| `topic` | Derived from query (slugified, max 40 chars) |
| `pattern` | Top result title or query string |
| `keyInsight` | First 500 chars of search content |
| `relevance` | `External research for self-bootstrap improvement` |

The fact is written via `write-external-fact.js`. Without `--live`,
the script runs in dry-run mode (search only, no fact written).

---

## Predefined Topics

When no query or topics are specified, the script searches these
default topics:

1. `AI agent orchestration frameworks 2026`
2. `multi-agent collaboration patterns`
3. `autonomous code generation safety`
4. `LLM self-improvement techniques`
5. `agent-based software engineering`

---

## Usage

```bash
# Search a single query (dry-run)
node scripts/ai/search-and-ingest.js "AI agent orchestration patterns"

# Search and ingest (live)
node scripts/ai/search-and-ingest.js "nest.js testing patterns" --live

# Search predefined topics
node scripts/ai/search-and-ingest.js --topics "topic1,topic2,topic3" --live

# Custom keyword and result limits
node scripts/ai/search-and-ingest.js "query" --max-keywords 5 --limit 10 --live

# Show help
node scripts/ai/search-and-ingest.js --help
```

### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `<query>` (positional) | - | Search query string |
| `--query`, `-q` | - | Search query string (alternative to positional) |
| `--topics` | - | Comma-separated list of topics to search |
| `--live` | `false` | Write facts to `external-facts.ndjson` |
| `--max-keywords` | `3` | Max keywords per search |
| `--limit` | `3` | Max results per search |
| `--help`, `-h` | - | Show help |

---

## Output

The script prints a summary to stdout:

```
=== Search & Ingest [DRY-RUN] ===
Queries: 5

Searching: "AI agent orchestration frameworks 2026"
  Found 3 sources
  Content: ...

Searching: "multi-agent collaboration patterns"
  Found 2 sources
  Content: ...

=== Summary ===
Searched: 5 queries
Sources found: 12
Ingested: 0

DRY-RUN: No facts written. Pass --live to ingest.
```

---

## Integration Points

| System | Interaction |
|--------|------------|
| [Web Search](web-search.js) | Provides the search backend via MiMo API |
| [Write External Fact](write-external-fact.js) | Writes ingested facts to `external-facts.ndjson` |
| [External Facts Schema](external-facts-schema.md) | Defines the fact entry format |
| [Agent Command Dispatcher](agent-command-dispatcher.md) | Invokes this script as the `search-and-ingest` command |
| [External Research Intake Loop](external-research-intake-loop.md) | Higher-level loop that may use this tool |

---

## Design Decisions

- **Dry-run by default.** Facts are only written when `--live` is
  passed. This prevents accidental ingestion during exploration.
- **Top result only.** Only the first search result is ingested as
  a fact. Multiple results could be added in a future iteration.
- **Medium reliability.** Web search results are assigned
  `reliabilityTier: medium` by default. Higher tiers require
  human verification or trusted source matching.
- **Query slugification.** The topic field is derived from the query
  by lowercasing and replacing non-alphanumeric characters with
  hyphens, truncated to 40 characters.
