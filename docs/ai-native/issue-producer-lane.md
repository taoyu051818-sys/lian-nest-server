# Issue Producer Lane

## Purpose

The Issue Producer lane is an autonomous subsystem that turns fact/state gaps into high-quality execution issues. It replaces manual issue drafting by reading current system state, detecting gaps, and producing structured issues with evidence, acceptance criteria, and CONTROL APPENDIX metadata.

## Problem Statement

- The self-cycle could request 30 workers but only had 5 executable issues.
- Existing generated issues were too shallow: missing evidence, acceptance structure, and rollback guidance.
- This kept Codex in the task-production loop, violating the Codex exit objective.

## Architecture

Three producer scripts share a single utility module (`scripts/ai/lib/issue-production-utils.js`) that consolidates deduplication, policy gating, candidate shaping, GitHub CLI wrappers, and issue-body rendering. Each producer retains its own gap generators and signal sources but delegates common pipeline stages to the shared module.

```
  ┌──────────────────────────────────────────────────────────────────┐
  │  scripts/ai/lib/issue-production-utils.js  (shared pipeline)    │
  │                                                                  │
  │  extractKeywords · titleOverlap · deduplicate · applyPolicyGate │
  │  buildIssueBody · buildOutput · makeCandidate                    │
  │  fetchOpenIssues · fetchOpenPRs · fetchMergedPRs                │
  │  createGitHubIssue · writeAuditEvent                             │
  └──────────────────────────┬───────────────────────────────────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
  ┌─────────────────┐ ┌─────────────┐ ┌──────────────────┐
  │ propose-self-   │ │ propose-    │ │ reduce-gaps-     │
  │ cycle-issues.js │ │ external-   │ │ to-issues.js     │
  │                 │ │ intake-     │ │                  │
  │ Gap generators: │ │ issues.js   │ │ Gap sources:     │
  │  - Resource     │ │             │ │  - Gap ledger    │
  │    sampler      │ │ Signals:    │ │  - Task board    │
  │  - Provider     │ │  - External │ │  - Provider pool │
  │    capacity     │ │    facts    │ │  - Meta-signals  │
  │  - Task board   │ │  - Oppor-   │ │                  │
  │  - Command      │ │    tunity   │ │ makeCandidate:   │
  │    Steward      │ │    signals  │ │  actorRole:      │
  │  - Bounded      │ │             │ │  'issue-prod-    │
  │    parallel     │ │ makeCandi-  │ │  uction-worker'  │
  │  - Active       │ │ date:       │ │                  │
  │    worker       │ │  actorRole: │ │                  │
  │  - Issue close  │ │  'research- │ │                  │
  │  - Ledger       │ │  worker'    │ │                  │
  │  - Failure      │ │             │ │                  │
  │  - Self-seeding │ │             │ │                  │
  │                 │ │             │ │                  │
  │ makeCandidate:  │ │             │ │                  │
  │  actorRole:     │ │             │ │                  │
  │  'automation-   │ │             │ │                  │
  │  cycle-worker'  │ │             │ │                  │
  └────────┬────────┘ └──────┬──────┘ └────────┬─────────┘
           │                 │                  │
           └─────────────────┼──────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Shared pipeline │
                    │  (deduplicate → │
                    │   policy gate → │
                    │   buildOutput)  │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ Output/Execute  │
                    │  - JSON (dry)   │
                    │  - GitHub issues│
                    │  - Audit ndjson │
                    └─────────────────┘
```

### Pipeline stages (agent-first)

The first decision surface is an agent-facing state projection, not a tool handler. Each producer script follows the same pipeline:

1. **Read facts** — Load `.github/ai-state/*` files (gap ledger, task board, provider pool, meta-signals, external facts, opportunity signals).
2. **Generate candidates** — Script-specific gap generators produce raw candidate objects.
3. **Deduplicate** — Shared `deduplicate()` filters by title overlap (>0.5 keyword similarity) and conflictGroup collision against open issues/PRs/merged PRs.
4. **Policy gate** — Shared `applyPolicyGate()` applies risk-based gating: high-risk → `humanRequired`/`blocked`, forbidden scopes → `blocked`, low/medium → `ready`.
5. **Build output** — Shared `buildOutput()` caps candidates at `max` and emits the plan JSON.
6. **Execute** (optional) — Shared `buildIssueBody()` + `createGitHubIssue()` creates issues on GitHub.

### Shared utility module

`scripts/ai/lib/issue-production-utils.js` consolidates all duplicated logic previously inlined in each producer. Each script imports the functions it needs and wraps `makeCandidate` with its own `actorRole` default:

```js
// In propose-self-cycle-issues.js
const { makeCandidate: makeCandidateBase } = require('./lib/issue-production-utils');
function makeCandidate(overrides) {
  return makeCandidateBase(overrides, { actorRole: 'automation-cycle-worker' });
}
```

### WebUI adapter

The WebUI `produce-issues` action is an adapter behind agent-facing issue proposals. It validates specs, builds CONTROL APPENDIX bodies, and scores quality — but never creates issues directly. The agent-first entry point is always the producer scripts or their JSON output.

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
