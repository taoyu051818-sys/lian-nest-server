# Launch Gate Provider Pool Fixture Coverage

Fixture-based tests for the provider pool warning path in `check-launch-gate.ps1`.

> **Closes:** [#450](https://github.com/taoyu051818-sys/lian-nest-server/issues/450)

---

## Purpose

The launch gate (`scripts/ai/check-launch-gate.ps1`) reads
`provider-pool.json` and emits warnings when providers are exhausted,
disabled, or at capacity. The fixture test
(`scripts/ai/check-launch-gate.provider-pool.test.ps1`) exercises every
provider-pool warning branch without modifying live state files.

---

## Running the Tests

```powershell
pwsh ./scripts/ai/check-launch-gate.provider-pool.test.ps1
```

The test creates temporary fixture files in the system temp directory,
invokes the launch gate with `-Json -DryRun`, parses the output, and
cleans up all fixtures on exit. No live files are touched.

---

## Fixture Scenarios

| Fixture | Providers | Expected Warnings |
|---------|-----------|-------------------|
| All available | 1 available | 0 warnings |
| Exhausted | 1 exhausted | 1 (exhausted) |
| Disabled | 1 disabled | 1 (disabled) |
| At capacity | 1 at max | 1 (capacity) |
| All exhausted | 2 exhausted | 3 (2 exhausted + CRITICAL) |
| All disabled | 2 disabled | 3 (2 disabled + CRITICAL) |
| Mixed | 1 available, 1 exhausted | 1 (exhausted, no CRITICAL) |
| Empty providers | 0 providers | 0 warnings |
| Expired cooldown | 1 exhausted (past cooldown) | 1 (exhausted) |
| Missing file | file does not exist | 0 (graceful skip) |
| Malformed JSON | invalid syntax | 0 (graceful skip) |
| Dry-run mode | 1 exhausted | 1 (in dry-run output) |
| At-capacity + exhausted | 1 at max, 1 exhausted | 2 (capacity + exhausted) |

### Exhausted Provider

Fixture:
```json
{
  "providers": [
    {
      "id": "provider-a",
      "status": "exhausted",
      "currentConcurrency": 0,
      "maxConcurrency": 2,
      "cooldownExpiresAt": "2099-12-31T23:59:59Z"
    }
  ]
}
```

Expected warning: `Provider 'provider-a' is exhausted (cooldown until ...).`

### Disabled Provider

Expected warning: `Provider 'provider-a' is disabled (manual intervention required).`

### At Capacity

Expected warning: `Provider 'provider-a' is at capacity (2/2).`

### CRITICAL (No Providers Available)

When all providers are exhausted, disabled, or at capacity:
`CRITICAL: No providers available. All providers are exhausted, disabled, or at capacity.`

### Missing / Malformed File

The gate logs a step message and continues with `providerPoolLoaded = false`.
No warnings are emitted, and the task evaluation proceeds normally.

---

## How Fixtures Are Created

1. A temp directory is created under the system temp path.
2. A minimal `provider-pool.json` fixture is written to that directory.
3. A single-task `task.json` is written (scripts-only, low risk, green state).
4. `check-launch-gate.ps1` is invoked with `-ProviderPoolFile` pointing
   at the fixture, plus `-Json` for machine-readable output.
5. The JSON report is parsed and assertions run against
   `providerPoolLoaded`, `providerPoolWarnings`, and `allAllowed`.
6. The temp directory is removed in a `finally` block.

---

## Adding a New Fixture

1. Add a new fixture block in the test script following the existing pattern.
2. Create the fixture JSON as a PowerShell hashtable, convert with `ConvertTo-Json`.
3. Call `Invoke-GateWithFixture` with the fixture JSON.
4. Parse the returned JSON and assert the expected warnings.
5. Update the fixture table in this doc.

---

## References

- [check-launch-gate.ps1](../../scripts/ai/check-launch-gate.ps1) — the script under test
- [Provider Pool Guard](provider-pool-guard.md) — provider pool validation details
- [Provider Pool](provider-pool.md) — full architecture
- [Launch Gate](launch-gate.md) — pre-launch health and conflict validation
