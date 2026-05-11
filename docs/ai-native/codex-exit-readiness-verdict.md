# Codex Exit Readiness Verdict

**Schema version:** 1
**Emitter:** `scripts/ai/emit-codex-exit-readiness.js`

## Overview

The exit readiness verdict is a machine-readable JSON projection that
evaluates all gates defined in [codex-exit-readiness.md](codex-exit-readiness.md)
and produces a single verdict: `ready`, `partial`, or `not_ready`.

The WebUI planning console consumes this verdict to display Codex exit
status without requiring operators to run each gate check manually.

## Usage

```bash
# Dry-run preview (default)
node scripts/ai/emit-codex-exit-readiness.js

# Write to file
node scripts/ai/emit-codex-exit-readiness.js --live

# Print JSON to stdout
node scripts/ai/emit-codex-exit-readiness.js --stdout

# Built-in self-test
node scripts/ai/emit-codex-exit-readiness.js --self-test

# Help
node scripts/ai/emit-codex-exit-readiness.js --help
```

## Output Shape

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-12T00:00:00.000Z",
  "verdict": "partial",
  "passedBlocking": 5,
  "totalBlocking": 7,
  "gates": [
    {
      "id": "gate-1",
      "name": "Self-Cycle Runner Autonomy",
      "pass": true,
      "blocking": true,
      "checks": [
        { "id": "1.1", "name": "Runner state tracking", "pass": true },
        { "id": "1.2", "name": "Health state known", "pass": true }
      ],
      "blockers": []
    }
  ],
  "blockers": [],
  "inputSources": {
    "healthLoaded": true,
    "providerPoolLoaded": true,
    "activeWorkersLoaded": true,
    "workerTrustLoaded": true,
    "metaSignalsLoaded": true,
    "queueLoaded": true
  }
}
```

## Verdict Values

| Verdict | Meaning |
|---------|---------|
| `ready` | All 7 blocking gates pass — Codex can exit routine orchestration |
| `partial` | Some blocking gates pass, some fail — progress is being made |
| `not_ready` | No blocking gates pass or critical state is missing |

## Gate Evaluation

Each gate evaluates one aspect of exit readiness. Gates are composed
of individual checks. A gate passes when all its blocking checks pass.

### Gate Mapping

| Gate | Source Files | Checks |
|------|-------------|--------|
| gate-1: Self-Cycle Runner Autonomy | active-workers, health | Runner state tracking, health state known |
| gate-2: Launch Gate Enforcement | health, worker-trust | Health gate operational, scheduling rules, trust thresholds |
| gate-3: Health Gate Operational | health, meta-signals | Health gate classifies state, state recorded (3.3 non-blocking) |
| gate-4: Recovery Path | worker-trust | Recovery worker types defined, red state blocks non-recovery (4.3 non-blocking) |
| gate-5: Merge Control | meta-signals | Dry-run default, guard checks, risk monitoring |
| gate-6: Human-Owned Boundaries | (structural) | Seed constitution, scope immutability, human wave decisions |
| gate-7: Observability | active-workers, meta-signals | State tracking, friction monitoring, result publisher |

### Non-Blocking Checks

- **3.3 Auto-trigger wired** — Health gate auto-trigger after merge is an automation upgrade, not a safety prerequisite.
- **4.3 Recovery auto-dispatch** — Automatic recovery worker launch on red is an automation upgrade.

These checks always report `pass: false` with `nonBlocking: true` until
the automation is implemented. They do not affect the gate verdict.

### Structural Gates

Gate 6 (Human-Owned Boundaries) evaluates structural guarantees enforced
by code contracts, not runtime state. It always passes. The checks exist
for documentation completeness.

## Input Files

All input files are optional. When a file is missing, the corresponding
gate checks default to `pass: false` (conservative posture).

| File | Gate(s) | Purpose |
|------|---------|---------|
| main-health.json | 1, 2, 3 | Health gate state |
| provider-pool.json | (dashboard only) | Provider availability |
| active-workers.json | 1, 7 | Worker state tracking |
| worker-trust.json | 2, 4 | Trust scores and scheduling |
| meta-signals.json | 3, 5, 7 | Aggregate health signals |
| queue-state.json | (dashboard only) | Queue lifecycle |

## Relationship to Dashboard State

The exit readiness verdict complements the
[dashboard state](control-plane-dashboard-state-actions.md). The dashboard
shows current operational status; the verdict evaluates retirement readiness.

| Projection | Purpose | Consumers |
|------------|---------|-----------|
| Dashboard state | Current operational health, action readiness | WebUI control console |
| Exit readiness verdict | Retirement gate evaluation | WebUI planning console, retirement runbook |

## References

- [codex-exit-readiness.md](codex-exit-readiness.md) — Gate definitions and verification commands.
- [codex-retirement-runbook.md](codex-retirement-runbook.md) — Full retirement criteria.
- [control-plane-dashboard-state-actions.md](control-plane-dashboard-state-actions.md) — Dashboard state schema.
