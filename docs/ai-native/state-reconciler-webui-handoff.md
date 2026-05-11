# State Reconciler — WebUI Handoff

> **Issue:** #822

Defines how the WebUI should surface reconciler status, stale running workers,
PR drift, and human-required escalations to operators.

## Purpose

The state reconciler detects lifecycle drift between issue labels, PR state, and
worker evidence. Today its output is consumed by scripts and gap ledger entries
but has no dedicated WebUI surface. This document specifies what the WebUI
should display and which actions remain human-only.

## Reconciler Drift Rules

The reconciler evaluates eight issue-level drift rules:

| Rule | Severity | Auto-fixable | Description |
|------|----------|:------------:|-------------|
| `stale-running` | high | yes | Worker has been running >72h with no PR activity |
| `done-without-merge` | medium | no | Issue is `done` but PR is still open |
| `merged-pr-open-issue` | medium | no | PR is merged but issue lacks `done` label |
| `stale-queued` | low | no | Issue has been `queued` >7 days with no launch |
| `blocked-with-open-pr` | low | no | Issue is `blocked` but has an open PR |
| `merged-pr-stale-label` | low | yes | PR merged, issue still has `running` label |
| `done-with-closed-pr` | low | no | Issue is `done` but PR was closed without merge |
| `multiple-agent-labels` | low | no | Issue has more than one agent lifecycle label |

PR-level reconciliation (`reconcile-worker-prs.ps1`) evaluates eight additional
rules:

| Rule | Description |
|------|-------------|
| `running-pr-ready` | PR is ready for review but issue still shows `running` |
| `running-pr-draft` | PR is still draft but issue shows `running` > expected duration |
| `running-pr-conflicts` | PR has merge conflicts |
| `running-pr-checks-fail` | PR CI checks are failing |
| `done-without-pr` | Issue is `done` but no PR exists |
| `queued-with-open-pr` | Issue is `queued` but has an open PR |
| `blocked-with-ready-pr` | Issue is `blocked` but PR is ready |
| `stale-pr` | PR has had no activity >72h |

Projection drift rules (`state-reconciler-active-workers.md`):

| Rule | Description |
|------|-------------|
| `stale-worker-projection` | `active-workers.json` entry has no matching heartbeat |
| `running-missing-from-projection` | Heartbeat shows running worker not in projection |
| `stale-projection` | `capturedAt` is older than the staleness threshold |

## WebUI Surfaces

### 1. Reconciler Drift Panel (Control Console)

A new **Drift** panel on the Control Console aggregates all unresolved drift
items from the reconciler output.

**Display fields per item:**

| Field | Source |
|-------|--------|
| Issue number + title | Drift rule output |
| Rule ID | `stale-running`, `done-without-merge`, etc. |
| Severity | `low` / `medium` / `high` |
| Suggested transition | Label change recommended by reconciler |
| Evidence | Link to PR or heartbeat timestamp |

**Sort order:** high severity first, then by most recent evidence.

**Filtering:** Operators can filter by severity, rule ID, or issue number.

### 2. Stale Worker Indicators (Control Console)

Workers that match `stale-running` or heartbeat `stale` state should show:

- Red indicator badge on the worker row in the Active Workers table
- Elapsed time since last evidence (PR activity or heartbeat)
- Suggested action: "Consider closing stale branch" with link to issue

Workers in `running:no-output` state (>60s silent heartbeat) show a yellow
indicator. This is advisory — the reconciler does not auto-kill workers.

### 3. PR Drift Summary (Planning Console)

The Planning Console should surface PR-level reconciliation results as a
**PR Drift** section:

- Group by drift rule type
- Each entry shows: issue number, PR link, rule, suggested correction
- `running-pr-conflicts` and `running-pr-checks-fail` entries link directly
  to the PR for operator review

### 4. Escalation Queue (Control Console)

A dedicated **Escalations** panel aggregates items that require human judgment:

