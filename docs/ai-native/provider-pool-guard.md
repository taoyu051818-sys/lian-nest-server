# Provider Pool Guard

Reads provider-pool policy and state files, validates structural consistency,
and reports whether enough providers are available for launch readiness.

> **Closes:** [#393](https://github.com/taoyu051818-sys/lian-nest-server/issues/393)

---

## Overview

The provider pool guard (`scripts/guards/check-provider-pool.js`) is a
pre-launch validation tool that checks:

1. **Policy structure** — `providers` array exists, each entry has `id` and
   numeric `maxConcurrency`.
2. **State structure** — each provider has a valid status (`available`,
   `exhausted`, `disabled`), numeric concurrency fields, and valid
   `lastFailureClass` when set.
3. **Cross-validation** — policy and state provider ids match, global and
   per-provider concurrency limits are consistent between files.
4. **Cooldown expiry** — exhausted providers whose `cooldownExpiresAt` has
   passed are flagged as warnings (state updater should have recovered them).
5. **Launch readiness** — combines policy gate settings with current state to
   determine if a new worker can be dispatched.

---

## Usage

```bash
# Basic check against default policy + state paths
node scripts/guards/check-provider-pool.js

# Machine-readable JSON output
node scripts/guards/check-provider-pool.js --json

# Dry-run mode (checks performed, result reflects mode)
node scripts/guards/check-provider-pool.js --dry-run

# Warn-only (exit 0 even on violations)
node scripts/guards/check-provider-pool.js --warn-only

# Custom file paths
node scripts/guards/check-provider-pool.js --policy ./my-policy.json --state ./my-state.json

# Help
node scripts/guards/check-provider-pool.js --help
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | Pass — providers available, state consistent |
| `1`  | Violation — no providers available or state inconsistent |
| `2`  | Usage error — bad arguments or missing files |

---

## Checks Performed

### Policy Structure

Validates the policy file has the expected shape:

- `providers` is an array
- Each provider has an `id` string
- Each provider has a numeric `maxConcurrency`
- `concurrency.globalMaxWorkers` is a number (when present)

### State Structure

Validates the state file has the expected shape:

- Each provider `status` is one of: `available`, `exhausted`, `disabled`
- `currentConcurrency` and `maxConcurrency` are numbers
- `lastFailureClass` is one of: `exhaustion`, `auth`, `runtime`, or `null`
- `global.globalMaxWorkers` is a number (when present)

### Cross-Validation

Checks consistency between policy and state:

- Every provider id in state exists in policy (and vice versa)
- `globalMaxWorkers` matches between policy and state
- Per-provider `maxConcurrency` matches between policy and state

### Cooldown Expiry

For exhausted providers with a `cooldownExpiresAt` timestamp:

- If the cooldown has passed, a warning is emitted suggesting the provider
  should have been recovered by the state updater.

### Launch Readiness

Evaluates whether a new worker can be dispatched based on policy gate settings
and current state:

| Condition | Gate Setting | Effect |
|-----------|-------------|--------|
| All providers exhausted/disabled | `blockWhenAllExhausted` | Blocks launch |
| All available providers at max concurrency | `blockWhenAtCapacity` | Blocks launch |
| Global worker count at cap | (always enforced) | Blocks launch |

---

## JSON Output Structure

When `--json` is passed, the guard emits:

```json
{
  "ok": true,
  "tool": "check-provider-pool",
  "dryRun": false,
  "violations": [],
  "warnings": [],
  "readiness": {
    "ready": true,
    "reasons": [],
    "summary": {
      "totalProviders": 1,
      "available": 1,
      "exhausted": 0,
      "disabled": 0,
      "totalActiveWorkers": 0,
      "globalMaxWorkers": 3
    }
  }
}
```

---

## Self-Test

Run the co-located test file:

```bash
node scripts/guards/check-provider-pool.test.js
```

The test file covers:

- Policy and state structure validation (positive and negative)
- Cross-validation (missing providers, id mismatches, limit mismatches)
- Cooldown expiry detection (expired, future, invalid timestamps)
- Launch readiness scenarios (available, exhausted, at-capacity, global-cap)
- CLI flags (`--json`, `--dry-run`, `--help`, unknown flags)
- Integration with real policy/state files

---

## Integration

### Launch Gate

The guard is designed to be called before worker dispatch. The existing launch
gate (`check-launch-gate.ps1`) handles main-branch health and conflict-group
validation; this guard adds provider-pool availability to the pre-launch
checks.

### State Updater

The guard reads the state file but does not modify it. State updates are the
responsibility of `scripts/ai/update-provider-state.ps1` (planned). The guard
flags stale cooldowns as warnings to help detect when the state updater has
not run.

---

## References

- [Provider Pool](provider-pool.md) — full architecture and planning doc
- [Launch Gate](launch-gate.md) — pre-launch health and conflict validation
- [Worker Permissions](worker-permissions.md) — provider-pool worker class
