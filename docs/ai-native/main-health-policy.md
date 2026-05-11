# Main Health Launch Policy

Defines how the health state of the `main` branch controls whether AI worker
batches may be launched. The orchestrator MUST consult this policy before
dispatching any worker.

> **Cross-link TODO:** Link to `orchestration.md` once it lands on `main`.
> See issue #102.

---

## Health States

The main branch is in one of three states at all times. The orchestrator
determines state by running the post-merge health gate (`--quick` or `--full`).

| State | Gate Result | Meaning |
|-------|-------------|---------|
| **Green** | All checks pass | Main is healthy. All worker types may launch. |
| **Yellow** | Non-critical failure (e.g. test env flake, boundary guard warning) | Main has a known issue that does not block source compilation. Limited worker types may launch. |
| **Red** | Critical failure (e.g. build broken, type-check fails, Prisma schema invalid) | Main is broken. Only recovery workers may launch. |

### State Detection

```
node scripts/post-merge-health-gate.js --quick
```

- Exit 0 with no critical failures -> **Green**
- Exit 1 with failure category in `test env` or `boundary guard` -> **Yellow**
- Exit 1 with failure category in `runtime compile`, `dependency/generate`, `database foundation`, or `conflict refresh` -> **Red**
- Script unavailable or crashes -> **Red** (fail-safe)

---

## Worker Types and Launch Permissions

| Worker Type | Green | Yellow | Red |
|-------------|:-----:|:------:|:---:|
| Runtime feature (NestJS source, API endpoints, services) | Yes | No | No |
| Foundation fix (dependency, Prisma, build config) | Yes | Yes | Yes |
| Docs / contract / policy | Yes | Yes | No |
| Health gate / CI repair | Yes | Yes | Yes |
| Test-only (add or fix tests, no source change) | Yes | Yes | No |
| Refactor (source code restructure) | Yes | No | No |

### Rationale

- **Runtime feature workers** require a green main because their changes must
  compile and pass tests on top of a healthy base.
- **Foundation fix workers** are explicitly allowed in all states because they
  exist to repair the broken state.
- **Docs workers** are allowed in yellow because they cannot worsen a build
  failure and do not depend on runtime health.
- **Health gate / CI repair workers** are always allowed — blocking them would
  create a deadlock where main stays red.
- **Test-only workers** are blocked in red because test failures may mask the
  real breakage.
- **Refactor workers** are blocked in yellow and red because refactors on an
  unstable base amplify risk.

---

## Post-Merge Stop Conditions

When the health gate fails after a merge, the orchestrator MUST:

1. **Classify the failure** using the categories in
   [post-merge-health-gate.md](post-merge-health-gate.md).
2. **Set the health state** (yellow or red) based on the classification above.
3. **Cancel or defer in-flight workers** whose type is not permitted in the
   current state.
4. **Block new launches** for disallowed worker types until health recovers.
5. **Dispatch a recovery worker** if the failure is red-state:
   - Assign the appropriate foundation-fix or health-gate-repair task.
   - The recovery worker's `allowedFiles` MUST cover the failing area.
6. **Re-run the health gate** after the recovery PR merges.
7. **Resume normal launches** only when state returns to green (or yellow for
   permitted types).

### In-Flight Worker Handling

If a worker is already running when health drops to yellow or red:

| Worker State | Action |
|--------------|--------|
| PR not yet opened | Abort the worker. Comment on the issue explaining the health stop. |
| PR open, not reviewed | Hold the PR. Do not request review until main recovers. Re-validate after recovery. |
| PR approved, not merged | Block merge. Re-validate after main recovers. |
| PR merged (caused the failure) | The merged PR is the recovery target. Launch a revert or fix worker. |

---

## Orchestrator Checklist

Before launching any worker batch:

- [ ] Run `node scripts/post-merge-health-gate.js --quick` (or check latest result).
- [ ] Determine health state: green / yellow / red.
- [ ] For each worker in the batch, verify its type is permitted in the current state.
- [ ] If any worker is blocked, defer it and record the reason.
- [ ] If state is red, launch a recovery worker first.
- [ ] After recovery merges, re-run the health gate before resuming deferred workers.

---

## References

- [post-merge-health-gate.md](post-merge-health-gate.md) — Health gate runner and failure categories.
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema with `conflictGroup` and `allowedFiles`.
- [parallel-work-policy.md](parallel-work-policy.md) — Conflict groups and parallelism rules.
- [SOP.md](SOP.md) — Full lifecycle flow.