| Escalation type | Trigger | Suggested operator action |
|----------------|---------|--------------------------|
| `done-without-merge` | PR open >48h after issue marked done | Review and merge or reopen issue |
| `done-with-closed-pr` | PR closed without merge on done issue | Reopen PR or reopen issue |
| `merged-pr-open-issue` | PR merged but issue not marked done | Mark issue done |
| Projection drift | Active workers projection is stale | Run reconciler to refresh |

Escalations are never auto-resolved. The WebUI must not offer one-click
dismissal — operators must take the suggested action through the normal
workflow (merge PR, update labels, etc.).

## Human-Only Boundaries

The WebUI must **not** provide automation for these actions:

| Action | Why |
|--------|-----|
| Killing stale workers | Requires judgment about whether work is salvageable |
| Merging PRs | Requires human review and approval |
| Overriding health gate | Safety boundary — must be explicit operator decision |
| Dismissing escalations | Each escalation represents a real state inconsistency |

The reconciler's `-Write` mode can auto-apply only two safe transitions:
`merged-pr-stale-label` and `stale-running`. All other corrections require
human action through the WebUI or CLI.

## Data Flow

```
state-reconciler.ps1 --json
        |
        v
reconciler-output.json        (drift report with suggested transitions)
        |
        v
WebUI Control Console
  ├── Drift Panel             (all unresolved drift items)
  ├── Stale Worker Indicators (stale-running + heartbeat stale)
  └── Escalation Queue        (human-required items)

reconcile-worker-prs.ps1 --json
        |
        v
pr-reconciliation-output.json (PR-level corrections)
        |
        v
WebUI Planning Console
  └── PR Drift Section        (grouped by rule type)
```

## Emitter Integration

To surface reconciler output in the WebUI, a new emitter
(`emit-reconciler-webui-state.js`) should:

1. Read `reconciler-output.json` and `pr-reconciliation-output.json`
2. Read `active-workers.json` for projection drift cross-reference
3. Classify items into **drift** (auto-fixable) and **escalation** (human-only)
4. Produce a JSON snapshot at `.github/ai-state/reconciler-webui-state.json`

Proposed output schema:

```jsonc
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "driftItems": [
    {
      "issue": 258,
      "rule": "stale-running",
      "severity": "high",
      "suggestedTransition": "stale-running → running",
      "evidence": "Last PR activity: 2026-05-01",
      "autoFixable": true
    }
  ],
  "escalations": [
    {
      "issue": 312,
      "rule": "done-without-merge",
      "severity": "medium",
      "description": "PR #45 open 3 days after issue marked done",
      "suggestedAction": "Review and merge PR #45 or reopen issue"
    }
  ],
  "prDrift": [
    {
      "issue": 258,
      "pr": 42,
      "rule": "running-pr-conflicts",
      "description": "PR has merge conflicts with main"
    }
  ],
  "projectionDrift": [
    {
      "rule": "stale-worker-projection",
      "worker": "claude/wave6-issue-258",
      "description": "No heartbeat for 12 minutes"
    }
  ],
  "summary": {
    "driftCount": 3,
    "escalationCount": 1,
    "prDriftCount": 1,
    "projectionDriftCount": 1
  }
}
```

## Schema Notes

- `schemaVersion` allows forward-compatible evolution.
- `severity` follows the reconciler's existing `low`/`medium`/`high` taxonomy.
- `autoFixable: true` means the reconciler's `-Write` mode can apply the
  transition. The WebUI should still show these but may visually distinguish
  them from human-required items.
- `escalations` entries never have `autoFixable` — they always require human
  action.

## See Also

- [State Reconciler](state-reconciler.md) — Drift detection rules and evidence precedence
- [State Reconciler — Active Workers](state-reconciler-active-workers.md) — Projection drift rules
- [State Reconciler — Write Mode](state-reconciler-write-mode.md) — Auto-fixable transitions
- [Reconcile Worker PRs](reconcile-worker-prs.md) — PR-level reconciliation rules
- [Worker Heartbeat](worker-heartbeat.md) — Worker liveness classification
- [Control-Plane Dashboard State](control-plane-dashboard-state-actions.md) — Action readiness projection
- [Planning Console State Emitter](planning-console-state-emitter.md) — Gap aggregation for Planning Console
