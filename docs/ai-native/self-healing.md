# Self-Healing

Automated recovery from classified health gate failures. When the post-merge
health gate detects a failure, the self-healing pipeline classifies it and
creates follow-up issues to route recovery workers.

## Pipeline Overview

```
health gate fails
  -> write-main-health-state.ps1 records state
  -> create-health-followup.js reads state, classifies failures
  -> follow-up issues created for recovery workers
  -> recovery workers fix issues
  -> health gate re-run confirms recovery
```

## Follow-Up Issue Creator

```bash
# Dry-run (default) — preview what issues would be created
node scripts/ai/create-health-followup.js

# Custom state file
node scripts/ai/create-health-followup.js --state-file .github/ai-state/main-health.json

# Help
node scripts/ai/create-health-followup.js --help
```

### Failure Category Mapping

| Category | Severity | Recovery Worker Type |
|---|---|---|
| `runtime compile` | critical | foundation-fix |
| `dependency/generate` | critical | foundation-fix |
| `database foundation` | critical | foundation-fix |
| `conflict refresh` | critical | foundation-fix |
| `boundary guard` | warning | docs |
| `test env` | warning | test-only |

### Issue Template

Each follow-up issue includes:
- Health state, commit SHA, and captured timestamp
- Failure category and severity
- Recovery worker type assignment
- Acceptance criteria (health gate passes, no new failures)

### Sanitization

All text is sanitized before issue body generation:
- Tokens and secrets are redacted (`[redacted-token]`, `[redacted-gh-token]`)
- Bearer headers are masked
- Password/secret/token key-value pairs are replaced
- Output is truncated to 200 characters

### Dry-Run Contract

In dry-run mode (default), the script:
- Reads the health state marker
- Classifies failures
- Prints structured preview of issue proposals
- Makes NO GitHub API calls
- Exits 0 on success

Live issue creation (`--live`) is intentionally blocked during validation.
When wired up, it would use `gh issue create` to create follow-up issues
with the generated title, body, and labels.

## Recovery Worker Routing

Follow-up issues are labeled for automatic routing:

| Severity | Labels | Worker Type |
|---|---|---|
| critical | `ai-native`, `type:infra`, `severity:critical`, `agent:queued` | foundation-fix |
| warning | `ai-native`, `type:infra`, `severity:warning`, `agent:queued` | docs or test-only |

## References

- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions
- [post-merge-health-gate.md](post-merge-health-gate.md) — Health gate runner and failure categories
- [write-main-health-state.ps1](../../scripts/ai/write-main-health-state.ps1) — Health marker writer
- [issue-lifecycle.md](issue-lifecycle.md) — Issue states and label conventions
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema for recovery workers
