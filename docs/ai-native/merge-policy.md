# Merge Policy

Machine-readable merge policy for explicit allowlist controlled merge.
Defines all eligibility checks, guard checks, risk policy, and gate
markers that must pass before any PR is merged.

> **Closes:** [#357](https://github.com/taoyu051818-sys/lian-nest-server/issues/357)

---

## Policy File

The canonical policy lives at `.github/ai-policy/merge-policy.json`.
All merge scripts and guards MUST read this file to determine merge
eligibility. The JSON is versioned (`version` field) and self-describing.

---

## Policy Flags

| Flag | Type | Description |
|------|------|-------------|
| `requireExplicitAllowlist` | boolean | PR number must be in the explicit allowlist (`-PRs` or `-AllowlistFile`). No discovery or guessing. |
| `requireNonDraft` | boolean | Draft PRs are never merged. |
| `requireCleanMergeState` | boolean | PR must be `MERGEABLE` with no `FAILURE`, `CANCELLED`, or `TIMED_OUT` checks. |
| `requireGateMarkers` | boolean | Health gate marker must exist and be `green` or `yellow`. |
| `riskCap` | string | Maximum risk level for auto-merge. `"medium"` means high-risk PRs require human review. |
| `requireNoForbiddenFiles` | boolean | No changes to `src/**`, `prisma/**`, `package.json`, `package-lock.json`, `.env.*`, or Claude settings. |
| `requireGeneratedFreshness` | boolean | If `src/generated/prisma/` changed, `prisma/schema.prisma` must also change. |
| `requireDocsAuthority` | boolean | Docs must not have duplicate basenames, duplicate H1 titles, or missing frontmatter. |
| `requireSecretScan` | boolean | No hardcoded secrets, tokens, or credentials in changed files. |
| `requireTelemetryMarker` | boolean | Merge batch manifest must be written for every merge run. |

---

## Eligibility Checks

These run on each PR before any guard checks. All must pass.

| Check | Field | Pass Condition |
|-------|-------|----------------|
| Open state | `state` | `OPEN` |
| Non-draft | `isDraft` | `false` |
| Mergeable | `mergeable` | `MERGEABLE` |
| Status checks | `statusCheckRollup` | No `FAILURE`, `CANCELLED`, or `TIMED_OUT` |

If any check fails, the entire batch is aborted — no PRs are merged.

---

## Guard Checks

These run after eligibility checks. Guards are either **blocking**
(fail-closed) or **warn-only**.

| Guard | Scope | Blocking | Required Input |
|-------|-------|----------|----------------|
| Explicit allowlist | Per-PR | Yes | `-PRs` or `-AllowlistFile` |
| Task boundary | Per-PR | Yes | `.ai/task-manifest.json` |
| PR handoff | Per-PR | Yes | PR body |
| Docs authority | Repo-wide | No (warn) | `docs/` directory |
| Generated Prisma freshness | Per-PR | Yes | PR changed files |
| Secret scan | Per-PR | Yes | PR changed files |
| Forbidden files | Per-PR | Yes | PR changed files |

### PR Handoff Sections

The PR body must contain all seven sections:

1. Summary
2. Changed files
3. Linked issues
4. Validation
5. Non-goals
6. Risk / rollback
7. Follow-up handoff

---

## Risk Policy

| Category | Globs | Risk | Required Review Roles |
|----------|-------|------|-----------------------|
| Runtime code | `src/**` | high | backend-programmer, architect |
| Database / Prisma | `prisma/**` | high | migration-auditor |
| Auth / security | `src/modules/auth/**` | high | security-reviewer |
| Dependencies | `package.json`, `package-lock.json` | high | repo-owner |
| Infrastructure scripts | `scripts/merge-queue-assistant.js`, `scripts/post-merge-health-gate.js` | high | devops-automation-engineer |
| Docs / policy | `docs/**`, `.github/ai-policy/**` | low | (none) |

PRs with `risk: "high"` are blocked from auto-merge. They require
explicit human review from the designated roles.

---

## Gate Markers

### Health Gate

- Path: `.github/ai-state/main-health.json`
- Required states: `green` or `yellow`
- See [main-health-policy.md](main-health-policy.md) for state definitions.

### Telemetry Marker

- Path: `.ai/merge-batch-manifests/`
- Required: `true`
- Every merge run (dry-run or execute) must write a manifest.
- See [controlled-auto-merge.md](controlled-auto-merge.md) for manifest schema.

---

## Merge Strategy

| Setting | Value |
|---------|-------|
| Default method | squash |
| Delete branch after merge | true |
| Stop on first failure | true |
| Revalidate before merge | true |

---

## Integration

This policy is consumed by:

- **merge-clean-pr-batch.ps1** — reads eligibility and guard config.
- **check-launch-gate.ps1** — reads risk policy and gate markers.
- **Guard scripts** — read forbidden globs, required sections, freshness rules.

When the policy file is absent, merge scripts fall back to the hardcoded
defaults in [controlled-auto-merge.md](controlled-auto-merge.md).

---

## References

- [controlled-auto-merge.md](controlled-auto-merge.md) — Batch merge script and guard integration.
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
- [pr-review-gate.md](pr-review-gate.md) — PR review checklist.
- [generated-code-policy.md](generated-code-policy.md) — Generated Prisma ownership rules.
- [docs-authority-map.md](docs-authority-map.md) — Documentation source of truth.
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema with `allowedFiles` and `forbiddenFiles`.
