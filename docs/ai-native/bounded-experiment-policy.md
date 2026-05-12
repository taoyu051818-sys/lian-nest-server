# Bounded Experiment Policy

Defines how agent ideas become bounded experiments with file boundaries,
validation gates, success metrics, and rollback procedures.

> **Closes:** [#895](https://github.com/taoyu051818-sys/lian-nest-server/issues/895)
>
> **Reference:** [worker-task-contract.md](worker-task-contract.md) for the
> task JSON schema, [parallel-work-policy.md](parallel-work-policy.md) for
> conflict groups, [failure-taxonomy-policy.md](failure-taxonomy-policy.md)
> for failure classification.

---

## Purpose

Agent ideas — from meta-signal suggestions, planning console output, or
human-authored issues — are proposals, not tasks. This policy defines the
transformation boundary between an idea and an executable experiment. Every
experiment MUST be scoped, validated, measurable, and reversible before a
worker touches code or docs.

The policy prevents three failure modes:

1. **Unbounded scope creep** — an idea grows beyond what a single worker can
   safely deliver.
2. **Unmeasurable work** — a worker delivers output but there is no objective
   way to determine if the experiment succeeded.
3. **Irreversible changes** — a failed experiment leaves the repo in a state
   that requires manual recovery.

---

## Lifecycle

```
  ┌──────────┐     ┌──────────────┐     ┌───────────┐     ┌───────────┐
  │  Idea    │────▶│  Scope       │────▶│  Execute  │────▶│  Evaluate │
  │  (raw)   │     │  (bounded)   │     │  (worker) │     │  (metrics)│
  └──────────┘     └──────────────┘     └───────────┘     └─────┬─────┘
                                                                │
                                              ┌─────────────────┼────────────────┐
                                              ▼                 ▼                ▼
                                         ┌─────────┐     ┌──────────┐     ┌──────────┐
                                         │ Success │     │ Continue │     │ Rollback │
                                         │ (merge) │     │ (iterate)│     │ (revert) │
                                         └─────────┘     └──────────┘     └──────────┘
```

| Phase | Owner | Gate |
|-------|-------|------|
| Idea | Human or meta-signal engine | None — raw proposals are unvalidated |
| Scope | Human or issue-to-task compiler | Compiler rejects missing `allowedFiles` or `validationCommands` |
| Execute | Worker | Launch gate checks health, conflict groups, shared locks |
| Evaluate | Orchestrator + human reviewer | Success metrics from task contract + PR review |

---

## Scoping Rules

An idea becomes an experiment when it has all of the following:

### 1. File Boundary (`allowedFiles`)

Every experiment MUST declare `allowedFiles` — a set of glob patterns that
defines exactly which files the worker may edit. The boundary guard enforces
this at runtime.

| Boundary Size | Risk | Approval |
|---------------|------|----------|
| 1–3 files | Low | Auto-launch eligible |
| 4–10 files | Medium | Launch gate validates conflict groups |
| > 10 files | High | Requires architect review before launch |

`forbiddenFiles` SHOULD be declared to prevent accidental edits to sensitive
paths (`.env`, `src/generated/**`, `node_modules/**`).

### 2. Validation Gate (`validationCommands`)

Every experiment MUST declare at least one validation command. The worker
runs these before opening a PR and attaches output as validation evidence.

| Validation Type | Example | When to Use |
|-----------------|---------|-------------|
| Type check | `npm run check` | Any change to `src/**` or `docs/**` |
| Build | `npm run build` | Runtime or dependency changes |
| Test suite | `npm test` | Behavioral changes |
| Link check | `npm run docs:check-links` | Docs-only changes |
| Guard script | `npm run ops:guard` | Policy or inventory changes |

The orchestrator rejects experiments with zero `validationCommands`.

### 3. Success Metrics

Every experiment MUST define how success is measured. Metrics are declared
in the issue body or `promptHandoff` — they are not a task JSON field because
they are semantic, not structural.

| Metric Type | Example | Measurable By |
|-------------|---------|---------------|
| Pass/fail | `npm run check` exits 0 | Validation command exit code |
| Behavioral | "Auth guard rejects unauthenticated requests" | Test assertion |
| Documentation | "All cross-references resolve" | Link check script |
| Observability | "Worker heartbeat reports healthy" | Health state marker |

**Rule:** If an experiment's success cannot be measured by a validation
command or test assertion, the experiment is underspecified. The compiler
SHOULD warn; the reviewer MUST reject.

### 4. Rollback Plan

Every experiment MUST have a defined rollback path before execution begins.

| Experiment Type | Rollback Method |
|-----------------|-----------------|
| Docs-only | `git revert` the PR commit |
| Single-module code | `git revert` + re-run `npm run check` |
| Multi-module code | `git revert` + health gate re-run |
| Schema change | Revert migration + regenerate Prisma client |
| Dependency change | Revert `package.json` + `npm install` |

The rollback method is implicit for most experiments (`git revert`). The
experiment author MUST explicitly document the rollback when the default
revert is insufficient (e.g., schema migrations, data transformations).

---

## Experiment Lifecycle States

| State | Meaning | Transition |
|-------|---------|------------|
| **Proposed** | Idea exists as an issue or suggestion | → Scoped when `allowedFiles`, `validationCommands`, and success metrics are defined |
| **Scoped** | Compiler produced valid task JSON | → Executing when launch gate passes |
| **Executing** | Worker is running in a worktree | → Evaluating when worker opens PR |
| **Evaluating** | PR is open, validation output attached | → Succeeded / Continued / Rolled Back |
| **Succeeded** | PR merged, metrics pass | Terminal |
| **Continued** | PR merged, follow-up experiment needed | → Proposed (new issue) |
| **Rolled Back** | PR reverted due to metric failure | Terminal |

---

## Underspecified Experiment Handling

When the compiler or reviewer identifies an underspecified experiment:

| Missing Element | Compiler Action | Reviewer Action |
|-----------------|-----------------|-----------------|
| No `allowedFiles` | **Block** — exit non-zero | N/A (never reaches reviewer) |
| No `validationCommands` | **Block** — exit non-zero | N/A |
| No success metrics | **Warn** — emit task JSON with warning | **Reject PR** — comment requesting metrics |
| No rollback plan (standard) | **Pass** — implicit `git revert` | Accept with default revert |
| No rollback plan (schema/destructive) | **Warn** — flag for reviewer | **Reject PR** — comment requesting explicit plan |
| Overly broad `allowedFiles` | **Warn** — flag `*` or `**` patterns | **Reject PR** — request tighter boundary |

---

## Integration with Existing Systems

### Task Contract

This policy constrains the task JSON fields defined in
[worker-task-contract.md](worker-task-contract.md):

| Task JSON Field | Experiment Policy Constraint |
|-----------------|------------------------------|
| `allowedFiles` | MUST be non-empty, SHOULD be < 10 files |
| `forbiddenFiles` | SHOULD include `.env`, `src/generated/**`, `node_modules/**` |
| `validationCommands` | MUST be non-empty |
| `risk` | Derived from boundary size and change type |
| `budgets.maxFiles` | MUST align with `allowedFiles` count |

### Meta-Signal Suggestions

The meta-signal task suggestion engine
([meta-signal-task-suggestions.md](meta-signal-task-suggestions.md)) produces
ideas, not experiments. Each suggestion needs scoping before it enters the
experiment lifecycle. The planning console MUST NOT auto-launch workers from
suggestions without passing through the compiler.

### Failure Taxonomy

Failed experiments map to failure categories in
[failure-taxonomy-policy.md](failure-taxonomy-policy.md):

| Experiment Failure | Failure Category |
|--------------------|-----------------|
| Validation commands fail | `validation-failed` |
| Worker edits outside `allowedFiles` | `forbidden-files-touched` |
| Worker exceeds time budget | `worker-timeout` |
| Post-merge health gate fails | Depends on failure type |

### Loop Model

The experiment lifecycle maps to loop model phases
([loop-model.md](loop-model.md)):

| Experiment Phase | Loop Phase |
|------------------|------------|
| Proposed | Task queue read |
| Scoped | Launch gate |
| Executing | Worker dispatch |
| Evaluating | PR and review gate |
| Succeeded | Health gate (green) |
| Rolled Back | Health gate (red) → recovery worker |

---

## Worker Responsibilities

Workers executing bounded experiments MUST:

1. **Stay within `allowedFiles`** — do not edit files outside the declared
   boundary, even to fix adjacent issues.
2. **Run all `validationCommands`** — attach output as validation evidence
   in the PR body.
3. **Report blockers immediately** — if validation fails or the boundary is
   too tight, comment on the issue instead of expanding scope.
4. **Not self-expand scope** — if additional files need changes, stop and
   report the blocker. The human decides whether to expand the experiment.

---

## Reviewer Responsibilities

Reviewers evaluating experiment PRs MUST:

1. **Verify `allowedFiles` compliance** — check the diff against the declared
   boundary.
2. **Check validation evidence** — confirm all `validationCommands` ran and
   passed.
3. **Evaluate success metrics** — confirm the experiment achieved its stated
   goal or explain why it did not.
4. **Verify rollback feasibility** — confirm `git revert` (or the explicit
   rollback plan) would cleanly undo the change.

---

## References

- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema and field definitions
- [parallel-work-policy.md](parallel-work-policy.md) — Conflict groups and parallelism rules
- [failure-taxonomy-policy.md](failure-taxonomy-policy.md) — Failure classification and recovery routing
- [meta-signal-task-suggestions.md](meta-signal-task-suggestions.md) — Suggestion engine producing raw ideas
- [loop-model.md](loop-model.md) — Automated loop phases
- [launch-policy.md](launch-policy.md) — Launch permission matrix
- [issue-to-task-compiler.md](issue-to-task-compiler.md) — Compiler producing task JSON from issues
