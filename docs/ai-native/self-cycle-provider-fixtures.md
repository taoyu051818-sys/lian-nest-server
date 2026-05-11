# Self-Cycle Provider Pool Preflight Fixture Coverage

Fixture-based test coverage for the provider pool preflight step (Step 2.5) of
the self-cycle runner.

> **Closes:** [#451](https://github.com/taoyu051818-sys/lian-nest-server/issues/451)

---

## Purpose

The provider pool preflight checks whether any API provider can accept a new
worker before the launch gate runs. The test script exercises this logic through
the `-DryRunFixture` path of `run-self-cycle.ps1`, requiring no live GitHub
access or live provider state.

## Test Script

**Path:** `scripts/ai/run-self-cycle.provider-pool.test.ps1`

```powershell
pwsh ./scripts/ai/run-self-cycle.provider-pool.test.ps1
```

### What It Does

1. Creates temporary fixture directories per scenario.
2. Copies the base task and health fixtures from `tests/fixtures/self-cycle/`.
3. Writes scenario-specific `provider-pool.json` and `provider-pool-policy.json`.
4. Runs `run-self-cycle.ps1 -DryRunFixture <dir>` and checks exit code + output.
5. Cleans up temp directories.

No files outside the temp directory are modified.

---

## Scenarios

| # | Scenario | Expected | Exit Code |
|---|----------|----------|-----------|
| 1 | Available provider with capacity | Preflight passes | 0 |
| 2 | All providers exhausted | Blocked | 1 |
| 3 | All providers at max concurrency | Blocked | 1 |
| 4 | Mixed (available + exhausted) | Preflight passes | 0 |
| 5 | Disabled provider only | Blocked | 1 |
| 6 | No provider-pool.json | Skipped (warning) | 0 |
| 7 | `blockWhenAllExhausted=false` | Preflight passes despite exhaustion | 0 |

### Scenario Details

**Scenario 1 — Available provider with capacity**
State: one provider, status `available`, concurrency 0/3.
Asserts: exit 0, output contains "PASSED" or "available".

**Scenario 2 — All providers exhausted**
State: one provider, status `exhausted`, future cooldown.
Asserts: exit 1, output contains `blocked-by-provider-pool`.

**Scenario 3 — All providers at max concurrency**
State: one provider, status `available`, concurrency 1/1.
Asserts: exit 1, output contains `blocked-by-provider-pool`.

**Scenario 4 — Mixed providers**
State: provider-a `available` (0/2), provider-b `exhausted`.
Asserts: exit 0, output contains "PASSED".

**Scenario 5 — Disabled provider only**
State: one provider, status `disabled`.
Asserts: exit 1, output contains `blocked-by-provider-pool`.

**Scenario 6 — Missing provider pool files**
State: no `provider-pool.json` in fixture dir.
Asserts: exit 0, output contains "skipped" or "no provider".

**Scenario 7 — Policy override (blockWhenAllExhausted=false)**
State: one provider, status `exhausted`.
Policy: `blockWhenAllExhausted` set to `false`.
Asserts: exit 0, preflight passes.

---

## Relationship to Other Tests

| Test | Layer | Scope |
|------|-------|-------|
| `scripts/guards/check-provider-pool.test.js` | Guard | Unit tests for policy/state validation and launch readiness logic |
| `scripts/ai/run-self-cycle.provider-pool.test.ps1` | Runner | Integration tests for Step 2.5 preflight through the full self-cycle pipeline |
| `tests/fixtures/self-cycle/` | Fixtures | Base task + health fixtures used by both guard and runner tests |

The guard test validates the **logic** (structure checks, cross-validation,
readiness computation). The fixture test validates the **integration** (runner
loads fixtures, exercises Step 2.5, reports pass/block, exits correctly).

---

## Fixture Construction

Each scenario builds a temporary fixture directory containing:

```
<tmp>/pp-preflight-test-<random>/
  01-planner-output-task.json      ← copied from tests/fixtures/self-cycle/
  02-health-green.json             ← copied from tests/fixtures/self-cycle/
  provider-pool.json               ← scenario-specific state
  provider-pool-policy.json        ← scenario-specific policy (when needed)
```

The runner's `-DryRunFixture` path overrides the default provider pool file
locations when these files exist in the fixture directory.

---

## References

- [Self-Cycle Provider Pool Preflight](self-cycle-provider-pool-preflight.md) — design doc for Step 2.5
- [Provider Pool Guard](provider-pool-guard.md) — guard script and unit tests
- [Self-Cycle Runner](self-cycle-runner.md) — full pipeline documentation
- [Provider Pool](provider-pool.md) — architecture and future slices
