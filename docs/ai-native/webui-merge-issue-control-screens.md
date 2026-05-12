# WebUI Merge & Issue Control Screens

Screen definitions for issue planning/closing and PR merge allowlist
control in the WebUI operation console. Both screens follow the
preview-first, confirmation-gated lifecycle with full audit.

> **Closes:** [#1120](https://github.com/taoyu051818-sys/lian-nest-server/issues/1120)
> **Scope:** Docs only. No runtime changes.

---

## Overview

Two dedicated control screens expose issue lifecycle and PR merge
operations through the Operation Console left-nav shell:

| Screen | Action ID | Risk | Purpose |
|--------|-----------|------|---------|
| Issue Control | `issue-state` | High | Plan, preview, and close done issues |
| Merge Control | `merge-prs` | High | Preview and merge an explicit PR allowlist |

Both screens follow the shared lifecycle:

```
Select targets  →  Preview  →  Confirm  →  Execute  →  Audit
```

---

## Shared Screen Layout

Both screens use the dense admin layout with left-nav shell:

```
┌─────────────────────────────────────────────────────────────┐
│  [Header] Operation Console           [Health: green ●]     │
├────────────┬────────────────────────────────────────────────┤
│  Left Nav  │  Screen Content                                │
│            │                                                │
│  • Providers│  ┌──────────────────────────────────────────┐ │
│  • Workers │  │  Action Header (label, risk badge, desc) │ │
│  • Queue   │  └──────────────────────────────────────────┘ │
│  • Issues ◄│  ┌──────────────────────────────────────────┐ │
│  • Merge  ◄│  │  Target Selection                        │ │
│  • Audit   │  │  (issue numbers / PR numbers input)      │ │
│            │  └──────────────────────────────────────────┘ │
│            │  ┌──────────────────────────────────────────┐ │
│            │  │  Preview Panel (blue border)             │ │
│            │  │  (dry-run results, no mutation)          │ │
│            │  └──────────────────────────────────────────┘ │
│            │  ┌──────────────────────────────────────────┐ │
│            │  │  Confirm + Execute Panel (red border)    │ │
│            │  │  (confirmation input, execute button)    │ │
│            │  └──────────────────────────────────────────┘ │
│            │  ┌──────────────────────────────────────────┐ │
│            │  │  Operator Feedback (chat-like log)       │ │
│            │  └──────────────────────────────────────────┘ │
├────────────┴────────────────────────────────────────────────┤
│  [Footer] Audit summary        [Export Audit] [Refresh]     │
└─────────────────────────────────────────────────────────────┘
```

### Visual Signals (shared)

| Signal | Meaning |
|--------|---------|
| Blue border/badge | Preview mode — no mutation |
| Red border/badge | Execute mode — state will change |
| Green border/badge | Safe / read-only action |
| 45% opacity | Disabled — action unavailable |
| Pulsing red dot | Confirmation needed |

---

## Screen 1: Issue Control (`issue-state`)

### Purpose

Plan issue lifecycle transitions and close done issues. Operators
enter issue numbers, preview drift classification, then execute
closings for eligible issues.

### Left-Nav Entry

| Field | Value |
|-------|-------|
| Label | Issues |
| Icon | issue |
| Active indicator | Highlighted border when selected |
| Badge | Count of issues with `error` severity drift |

### Target Selection Panel

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Issue Numbers | text input | yes | Comma-separated issue numbers (e.g. `682, 683, 700`) |

Validation:

- Each entry must be a positive integer
- Maximum 20 issues per request
- Duplicate numbers are deduplicated
- Invalid entries show inline error

### Preview Panel (Blue Border)

After clicking **Preview**, the panel shows the dry-run drift report.

**API call:** `POST /api/actions/preview`

```json
{
  "actionId": "issue-state",
  "payload": { "issueNumbers": [682, 683] }
}
```

**Preview content:**

| Section | Content |
|---------|---------|
| Summary bar | `2 issues scanned · 1 eligible · 0 refused` |
| Drift table | Per-issue rows with rule, severity, action |
| Eligible list | Issues that would be closed on execute |
| Refused list | Issues skipped with reason (umbrella, human-required) |

**Drift table columns:**

| Column | Source | Description |
|--------|--------|-------------|
| # | `number` | Issue number |
| Title | `title` | Issue title |
| State | `state` | Current issue state (OPEN/CLOSED) |
| Rule | `rule` | Drift classification rule |
| Severity | `severity` | `info`, `warning`, or `error` |
| Action | `action` | Proposed action: `none`, `close`, `label`, `review` |
| Detail | `detail` | Human-readable explanation |

**Severity coloring:**

| Severity | Color | Badge |
|----------|-------|-------|
| `info` | Gray | No action needed |
| `warning` | Yellow | Review recommended |
| `error` | Red | Action required |

### Confirm + Execute Panel (Red Border)

After preview completes with eligible issues:

| Element | Behavior |
|---------|----------|
| Confirmation input | Disabled until preview has eligible issues |
| Confirmation phrase | None required (server `confirm: true` gate only) |
| Execute button | Disabled until confirmation input is non-empty |
| Warning banner | "This will close N issues. This action is irreversible." |

**Execute API call:** `POST /api/actions/execute`

```json
{
  "actionId": "issue-state",
  "payload": { "issueNumbers": [683] },
  "confirm": true
}
```

### Operator Feedback (Chat-Like)

After execute, a chat-like log shows the result:

```
[2026-05-12 10:15:00] issue-state execute started
[2026-05-12 10:15:01] Closed #683 (linked PR #700 merged)
[2026-05-12 10:15:01] audit-id: audit-1683812400000-x7k9m2
[2026-05-12 10:15:01] Done. 1 closed, 0 skipped.
```

### Safety Rules

| Rule | Enforcement |
|------|-------------|
| Max 20 issues | Payload validation rejects >20 |
| Refuse list | Umbrella and human-required issues always skipped |
| Audit comment | Every close posts idempotent comment with markers |
| No secrets | All output sanitized via `sanitizeObject` |
| Dangerous flag | Server requires `confirm: true` |

---

## Screen 2: Merge Control (`merge-prs`)

### Purpose

Preview and execute PR merges via an explicit allowlist. Operators
enter PR numbers, preview the merge plan with guard results, then
execute merges with health gate.

### Left-Nav Entry

| Field | Value |
|-------|-------|
| Label | Merge |
| Icon | merge |
| Active indicator | Highlighted border when selected |
| Badge | Count of PRs in merge queue (optional) |

### Target Selection Panel

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| PR Numbers | text input | yes | Comma-separated PR numbers (e.g. `42, 45, 51`) |
| Repository | text input | no | `OWNER/NAME` format (falls back to `GH_REPO` env) |

Validation:

- Each PR number must be a positive integer
- No wildcard (`*`) or `all` keyword allowed
- Empty list is rejected
- Negative numbers, zero, floats rejected
- Repository must match `OWNER/NAME` format if provided

### Preview Panel (Blue Border)

After clicking **Preview**, the panel shows the dry-run merge plan.

**API call:** `POST /api/actions/preview`

```json
{
  "actionId": "merge-prs",
  "payload": {
    "prNumbers": [42, 45],
    "repo": "owner/repo"
  }
}
```

**Preview content:**

| Section | Content |
|---------|---------|
| Summary bar | `2 PRs · dry-run · health gate: skipped · guards: skipped` |
| PR table | Per-PR rows with number, title, status, guard result |
| Manifest link | Link to `.ai/webui-merge-manifests/` manifest |

**PR table columns:**

| Column | Source | Description |
|--------|--------|-------------|
| PR # | `prNumbers` | Pull request number |
| Title | PR metadata | PR title |
| Status | PR metadata | Open, mergeable, checks status |
| Risk | guard output | High-risk path indicator |
| Guards | guard output | Blocking guard results |

**Risk classification:**

| Risk Level | Paths | UI Indicator |
|------------|-------|--------------|
| High | `src/**`, `prisma/**`, `package.json` | Red badge |
| Medium | `scripts/**`, `docs/**` | Yellow badge |
| Low | Other paths | Green badge |

### Gate Markers Panel

The preview includes gate marker status:

| Marker | Values | Display |
|--------|--------|---------|
| `healthGate` | `skipped`, `pass`, `fail`, `unknown` | Icon + label |
| `guards` | `skipped`, `pass`, `fail`, `unknown` | Icon + label |
| `mode` | `dry-run`, `execute`, `aborted` | Badge |

### Confirm + Execute Panel (Red Border)

After preview completes:

| Element | Behavior |
|---------|----------|
| Confirmation input | Type `MERGE` to enable execute |
| Execute button | Disabled until confirmation matches exactly |
| Warning banner | "This will merge N PRs into main. Use git revert to rollback." |

**Execute API call:** `POST /api/actions/execute`

```json
{
  "actionId": "merge-prs",
  "payload": {
    "prNumbers": [42, 45],
    "repo": "owner/repo"
  },
  "confirm": true,
  "confirmationToken": "MERGE"
}
```

### Operator Feedback (Chat-Like)

After execute, a chat-like log shows the result:

```
[2026-05-12 10:20:00] merge-prs execute started
[2026-05-12 10:20:01] Merging PR #42 (squash + delete branch)
[2026-05-12 10:20:03] PR #42 merged successfully
[2026-05-12 10:20:03] Merging PR #45 (squash + delete branch)
[2026-05-12 10:20:05] PR #45 merged successfully
[2026-05-12 10:20:06] Health gate: pass
[2026-05-12 10:20:06] Guards: pass
[2026-05-12 10:20:06] audit-id: audit-1683812800000-a1b2c3
[2026-05-12 10:20:06] Done. 2 merged, 0 failed.
```

### Safety Rules

| Rule | Enforcement |
|------|-------------|
| Explicit allowlist | No wildcard discovery; each PR listed explicitly |
| Dangerous flag | Server requires `confirm: true` |
| Health gate | Runs automatically in execute mode |
| 7 guards | Blocking guards fail-closed |
| No raw stderr | Error messages sanitized |
| Audit trail | Server logs all executions with sanitized payloads |
| Manifest output | Every run writes JSON manifest |

---

## Audit Integration

Both screens write to the shared audit trail via `GET /api/audit`.

### Audit Entry Shape

```json
{
  "id": "audit-1715500000000-abc123",
  "actionId": "issue-state",
  "startedAt": "2026-05-12T10:15:00.000Z",
  "completedAt": "2026-05-12T10:15:01.000Z",
  "status": "success",
  "payload": { "issueNumbers": [683] },
  "result": { "closed": 1, "skipped": 0 },
  "confirmationToken": "provided"
}
```

### Audit Filtering

| Filter | Field | Example |
|--------|-------|---------|
| By action | `actionId=issue-state` | All issue control executions |
| By action | `actionId=merge-prs` | All merge executions |
| By status | `status=success` | Successful executions only |
| By status | `status=error` | Failed executions only |
| By limit | `limit=20` | Last 20 entries |

### Sanitization

All `payload` and `result` fields pass through `sanitizeObject`:

| Pattern | Replacement |
|---------|-------------|
| Fields matching `api_key`, `token`, `secret`, `password` | `***REDACTED***` |
| Long alphanumeric strings (>20 chars) | `***REDACTED***` |
| GitHub PATs (`ghp_*`, etc.) | `[redacted-gh-token]` |
| Strings >500 chars | Truncated to 500 |

---

## Manifest Output

Both screens produce manifests for traceability.

### Merge Manifest

Written to `.ai/webui-merge-manifests/`:

```json
{
  "schemaVersion": 1,
  "batchId": "webui-merge-2026-05-12T10-20-00Z",
  "timestamp": "2026-05-12T10:20:00.000Z",
  "repository": "owner/repo",
  "mode": "execute",
  "prNumbers": [42, 45],
  "healthGate": "pass",
  "guards": "pass",
  "failureReason": null
}
```

### Issue Close Comment

Each closed issue receives a GitHub audit comment:

```
<!-- ai-webui-issue-control:begin -->
Auto-closed via WebUI issue-state action.
Linked PR #700 has been merged into main.
<!-- ai-webui-issue-control:end -->
```

---

## Rollback Procedures

### Issue Control Rollback

| Step | Action |
|------|--------|
| 1 | Reopen the issue via `gh issue reopen <number>` |
| 2 | Restore agent labels via `gh issue edit <number> --add-label "agent:done"` |
| 3 | Remove the audit comment if needed |

### Merge Control Rollback

| Step | Action |
|------|--------|
| 1 | `git revert <merge-commit>` on main |
| 2 | Push the revert commit |
| 3 | The merge manifest in `.ai/webui-merge-manifests/` records the merge for traceability |

---

## Preconditions

Before using either screen:

1. **Server running** — `npm run ops:webui` launched
2. **Health state valid** — `.github/ai-state/main-health.json` shows `green` or `yellow`
3. **No secrets exposed** — verify no `.env` values appear in browser console or audit log
4. **Audit log exported** — if resuming a session, export prior audit first

---

## Blocked States

### Issue Control Blocked When

| Condition | UI Behavior |
|-----------|-------------|
| No issue numbers entered | Preview button disabled |
| All issues refused (umbrella/human-required) | Preview shows refusal list; execute disabled |
| No eligible issues after preview | Execute button stays disabled |
| Server returns 409 | Show error: "Confirmation required" |

### Merge Control Blocked When

| Condition | UI Behavior |
|-----------|-------------|
| No PR numbers entered | Preview button disabled |
| Invalid PR numbers | Inline validation error |
| Health gate fails | Execute blocked; show health gate failure details |
| Blocking guard fails | Execute blocked; show guard failure details |
| Confirmation not `MERGE` | Execute button disabled |
| Server returns 409 | Show error: "Dangerous action requires confirm: true" |

---

## Cross-References

- [WebUI Action: Issue State](webui-action-issue-state.md) — action module contract
- [WebUI Action: Merge PRs](webui-action-merge-prs.md) — action module contract
- [WebUI Merge Control](webui-merge-control.md) — PowerShell wrapper
- [WebUI Control Map](webui-control-map.md) — action-to-endpoint mapping
- [WebUI Operation Runbook](webui-operation-runbook.md) — step-by-step operator guide
- [WebUI Control Console](webui-control-console.md) — full console runbook
- [Provider Pool WebUI API](../contracts/provider-pool-webui-api.md) — API contract
- [Provider Pool WebUI README](../../tools/provider-pool-webui/README.md) — quick start
