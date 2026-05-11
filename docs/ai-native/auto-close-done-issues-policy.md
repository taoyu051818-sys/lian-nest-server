# Auto-Close Done Issues Policy

Gate conditions and human boundaries for the auto-close-done-issues
script. This policy defines when issues may be closed automatically
and when human intervention is required.

> **Closes:** [#741](https://github.com/taoyu051818-sys/lian-nest-server/issues/741)

---

## Gate Conditions

An issue passes the auto-close gate when **all** conditions are met:

| # | Gate | Source | Blocking |
|---|------|--------|----------|
| 1 | Issue has `agent:done` label | `gh issue view` labels | Yes |
| 2 | A linked PR is merged into main | `gh pr list --state merged` | Yes |
| 3 | Main health is green | `.github/ai-state/main-health.json` | Yes (skippable) |
| 4 | Issue is not already CLOSED | `gh issue view` state | Yes |

If any gate fails, the issue is reported but **not closed**.

### Health Gate Modes

| Mode | Behavior |
|------|----------|
| Default | Reads `main-health.json`; non-green blocks close |
| `-SkipHealthCheck` | Bypasses health gate; use when health verified independently |
| File missing | Health check skipped; issues eligible |

---

## Human Boundaries

These scenarios **require human decision** and cannot be auto-resolved:

| Scenario | Why human required | Resolution |
|----------|--------------------|------------|
| No linked merged PR | Insufficient evidence of completion | Human reviews and closes manually |
| Main health non-green | Closing during instability masks regressions | Wait for green or human override with `-SkipHealthCheck` |
| PR merged but issue has `agent:blocked` | Contradictory state | Human resolves label conflict |
| Issue linked to multiple PRs (some unmerged) | Partial completion | Human decides if work is done |
| Issue has `wip` or `do-not-close` labels | Explicit operator hold | Human removes hold label first |

### Label Conflict Resolution

When an issue has both `agent:done` and another `agent:*` label, the
script removes **all** `agent:*` labels during close. This prevents
label drift from prior states. If the conflicting state indicates
incomplete work (e.g., `agent:blocked`), the human boundary above
applies.

---

## Preview-First Safety

The auto-close script follows the preview-first contract:

1. **Default mode is dry-run.** No issues closed, no labels removed.
2. **`-DryRun` flag** is explicit confirmation for CI pipelines.
3. **`-Execute` flag** is required for any mutation.
4. **`-DryRun` and `-Execute` are mutually exclusive.** Using both
   together is an error.

### Dry-Run Output

In dry-run mode the script reports:

- Which issues would be closed (with linked PR numbers)
- Which issues have no merged PR (skipped)
- Which issues are blocked by health gate
- Which issues are already closed

Exit code 1 in dry-run signals actionable items exist.

---

## Confirmation Gate

The `-Execute` flag serves as the confirmation gate. There is no
additional typed-confirmation prompt because:

1. The script operates on issues, not infrastructure.
2. The closing action is reversible (issues can be reopened).
3. Every close posts an idempotent audit comment with markers.

### Idempotent Audit Comment

Every closed issue receives:

```
<!-- ai-auto-close:begin -->
Auto-closed: linked PR #N has been merged into main.
Main health at close: green
<!-- ai-auto-close:end -->
```

The `<!-- ai-auto-close:begin/end -->` markers enable:
- Idempotent detection on re-runs
- Audit trail for post-incident review
- Downstream parsing by state reconciler

---

## WebUI Integration

When surfaced in the WebUI action console, auto-close follows the
control-map principles:

| Principle | Enforcement |
|-----------|-------------|
| Preview-first | WebUI calls `/api/actions/preview` before `/api/actions/execute` |
| No secrets | All payloads pass through `sanitizeObject` |
| Loopback-only | Server binds to `127.0.0.1` |
| Audit trail | Every execute writes an audit entry |

The WebUI action for auto-close is read-only by default. The execute
path requires explicit operator confirmation through the standard
risk gate chain (see [webui-control-map.md](webui-control-map.md)).

---

## Non-Goals

- Auto-closing issues without a merged PR link.
- Closing issues during non-green main health (without explicit override).
- Modifying issue assignees, milestones, or project fields.
- Reopening previously closed issues.
- Touching `src/**`, `prisma/**`, or any runtime code.

---

## Rollback

If an issue is closed in error:

1. Reopen the issue: `gh issue reopen N --repo owner/name`
2. Re-apply labels if needed: `gh issue edit N --add-label "agent:done"`
3. Remove the audit comment if desired (manual)

The closing comment markers make it easy to identify auto-closed
issues for bulk rollback if needed.

---

## See Also

- [Auto-Close Done Issues](auto-close-done-issues.md) — Script usage and parameters
- [Issue Lifecycle](issue-lifecycle.md) — State machine and label definitions
- [WebUI Control Map](webui-control-map.md) — Action risk gates and audit
- [Controlled Auto-Merge](controlled-auto-merge.md) — Batch merge policy
- [State Reconciler](state-reconciler.md) — Drift detection companion
