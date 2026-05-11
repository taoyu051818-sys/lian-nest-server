# Parallel Work Policy

Defines how multiple AI workers may operate concurrently without conflicts.
This policy prevents workers from stepping on each other's changes and
establishes the coordination rules for the orchestrator.

> **Reference:** [SOP.md](SOP.md) for lifecycle flow,
> [worker-task-contract.md](worker-task-contract.md) for the task JSON schema,
> [endpoint-migration-queue.md](../migration/endpoint-migration-queue.md) for
> slice dependency graph.

---

## Conflict Groups

A conflict group is a set of tasks that MUST NOT run in parallel because they
touch overlapping files or have semantic dependencies.

| Group | Tasks | Reason |
|-------|-------|--------|
| `auth-core` | A1, A2, A3, A4, A5, A6 | Serial chain — each builds on the previous |
| `posts` | P1, P2, P3, P4 | P2–P4 depend on P1; share `posts.service.ts` |
| `feed` | F1 | Independent after A2 |
| `messages` | M1 | Independent after A2 |
| `notifications` | N1 | Independent after A2 |
| `profile` | PR1 | Independent after A2 |
| `migration-docs` | Legacy shutdown matrix, acceptance checklist | Docs-only, low conflict |
| `ai-policy-docs` | Worker checklist, parallel work policy | Docs-only, low conflict |

---

## Parallelism Rules

### Rule 1: Serial Within a Conflict Group

Tasks in the same conflict group MUST execute sequentially. The orchestrator
launches the next task in a group only after the previous one merges or is
confirmed complete.

```
A1 → A2 → A3 → A4/A5 (parallel OK) → A6
P1 → P2, P3, P4 (parallel OK after P1)
```

### Rule 2: Parallel Across Independent Groups

Tasks in different conflict groups MAY run in parallel if:

- They do not share any files (check `allowedFiles` intersection).
- Neither depends on the other (check `dependsOn` in the task contract).
- Both are based on the same `main` commit.

```
A2 merged → F1 ∥ P1 ∥ M1 ∥ N1 ∥ PR1  (all parallel)
```

### Rule 3: Docs Tasks Are Low-Conflict

Tasks whose `allowedFiles` are exclusively under `docs/` MAY run in parallel
with each other and with code tasks, provided no file overlap exists.

### Rule 4: No Cross-Group File Sharing

If two tasks touch the same file, they are in the same conflict group — even if
the semantic dependency is unclear. The orchestrator MUST NOT launch them in parallel.

---

## Coordinator Responsibilities

The orchestrator (or batch executor) MUST:

1. **Assign conflict groups** — Every task JSON includes a `conflictGroup` field.
2. **Enforce serial execution within groups** — Do not launch a second task in a
   group while the first is in-flight.
3. **Detect stale branches** — Before launching a parallel task, verify the
   branch is based on the current `main` HEAD.
4. **Rebase or abort on conflict** — If a parallel PR has merge conflicts, the
   orchestrator rebases and re-validates, or aborts and reassigns.
5. **Track completion** — Use `agent:done` comments or merge events to know
   when a task is finished before launching the next in its group.

---

## Worker Responsibilities

Workers MUST:

1. **Respect `allowedFiles`** — Do not edit files outside the assigned boundary,
   even to fix adjacent issues.
2. **Rebase before PR** — Ensure the branch is current with `main` to minimize
   merge conflicts.
3. **Report blockers immediately** — If a dependency is not yet merged, do not
   proceed. Comment on the issue with the blocker.
4. **Not self-assign parallel work** — A single worker instance must not run
   multiple tasks simultaneously unless the orchestrator explicitly assigns
   them as a batch.

---

## Merge Order

When multiple parallel PRs are ready, merge fewest-dependents first, rebase
remaining PRs on new `main`, re-validate, and repeat. On equal dependency
counts, prefer smaller diff size.

---

## Escalation

If a conflict cannot be resolved by rebase: workers comment conflict details on
their issues, the orchestrator pauses the conflict group, and the architect or
repo-owner decides which PR takes precedence.
