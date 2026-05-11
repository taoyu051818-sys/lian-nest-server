# Failure Taxonomy Policy for Self-Healing Classification

Defines the canonical failure categories used by the self-healing pipeline to
classify, route, and recover from post-merge and worker failures.

## Source of Truth

The machine-readable taxonomy lives at `.github/ai-policy/failure-taxonomy.json`.
This document is the human-readable policy companion. If they diverge, the JSON
file wins.

## Categories

### Worker Lifecycle Failures

| Category | Severity | Health Impact | Description |
|----------|----------|---------------|-------------|
| `worker-timeout` | critical | yellow | Worker exceeded its time budget without producing output |
| `worker-silent` | critical | yellow | Worker exited without producing any output or feedback |
| `forbidden-files-touched` | critical | red | Worker edited files outside its allowedFiles boundary |
| `validation-missing` | warning | yellow | Worker did not run required validation before opening PR |
| `validation-failed` | critical | red | Worker ran validation but one or more checks failed |

### Infrastructure Failures

| Category | Severity | Health Impact | Description |
|----------|----------|---------------|-------------|
| `main-red` | critical | red | Main branch health state is red |
| `generated-stale` | critical | red | Generated code is stale or missing relative to schema |
| `docs-authority-conflict` | warning | yellow | Docs contradict the current source-of-truth |
| `state-drift` | warning | yellow | Persistent state is inconsistent with actual repo state |

### Security and Safety Failures

| Category | Severity | Health Impact | Description |
|----------|----------|---------------|-------------|
| `secret-leak` | critical | red | Secrets or credentials exposed in commits or PRs |
| `destructive-migration` | critical | red | Migration would destroy data without backup or rollback |
| `auth-regression` | critical | red | Auth behavior regressed (broken guards, bypassed checks) |

### Coordination Failures

| Category | Severity | Health Impact | Description |
|----------|----------|---------------|-------------|
| `semantic-conflict` | warning | yellow | Parallel workers produced logically conflicting changes |
| `cost-overrun` | warning | yellow | Worker or pipeline exceeded cost/resource budget |
| `token-overrun` | warning | yellow | LLM token usage exceeded configured budget |

## Severity and Health Impact

### Severity Levels

- **Critical** — blocks all non-recovery worker launches. Requires immediate recovery action.
- **Warning** — limits workers to fix-only and docs types. Does not block the pipeline entirely.

### Health Impact Mapping

| Failure Health Impact | Resulting Main State | Worker Permission |
|----------------------|---------------------|-------------------|
| `red` | Red | recovery-only (foundation-fix, health-gate) |
| `yellow` | Yellow | limited (foundation-fix, docs, test-only, health-gate) |
| (no failure) | Green | all worker types |

When multiple failures are detected, the worst health impact wins:
any `red` impact sets main to red; otherwise any `yellow` sets main to yellow.

## Detection

Classification is deterministic and signal-based. Each category defines a set
of detection signals. The classifier matches these against worker output, git
diffs, CI results, and state markers.

### Confidence Levels

| Confidence | Signals Matched |
|------------|----------------|
| high | 3 or more |
| medium | 2 |
| low | 1 |

### Signal Sources

| Source | Used By |
|--------|---------|
| Worker stdout/stderr | `worker-timeout`, `worker-silent`, `validation-failed` |
| Git diff output | `forbidden-files-touched`, `secret-leak` |
| PR body/comments | `validation-missing`, `secret-leak` |
| Health state marker | `main-red`, `state-drift` |
| Generated code diff | `generated-stale` |
| Docs authority map | `docs-authority-conflict` |
| Migration SQL | `destructive-migration` |
| Auth test results | `auth-regression` |
| Parallel PR analysis | `semantic-conflict` |
| Cost/token tracking | `cost-overrun`, `token-overrun` |

## Recovery Routing

Each category maps to a recovery action and worker type:

| Category | Recovery Worker Type |
|----------|---------------------|
| `worker-timeout` | retry with reduced scope |
| `worker-silent` | debug and relaunch |
| `forbidden-files-touched` | revert and relaunch |
| `validation-missing` | request validation run |
| `validation-failed` | fix failures |
| `main-red` | foundation-fix |
| `generated-stale` | foundation-fix |
| `docs-authority-conflict` | docs |
| `state-drift` | state reconciler |
| `secret-leak` | security incident response |
| `destructive-migration` | migration audit |
| `auth-regression` | foundation-fix |
| `semantic-conflict` | manual merge resolution |
| `cost-overrun` | scope review |
| `token-overrun` | task splitting |

## Relationship to Existing Taxonomy

The existing `failure-taxonomy.md` defines categories for the post-merge health
gate script (`classify-health-failure.js`). This policy extends that taxonomy
for the broader self-healing pipeline:

| Existing Category | Maps To |
|-------------------|---------|
| `runtime compile` | `validation-failed` (build check) |
| `dependency/generate` | `generated-stale` or `validation-failed` |
| `boundary guard` | `forbidden-files-touched` |
| `docs guard` | `docs-authority-conflict` |
| `unknown` | Manual triage required |

The existing taxonomy remains the source of truth for the health gate script.
This policy provides the broader classification used by the self-healing
orchestrator for follow-up issue generation and recovery routing.

## Usage

The taxonomy JSON is consumed by:
- Self-healing orchestrator (failure classification and routing)
- Follow-up issue generator (recovery worker type selection)
- Health gate reporter (severity and health impact mapping)
- Launch gate (worker permission decisions based on health state)

## References

- [failure-taxonomy.md](failure-taxonomy.md) — Health gate failure categories
- [self-healing.md](self-healing.md) — Self-healing pipeline overview
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema for recovery workers
- [SOP.md](SOP.md) — Full lifecycle flow
