# WebUI Issue Control

Preview-first issue close and state reconcile wrapper for the WebUI
control console. Orchestrates the issue lifecycle control scripts behind
a single safety-enforced entry point.

> **Closes:** [#655](https://github.com/taoyu051818-sys/lian-nest-server/issues/655)

---

## Overview

The WebUI issue control wrapper provides a single entry point for
routine Codex orchestration to exit by coordinating three underlying
scripts:

1. **State reconciler** — detects label/PR drift (read-only)
2. **Worker PR reconciler** — identifies label corrections (read-only)
3. **Auto-close done issues** — closes eligible issues (mutating)

All three are called with their own safety defaults. The wrapper adds
an explicit allowlist gate and refuse-list enforcement on top.

```
WebUI control console
  └─ webui-issue-control.ps1  ← THIS SCRIPT
       ├─ state-reconciler.ps1        (read-only drift detection)
       ├─ reconcile-worker-prs.ps1    (read-only PR correction)
       └─ auto-close-done-issues.ps1  (close eligible issues)
```

Dry-run is the default. No issues are closed without `-Execute`.

---

## Safety Policy

### Explicit Allowlist

Execute mode (`-Execute`) requires an explicit issue allowlist via
`-IssueNumbers`. This prevents accidental mass-close operations.

```powershell
# Requires -IssueNumbers for -Execute
./scripts/ai/webui-issue-control.ps1 -Repo "owner/name" -IssueNumbers 655,656 -Execute
```

### Refuse Rules

Issues are refused (skipped) when they match any of these criteria:

| Rule | Check | Reason |
|------|-------|--------|
| Umbrella issue | Title matches `umbrella` pattern | Umbrella issues require human orchestration |
| Human-required | Has `human-required` label | Issue explicitly requires human intervention |

Refused issues are reported but never processed for close or label
changes. In JSON output, refused issues appear in the `refused` array.

### Mutation Boundary

The wrapper never bypasses the safety semantics of underlying scripts:

- State reconciler runs in `-DryRun` mode always (read-only)
- Worker PR reconciler runs without `-Apply` (read-only)
- Auto-close runs with `-Execute` only when the wrapper itself has
  `-Execute` and an explicit allowlist

---

## Usage

### Preview mode (default)

```powershell
./scripts/ai/webui-issue-control.ps1 -Repo "owner/name" -IssueNumbers 655,656
```

Runs all three underlying scripts in read-only mode. Reports drift,
corrections, and close eligibility. No changes are made.

### Explicit dry-run

```powershell
./scripts/ai/webui-issue-control.ps1 -Repo "owner/name" -IssueNumbers 655 -DryRun
```

Same as default but intent is explicit for CI pipelines.

### Execute with allowlist (mutating)

```powershell
./scripts/ai/webui-issue-control.ps1 -Repo "owner/name" -IssueNumbers 655 -Execute
```

Runs the full control loop and closes eligible issues. Requires
`-IssueNumbers` — no mass-close without explicit allowlist.

### JSON output for CI

```powershell
./scripts/ai/webui-issue-control.ps1 -Repo "owner/name" -IssueNumbers 655 -Json
```

Outputs structured JSON:

```json
{
  "version": 1,
  "mode": "dry-run",
  "repo": "owner/name",
  "capturedAt": "2026-05-11T12:00:00Z",
  "issues": [
    { "number": 655, "title": "Add preview-first issue close wrapper", "state": "OPEN" }
  ],
  "refused": [],
  "reconcile": {
    "driftCount": 0,
    "correctionCount": 0,
    "closeCount": 0
  },
  "audit": {
    "markerBegin": "<!-- ai-webui-issue-control:begin -->",
    "markerEnd": "<!-- ai-webui-issue-control:end -->"
  }
}
```

### Fixture mode (offline testing)

```powershell
./scripts/ai/webui-issue-control.ps1 -FixturePath ./snapshot.json
```

Loads issues from a JSON fixture file. Disables mutation regardless of
other flags. Useful for CI regression testing.

### Display help

```powershell
./scripts/ai/webui-issue-control.ps1 -Help
```

---

## Dry-Run Contract

This script defaults to dry-run. The contract:

- **Default mode:** No issues closed, no labels changed. Report only.
- **`-DryRun` flag:** Same as default; explicit confirmation for CI.
- **`-Execute` flag:** Required for mutation. Requires `-IssueNumbers`.
- **`-Execute` + `-FixturePath`:** Blocked — fixture mode is read-only.
- **Refuse rules:** Applied regardless of mode. Refused issues are
  never processed.

---

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-Repo` | string | `$env:GH_REPO` | GitHub owner/repo |
| `-IssueNumbers` | int[] | — | Explicit issue allowlist |
| `-DryRun` | switch | — | Explicit dry-run (conflicts with `-Execute`) |
| `-Execute` | switch | — | Mutation mode (requires `-IssueNumbers`) |
| `-Json` | switch | — | JSON output format |
| `-FixturePath` | string | — | Fixture file for offline mode |
| `-SkipHealthCheck` | switch | — | Skip health gate in auto-close |
| `-Help` | switch | — | Show usage |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No actionable items or execute succeeded |
| 1 | Actionable items found (dry-run) or validation failure |
| 2 | Script error (missing repo, mutual exclusion) |

---

## Audit Payload

Every run produces a structured audit payload (visible in JSON mode)
with:

- **version:** Schema version (currently 1)
- **mode:** `dry-run` or `execute`
- **repo:** GitHub repository
- **capturedAt:** ISO 8601 timestamp
- **issues:** Allowed issues processed
- **refused:** Issues refused by safety policy
- **reconcile:** Reconciliation summary (drift, corrections, closes)
- **audit:** Idempotent HTML comment markers

The markers `<!-- ai-webui-issue-control:begin/end -->` enable
idempotent detection for comment posting.

---

## Integration

The WebUI issue control wrapper fits into the orchestration workflow:

```
1. Workers complete PRs        → agent:done label set
2. Merge batch runs            → PRs merged into main
3. Post-merge health gate      → main health verified green
4. WebUI issue control         → preview + close eligible issues  ← THIS SCRIPT
5. State reconciler            → confirms no remaining drift
6. Planning loop               → next wave candidates evaluated
```

### When to run

| Scenario | When |
|----------|------|
| Routine exit | After merge batch + health gate pass |
| Manual review | Operator reviewing issue lifecycle |
| CI pipeline | Post-merge validation step |

### Relationship to underlying scripts

| Script | Role in wrapper |
|--------|----------------|
| [state-reconciler](state-reconciler.md) | Drift detection (always read-only) |
| [reconcile-worker-prs](reconcile-worker-prs.md) | PR correction detection (always read-only) |
| [auto-close-done-issues](auto-close-done-issues.md) | Issue closing (mutating only with `-Execute`) |

---

## Design Decisions

- **Dry-run default.** Consistent with all `scripts/ai/*.ps1` scripts.
  No mutation without explicit opt-in.
- **Explicit allowlist for execute.** Prevents accidental mass-close.
  Every issue number must be listed.
- **Refuse-list enforcement.** Umbrella and human-required issues are
  never processed, even if listed in the allowlist.
- **Orchestration, not replacement.** The wrapper calls existing
  scripts with their own safety semantics. It does not reimplement
  their logic.
- **Audit payload.** Structured output for CI consumption and
  idempotent comment markers for GitHub.

---

## See Also

- [Issue Lifecycle](issue-lifecycle.md) — State machine and label definitions
- [State Reconciler](state-reconciler.md) — Drift detection
- [Reconcile Worker PRs](reconcile-worker-prs.md) — PR correction detection
- [Auto-Close Done Issues](auto-close-done-issues.md) — Issue closing
- [WebUI Queue State Schema](webui-queue-state-schema.md) — Queue state format
- [Control Plane NPM Scripts](control-plane-npm-scripts.md) — NPM script reference
