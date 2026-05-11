# Worker Control Actions

Preview-first wrapper for worker lifecycle control, designed for the WebUI
control console. Provides safe list, preview, and stop operations with
explicit PID allowlists and audit trail.

> **Closes:** [#653](https://github.com/taoyu051818-sys/lian-nest-server/issues/653)

---

## Overview

The worker control wrapper adds a safe interface for the WebUI to manage
running workers without broad kill capabilities. Three modes provide
progressive levels of trust:

| Mode | Mutating | Purpose |
|------|----------|---------|
| **List** | No | Read-only view of active workers from manifest |
| **Preview** | No | Dry-run: shows what Stop would do for given PIDs |
| **Stop** | Yes | Terminates allowlisted PIDs with audit trail |

Default mode is **List** — no side effects, no confirmation required.

---

## Safety Policy

| Constraint | Enforcement |
|------------|------------|
| Default is read-only | List mode is the default; no mutation without explicit mode |
| Explicit PID allowlist | Stop/Preview require `-Pids` with specific PID values |
| Reason required | Stop mode requires a human-readable `-Reason` |
| No broad kill | Empty or invalid PID lists are rejected |
| Manifest-only scope | Only PIDs matching manifest entries are acted on |
| Audit trail | All stop actions logged to JSONL audit file |
| Confirmation prompt | Stop mode prompts for `yes` unless `-Force` is set |

---

## Modes

### List (default)

Read-only mode that displays active workers from the manifest file.

```powershell
# Console output
./scripts/ai/control-workers.ps1

# JSON output
./scripts/ai/control-workers.ps1 -Json
```

Shows: conflict group, issue number, PID, status, and branch for each worker.

### Preview

Dry-run mode that shows which PIDs would be stopped for a given allowlist.

```powershell
# Preview specific PIDs
./scripts/ai/control-workers.ps1 -Mode Preview -Pids 1234,5678

# JSON output
./scripts/ai/control-workers.ps1 -Mode Preview -Pids 1234,5678 -Json
```

Reports:
- Matched PIDs (in both allowlist and manifest)
- Unmatched PIDs (in allowlist but not in manifest)
- Actions that would be taken

No processes are terminated in Preview mode.

### Stop

Mutating mode that terminates allowlisted processes with full audit trail.

```powershell
# Stop with reason (prompts for confirmation)
./scripts/ai/control-workers.ps1 -Mode Stop -Pids 1234,5678 -Reason "Stale worker cleanup"

# Force skip confirmation
./scripts/ai/control-workers.ps1 -Mode Stop -Pids 1234 -Reason "Manual override" -Force
```

Requirements:
- `-Pids` must be specified with explicit PID values
- `-Reason` must be a non-empty string
- Confirmation prompt (unless `-Force`)
- Only PIDs in the allowlist AND present in the manifest are stopped

---

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-Mode` | String | `List` | Operation mode: List, Preview, Stop |
| `-ManifestFile` | String | `.github/ai-state/active-workers.json` | Path to active workers manifest |
| `-Pids` | Int[] | — | Explicit PID allowlist (required for Preview/Stop) |
| `-Reason` | String | — | Justification for stop (required for Stop) |
| `-AuditFile` | String | `.github/ai-state/worker-control-audit.jsonl` | Path to audit log |
| `-Force` | Switch | `$false` | Skip confirmation in Stop mode |
| `-Json` | Switch | `$false` | Output structured JSON |
| `-Help` | Switch | `$false` | Display help and exit |

---

## Audit Trail

All Stop actions are logged to the audit file as JSONL (one JSON object per
line). Each entry contains:

```json
{
  "timestamp": "2026-05-11T15:30:00.0000000Z",
  "action": "stop",
  "pid": 1234,
  "conflictGroup": "my-group",
  "issue": 653,
  "branch": "claude/issue-653-control",
  "reason": "Stale worker cleanup",
  "result": "success"
}
```

Result values: `success`, `not-found` (already terminated), `failed`.

---

## WebUI Integration

The WebUI control console should call the wrapper through a controlled
registry, not directly. The integration pattern:

1. **List workers** — Call with `-Mode List -Json` to populate the dashboard
2. **Preview stop** — Call with `-Mode Preview -Pids <selected> -Json` to
   show the operator what would happen
3. **Execute stop** — Call with `-Mode Stop -Pids <selected> -Reason <reason> -Json`
   after explicit operator confirmation

The WebUI must:
- Never bypass the preview step for stop actions
- Always collect a reason string before allowing stop
- Display the audit trail for transparency
- Not expose raw process management to end users

---

## Files

| File | Purpose |
|------|---------|
| `scripts/ai/control-workers.ps1` | Main wrapper script |
| `scripts/ai/control-workers.test.ps1` | Fixture-based tests |
| `docs/ai-native/worker-control-actions.md` | This document |
| `.github/ai-state/active-workers.json` | Active workers manifest (input) |
| `.github/ai-state/worker-control-audit.jsonl` | Audit trail (output) |

---

## References

- [Provider Pool WebUI Workers API](provider-pool-webui-workers-api.md) — worker dashboard endpoints
- [Provider Pool WebUI Worker View](provider-pool-webui-worker-view.md) — worker dashboard UI
- [Active Workers Schema](active-workers-schema.md) — manifest structure
- [Active Workers State](active-workers-state.md) — manifest lifecycle
