# Result Publishing

Defines how self-hosted agent workers publish structured result summaries
to GitHub issues and pull requests. The publisher script lives at
`scripts/ai/publish-agent-result.ps1`.

## Overview

After a worker completes a task, it posts a summary comment on the
target issue or PR. The comment uses machine-readable markers for
idempotency, so re-running the publisher updates the existing comment
instead of creating duplicates.

## Result Kinds

| Kind | When to use | Content |
|------|-------------|---------|
| `execution` | Worker completed a code/docs change | Summary, changed files, validation evidence |
| `review` | Worker reviewed a PR or code area | Findings, severity, recommendations |
| `audit` | Security or compliance audit | Vulnerabilities found, severity, remediation |
| `metrics` | Performance or quality metrics | Benchmark results, comparisons |

## Comment Markers

Every published comment is wrapped in idempotency markers:

```
<!-- ai-result:<marker-id>:begin -->
... comment content ...
<!-- ai-result:<marker-id>:end -->
```

The `<marker-id>` is a unique string per result (e.g., `issue-88-exec`).
The publisher searches for an existing comment containing the open marker
and updates it instead of creating a new one.

### Marker ID Rules

- Alphanumeric, hyphens, underscores, and dots only.
- Must be unique per result type on a given issue/PR.
- Recommended format: `issue-<N>-<kind>` or `pr-<N>-<kind>`.

## Redaction Policy

**Raw transcripts, log files, and LLM IO must NEVER be posted.**

Before publishing, **all** user-supplied parameters (`-Summary`, `-Body`,
`-ValidationEvidence`, `-ChangedFiles`, `-LinkedIssues`) are scanned
against these patterns:

| Pattern | Example | Action |
|---------|---------|--------|
| GitHub tokens | `ghp_...`, `github_pat_...`, `gho_...` | Reject (exit 1) |
| GitLab tokens | `glpat-...` | Reject (exit 1) |
| AWS keys | `AKIA...` | Reject (exit 1) |
| Slack tokens | `xoxb-...`, `xoxp-...` | Reject (exit 1) |
| Bearer tokens | `Bearer eyJ...` | Reject (exit 1) |
| Private keys | `-----BEGIN ... PRIVATE KEY-----` | Reject (exit 1) |
| Passwords/secrets | `password=...`, `secret=...`, `token=...` | Reject (exit 1) |

If any pattern matches, the publisher exits with an error and does NOT
post the comment. The pattern match is included in the error message
to aid debugging.

## Sanitization

### ANSI Escape Stripping

Validation evidence is stripped of ANSI escape sequences (terminal colors,
cursor codes) before publishing. This prevents garbled output when workers
produce colored terminal output.

### Validation Evidence Truncation

Validation evidence is capped at **200 lines**. If the output exceeds
this limit, it is truncated with a footer showing the total line count.
This prevents massive build logs from inflating the comment.

### Max Comment Size

The total comment body is capped at **65,000 characters** (GitHub's limit
is 65,536). If the assembled comment exceeds this, it is truncated with
a size-limit notice. The idempotency close marker is re-appended to
preserve the marker pair.

### Safe Content

- One-line status summary
- File change lists
- Validation command output (truncated at 200 lines, ANSI-stripped)
- Structured findings with severity levels
- Issue/PR references

### Unsafe Content

- Full LLM conversation transcripts
- Raw `llm_io_logs` output
- `.env` file contents
- API keys, tokens, passwords
- Stack traces with internal paths (redact first)

## Usage

### Target an issue

```powershell
./scripts/ai/publish-agent-result.ps1 `
    -Repo "owner/name" `
    -TargetIssue 88 `
    -Kind execution `
    -Summary "PASS - all checks green" `
    -Body "Added result publisher script and documentation." `
    -MarkerId "issue-88-exec"
```

### Target a PR

```powershell
./scripts/ai/publish-agent-result.ps1 `
    -Repo "owner/name" `
    -TargetPR 90 `
    -Kind execution `
    -Summary "PASS" `
    -Body "Implemented feature X." `
    -MarkerId "pr-90-exec" `
    -ChangedFiles "src/foo.ts,src/bar.ts" `
    -ValidationEvidence "npm run build: PASS`nnpm run check: PASS" `
    -LinkedIssues "Closes #88"
```

### Dry-run

Pass `-DryRun` to print the comment payload without posting. The output
includes the comment size in characters so callers can verify truncation
behavior before posting.

Requires `gh` CLI authenticated with `issues` and `pull_requests` scopes.
Set `GH_REPO` env var or pass `-Repo OWNER/NAME`.

## Idempotency Flow

```
1. Build comment body with markers
2. Search existing comments on target for matching open marker
3. If found  -> PATCH (update) existing comment
4. If not found -> POST new comment
```

This ensures workers can safely re-publish after fixing issues without
creating duplicate comments.

## Integration with Worker Contracts

The publisher aligns with the [Worker Task Contract](worker-task-contract.md):

- `targetIssue` maps to `-TargetIssue`
- `targetPR` maps to `-TargetPR`
- `validationCommands` output maps to `-ValidationEvidence`
- `allowedFiles` list maps to `-ChangedFiles`

Workers should call the publisher as the final step after validation
evidence is collected.

## Integration with Monitor

The [worker heartbeat monitor](worker-heartbeat.md) can publish a result
comment automatically on process exit via `-PublishOnComplete`. The monitor
calls the publisher with these sanitized fields:

| Monitor field | Publisher param | Value |
|---------------|-----------------|-------|
| Final state | `-Summary` | `PASS (exit 0, Ns)` or `FAIL (exit N, Ns)` |
| Target | `-TargetIssue` / `-TargetPR` | From `-IssueNumber` or `-PRNumber` |
| Kind | `-Kind` | From `-PublishKind` (default: `execution`) |
| Marker | `-MarkerId` | `<prefix>-<N>-monitor-<taskId>` |

The monitor never passes raw logs, stdout, or stderr to the publisher.
Only exit code, elapsed time, and task metadata are included.

See [worker-heartbeat.md](worker-heartbeat.md) for full usage examples.

## See Also

- [Worker Task Contract](worker-task-contract.md) -- Task JSON schema
- [Validation Evidence](validation-evidence.md) -- Evidence format
- [Worker Acceptance Checklist](worker-acceptance-checklist.md) -- Completion criteria
- [SOP](SOP.md) -- Full development lifecycle
- [#88](https://github.com/nicholasxsxs/lian-nest-server/issues/88) -- This feature
