# State Reconciler Write Mode

Adds an opt-in `-Write` flag to `state-reconciler.ps1` so it can execute
safe label transitions instead of only printing suggestions.

## Overview

The state reconciler detects label/PR/worker state drift. By default it
is read-only: it reports drift but never mutates GitHub issues.

Write mode (`-Write`) narrows the gap between detection and remediation.
When enabled, the reconciler executes **safe** label transitions via
`gh api`. Drift rules that require human judgment are still printed as
suggestions and are **not** auto-applied.

Dry-run remains the default. `-Write` is an explicit opt-in.

## Usage

```powershell
# Dry-run (default) -- no mutation
./scripts/ai/state-reconciler.ps1 -Repo "owner/name"

# Suggestions only -- prints gh issue edit commands
./scripts/ai/state-reconciler.ps1 -Repo "owner/name" -Apply

# Write mode -- executes safe label transitions
./scripts/ai/state-reconciler.ps1 -Repo "owner/name" -Write

# Explicit dry-run flag (CI guard)
./scripts/ai/state-reconciler.ps1 -Repo "owner/name" -DryRun
```

`-DryRun`, `-Apply`, and `-Write` are mutually exclusive. Specifying
more than one produces an error.

## Safe Transitions

Only drift rules with unambiguous, low-risk remediation are auto-applied
in write mode. All other rules are logged as `[SKIP]` and their
suggestions are printed for manual review.

| Drift Rule | Auto-Applied Action | Rationale |
|---|---|---|
| `merged-pr-stale-label` | Remove stale label, add `agent:done` | PR is merged; label must reflect completion. |
| `stale-running` | Remove `agent:running`, add `agent:blocked` | Issue is stale beyond threshold; blocked is the next valid state. |

### Rules NOT auto-applied

These rules require human judgment and are always skipped in write mode:

| Drift Rule | Why it needs a human |
|---|---|
| `done-without-merge` | Re-open work or close? Context-dependent. |
| `merged-pr-open-issue` | Closing issues is a broader decision. |
| `stale-queued` | Re-triage needs queue owner input. |
| `blocked-with-open-pr` | Resume or mark done? Depends on PR readiness. |
| `done-with-closed-pr` | Re-open work or close? Context-dependent. |
| `multiple-agent-labels` | Which label is correct depends on context. |
| Projection drift rules | Require projection file updates, not label changes. |

## Constraints

- **Dry-run by default.** `-Write` is an explicit opt-in flag.
- **Fixture guard.** `-Write` cannot be combined with `-FixturePath` or
  `-FixtureDir`. It requires a live GitHub repo (`-Repo`).
- **Safe subset only.** Only rules with unambiguous remediation are
  executed. Everything else is skipped with a `[SKIP]` log line.
- **Idempotent.** Removing an absent label is a no-op (logged, not an
  error). Adding an already-present label fails at the API level and is
  reported as `[FAIL]`.
- **Audit trail.** Every mutation is logged to stdout: `[WRITE]` for
  applied changes, `[SKIP]` for non-safe rules, `[FAIL]` for errors.
- **Exit code.** Exits 0 if all transitions succeed (or are skipped).
  Exits 1 if any transition fails.

## Output Example

```
State Reconciler
======================================
Mode: WRITE (will execute safe label transitions via gh api)

Querying GitHub: owner/repo
Evaluating 3 issue(s)...

=== STATE DRIFT REPORT ===

Found 2 drift item(s):

  [!!] #120 Feature X
       Rule:    merged-pr-stale-label
       Detail:  PR #135 merged but issue still has agent:running
       Suggest: agent:running -> agent:done
       Severity: error

  [! ] #131 Feature Y
       Rule:    stale-running
       Detail:  agent:running for 96h with no open PR
       Suggest: agent:running -> agent:blocked (or close if abandoned)
       Severity: warning

=== END DRIFT REPORT ===

=== WRITE MODE (executing safe label transitions) ===

  [WRITE] #120: removed label 'agent:running'
  [WRITE] #120: added label 'agent:done'
  [WRITE] #131: removed label 'agent:running'
  [WRITE] #131: added label 'agent:blocked'

--- Remediation Summary ---
  Applied: 2
  Skipped: 0 (no safe transition)
  Failed:  0
```

## Integration

Write mode fits into the orchestration workflow as the remediation step:

1. **Batch launcher** picks up queued issues.
2. **Workers** implement and publish results.
3. **State reconciler -Write** detects and fixes safe drift.
4. **Repo-owner** reviews the remaining unsafe drift suggestions.

For CI pipelines, use `-DryRun` to enforce no mutation. For manual
review, use `-Apply` to see suggested commands. For automated
remediation of safe rules, use `-Write`.

## See Also

- [State Reconciler](state-reconciler.md) -- Core reconciler documentation
- [State Reconciler Active Workers](state-reconciler-active-workers.md) -- Projection drift rules
- [Issue Lifecycle](issue-lifecycle.md) -- State machine and label definitions
- [#589](https://github.com/nicholasxsxs/lian-nest-server/issues/589) -- This feature
