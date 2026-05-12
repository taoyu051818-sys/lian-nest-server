# External Intake Source Matrix

Catalogues every external information source that feeds into the AI-native
control plane, with reliability classification, risk profile, allowed readers,
and the facts each source produces.

> **Principle:** External information is *evidence*, not *commands*. All
> external intake must pass through a gate or normalizer before it can
> influence control-plane decisions.

> **Closes:** [#909](https://github.com/taoyu051818-sys/lian-nest-server/issues/909)

---

## Overview

The AI-native control plane consumes information from multiple external
sources: GitHub, git, local tooling, LLMs, and the operator. Each source
has different trust characteristics. This matrix defines how each source
is classified, what risk it carries, which roles may read it, and what
facts it can produce.

```
External Source
    │
    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Intake Gate │────▶│  Normalizer  │────▶│  Fact / State    │
│  (validate)  │     │  (sanitize)  │     │  (emit record)   │
└──────────────┘     └──────────────┘     └──────────────────┘
```

No external source may write directly to state files, policy files, or
the fact event ledger. All intake passes through validation and
sanitization.

---

## Source Matrix

| # | Source | Type | Reliability | Risk | Allowed Readers | Output Facts | Gate / Normalizer |
|---|--------|------|-------------|------|-----------------|--------------|-------------------|
| 1 | GitHub issue body (CONTROL APPENDIX) | Structured JSON | **High** | Low | issue-to-task compiler, self-cycle runner | Task JSON contract | `compile-issue-to-task-json.ps1` field validation |
| 2 | GitHub issue body (free-form markdown) | Unstructured text | **Medium** | Medium | LLM extractor, human reviewer | Task JSON contract (via LLM extraction) | LLM extraction + compiler validation |
| 3 | GitHub issue labels | Metadata | **High** | Low | self-cycle runner, launch gate | Queue membership, priority | Label filter in `run-self-cycle.ps1` |
| 4 | GitHub PR status / checks | API response | **High** | Low | health gate, merge scripts | CI pass/fail, merge readiness | `post-merge-health-gate.js` |
| 5 | GitHub API (gh CLI) | API response | **High** | Medium | scripts, orchestrator | Issue list, PR metadata, comments | Script-level input validation |
| 6 | git log / git history | Local data | **High** | Low | state reconciler, workers, auditors | Commit history, branch state, drift detection | Git-native (no external trust boundary) |
| 7 | Health gate output | Script output | **High** | Low | launch gate, orchestrator, merge scripts | green/yellow/red/black state | `write-main-health-state.ps1` schema validation |
| 8 | Worker heartbeat snapshots | NDJSON log | **High** | Low | meta signals, orchestrator, monitor | Worker liveness, stale detection | `monitor-state.schema.json` validation |
| 9 | Fact event ledger | NDJSON log | **High** | Low | context bundles, meta signals, reconciler, auditors | Append-only event records | Sanitization in `write-fact-event.js` |
| 10 | Meta signals snapshot | JSON file | **High** | Low | planning loop, batch launcher | failureScore, frictionScore, trust, cost | `calculate-meta-signals.js` deterministic scoring |
| 11 | Provider pool state | JSON file | **High** | Low | launch gate, orchestrator | API key availability, quota status | `provider-pool-guard` validation |
| 12 | Local resource state | System metrics | **High** | Low | resource guard, orchestrator | Disk, memory, CPU pressure | `local-resource-guard` thresholds |
| 13 | Schemas (`schemas/*.schema.json`, `scripts/ai/*.schema.json`) | Local files | **High** | Low | workers, context bundles | Validation rules, field definitions | File-system read (no trust boundary) |
| 14 | Docs (`docs/ai-native/*.md`) | Local files | **High** | Low | workers, context bundles, orchestrator | Process rules, policies, contracts | File-system read (no trust boundary) |
| 15 | LLM extraction (Claude) | AI output | **Medium** | High | issue-to-task compiler | Semantic fields (knowledgeRefs, promptHandoff) | Compiler strict validation when `llmExtracted: true` |
| 16 | Operator (human) | Manual input | **Highest** | Low | All roles | Issue scoping, PR approval, wave sequencing, gate overrides | Human judgment (no automated gate) |
| 17 | CI / GitHub Actions | Webhook / API | **High** | Medium | health gate, merge scripts | Check outcomes, workflow status | `post-merge-health-gate.js` category classification |

---

## Reliability Classes

| Class | Meaning | Trust Action |
|-------|---------|--------------|
| **Highest** | Human operator decision | Accepted directly; logged for audit |
| **High** | Deterministic, schema-validated source | Accepted after schema validation |
| **Medium** | Semi-structured or AI-generated | Requires normalization + validation before use |
| **Low** | Raw external data, no schema guarantee | Must be parsed, sanitized, and validated; never trusted raw |

---

## Risk Classes

| Risk | Meaning | Mitigation |
|------|---------|------------|
| **Low** | Source is local, schema-validated, or read-only | Standard validation gates |
| **Medium** | Source is external API or semi-structured | Input validation + sanitization before state mutation |
| **High** | Source is AI-generated or user-generated free text | Strict schema validation; human review gate before execution |

---

## Intake Rules

### Rule 1: Evidence, Not Commands

External information becomes a *fact* only after passing through a gate.
No external source may directly mutate:

- `.github/ai-state/*.json` (state files)
- `.github/ai-policy/*.json` (policy files)
- `.github/ai-state/fact-events.ndjson` (fact ledger)

All mutations go through dedicated writer scripts that validate and
sanitize input.

### Rule 2: Sanitize Before Record

All string values from external sources are sanitized before writing to
the fact event ledger or state files:

- Base64-like strings (40+ chars) → `[redacted-token]`
- `ghp_*` tokens → `[redacted-gh-token]`
- `Bearer *` headers → `Bearer [redacted]`
- `password=`, `secret=`, `token=` values → `[redacted]`
- String values truncated to 500 characters

See [fact-event-ledger.md](fact-event-ledger.md) for sanitization details.

### Rule 3: LLM Output Is Never Authoritative

When an LLM (e.g. Claude) produces semantic fields for the issue-to-task
compiler, the output is treated as a *suggestion*, not a command. The
compiler applies strict validation when `llmExtracted: true`:

- `knowledgeRefs` must be present and non-empty.
- `promptHandoff` must be present and non-empty.
- Structural fields (`allowedFiles`, `risk`, `conflictGroup`) are
  validated regardless of source.

If LLM extraction fails or produces incomplete output, the deterministic
fallback path always applies.

See [issue-to-task-compiler.md](issue-to-task-compiler.md) for LLM
extraction handling.

### Rule 4: Schema Drift Detection

When a schema file referenced by a normalizer changes, the normalizer
must be re-validated. Workers MUST check
[docs-authority-map.md](docs-authority-map.md) for stale doc detection
signals before relying on any external source.

### Rule 5: No Secrets in Facts

No external intake source may produce a fact that contains credentials,
tokens, or secrets. The sanitization in Rule 2 is the backstop, but
source scripts MUST NOT emit raw secrets in the first place.

---

## Intake Flow by Source Category

### GitHub Sources (Issues, PRs, Labels, API)

```
GitHub
  │
  ├── issue body ──▶ compile-issue-to-task-json.ps1 ──▶ task JSON
  │     (CONTROL APPENDIX or LLM-extracted)
  │
  ├── issue labels ──▶ run-self-cycle.ps1 -IssueLabel ──▶ queue filter
  │
  ├── PR checks ──▶ post-merge-health-gate.js ──▶ health state
  │
  └── gh CLI ──▶ scripts (read-only) ──▶ local processing
```

### Local Tooling Sources (Git, Health, Resources)

```
Local
  │
  ├── git log ──▶ state-reconciler.ps1 ──▶ drift detection
  │
  ├── health gate ──▶ write-main-health-state.ps1 ──▶ main-health.json
  │
  ├── heartbeats ──▶ calculate-meta-signals.js ──▶ meta-signals.json
  │
  └── resource sampler ──▶ local-resource-guard ──▶ pressure state
```

### AI / LLM Sources

```
LLM (Claude)
  │
  └── issue body extraction ──▶ compile-issue-to-task-json.ps1
        (knowledgeRefs, promptHandoff)   (strict validation when
                                          llmExtracted: true)
```

### Operator (Human) Sources

```
Human
  │
  ├── Issue creation ──▶ GitHub issue ──▶ compiler
  ├── PR review ──▶ approve/block ──▶ merge gate
  ├── Wave sequencing ──▶ next batch ──▶ self-cycle runner
  └── Gate override ──▶ health policy ──▶ launch gate
```

---

## Downstream Consumers

| Consumer | Reads From | Produces |
|----------|------------|----------|
| Issue-to-task compiler | GitHub issues (sources 1, 2) | Task JSON contracts |
| Self-cycle runner | Issue labels (source 3), task JSON | Worker dispatch |
| Launch gate | Health state (source 7), task JSON | Allow/block decision |
| Health gate | PR checks (source 4) | Health state marker |
| Meta signals | Heartbeats (source 8), health log | Aggregated signals snapshot |
| State reconciler | Git history (source 6), state files | Drift report |
| Context bundles | Docs (source 14), schemas (source 13) | Worker context manifest |
| Fact event ledger | All sources (via writers) | Append-only event log |
| Planning loop | Meta signals (source 10) | Risk-aware batch prioritization |

---

## References

- [fact-event-ledger.md](fact-event-ledger.md) — Append-only event log and sanitization rules.
- [issue-to-task-compiler.md](issue-to-task-compiler.md) — Compiler with LLM extraction handling.
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
- [launch-gate.md](launch-gate.md) — Pre-launch validation.
- [context-bundles.md](context-bundles.md) — Worker context manifest generation.
- [meta-signals.md](meta-signals.md) — Deterministic health aggregation.
- [loop-model.md](loop-model.md) — Self-cycle runner architecture.
- [docs-authority-map.md](docs-authority-map.md) — Folder authority and stale doc detection.
