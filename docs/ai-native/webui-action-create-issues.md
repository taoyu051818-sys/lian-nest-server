# WebUI Action: Create Issues

Action module for proposing and creating GitHub issues from gap analysis
data through the WebUI control console. Defaults to preview (dry-run) —
no GitHub mutations without explicit confirmation.

> **Closes:** [#678](https://github.com/taoyu051818-sys/lian-nest-server/issues/678)

---

## Overview

The `create-issues` action module enables the WebUI to become a real
operation entry point for issue creation. Operators can:

1. Submit gap analysis data via the WebUI
2. Preview proposed issues (dry-run, default)
3. Review and confirm to create issues on GitHub

```
  Operator (localhost)
       │
       ▼
  POST /api/actions/preview   → propose issues from gaps (dry-run)
  POST /api/actions/execute   → create issues on GitHub (requires confirm)
```

---

## Module Contract

```js
{
  id: "create-issues",
  label: "Create Issues",
  description: "Propose and create GitHub issues from gap analysis. Defaults to preview (dry-run).",
  dangerous: true,        // requires confirm: true for execute
  preview(payload) { ... },
  execute(payload, opts) { ... },
}
```

| Field | Value |
|-------|-------|
| `id` | `create-issues` |
| `label` | Create Issues |
| `dangerous` | `true` |
| `preview` | Yes — dry-run proposal generation |
| `execute` | Yes — real `gh issue create` calls |

---

## Preview

Generates proposed issues from gap analysis data without any GitHub
mutations. Deduplicates against existing open issues by `gapKey`.

### Request

```json
{
  "actionId": "create-issues",
  "payload": {
    "gaps": [
      {
        "title": "Add parity test for auth module",
        "gapKey": "missing-parity-test-auth",
        "goal": "Ensure auth module has parity coverage",
        "scope": "Add test file for auth module",
        "priority": "high",
        "risk": "low",
        "conflictGroup": "parity-tests",
        "allowedFiles": ["src/auth/**", "tests/auth/**"],
        "sliceRef": "auth-v1"
      }
    ],
    "labels": ["type:test", "priority:high"]
  }
}
```

### Gap Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `title` | yes | — | Issue title |
| `gapKey` | yes | — | Stable deduplication key |
| `goal` | no | `"Address gap: <title>"` | Goal section text |
| `scope` | no | `"Auto-generated from gap analysis."` | Scope section text |
| `priority` | no | `"medium"` | `critical`, `high`, `medium`, `low` |
| `risk` | no | `"medium"` | Risk level |
| `conflictGroup` | no | `"gap-fill"` | Conflict group for workers |
| `allowedFiles` | no | `["docs/**"]` | Files workers may touch |
| `sliceRef` | no | `null` | Slice reference (omitted when null) |

### Response

```json
{
  "ok": true,
  "proposals": [
    {
      "title": "Add parity test for auth module",
      "body": "## Goal\nEnsure auth module...\n\n## CONTROL APPENDIX\n...",
      "gapKey": "missing-parity-test-auth",
      "labels": ["type:test", "priority:high"],
      "priority": "high",
      "risk": "low",
      "conflictGroup": "parity-tests",
      "allowedFiles": ["src/auth/**", "tests/auth/**"],
      "sliceRef": "auth-v1"
    }
  ],
  "summary": {
    "total": 1,
    "valid": 1,
    "duplicatesSkipped": 0,
    "proposed": 1,
    "mode": "preview"
  }
}
```

### Deduplication

Before proposing, the module fetches existing open issues via
`gh issue list` and checks for matching `gapKey` values in issue
bodies. A gap is skipped when an open issue already covers it.

If `gh issue list` fails (no CLI, no auth), the module continues
without deduplication — all valid gaps pass through.

### Priority Ordering

Proposals are sorted by priority rank:

| Priority | Rank |
|----------|------|
| `critical` | 0 |
| `high` | 1 |
| `medium` | 2 |
| `low` | 3 |

---

## Execute

Creates GitHub issues from proposals. **Dangerous** — requires
`confirm: true`. In dry-run mode (default), returns what would be
created without mutation.

### Request (dry-run)

```json
{
  "actionId": "create-issues",
  "payload": {
    "proposals": [...],
    "dryRun": true
  },
  "confirm": true
}
```

### Request (real mutation)

```json
{
  "actionId": "create-issues",
  "payload": {
    "proposals": [...],
    "dryRun": false
  },
  "confirm": true
}
```

### Response (execute mode)

```json
{
  "ok": true,
  "created": [
    {
      "title": "Add parity test for auth module",
      "gapKey": "missing-parity-test-auth",
      "issueNumber": "42",
      "url": "https://github.com/org/repo/issues/42"
    }
  ],
  "dryRun": false,
  "summary": {
    "total": 1,
    "created": 1,
    "failed": 0,
    "mode": "execute"
  }
}
```

### Failure Handling

If any `gh issue create` call fails, execution stops immediately.
The response includes all issues created before the failure plus
the error message.

---

## Issue Body Format

Each proposed issue body follows the issue template from
[issue-lifecycle.md](issue-lifecycle.md) with a full CONTROL APPENDIX:

```markdown
## Goal
<goal text>

## Scope
<scope text>

## CONTROL APPENDIX
Task type: execution
Risk: <risk>
Conflict group: <conflictGroup>
Allowed files:
- <file1>
- <file2>
Validation commands:
- npm run check
- npm run build
Slice: <sliceRef>      # omitted when null
Mode: dry-run
Gap key: <gapKey>
```

---

## Validation

The preview function validates each gap entry:

| Condition | Error |
|-----------|-------|
| Not an object | `gap[N]: not an object` |
| Missing `title` | `gap[N]: missing title` |
| Missing `gapKey` | `gap[N]: missing gapKey` |

Gaps that fail validation are excluded from proposals. The response
includes a `validationErrors` array with details.

---

## Security

| Rule | Enforcement |
|------|-------------|
| Dangerous flag | `dangerous: true` — server requires `confirm: true` |
| Dry-run default | Execute defaults to `dryRun: true` |
| No secrets in body | Issue bodies contain no API keys or tokens |
| Secret sanitization | Server applies `sanitizeObject()` to all payloads/results |
| Audit trail | Server writes every execute call to `.audit-log.json` |
| Deduplication | Prevents duplicate issue creation |

---

## Testing

```bash
node tools/provider-pool-webui/action-modules.test.js
```

Tests cover:
- Module contract (id, label, dangerous, preview, execute)
- Server loadability (file exists in actions directory)
- Preview with empty/null payload
- Preview with valid gaps and default fields
- Preview priority ordering (critical → low)
- Preview validation errors (missing title/gapKey)
- Preview deduplication behavior
- CONTROL APPENDIX body structure
- Execute dry-run mode
- Execute with mock `gh` executor
- Execute multiple issues
- Execute failure handling
- Execute special character escaping

No real GitHub mutations occur during testing.

---

## Non-Goals

- No client UI (dashboard changes are out of scope)
- No bypass of policy/gate semantics
- No remote access — localhost binding only
- No modification of NestJS application modules
- No autonomous issue creation without operator confirmation

---

## References

- [Planner Create-Issues Mode](planner-create-issues-mode.md) — gap-to-issue proposal system
- [Issue Lifecycle](issue-lifecycle.md) — issue template and labels
- [Provider Pool WebUI Actions API](provider-pool-webui-actions-api.md) — action module contract
- [Provider Pool WebUI Security](provider-pool-webui-security.md) — security model
