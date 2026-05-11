# Control Plane Adoption Checklist

Step-by-step guide for moving from manual launcher use to governed
self-cycle usage. Each section is a gate — do not skip ahead.

> **Audience:** Operators adopting the AI-native control plane for the
> first time, or teams migrating from ad-hoc `batch-launch.ps1` usage to
> the full self-cycle pipeline.

---

## Phase 0 — Prerequisites

Before touching any scripts, verify the local environment is ready.

- [ ] **PowerShell 7+** installed (`pwsh --version` shows 7.x or later).
- [ ] **gh CLI** authenticated (`gh auth status` shows Logged in).
- [ ] **Node.js** and **npm** installed (`node --version`, `npm --version`).
- [ ] **Claude Code** CLI available (`claude --version`).
- [ ] **Repository cloned** with `main` branch checked out and up to date.
- [ ] **No stale worktrees** — run the worktree janitor in dry-run mode:
      ```powershell
      ./scripts/ai/worktree-janitor.ps1
      ```
      Clean up any `merged` or `merged+dirty` entries before proceeding.

---

## Phase 1 — Understand the Control Plane

Read these docs before running any automation. Skimming is not enough —
each doc defines a contract that the scripts enforce at runtime.

| Doc | Why It Matters |
|-----|----------------|
| [orchestration.md](orchestration.md) | Batch launcher overview, task contract, worktree isolation |
| [launch-gate.md](launch-gate.md) | Health-aware launch permissions, conflict detection |
| [main-health-policy.md](main-health-policy.md) | Health states (green/yellow/red/black) and what each permits |
| [parallel-work-policy.md](parallel-work-policy.md) | Conflict groups, shared locks, docs-only exemption |
| [worker-task-contract.md](worker-task-contract.md) | Task JSON schema — every field the scripts consume |
| [self-cycle-runner.md](self-cycle-runner.md) | Full pipeline: reconcile → health → gate → launch → summary |
| [seed-constitution.md](seed-constitution.md) | Immutable boundaries no worker may cross |

