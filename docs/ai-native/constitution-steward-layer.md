# Constitution Steward Layer

Meta-governance layer that audits prompts, policies, schemas, docs, and
workflows against the three constitutional laws. Proposes amendments but
cannot self-approve constitutional changes.

> **Closes:** [#1060](https://github.com/taoyu051818-sys/lian-nest-server/issues/1060)

---

## Purpose

The Constitution Steward is a read-mostly audit layer that verifies the
AI development control plane remains internally consistent and faithful
to its declared invariants. It answers one question: *does this artifact
obey the constitution?*

The steward does not execute tasks, launch workers, or modify runtime
code. It inspects artifacts and produces structured findings.

---

## Three Laws

Every steward audit evaluates artifacts against these laws in order.
A finding that violates an earlier law takes precedence over findings
that violate a later one.

### 1. Reality Before Judgment

Inspect the artifact as it exists on disk or in the diff. Do not infer
intent from commit messages, PR titles, or issue descriptions. The
artifact's content is the sole evidence.

**Applied to:**
- Prompt files — read the rendered prompt, not the filename.
- Policy files — read the enforced rule, not the section heading.
- Schemas — validate the JSON structure, not the prose description.

### 2. Selection Before Memory

Prefer the authoritative source over any cached, mirrored, or remembered
version. When two sources disagree, the one declared canonical by
[docs-authority-map.md](docs-authority-map.md) wins.

**Applied to:**
- Duplicate docs across `architecture/` and `migration/` — consult the
  authority map, not the older copy.
- Constitution files — the authoritative file at
  `.github/ai-policy/seed-constitution.md` supersedes the docs mirror.
- Task contracts — the GitHub issue body is the semantic source of truth;
  the task JSON is a control-plane envelope.

### 3. Governed Recursion

The steward may inspect its own audit process but must not modify it. If
the steward discovers that its own rules are inconsistent, it produces a
finding — it does not silently patch itself.

**Applied to:**
- The steward cannot edit its own definition (this file).
- The steward cannot relax gates it is auditing.
- The steward cannot spawn sub-workers or delegate audits.

---

## Inputs

| Input | Source | Purpose |
|-------|--------|---------|
| Prompts | `ops/agent-prompts/` | Verify role prompts do not contradict constitution |
| Policies | `.github/ai-policy/`, `docs/ai-native/` | Verify policy files are internally consistent |
| Schemas | `docs/ai-native/*-schema.md`, `prisma/` | Verify schema docs match declared contracts |
| Docs | `docs/ai-native/`, `docs/architecture/`, `docs/migration/` | Verify cross-references, authority claims, staleness |
| Workflows | `scripts/ai/`, `scripts/guards/` | Verify scripts enforce declared policies |
| Task contracts | `.ai/task-manifest.json`, issue CONTROL APPENDIX | Verify `allowedFiles` / `forbiddenFiles` do not overlap |

---

## Outputs

| Output | Format | Consumer |
|--------|--------|----------|
| Audit findings | Structured list (pass/warn/fail per artifact) | Human reviewer, orchestrator |
| Amendment proposals | Diff against the audited artifact | Human reviewer only (never auto-applied) |
| Consistency report | Markdown summary of cross-artifact alignment | PR body or issue comment |

---

## Non-Goals

The steward explicitly does NOT:

- **Execute tasks or launch workers.** It is an audit layer, not an
  orchestrator.
- **Self-approve constitutional changes.** Findings that require
  constitution amendments are proposed as human-reviewed PRs.
- **Modify runtime code.** The steward reads `src/` for context but
  never edits it.
- **Override human-required boundaries.** If a finding touches a
  high-risk boundary (see [seed-constitution.md](seed-constitution.md)),
  the steward flags it for human action — it does not resolve it.
- **Broaden worker scope.** The steward cannot widen `allowedFiles` or
  relax `forbiddenFiles` on any task contract.

---

## Audit Gates

The steward runs these checks against each audited artifact:

| Gate | Checks | Failure Action |
|------|--------|----------------|
| Constitution presence | Authoritative + mirror files exist with required sections | Block (fail-closed) |
| Section sync | Headings match between authoritative and mirror | Block |
| Boundary integrity | `allowedFiles` and `forbiddenFiles` do not overlap | Block |
| Authority consistency | Cross-references point to canonical sources per docs-authority-map | Warn |
| Staleness detection | Migration docs not superseded by shutdown matrix | Warn |
| Prompt-policy alignment | Role prompts do not contradict seed constitution rules | Block |
| Scope immutability | Task contracts do not self-expand | Block |

---

## Escape Hatch

When the steward cannot complete an audit (missing inputs, ambiguous
authority, or circular dependency):

1. **Log the gap** as a finding with severity `warn`.
2. **Do not guess.** If the authoritative source is missing, report it
   as missing — do not substitute a mirror or cached version.
3. **Defer to human.** Post the gap as a comment on the relevant issue
   or PR and wait for resolution.

---

## Integration

The steward is designed to be invoked by:

- **Orchestrators** — as a pre-launch gate (audit the task contract
  before dispatching a worker).
- **CI** — as a post-merge check (audit changed policy/docs files).
- **Humans** — as a manual review step (run the steward on a PR diff).

The steward produces machine-readable output (`--json` flag when a
script implementation exists) for integration into automated gates.

---

## Relationship to Existing Guards

| Guard | Scope | Steward Relationship |
|-------|-------|---------------------|
| [constitution-guard.md](constitution-guard.md) | Validates constitution file structure | Steward depends on this gate passing before running deeper audits |
| [check-task-boundary.js](../../scripts/guards/check-task-boundary.js) | Validates `allowedFiles` on diffs | Steward uses the same boundary logic for contract audits |
| [check-docs-authority.js](../../scripts/guards/check-docs-authority.js) | Detects stale/misplaced docs | Steward extends this with cross-reference consistency |

---

## References

- [seed-constitution.md](seed-constitution.md) — The constitution being audited.
- [constitution-guard.md](constitution-guard.md) — Structural validation of constitution files.
- [docs-authority-map.md](docs-authority-map.md) — Canonical source declarations.
- [worker-task-contract.md](worker-task-contract.md) — Task JSON schema (boundary definitions).
- [backend-worker-layers.md](backend-worker-layers.md) — Layer model this steward sits above.
- [controlled-auto-merge.md](controlled-auto-merge.md) — Guard integration for merge gates.
