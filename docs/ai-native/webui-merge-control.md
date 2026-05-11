# WebUI Merge Control

Preview-first merge control wrapper for the WebUI control console.

## Purpose

`webui-merge-control.ps1` is the final control-console layer that allows Codex to exit routine orchestration. It wraps `merge-clean-pr-batch.ps1` with enforced safety defaults:

- **Dry-run by default** — no merges unless `-Execute` is passed explicitly
- **Explicit PR allowlist only** — never discovers or guesses PRs
- **Health gate ON by default** — post-merge health check runs unless `-SkipHealthGate`
- **Confirmation prompt** — execute mode prints the plan and requires `-Confirm` (unless `-Force`)
- **Guard integration** — runs guards by default in execute mode
- **Manifest output** — every run writes a JSON manifest for WebUI consumption

## Quick Start

```powershell
# Preview what would happen (dry-run)
.\scripts\ai\webui-merge-control.ps1 -PRs 42,45 -Repo owner/name

# Execute with confirmation prompt
.\scripts\ai\webui-merge-control.ps1 -PRs 42 -Repo owner/name -Execute

# Execute without confirmation (CI/automation)
.\scripts\ai\webui-merge-control.ps1 -PRs 42 -Repo owner/name -Execute -Force

# Execute from allowlist file
.\scripts\ai\webui-merge-control.ps1 -AllowlistFile .\pr-allowlist.txt -Repo owner/name -Execute
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-PRs` | `int[]` | — | Inline PR allowlist (required unless `-AllowlistFile`) |
| `-AllowlistFile` | `string` | — | Path to allowlist file (required unless `-PRs`) |
| `-Repo` | `string` | `$GH_REPO` | Target repository in `OWNER/NAME` format |
| `-Execute` | `switch` | off | Actually merge PRs (default is dry-run) |
| `-SkipHealthGate` | `switch` | off | Skip post-merge health check |
| `-SkipGuards` | `switch` | off | Skip local guard checks |
| `-Force` | `switch` | off | Skip confirmation prompt in execute mode |
| `-SelfTest` | `switch` | — | Run inline self-test assertions |

## Modes

### Dry-Run (default)

Prints the merge plan without performing any merges. Validates PRs and shows what would happen.

```powershell
.\scripts\ai\webui-merge-control.ps1 -PRs 42,45 -Repo owner/name
```

### Execute

Actually merges PRs with full safety checks:

1. Prints the merge plan
2. Prompts for confirmation (unless `-Force`)
3. Invokes `merge-clean-pr-batch.ps1 -Execute -RunHealthGate -RunGuards`
4. Writes manifest with results

```powershell
.\scripts\ai\webui-merge-control.ps1 -PRs 42 -Repo owner/name -Execute
```

### Aborted

When the user declines the confirmation prompt, the script writes an abort manifest and exits with code 2.

## Safety Defaults

| Feature | Dry-Run | Execute |
|---------|---------|---------|
| PR allowlist | required | required |
| Health gate | skipped | ON (unless `-SkipHealthGate`) |
| Guards | skipped | ON (unless `-SkipGuards`) |
| Confirmation | not needed | required (unless `-Force`) |

## Allowlist Format

The allowlist file supports:

- One PR number per line
- Blank lines (ignored)
- Comment lines starting with `#` (ignored)
- Invalid entries cause an error and abort

```
# PRs to merge
42
45
51
```

## Manifest Output

Every run writes a JSON manifest to `.ai/webui-merge-manifests/` with:

```json
{
  "schemaVersion": 1,
  "batchId": "webui-merge-2026-05-11T22-17-21Z",
  "timestamp": "2026-05-11T22:17:21.000Z",
  "repository": "owner/name",
  "mode": "dry-run",
  "prNumbers": [42, 45],
  "healthGate": "skipped",
  "guards": "skipped",
  "failureReason": null
}
```

### Mode Values

| Mode | Description |
|------|-------------|
| `dry-run` | Preview only, no merges performed |
| `execute` | Merges were attempted |
| `aborted` | User declined confirmation |

### Health Gate Values

| Value | Description |
|-------|-------------|
| `skipped` | Health gate did not run |
| `pass` | Health gate passed |
| `fail` | Health gate failed |

### Guard Values

| Value | Description |
|-------|-------------|
| `skipped` | Guards did not run |
| `pass` | All guards passed |
| `fail` | One or more guards failed |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (dry-run preview or completed merges) |
| 1 | Validation failure, guard failure, merge failure, or health gate failure |
| 2 | Invalid arguments or confirmation declined |

## Self-Test

Run inline assertions without contacting GitHub:

```powershell
.\scripts\ai\webui-merge-control.ps1 -SelfTest
```

The self-test validates:

- Inline allowlist resolution
- File-based allowlist resolution (comments, blanks, valid entries)
- Allowlist error cases (empty file, invalid entries, missing file)
- WebUI manifest structure (schema version, batch ID, mode, PR numbers)
- WebUI manifest with failure (health gate fail, guard fail)
- Manifest JSON validity
- Timestamp format (ISO 8601)
- batchId pattern validation

## Architecture

```
webui-merge-control.ps1
  ├── Resolve-Allowlist      ← validates and resolves PR allowlist
  ├── Invoke-MergeBatch      ← delegates to merge-clean-pr-batch.ps1
  ├── Write-WebUIManifest    ← writes JSON manifest for WebUI
  └── Main                   ← orchestrates the flow
```

The script delegates all actual merge logic to `merge-clean-pr-batch.ps1`. It adds:

1. **UI-oriented validation** — clearer error messages, confirmation prompts
2. **Safety defaults** — health gate and guards ON by default in execute mode
3. **Manifest output** — WebUI-friendly manifest with schema version and structured fields
4. **Preview semantics** — always shows what will happen before doing it

## Related Scripts

- `merge-clean-pr-batch.ps1` — underlying merge orchestration
- `merge-queue-assistant.js` — PR discovery and classification
- `emit-control-plane-dashboard-state.js` — dashboard state emitter
- `post-merge-health-gate.js` — post-merge health checks

## Testing

```powershell
# Run the test suite
pwsh ./scripts/ai/webui-merge-control.test.ps1

# Run the self-test (inline assertions)
pwsh ./scripts/ai/webui-merge-control.ps1 -SelfTest
```
