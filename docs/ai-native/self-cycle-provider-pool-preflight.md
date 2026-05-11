# Self-Cycle Provider Pool Preflight

## Purpose

Step 2.5 of the self-cycle runner checks API provider availability before the
launch gate. It reads the provider pool state and policy files to determine
whether any provider can accept a new worker, blocking the cycle when capacity
is exhausted.

This prevents wasted launch-gate work when no provider is available.

## Inputs

| File | Required | Description |
|------|----------|-------------|
| `.github/ai-state/provider-pool.json` | No | Current provider availability, concurrency, and cooldown state |
| `.github/ai-policy/provider-pool-policy.json` | No | Launch gate integration flags (`blockWhenAllExhausted`, `blockWhenAtCapacity`) |

When either file is missing, the preflight is skipped with a warning. The cycle
continues — the launch gate downstream may still block if it enforces its own
provider checks.

## Behavior

1. Load provider pool state and policy.
2. For each provider, classify as:
   - **available** — status is `available` and `currentConcurrency < maxConcurrency`
   - **at-capacity** — status is `available` but `currentConcurrency >= maxConcurrency`
   - **exhausted** — status is `exhausted` (cooldown in progress)
   - **disabled** — status is `disabled` (manual fix required)
3. Apply policy rules:
   - If `blockWhenAllExhausted` is true and no provider is available or at-capacity → **block**
   - If `blockWhenAtCapacity` is true and all providers are at-capacity → **block**
4. Otherwise → **pass**, continue to launch gate.

## Blocking conditions

| Condition | Policy flag | Result |
|-----------|-------------|--------|
| All providers exhausted or disabled | `blockWhenAllExhausted` | Exit 1, `blocked-by-provider-pool` |
| All providers at max concurrency | `blockWhenAtCapacity` | Exit 1, `blocked-by-provider-pool` |
| At least one provider has room | — | Pass, continue |

## Dry-run fixture support

When `-DryRunFixture` is used, the runner looks for `provider-pool.json` and
`provider-pool-policy.json` inside the fixture directory. If found, those
override the default paths. This allows testing blocked scenarios without
modifying the live state.

## Integration with launch gate

The provider pool preflight runs before the launch gate (STEP 3). It is a
fast-fail check — if no provider can accept work, the cycle stops early without
running the more expensive gate logic. The launch gate retains its own provider
checks for finer-grained per-task decisions.

## Example output

```
----------------------------------------------------------
  STEP 2.5 — Provider Pool Preflight
----------------------------------------------------------
[  ok]  provider-default: available (0/1)
[cycle] Pool summary: 1 available, 0 exhausted, 0 disabled, 0 at-capacity (of 1)
[  ok]  Provider pool preflight PASSED — 1 provider(s) available
```

Blocked scenario:

```
[warn]  provider-default: exhausted (cooldown: 2026-05-11T12:45:00Z)
[cycle] Pool summary: 0 available, 1 exhausted, 0 disabled, 0 at-capacity (of 1)
==========================================================
  HUMAN DECISION REQUIRED
==========================================================
  Reason: All providers exhausted or disabled ...
  Next:   Wait for cooldown to expire ...
==========================================================
```

## Related

- [Provider pool architecture](provider-pool.md) — full design and future slices
- [Self-cycle runner](self-cycle-runner.md) — top-level orchestrator docs
- `.github/ai-state/provider-pool.json` — live state projection
- `.github/ai-policy/provider-pool-policy.json` — policy configuration
