# WebUI Action: Issue State Control

Action module for issue reconcile and close-done preview in the WebUI
control console. Exposes real operation entry points through the action
module system.

> **Closes:** [#682](https://github.com/taoyu051818-sys/lian-nest-server/issues/682)

---

## Overview

The `issue-state` action module brings issue lifecycle control into
the WebUI as a first-class action. It wraps the same drift detection
and close logic used by the PowerShell scripts behind the WebUI action
module contract (`preview` / `execute`).

```
WebUI control console
  └─ POST /api/actions/preview   → issue-state preview (dry-run)
  └─ POST /api/actions/execute   → issue-state execute (mutating)
       ├─ gh issue view           (read issue + labels)
       ├─ gh pr list --merged     (find linked merged PRs)
       ├─ gh issue comment        (post closing audit comment)
       ├─ gh issue edit           (remove agent:* labels)
       └─ gh issue close          (close the issue)
```

---

## Module Contract

| Field         | Value                                                |
|---------------|------------------------------------------------------|
| `id`          | `issue-state`                                        |
| `label`       | Issue State Control                                  |
| `description` | Reconcile issue labels/PRs and close done issues     |
| `dangerous`   | `true` — execute requires `confirm: true`            |
| `preview`     | Dry-run drift report (read-only)                     |
| `execute`     | Close eligible issues (mutating)                     |

---

## Preview (Dry-Run)

Shows what would happen without making any changes.

**Request:**

```json
{
  "actionId": "issue-state",
  "payload": {
    "issueNumbers": [682, 683]
  }
}
```

**Response:**

```json
{
  "actionId": "issue-state",
  "label": "Issue State Control",
  "description": "Reconcile issue labels/PRs and close done issues.",
  "preview": {
    "ok": true,
    "version": 1,
    "capturedAt": "2026-05-12T00:15:00.000Z",
    "totalIssues": 2,
    "eligible": 1,
    "refusedCount": 0,
    "results": [
      {
        "number": 682,
        "title": "Add WebUI action module for issue close and state reconcile",
        "state": "OPEN",
        "rule": "no-drift",
        "severity": "info",
        "action": "none",
        "detail": "Issue #682 has no detected drift"
      },
      {
        "number": 683,
        "title": "Example done issue",
        "state": "OPEN",
        "rule": "merged-pr-open-issue",
        "severity": "error",
        "action": "close",
        "mergedPR": 700,
        "detail": "PR #700 merged; issue #683 still open"
      }
    ],
    "refused": [],
    "eligibleIssues": [
      { "number": 683, "title": "Example done issue", "mergedPR": 700 }
    ]
  },
  "dryRun": true
}
```

---

## Execute (Mutating)

Closes eligible issues. Requires `confirm: true` from the server gate
(since `dangerous: true`).

**Request:**

```json
{
  "actionId": "issue-state",
  "payload": {
    "issueNumbers": [683]
  },
  "confirm": true
}
```

**Response:**

```json
{
  "ok": true,
  "auditId": "audit-1683812400000-x7k9m2",
  "result": {
    "ok": true,
    "version": 1,
    "capturedAt": "2026-05-12T00:15:00.000Z",
    "mode": "execute",
    "totalRequested": 1,
    "closed": 1,
    "skipped": 0,
    "closedIssues": [
      { "number": 683, "title": "Example done issue", "mergedPR": 700 }
    ],
    "skippedIssues": []
  }
}
```

---

## Eligibility Rules

An issue is eligible for closing when all of the following are true:

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Issue is OPEN | `gh issue view` state |
| 2 | A linked PR is merged | `gh pr list --state merged` title/body |
| 3 | Not refused | Not umbrella, not human-required |

### Drift Classification

| Rule | Condition | Severity | Action |
|------|-----------|----------|--------|
| `merged-pr-open-issue` | Merged PR exists, issue open | error | close |
| `merged-pr-stale-label` | Merged PR, no agent:done label | error | label |
| `done-without-merge` | agent:done, no merged PR | error | review |
| `stale-running` | agent:running, no linked PRs | warning | review |
| `no-drift` | No issues detected | info | none |

---

## Refuse Rules

Issues are refused (skipped) when they match:

| Rule | Check | Reason |
|------|-------|--------|
| Umbrella issue | Title matches `umbrella` pattern | Requires human orchestration |
| Human-required | Has `human-required` label | Explicitly requires human intervention |

Refused issues appear in the `refused` array and are never closed.

---

## Safety

| Rule | Enforcement |
|------|-------------|
| Dangerous flag | Module exports `dangerous: true` |
| Server confirm gate | Execute requires `confirm: true` via server |
| Explicit allowlist | `issueNumbers` array is required |
| Max issues cap | 20 issues per request |
| Refuse rules | Umbrella and human-required always skipped |
| Audit comment | Every close posts idempotent comment with markers |
| No secrets | All outputs sanitized; no raw stdout/stderr |

---

## Closing Comment Format

Each closed issue receives an audit-trail comment:

```
<!-- ai-webui-issue-control:begin -->
Auto-closed via WebUI issue-state action.
Linked PR #700 has been merged into main.
<!-- ai-webui-issue-control:end -->
```

---

## Integration

The action module fits into the orchestration workflow:

```
1. Workers complete PRs        → agent:done label set
2. Merge batch runs            → PRs merged into main
3. Post-merge health gate      → main health verified green
4. WebUI issue-state preview   → audit drift  ← THIS MODULE
5. WebUI issue-state execute   → close eligible issues
6. State reconciler            → confirms no remaining drift
7. Planning loop               → next wave candidates evaluated
```

---

## Relationship to PowerShell Scripts

| Script | Relationship |
|--------|-------------|
| `webui-issue-control.ps1` | Same orchestration, different interface |
| `state-reconciler.ps1` | Same drift rules, JS reimplementation |
| `auto-close-done-issues.ps1` | Same close logic, JS reimplementation |

The action module reimplements the core logic in JavaScript to avoid
cross-language spawning overhead and to integrate natively with the
Node.js-based WebUI server.

---

## Design Decisions

- **Dangerous by default.** Issue close is a mutating operation.
  Server gate enforces `confirm: true`.
- **Explicit allowlist.** No mass-close. Every issue number must be
  listed in the payload.
- **Refuse-list enforcement.** Umbrella and human-required issues are
  never processed, even if listed.
- **Same drift rules.** Mirrors the state-reconciler classification
  logic for consistency.
- **Audit comment with markers.** Provides GitHub audit trail and
  enables idempotent detection.
- **No raw output.** All outputs are structured JSON objects. No
  stdout/stderr strings in responses.

---

## See Also

- [WebUI Issue Control](webui-issue-control.md) — PowerShell wrapper
- [Auto-Close Done Issues](auto-close-done-issues.md) — Close script
- [State Reconciler](state-reconciler.md) — Drift detection
- [Provider Pool WebUI Actions API](provider-pool-webui-actions-api.md) — Action module contract
