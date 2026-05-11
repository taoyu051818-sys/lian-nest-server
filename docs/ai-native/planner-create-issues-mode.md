# Planner Create-Issues Mode

Proposes GitHub issue creation from gap analysis facts without mutating by
default. This mode completes the final control-loop layer: the planner can
identify gaps (missing parity tests, stale rows, uncovered slices) and produce
ready-to-file issue proposals with full CONTROL APPENDIX metadata.

## Purpose

The existing `plan-next-batch.ps1` consumes open issues and ranks them for
worker dispatch. The create-issues mode works in the opposite direction: it
starts from gaps and facts, then proposes new issues to fill them.

This closes the loop:

```
facts/gaps → propose issues → operator reviews → issues created → workers dispatched
```

## Dry-Run Default

All write-capable automation defaults to **dry-run**. The mode never calls
`gh issue create` unless the caller explicitly passes `-Write`.

| Mode | Behavior |
|------|----------|
| `dry-run` (default) | Outputs proposed issues as JSON or console text. No GitHub mutations. |
| `write` | Calls `gh issue create` for each proposal. Requires explicit `-Write` flag. |

This matches the hard constraint: default all write-capable automation to
dry-run unless the issue explicitly says otherwise.

## Proposal Structure

Each gap produces a proposed issue with:

| Field | Source | Default |
|-------|--------|---------|
| `title` | Gap entry | Required |
| `goal` | Gap entry | `"Address gap: <title>"` |
| `scope` | Gap entry | `"Auto-generated from gap analysis."` |
| `priority` | Gap entry | `"medium"` |
| `risk` | Gap entry | `"medium"` |
| `conflictGroup` | Gap entry | `"gap-fill"` |
| `allowedFiles` | Gap entry | `["docs/**"]` |
| `sliceRef` | Gap entry | `$null` (omitted from body) |
| `gapKey` | Gap entry | Required (for deduplication) |

The proposal body follows the issue template from
[issue-lifecycle.md](issue-lifecycle.md) and includes a full
CONTROL APPENDIX with `Mode: dry-run` to signal that the resulting worker
must also respect dry-run defaults.

### CONTROL APPENDIX in Proposed Issues

```markdown
## Goal
<goal text>

## Scope
<scope text>

## CONTROL APPENDIX
Task type: execution
Risk: <risk>
Conflict group: <conflictGroup>
Allowed files:
- <file1>
- <file2>
Validation commands:
- npm run check
- npm run build
Slice: <sliceRef>      # omitted when null
Mode: dry-run
```

## Deduplication

Before proposing an issue, the mode checks existing open issues (fetched via
`gh issue list`) for matching `gapKey` values. A gap is skipped when an open
issue already covers it. This prevents duplicate filing when the planner runs
multiple times.

Gap keys are stable identifiers like `missing-parity-test-auth` or
`stale-row-runtime`. The gap source (fact event, stale-row detector, manual
analysis) is responsible for generating unique, descriptive keys.

## Priority Ordering

Proposals are sorted by priority rank before output:

| Priority | Rank | Meaning |
|----------|------|---------|
| `critical` | 0 | Blocks other work — file first |
| `high` | 1 | Current wave |
| `medium` | 2 | Next wave (default) |
| `low` | 3 | Backlog |

Within the same priority, proposals are output in discovery order (stable sort).

## Fixture Coverage

The test script `scripts/ai/plan-next-batch.create-issues.test.ps1` covers
nine fixtures:

| Fixture | What it validates |
|---------|-------------------|
| 1 | Basic gap-to-issue proposal mapping |
| 2 | Dry-run is the default mode (no `-Write`) |
| 3 | Deduplication against existing issues |
| 4 | Priority rank ordering (critical → low) |
| 5 | Default field population for minimal gaps |
| 6 | Full CONTROL APPENDIX body structure |
| 7 | Slice line omitted when no sliceRef |
| 8 | JSON file round-trip (serialize + deserialize) |
| 9 | Mixed dedup across multiple gaps |

### Running

```bash
pwsh ./scripts/ai/plan-next-batch.create-issues.test.ps1
```

Exit 0 on all-pass, exit 1 on any failure. No GitHub API calls are made.

## Integration

```
gap sources (fact events, stale-row detector, manual)
        |
        v
create-issues mode  (this feature — proposes issues)
        |
        v
operator reviews proposals
        |
        v
gh issue create     (only with -Write, or manual)
        |
        v
plan-next-batch.ps1 (discovers new issues, ranks them)
        |
        v
worker dispatch     (run-self-cycle.ps1 / batch-launch.ps1)
```

The create-issues mode sits between gap detection and issue creation. It does
not replace `plan-next-batch.ps1` — it feeds into it by producing the issues
that the planner later discovers and ranks.

## Safety Boundaries

- **Dry-run by default.** Never mutates GitHub without explicit `-Write`.
- **No autonomous merge.** Proposed issues are reviewed by a human before
  filing. The `-Write` flag is a conscious operator action.
- **No secret exposure.** Proposals contain no API keys, tokens, or provider
  configuration.
- **Dedup prevents spam.** Re-running the mode does not create duplicate
  issues for the same gap.

## References

- [Planning Loop](planning-loop.md) — the planner that consumes filed issues
- [Planner Meta-Signals Ranking](planner-meta-signals-ranking.md) — ranking
  enrichment that applies after issues are filed
- [Issue Lifecycle](issue-lifecycle.md) — issue states and label conventions
- [Planner Meta-Signals Fixtures](planner-meta-signals-fixtures.md) — sibling
  fixture test documentation
