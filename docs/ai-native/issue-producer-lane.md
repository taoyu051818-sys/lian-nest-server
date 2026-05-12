# Issue Producer Lane

## Purpose

The Issue Producer lane is an autonomous subsystem that turns fact/state gaps into high-quality execution issues. It replaces manual issue drafting by reading current system state, detecting gaps, and producing structured issues with evidence, acceptance criteria, and CONTROL APPENDIX metadata.

## Problem Statement

- The self-cycle could request 30 workers but only had 5 executable issues.
- Existing generated issues were too shallow: missing evidence, acceptance structure, and rollback guidance.
- This kept Codex in the task-production loop, violating the Codex exit objective.

## Architecture

```
  ┌─────────────────────┐
  │  .github/ai-state/  │  (facts: health, resources, provider pool, task board, workers, ledgers)
  └────────┬────────────┘
           │
           ▼
  ┌─────────────────────────────────────┐
  │  propose-self-cycle-issues.js       │
  │  ┌───────────────────────────────┐  │
  │  │ Gap Generators                │  │
  │  │  - Resource sampler freshness │  │
  │  │  - Provider capacity          │  │
  │  │  - Task board completeness    │  │
  │  │  - Command Steward recovery   │  │
  │  │  - Bounded parallel rehearsal │  │
  │  │  - Active worker monitoring   │  │
  │  │  - Issue close detection      │  │
  │  │  - Ledger integration         │  │
  │  │  - Failure classification     │  │
  │  │  - Self-seeding meta          │  │
  │  └───────────┬───────────────────┘  │
  │              │                       │
  │              ▼                       │
  │  ┌───────────────────────────────┐  │
  │  │ Deduplication                 │  │
  │  │  - Title overlap (>0.5)       │  │
  │  │  - Conflict group collision   │  │
  │  └───────────┬───────────────────┘  │
  │              │                       │
  │              ▼                       │
  │  ┌───────────────────────────────┐  │
  │  │ Policy Gate                   │  │
  │  │  - High-risk → humanRequired  │  │
  │  │  - Forbidden scope → blocked  │  │
  │  │  - Low/medium → auto-creatable│  │
  │  └───────────┬───────────────────┘  │
  │              │                       │
  │              ▼                       │
  │  ┌───────────────────────────────┐  │
  │  │ Output / Execute              │  │
  │  │  - JSON (dry-run)             │  │
  │  │  - GitHub issues (--execute)  │  │
  │  │  - Audit log (ndjson)         │  │
  │  └───────────────────────────────┘  │
  └─────────────────────────────────────┘
```

## Issue Structure

Every generated issue includes these sections:

| Section | Purpose |
|---------|---------|
| **Goal** | One-line title describing the task |
| **Evidence** | Concrete facts from system state that justify this issue |
| **Scope** | Task type, rationale, readiness note |
| **Acceptance** | Validation commands that must pass |
| **Constraints** | File scope boundaries (allowed/forbidden) |
| **Rollback / Follow-up** | Steps to revert if the change fails, and what to verify after |
| **CONTROL APPENDIX** | Machine-readable metadata: risk, conflictGroup, allowedFiles, forbiddenFiles, validationCommands, role packet |

## Candidate Fields

Each candidate object contains:

- `title` — Issue title
- `taskType` — "execution" or "research"
- `risk` — "low", "medium", or "high"
- `conflictGroup` — Namespace for conflict-safe dispatch
- `actorRole` — Worker role that should execute this
- `allowedFiles` — Glob patterns for files the worker may touch
- `forbiddenFiles` — Glob patterns that must not be touched
- `validationCommands` — Commands to verify correctness
- `readiness` — "ready", "blocked", or "human-required"
- `readinessNote` — Why readiness is not "ready"
- `macroGoal` — Which macro-goal this serves
- `rationale` — Why this gap exists
- `evidence` — Concrete facts from system state
- `rollbackFollowUp` — Recovery steps if the change fails
- `humanRequired` — Whether a human must approve before execution

## Policy Gate Rules

1. **High-risk** candidates are always `humanRequired` and `blocked`.
2. Candidates touching **forbidden file scopes** (`src/**`, `prisma/**`, `package.json`) are `humanRequired` and `blocked`.
3. Candidates with `humanRequired: true` preset are `human-required`.
4. All other candidates (low/medium risk, within allowed scopes) are `ready` and auto-creatable.

## Deduplication

Candidates are deduplicated against open issues and PRs by:

1. **Title overlap** — Keyword-based similarity > 0.5 skips the candidate.
2. **Conflict group** — If an open issue already has the same conflictGroup in its CONTROL APPENDIX, the candidate is skipped.

## Usage

```bash
# Dry-run (preview only, no GitHub issues created)
node scripts/ai/propose-self-cycle-issues.js --stdout

# Dry-run with repo context (fetches open issues for dedup)
node scripts/ai/propose-self-cycle-issues.js --repo owner/name --stdout

# Execute mode (auto-creates low/medium-risk issues)
node scripts/ai/propose-self-cycle-issues.js --execute --repo owner/name --stdout

# Self-test
node scripts/ai/propose-self-cycle-issues.js --self-test
```

## Audit Trail

Every action (propose, block, skip, create, create-failed) is logged to `issue-seeding-events.ndjson` as an NDJSON entry with:

- `schemaVersion` — Always 1
- `eventId` — UUID
- `recordedAt` — ISO timestamp
- `mode` — "dry-run" or "execute"
- `action` — What happened
- `title`, `conflictGroup`, `risk` — Candidate identity
- `humanRequired` — Whether gated
- `issueUrl` — GitHub URL (if created)
- `reason` — Why this action was taken