- [ ] Read the seven docs above.
- [ ] Confirm you understand the difference between `conflictGroup` and
      `sharedLocks` (see [orchestration.md §Shared Locks](orchestration.md#shared-locks-conflictgroup-vs-sharedlocks)).

---

## Phase 2 — Health Marker Setup

The self-cycle runner requires a main health marker before it can
proceed past Step 2.

1. **Run the post-merge health gate:**
   ```powershell
   node scripts/post-merge-health-gate.js --quick
   ```

2. **Write the health marker:**
   ```powershell
   ./scripts/ai/write-main-health-state.ps1 -State green -Checks "manual baseline"
   ```

3. **Verify the marker exists:**
   ```powershell
   cat .github/ai-state/main-health.json
   ```
   Confirm the JSON contains `"state": "green"`.

- [ ] Health marker file exists at `.github/ai-state/main-health.json`.
- [ ] State is `green` (or the appropriate state for current main health).

---

## Phase 3 — First Dry-Run Cycle

Run the self-cycle in dry-run mode to validate the full pipeline without
making changes.

### Option A: From a Task File

```powershell
./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/your-task.json
```

### Option B: From Issue Discovery

```powershell
./scripts/ai/run-self-cycle.ps1 -IssueLabel "agent:codex-action-needed" -Repo owner/name
```

### Option C: Fixture-Based (No GitHub Access)

```powershell
./scripts/ai/run-self-cycle.ps1 -DryRunFixture ./tests/fixtures/self-cycle
```

- [ ] Dry-run completes with exit code 0.
- [ ] Launch gate report shows `allAllowed: true` for your task(s).
- [ ] No conflict group or shared lock violations detected.
- [ ] Health state displayed matches your Phase 2 marker.

---

## Phase 4 — First Execute Cycle

After a successful dry-run, run with `-Execute` to launch an actual
worker.

1. **Confirm main health is green** (Step 2 marker is current).
2. **Run the self-cycle in execute mode:**
   ```powershell
   ./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/your-task.json -Execute
   ```
3. **At the confirmation prompt**, review the launch plan and confirm.
4. **Monitor the worker** — it runs in a worktree under `.claude/worktrees/`.
5. **After completion**, verify:
   - [ ] Worker committed to its branch.
   - [ ] `git diff main --name-only` shows only allowed files changed.
   - [ ] Validation commands passed (check PR body for evidence).

---

## Phase 5 — Batch Operations

Once single-task cycles are comfortable, scale to batches.

1. **Build a batch task file** — array of task objects with distinct
   `conflictGroup` values. See
   [orchestration.md §Task Array](orchestration.md#task-array-batch).

2. **Dry-run the batch:**
   ```powershell
   ./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/batch-wave-N.json
   ```

3. **Review the shared-lock preflight** — look for `CONFLICT` entries.
   Tasks sharing a lock must run sequentially.

4. **Execute the batch:**
   ```powershell
   ./scripts/ai/run-self-cycle.ps1 -TaskFile ./tasks/batch-wave-N.json -Execute
   ```

5. **Respect the max-task safety limit** — default is 10. Override with
   `-MaxTasks <N>` (valid range: 1–100) only after validating the batch.

- [ ] Each task has a unique `conflictGroup` (or is docs-only).
- [ ] Shared locks are declared for tasks touching the same physical file.
- [ ] Dry-run passes before execute.
- [ ] Batch size is within the max-task limit (or explicitly overridden).

---

## Phase 6 — Post-Merge Operations

After workers merge, maintain the control plane state.

1. **Run the health gate** after each merge:
   ```powershell
   node scripts/post-merge-health-gate.js --quick
   ```

2. **Update the health marker** if state changed:
   ```powershell
   ./scripts/ai/write-main-health-state.ps1 -State <new-state> -Checks "post-merge"
   ```

3. **Run the worktree janitor** to clean up merged worktrees:
   ```powershell
   ./scripts/ai/worktree-janitor.ps1 -RemoveMerged
   ```

4. **Run the state reconciler** to detect drift:
   ```powershell
   ./scripts/ai/state-reconciler.ps1
   ```

- [ ] Health marker reflects current main state.
- [ ] Merged worktrees cleaned up.
- [ ] No drift detected by state reconciler (or drift is documented).

---

## Phase 7 — Ongoing Governance

These are recurring practices, not one-time setup.

### Before Every Batch

- [ ] Check main health state (`cat .github/ai-state/main-health.json`).
- [ ] Run worktree janitor in dry-run mode.
- [ ] Dry-run the batch before executing.

### After Every Merge

- [ ] Run post-merge health gate.
- [ ] Update health marker if state changed.
- [ ] Clean up merged worktrees.

### When Health State Is Not Green

| State | Action |
|-------|--------|
| **Yellow** | Only foundation-fix, docs, health-repair, and research workers may launch. Defer runtime feature work. |
| **Red** | Only foundation-fix and health-repair workers may launch. All in-flight workers paused. |
| **Black** | No automation. Manual intervention required. |

See [main-health-policy.md](main-health-policy.md) for the full matrix.

### When a Worker Fails

1. Check the worker's PR for validation evidence.
2. If the failure is in the worker's scope, open a new issue for a fix worker.
3. If the failure is outside scope, comment on the original issue with the blocker.
4. Never broaden a worker's scope to fix adjacent issues.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Runner exits at Step 2 | Missing health marker | Run Phase 2 health marker setup |
| Launch gate blocks task | Health state disallows worker type | Check [main-health-policy.md](main-health-policy.md) matrix |
| Duplicate conflict group error | Two tasks share a non-doc `conflictGroup` | Assign unique groups or make both docs-only |
| Shared lock conflict | Two tasks edit the same file without a lock | Add `sharedLocks` to task JSON |
| Max-task safety limit hit | Batch exceeds `-MaxTasks` | Reduce batch size or override with `-MaxTasks <N>` |
| Worker edits forbidden files | Task contract misconfigured | Fix `allowedFiles`/`forbiddenFiles` in task JSON |
| Worktree dirty after merge | Uncommitted changes in worktree | `git stash` or commit, then re-run janitor |

---

## References

- [Orchestration](orchestration.md) — batch launcher and task contract
- [Self-Cycle Runner](self-cycle-runner.md) — full pipeline walkthrough
- [Launch Gate](launch-gate.md) — pre-launch validation
- [Main Health Policy](main-health-policy.md) — health states and permissions
- [Worker Task Contract](worker-task-contract.md) — task JSON schema
- [Worker Acceptance Checklist](worker-acceptance-checklist.md) — PR review criteria
- [Seed Constitution](seed-constitution.md) — immutable boundaries
- [Local Ops Doctor](local-ops-doctor.md) — manual cleanup and diagnostics
