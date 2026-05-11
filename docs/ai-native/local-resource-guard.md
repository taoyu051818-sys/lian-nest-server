# Local Resource Guard

Reads local-resource policy and state files, validates structural consistency,
and reports whether local resources meet thresholds for launch readiness.

> **Closes:** [#529](https://github.com/taoyu051818-sys/lian-nest-server/issues/529)

---

## Overview

The local resource guard (`scripts/guards/check-local-resource.js`) is a
pre-launch validation tool that checks:

1. **Policy structure** — `resources` array exists, each entry has `id`,
   valid `type`, optional numeric `threshold`, and optional `severity`.
2. **State structure** — each resource has a valid `type`, numeric
   `available`, optional `unit` string, and valid `status`.
3. **Cross-validation** — policy and state resource ids match, types are
   consistent between files.
4. **Threshold checks** — resources below their threshold are flagged as
   violations (critical severity) or warnings (other severities).
5. **Launch readiness** — combines policy gate settings with current state to
   determine if local resources are sufficient for worker dispatch.

---

## Resource Types

| Type | Description |
|------|-------------|
| `disk` | Disk space availability (e.g., root volume free MB) |
| `memory` | Memory availability (e.g., free RAM MB) |
| `cpu` | CPU availability (e.g., load average headroom) |
| `port` | Network port availability (e.g., port 3000 free) |
| `service` | Local service availability (e.g., dev server running) |

---

## Usage

```bash
# Basic check against default policy + state paths
node scripts/guards/check-local-resource.js

# Machine-readable JSON output
node scripts/guards/check-local-resource.js --json

# Dry-run mode (checks performed, result reflects mode)
node scripts/guards/check-local-resource.js --dry-run

# Warn-only (exit 0 even on violations)
node scripts/guards/check-local-resource.js --warn-only

# Custom file paths
node scripts/guards/check-local-resource.js --policy ./my-policy.json --state ./my-state.json

# Help
node scripts/guards/check-local-resource.js --help
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | Pass — local resources sufficient, state consistent |
| `1`  | Violation — resource shortfall or state inconsistent |
| `2`  | Usage error — bad arguments or missing files |

---

## Checks Performed

### Policy Structure

Validates the policy file has the expected shape:

- `resources` is an array
- Each resource has an `id` string
- Each resource has a `type` from: `disk`, `memory`, `cpu`, `port`, `service`
- Each resource may have a numeric `threshold`
- Each resource may have a `severity` from: `critical`, `warning`, `info`

### State Structure

Validates the state file has the expected shape:

- `resources` is an array
- Each resource has an `id`, valid `type`, numeric `available`
- Each resource may have a string `unit`
- Each resource may have a `status` from: `ok`, `low`, `critical`, `unavailable`
- `global.ready` is a boolean (when present)

### Cross-Validation

Checks consistency between policy and state:

- Every resource id in state exists in policy (and vice versa)
- Resource `type` matches between policy and state

### Threshold Checks

For resources with a `threshold` in policy:

- If `available < threshold`, the resource is flagged
- Critical severity produces a violation; other severities produce a warning

### Launch Readiness

Evaluates whether local resources are sufficient based on policy gate settings
and current state:

| Condition | Gate Setting | Effect |
|-----------|-------------|--------|
| Critical resource below threshold | `blockOnCritical` | Blocks launch |
| Critical resource missing from state | `blockOnMissingState` | Blocks launch |
| `state.global.ready` is false | (always enforced) | Blocks launch |

---

## JSON Output Structure

When `--json` is passed, the guard emits:

```json
{
  "ok": true,
  "tool": "check-local-resource",
  "dryRun": false,
  "violations": [],
  "warnings": [],
  "readiness": {
    "ready": true,
    "reasons": [],
    "summary": {
      "totalResources": 3,
      "ok": 3,
      "low": 0,
      "critical": 0,
      "unavailable": 0
    }
  }
}
```

---

## Policy Schema

```json
{
  "policyVersion": 1,
  "resources": [
    {
      "id": "disk-root",
      "type": "disk",
      "threshold": 1024,
      "severity": "critical",
      "unit": "MB"
    }
  ],
  "launchGateIntegration": {
    "blockOnCritical": true,
    "blockOnMissingState": true,
    "preLaunchCheck": true
  }
}
```

## State Schema

```json
{
  "stateVersion": 1,
  "resources": [
    {
      "id": "disk-root",
      "type": "disk",
      "available": 2048,
      "unit": "MB",
      "status": "ok",
      "capturedAt": "2026-05-11T00:00:00Z"
    }
  ],
  "global": {
    "ready": true,
    "lastUpdatedBy": "collector",
    "capturedAt": "2026-05-11T00:00:00Z"
  }
}
```

---

## Self-Test

Run the co-located test file:

```bash
node scripts/guards/check-local-resource.test.js
```

The test file covers:

- Constants (`VALID_RESOURCE_TYPES`, `VALID_SEVERITIES`)
- Policy and state structure validation (positive and negative)
- Cross-validation (missing resources, id mismatches, type mismatches)
- Threshold checks (below threshold with critical vs warning severity)
- Launch readiness scenarios (ok, below threshold, missing critical, global.ready false)
- CLI flags (`--json`, `--dry-run`, `--help`, unknown flags)
- `loadJson` edge cases (missing file, invalid JSON, valid JSON)

---

## References

- [Provider Pool Guard](provider-pool-guard.md) — similar guard pattern for provider availability
- [Launch Gate](launch-gate.md) — pre-launch health and conflict validation
- [Worker Permissions](worker-permissions.md) — worker class and resource boundaries
