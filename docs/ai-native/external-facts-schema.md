# External Facts Ledger Schema

Append-only NDJSON ledger for recording facts sourced from outside the
AI-native control plane. Each entry is evidence — not a command. External
facts inform planning and context but never bypass gates or override policy.

> **Closes:** [#891](https://github.com/taoyu051818-sys/lian-nest-server/issues/891)

---

## Overview

The control plane produces internal facts (fact-event-ledger, task-ledger,
gap-ledger) from its own lifecycle events. External facts cover information
that originates outside: CI results, upstream dependency changes, human
annotations, third-party service status, or manual observations.

External facts are **evidence only**. Downstream consumers (planner,
context-bundle generator, state reconciler) may read them, but no gate
or policy engine treats an external fact as a direct command. A fact with
`reliability: "verified"` carries more weight than `"rumor"`, but neither
bypasses a launch gate or health policy.

| Aspect | Value |
|--------|-------|
| Schema version | `entryVersion: 1` |
| JSON Schema draft | `draft-07` |
| File | `.github/ai-state/external-facts.ndjson` |
| Format | NDJSON (one JSON object per line) |
| Writer | `scripts/ai/write-external-fact.js` (future) |
| Mutability | Append-only — entries are never modified or removed |

---

## Entry Schema

Each line in the NDJSON file is a JSON object with the following fields.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `entryVersion` | `1` (const) | Schema version. Consumers must reject other values. |
| `factType` | string (dot-namespaced) | Category of external fact. See [Fact Types](#fact-types). |
| `subject` | string | What the fact is about. E.g. issue number, package name, service URL. |
| `claim` | string | The factual assertion. Must be specific enough to be verifiable. |
| `capturedAt` | date-time | ISO-8601 timestamp when the fact was recorded. |
| `sourceReliability` | enum | How the fact was sourced. See [Source Reliability](#source-reliability). |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `sourceUrl` | string or null | URL or identifier for the external source. Must not contain credentials. |
| `capturedBy` | string or null | Who recorded the fact. E.g. `human:taoyu`, `script:ci-watcher`. |
| `relatedIssue` | integer or null | GitHub issue number this fact informs. |
| `relatedPr` | integer or null | GitHub PR number this fact informs. |
| `expiresAt` | date-time or null | When this fact becomes stale. Ongoing facts omit this. |
| `tags` | array of strings | Filterable tags. May be empty. |
| `meta` | object or null | Arbitrary key-value metadata. Must not contain secrets. |

---

## Fact Types

Fact types use dot-namespace notation. Common prefixes:

| Prefix | Meaning | Examples |
|--------|---------|----------|
| `ci.*` | CI/CD pipeline observations | `ci.failure`, `ci.recovery`, `ci.flaky` |
| `dep.*` | Upstream dependency changes | `dep.breaking-change`, `dep.security-patch`, `dep.deprecated` |
| `infra.*` | Infrastructure or service status | `infra.outage`, `infra.degraded`, `infra.restored` |
| `human.*` | Human-provided annotations | `human.priority-change`, `human.scope-change`, `human.constraint` |
| `ext.*` | Other external observations | `ext.api-change`, `ext.doc-update`, `ext.requirement` |

The `factType` pattern `^[a-zA-Z0-9]+(\.[a-zA-Z0-9_-]+)*$` requires at
least one segment of alphanumeric characters, optionally followed by
dot-separated segments that may include hyphens and underscores. This
matches the convention used by fact-event-ledger and task-ledger.

---

## Source Reliability

Every external fact carries a `sourceReliability` rating. This tells
consumers how much weight to give the fact when making planning or
prioritization decisions.

| Value | Meaning | Example Source |
|-------|---------|----------------|
| `verified` | Confirmed by a machine-readable source (CI output, API response, automated check). | `npm run check` exit code, GitHub API status, Prisma migration output |
| `observed` | Seen directly but not yet independently confirmed. | Watching a CI run, reading a stack trace, seeing a test output |
| `reported` | Communicated by a human or external party without independent verification. | Slack message, issue comment, email from upstream maintainer |
| `rumor` | Unverified or indirect. May be outdated or inaccurate. | Secondhand report, speculative analysis, cached data from unknown age |

### Reliability and Consumer Behavior

| Reliability | Context Bundle | Planner Weight | Gate Influence |
|-------------|:--------------:|:--------------:|:--------------:|
| `verified` | Included | Full | May inform (not override) gate decisions |
| `observed` | Included | Normal | Informational only |
| `reported` | Included | Reduced | Informational only |
| `rumor` | Flagged | Minimal | None |

No reliability level allows an external fact to **override** a gate
decision. Even `verified` facts are inputs to decision-making, not
authoritative commands.

---

## Examples

### CI Failure (Verified)

```json
{
  "entryVersion": 1,
  "factType": "ci.failure",
  "subject": "tsc check on main",
  "claim": "tsc exited with code 1 due to type error in src/auth/guards/roles.guard.ts",
  "sourceReliability": "verified",
  "sourceUrl": "https://github.com/taoyu051818-sys/lian-nest-server/actions/runs/12345",
  "capturedAt": "2026-05-12T10:30:00Z",
  "capturedBy": "script:ci-watcher",
  "relatedIssue": null,
  "relatedPr": null,
  "expiresAt": null,
  "tags": ["tsc", "main-branch", "type-error"],
  "meta": { "exitCode": 1, "check": "tsc" }
}
```

### Upstream Dependency Security Patch (Observed)

```json
{
  "entryVersion": 1,
  "factType": "dep.security-patch",
  "subject": "@nestjs/core@10.3.0",
  "claim": "NestJS 10.3.0 patches CVE-2026-XXXX affecting middleware ordering",
  "sourceReliability": "observed",
  "sourceUrl": "https://github.com/nestjs/nest/releases/tag/v10.3.0",
  "capturedAt": "2026-05-12T11:00:00Z",
  "capturedBy": "human:taoyu",
  "relatedIssue": null,
  "relatedPr": null,
  "expiresAt": "2026-06-12T00:00:00Z",
  "tags": ["nestjs", "security", "upgrade"],
  "meta": { "currentVersion": "10.2.0", "targetVersion": "10.3.0" }
}
```

### Human Priority Change (Reported)

```json
{
  "entryVersion": 1,
  "factType": "human.priority-change",
  "subject": "issue #891",
  "claim": "External facts schema is blocking wave27 planning; prioritize over remaining docs tasks",
  "sourceReliability": "reported",
  "sourceUrl": null,
  "capturedAt": "2026-05-12T09:15:00Z",
  "capturedBy": "human:taoyu",
  "relatedIssue": 891,
  "relatedPr": null,
  "expiresAt": null,
  "tags": ["priority", "wave27"],
  "meta": null
}
```

### Minimal Entry (Rumor)

```json
{
  "entryVersion": 1,
  "factType": "ext.requirement",
  "subject": "auth module",
  "claim": "Upstream team may require OAuth2 PKCE flow in next sprint",
  "sourceReliability": "rumor",
  "sourceUrl": null,
  "capturedAt": "2026-05-12T08:00:00Z",
  "capturedBy": null,
  "relatedIssue": null,
  "relatedPr": null,
  "expiresAt": "2026-05-26T00:00:00Z",
  "tags": ["auth", "oauth"],
  "meta": null
}
```

---

## Relationship to Other Ledgers

```
fact-event-ledger.ndjson      -- internal control-plane events (worker, health, merge)
task-ledger.ndjson            -- task lifecycle and fact flow (produced/consumed)
gap-ledger.ndjson             -- planning deviations and failures
knowledge-updates.ndjson      -- structured learnings from merged PRs
external-facts.ndjson         -- external observations and evidence (this schema)
```

| Ledger | Source | Mutability | Gate Authority |
|--------|--------|------------|:--------------:|
| fact-event | Internal scripts | Append-only | Yes (health, merge) |
| task | Worker lifecycle | Append-only | Yes (validation, gate) |
| gap | Planner/reconciler | Append-only | No (observational) |
| knowledge | Post-merge | Append-only | No (contextual) |
| **external** | **Outside control plane** | **Append-only** | **No (evidence only)** |

External facts are the only ledger that records information not produced
by the control plane itself. This boundary is deliberate: external data
is evidence that informs decisions, never a mechanism that bypasses gates.

---

## Downstream Consumers

| Consumer | How It Uses External Facts |
|----------|---------------------------|
| **Context bundle generator** | Includes recent external facts in worker context bundles, tagged by reliability. |
| **Planning loop** | Weighs `verified` and `observed` facts when ranking tasks; deprioritizes tasks contradicted by external evidence. |
| **State reconciler** | Cross-references external facts (e.g. CI status) with internal projections to detect drift. |
| **Knowledge update writer** | May promote a verified external fact to a knowledge entry after it is confirmed by a merged PR. |
| **Operator dashboards** | Displays external facts alongside internal signals for full situational awareness. |

---

## Staleness

External facts may become stale. Consumers should check `expiresAt`:

- If `expiresAt` is set and has passed, treat the fact as stale.
- If `expiresAt` is null, the fact is considered ongoing until superseded.
- A newer fact with the same `factType` and `subject` supersedes older entries.

Consumers SHOULD prefer the most recent entry when multiple entries share
the same `factType` and `subject`.

---

## Sanitization

All string fields are sanitized before writing:

- Base64-like strings (40+ chars) → `[redacted-token]`
- `ghp_*` GitHub tokens → `[redacted-gh-token]`
- `Bearer *` headers → `Bearer [redacted]`
- `password=`, `secret=`, `token=` values → `[redacted]`
- String values truncated to 500 characters

Applied to: `subject`, `claim`, `sourceUrl`, `capturedBy`, and all
string values within `meta`. The `sourceUrl` field must not contain
embedded credentials (user:pass@host patterns are redacted).

---

## Design Decisions

- **Append-only.** Consistent with all other NDJSON ledgers in the
  control plane. Entries are never modified or removed.
- **Evidence, not command.** No reliability level allows an external fact
  to override a gate or policy. This is a hard boundary, not a guideline.
- **Source reliability is required.** Every entry must declare how it was
  sourced. This prevents uncalibrated data from entering the planning loop
  without a trust signal.
- **Claim field is verifiable.** The `claim` must be specific enough that
  a consumer could check it. Vague claims ("things are slow") are not valid
  entries.
- **NDJSON over JSON array.** Streamable, appendable, and consistent with
  the existing ledger pattern. `git diff` shows individual entries.
- **Schema versioning.** `entryVersion` enables forward-compatible
  evolution without breaking consumers.
- **No secrets.** The schema contains no fields for credentials, tokens,
  or raw log content. Sanitization is applied before write.

---

## Validation

The schema uses JSON Schema draft-07. Validate external fact entries against it:

```bash
# Using ajv-cli (if installed)
npx ajv validate -s schemas/external-facts.schema.json -d <entry-file>.json

# Using any draft-07 compatible validator
```

---

## See Also

- [Fact Event Ledger](fact-event-ledger.md) — Internal control-plane fact log
- [Task Ledger](task-ledger-schema.md) — Task lifecycle and fact flow
- [Gap Ledger](gap-ledger.md) — Planning deviations and failures
- [Knowledge Update Writer](knowledge-update-writer.md) — Post-merge knowledge entries
- [Context Bundle Fact Projection](context-bundle-fact-projection.md) — How facts enter worker context
- [Meta Signals](meta-signals.md) — Aggregate signal calculator
- [Loop Model](loop-model.md) — Self-cycle runner phases
- [#891](https://github.com/taoyu051818-sys/lian-nest-server/issues/891) — This feature
