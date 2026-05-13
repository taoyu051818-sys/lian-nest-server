# Gap-to-Issue Reducer

Reads gap ledger entries, meta-signals, task board gaps, and provider state
to produce deduplicated issue proposals with full evidence and CONTROL APPENDIX.

> **Closes:** [#1327](https://github.com/taoyu051818-sys/lian-nest-server/issues/1327)

---

## Problem

The self-cycle could request 30 workers but only had 5 executable issues.
Existing generated issues were too shallow and lacked evidence and acceptance
structure. The gap ledger records discrete gap events (worker failures, health
gate blocks, launch rejections, plan drift, stale rows) but there is no script
that reduces these entries into well-formed issue proposals.

## Goals

- Read gap ledger entries as the primary signal source.
- Combine with meta-signals, task board gaps, and provider state.
- Deduplicate against open issues, open PRs, and merged PRs.
- Apply a risk policy gate (high-risk → human-required).
- Produce issue proposals with full evidence, allowedFiles, forbiddenFiles,
  validation commands, conflictGroup, risk, rollback/follow-up, and
  CONTROL APPENDIX.

## Non-Goals

- No changes to `package.json`, Prisma schema, or Nest runtime modules.
- No modification of the gap ledger writer or its schema.
- No bypass of risk policy or review gates.

---

## Architecture

### Signal Sources

| Source | File | What it provides |
|--------|------|------------------|
| Gap ledger | `.github/ai-state/gap-ledger.ndjson` | Discrete gap events (6 types) |
| Meta-signals | `.github/ai-state/meta-signals.json` | failureScore, frictionScore, riskScore, topPain |
| Task board | `.github/ai-state/task-board.json` | Blocked lanes, empty-ready, stale-running |
| Provider pool | `.github/ai-state/provider-pool.json` | Capacity deficit |

### Gap Type → Issue Template Mapping

Each gap ledger type maps to a specific issue template:

| Gap Type | Risk | Conflict Group | Task Type |
|----------|------|----------------|-----------|
| `worker-failed` | high | worker-recovery | execution |
| `worker-stale` | high | worker-recovery | execution |
| `health-gate-fail` | high | health-gate-repair | execution |
| `launch-blocked` | medium | launch-block-resolution | execution |
| `plan-drift` | low | plan-drift-correction | docs |
| `stale-row` | low | stale-row-refresh | docs |

### Task Board Gap → Issue Template Mapping

| Signal Type | Risk | Conflict Group | Task Type |
|-------------|------|----------------|-----------|
| `blocked-lane` | medium | (from task) | execution |
| `empty-ready` | low | ready-lane-deficit | docs |
| `stale-running` | medium | (from task) | execution |

### Pipeline

```
gap-ledger.ndjson ──┐
meta-signals.json ──┤
task-board.json ────┤──► generateAllCandidates()
provider-pool.json ─┘           │
                                ▼
                     enrichCandidateWithMetaSignals()
                                │
                                ▼
                     deduplicate(candidates, openIssues, openPRs, mergedPRs)
                                │
                                ▼
                     applyPolicyGate(proposed)
                                │
                        ┌───────┴───────┐
                        ▼               ▼
                  autoCreatable    humanRequired
                        │               │
                        └───────┬───────┘
                                ▼
                     buildOutput(allProposed, skipped, mode, max)
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
              --stdout JSON           --execute mode
                                  (gh issue create)
```

---

## Deduplication

Candidates are deduplicated against:

1. **Open issues** — title overlap > 0.5 or conflictGroup collision.
2. **Open PRs** — title overlap > 0.5 or conflictGroup collision.
3. **Merged PRs** — title overlap > 0.5 or conflictGroup collision.

Within the gap ledger, entries of the same gap type for the same issue are
deduplicated to avoid multiple proposals for the same underlying problem.

---

## Risk Policy Gate

| Risk | Auto-create | Human-required |
|------|:-----------:|:--------------:|
| low | yes | no |
| medium | yes | no |
| high | no | yes |

Candidates with forbidden file scopes (`src/**`, `prisma/**`, `package.json`)
are always human-required regardless of risk level.

---

## Usage

```bash
# Dry-run (default) — output to .github/ai-state/gap-reduced-issues.json
node scripts/ai/reduce-gaps-to-issues.js

# Output to stdout
node scripts/ai/reduce-gaps-to-issues.js --stdout

# With GitHub dedup
node scripts/ai/reduce-gaps-to-issues.js --repo owner/name --stdout

# Execute mode — auto-create low/medium-risk issues
node scripts/ai/reduce-gaps-to-issues.js --execute --repo owner/name --stdout

# Limit proposals
node scripts/ai/reduce-gaps-to-issues.js --max 5 --stdout

# Custom state directory
node scripts/ai/reduce-gaps-to-issues.js --state-dir /path/to/ai-state --stdout
```

---

## Output Format

```json
{
  "planVersion": 1,
  "capturedAt": "2026-05-13T12:00:00.000Z",
  "label": "agent:codex-action-needed",
  "mode": "dry-run",
  "totalProposed": 3,
  "totalCapped": 3,
  "totalSkipped": 1,
  "candidates": [...],
  "skippedDuplicates": [...],
  "policy": {
    "allowedScopes": ["docs/**", "scripts/ai/**", "schemas/**", ".github/ai-state/*.example.json"],
    "forbiddenScopes": ["src/**", "prisma/**", "package.json", "package-lock.json"],
    "maxAutoCreate": 10
  }
}
```

Each candidate includes all fields required for the CONTROL APPENDIX:

- `taskType`, `risk`, `conflictGroup`, `allowedFiles`, `forbiddenFiles`
- `validationCommands`, `actorRole`, `macroGoal`
- `evidence`, `rationale`, `rollbackFollowUp`

---

## Tests

```bash
node scripts/ai/reduce-gaps-to-issues.test.js
```

Tests cover:
- Gap entry → candidate mapping (all 6 gap types)
- Task board gap discovery and mapping
- Provider capacity candidate generation
- Meta-signal enrichment
- Deduplication (title overlap, conflictGroup collision)
- Policy gate (risk levels, forbidden scopes)
- Issue body with CONTROL APPENDIX
- Output shape
- CLI (help, unknown flags, stdout, max)

---

## Integration Points

| System | Interaction |
|--------|------------|
| [Gap Ledger](gap-ledger.md) | Primary input — reads NDJSON entries |
| [Meta Signals](meta-signals.md) | Enriches candidates with failure/friction scores |
| [Task Board Projection](task-board-projection.md) | Discovers blocked-lane, empty-ready, stale-running gaps |
| [Risk Policy](risk-policy.md) | Gates high-risk candidates to human-required |
| [Candidate Gap Dedupe Policy](candidate-gap-dedupe-policy.md) | Dedup against existing issues/PRs |
| [Issue Body Renderer](issue-body-renderer.md) | CONTROL APPENDIX format |
| [Issue Producer Lane](issue-producer-lane.md) | Part of the autonomous issue production subsystem |

---

## See Also

- [Gap Ledger](gap-ledger.md) — Append-only gap event log
- [Gap Ledger Schema](gap-ledger-schema.md) — Entry JSON schema
- [Parallel Planning Reducer](parallel-planning-reducer.md) — Multi-planner candidate compilation
- [Propose Self Cycle Issues](../../scripts/ai/propose-self-cycle-issues.js) — Fact-based issue proposal generator
- [Risk Policy](risk-policy.md) — Risk categories and merge gates
- [#1327](https://github.com/taoyu051818-sys/lian-nest-server/issues/1327) — This feature
