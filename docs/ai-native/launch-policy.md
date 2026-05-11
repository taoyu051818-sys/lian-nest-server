# Launch Policy (Machine-Readable)

Defines the canonical, machine-readable launch policy that controls worker
scheduling based on main branch health and lock-aware conflict resolution.

> **Closes:** [#356](https://github.com/taoyu051818-sys/lian-nest-server/issues/356)

---

## Purpose

This policy codifies the rules from [main-health-policy.md](main-health-policy.md),
[launch-gate.md](launch-gate.md), and [parallel-work-policy.md](parallel-work-policy.md)
into a single JSON file that scripts and automation can consume without parsing
markdown.

The JSON lives at `.github/ai-policy/launch-policy.json` and is the source of
truth for:

- Health state definitions and their meaning
- Worker type classification rules
- Launch permission matrix (which worker types run in which health states)
- Conflict group definitions and shared lock rules
- Timeout defaults and dependency chains
- Post-merge stop conditions and in-flight worker handling

---

## File Location

```
.github/ai-policy/launch-policy.json
```

---

## Schema Overview

| Section | Purpose |
|---------|---------|
| `policyVersion` | Schema version for forward compatibility |
| `healthStates` | Defines green/yellow/red/black states |
| `workerTypes` | Worker type names and classification rules |
| `launchPermissionMatrix` | Which worker types may launch per health state |
| `conflictGroups` | Named conflict groups and their task memberships |
| `sharedLocks` | Fine-grained resource locks (package, prisma-schema, app-module, docs-index) |
| `timeoutDefaults` | Default soft/hard time budgets by worker type |
| `dependencyFacts` | Default blockedBy chains by worker type |
| `postMergeStopConditions` | Orchestrator steps when health gate fails |
| `blackStateRules` | Black state escalation rules |

---

## Health States

| State | Gate Result | Allowed Workers |
|-------|-------------|-----------------|
| **Green** | All checks pass | All types |
| **Yellow** | Non-critical failure | foundation-fix, docs, health-repair, research |
| **Red** | Critical failure | foundation-fix, health-repair, research |
| **Black** | Unrecoverable | None (manual intervention) |

---

## Launch Permission Matrix

| Worker Type | Green | Yellow | Red | Black |
|-------------|:-----:|:------:|:---:|:-----:|
| Runtime feature | Yes | No | No | No |
| Foundation fix | Yes | Yes | Yes | No |
| Docs | Yes | Yes | No | No |
| Health / CI repair | Yes | Yes | Yes | No |
| Test-only | Yes | Yes | No | No |
| Research | Yes | Yes | Yes | No |

---

## Shared Locks

Tasks may declare `sharedLocks` to claim fine-grained locks on common resources.
Two tasks claiming the same lock cannot run in parallel.

| Lock Name | Files | Rule |
|-----------|-------|------|
| `package` | `package.json`, `package-lock.json` | Single-writer |
| `prisma-schema` | `prisma/**` | Single-writer |
| `app-module` | `src/app.module.ts` | Single-writer (positional merge semantics) |
| `docs-index` | `docs/**/*.md` | Low-conflict, no file overlap required |

---

## Conflict Groups

Workers in the same conflict group MUST execute sequentially. The orchestrator
launches the next task only after the previous one merges.

Docs-only tasks (all `allowedFiles` under `docs/`) are exempt from duplicate-group
rejection.

See the `conflictGroups` section in the JSON for the full group table.

---

## Timeout Defaults

Default budgets by worker type. Task JSON may override.

| Worker Type | Soft (min) | Hard (min) | Extension (min) |
|-------------|:----------:|:----------:|:----------------:|
| Foundation fix | 20 | 40 | 15 |
| Health repair | 25 | 50 | 10 |
| Docs | 20 | 40 | 10 |
| Runtime feature | 30 | 60 | 15 |
| Test-only | 20 | 40 | 10 |
| Research | 15 | 30 | 10 |

---

## Dependency Chains

Default `blockedBy` relationships. Task JSON may override.

```
foundation-fix → health-repair → docs → runtime-feature
foundation-fix → health-repair → test-only
research (no dependencies)
```

---

## Post-Merge Stop Conditions

When the health gate fails after a merge, the orchestrator MUST:

1. Classify the failure using post-merge-health-gate categories.
2. Set health state (yellow or red) based on classification.
3. Cancel or defer in-flight workers whose type is not permitted.
4. Block new launches for disallowed worker types.
5. Dispatch a recovery worker if red-state.
6. Re-run health gate after recovery PR merges.
7. Resume normal launches when state returns to green/yellow.

### In-Flight Worker Handling

| Worker State | Action |
|--------------|--------|
| PR not opened | Abort. Comment on issue. |
| PR open, not reviewed | Hold until main recovers. |
| PR approved, not merged | Block merge. Re-validate after recovery. |
| PR merged (caused failure) | Launch revert or fix worker. |

---

## Consuming the JSON

Scripts should read `.github/ai-policy/launch-policy.json` and use:

- `launchPermissionMatrix.matrix[state]` to get allowed worker types for the
  current health state.
- `workerTypes[type].classification` to classify a task into a worker type.
- `conflictGroups.groups` to validate no parallel conflicts exist.
- `sharedLocks.locks` to validate no shared lock overlaps exist.
- `timeoutDefaults.byWorkerType[type]` for default budget values.
- `dependencyFacts.chains[type]` for default blockedBy chains.

---

## References

- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions (prose).
- [launch-gate.md](launch-gate.md) — Launch gate checker and report format.
- [parallel-work-policy.md](parallel-work-policy.md) — Conflict groups and parallelism rules.
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema.
- [backend-task-json-examples.md](backend-task-json-examples.md) — Example task JSONs by worker tier.
- `.github/ai-state/main-health.json` — Current health state marker.
- `.github/ai-policy/launch-policy.json` — Machine-readable policy (this file's source).
