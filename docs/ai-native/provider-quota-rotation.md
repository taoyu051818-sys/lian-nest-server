# Provider Quota Rotation Runbook

Operational runbook for handling API provider quota exhaustion, automatic
disablement, cooldown management, retry behavior, and human-required
intervention boundaries during parallel worker batches.

> **Closes:** [#561](https://github.com/taoyu051818-sys/lian-nest-server/issues/561)
>
> **Cross-references:**
> [provider-pool.md](provider-pool.md) for architecture,
> [provider-pool-guard.md](provider-pool-guard.md) for guard checks,
> [self-cycle-provider-pool-preflight.md](self-cycle-provider-pool-preflight.md)
> for preflight behavior.

---

## Quick Reference

| Scenario | Automatic Action | Human Required? |
|----------|-----------------|:---:|
| HTTP 429 (rate limit) | Mark exhausted, 15 min cooldown | No |
| Quota exhausted | Mark exhausted, 60 min cooldown | No |
| Auth failure (401/403) | Mark disabled permanently | **Yes** |
| Transient 5xx | No state change | No |
| All providers exhausted | Block new launches | **Yes** (decide: wait or add provider) |
| Cooldown expired, provider not recovered | Guard warns | **Yes** (investigate state updater) |
| Provider stays exhausted > 2 hours | — | **Yes** (investigate quota reset) |

---

## Exhaustion Detection

### Failure Classification

Failures are classified by pattern matching against API responses. The
classification determines the provider state transition.

| Class | HTTP Codes / Patterns | Provider State Transition |
|-------|----------------------|--------------------------|
| `exhaustion` | 429, "quota exceeded", "rate limit" | `available` -> `exhausted` |
| `auth` | 401, 403, "invalid api key" | `available` -> `disabled` |
| `runtime` | timeout, 500, 502, 503 | No change (transient) |

**Key distinction:** Exhaustion is a resource constraint that resolves on its
own after a cooldown. Auth failures require manual credential fix. Runtime
errors are transient and do not affect provider state.

### Where Detection Happens

1. **Worker level** — Worker catches API errors and classifies them by pattern.
2. **State updater** — `update-provider-state.ps1` receives the classification
   and updates `.github/ai-state/provider-pool.json`.
3. **Guard** — `check-provider-pool.js` reads the state file and reports
   provider availability.

---

## Cooldown Behavior

### Cooldown Durations

| Trigger | Cooldown | Rationale |
|---------|----------|-----------|
| HTTP 429 | 15 minutes | Rate limits typically reset within minutes |
| Quota exhausted | 60 minutes | Quota resets are slower; 60 min covers most billing cycles |

### Cooldown Lifecycle

```
Provider hit 429/quota
       │
       ▼
  status = "exhausted"
  cooldownExpiresAt = now + cooldown duration
  lastFailureClass = "exhaustion"
       │
       ▼
  Provider skipped by selector (least-loaded strategy picks other providers)
       │
       ▼
  Cooldown expires (cooldownExpiresAt < now)
       │
       ▼
  State updater marks status = "available"
  currentConcurrency = 0
       │
       ▼
  Provider re-enters rotation
```

### Stale Cooldown Detection

The provider pool guard checks for expired cooldowns. If a provider's
`cooldownExpiresAt` has passed but its status is still `exhausted`, the guard
emits a warning:

```
[warn] provider-secondary: cooldown expired at 2026-05-11T13:00:00Z, status still exhausted
```

This indicates the state updater has not run. See
[Troubleshooting: Stale Cooldowns](#stale-cooldowns) below.

---

## Provider Disablement

### Automatic Disablement

When an auth failure (401/403) is detected:

1. Provider status changes to `disabled`.
2. No cooldown is set — the provider stays disabled indefinitely.
3. The selector never picks a disabled provider.
4. **No auto-recovery.** The credential must be fixed manually.

### Manual Disablement

An operator can manually disable a provider by editing the state file:

```json
{
  "id": "provider-secondary",
  "status": "disabled",
  "currentConcurrency": 0,
  "maxConcurrency": 2
}
```

Use cases:
- Credential rotation in progress
- Provider account suspended
- Intentional capacity reduction

### Re-enabling a Disabled Provider

1. Fix the underlying credential issue (rotate key, re-authenticate).
2. Update the state file: set `status` to `available`, `currentConcurrency` to 0.
3. Clear `lastFailureClass` (set to `null`).
4. Run the guard to verify: `node scripts/guards/check-provider-pool.js`.

---

## Retry Behavior

### Worker-Level Retry

Workers do **not** retry on exhaustion. When a 429 or quota error is received:

1. Worker reports the failure class to the state updater.
2. Worker exits with a non-zero code.
3. The task is re-queued for the next batch cycle (picks a different provider).

### Selector-Level Retry

The provider selector (`select-api-provider.ps1`) handles rotation:

1. Reads current state for all providers.
2. Filters to `available` providers with `currentConcurrency < maxConcurrency`.
3. Picks the least-loaded provider.
4. If no provider passes: blocks the launch (fail-closed).

The selector does not retry across exhausted providers — it waits for cooldown
expiry and state update.

### Batch-Level Retry

When a batch is blocked by provider exhaustion:

1. The self-cycle runner reports `blocked-by-provider-pool`.
2. The cycle pauses. No new workers are dispatched.
3. The operator can either:
   - Wait for cooldowns to expire (automatic recovery), or
   - Add a new provider to the pool (manual action).

---

## All Providers Exhausted

When every provider is either `exhausted` or `disabled`, the system enters a
**blocked state**.

### Detection

The provider pool preflight (Step 2.5 of the self-cycle runner) detects this:

```
[warn]  provider-default: exhausted (cooldown: 2026-05-11T12:45:00Z)
[warn]  provider-secondary: disabled
[cycle] Pool summary: 0 available, 1 exhausted, 1 disabled, 0 at-capacity (of 2)
==========================================================
  HUMAN DECISION REQUIRED
==========================================================
  Reason: All providers exhausted or disabled
  Next:   Wait for cooldown to expire, or add a new provider
==========================================================
```

### Resolution Options

| Option | When to Use | Steps |
|--------|-------------|-------|
| **Wait** | Only exhaustion (not disabled), cooldowns are short | Monitor state file; recovery is automatic |
| **Add provider** | Disabled providers, long cooldowns, or urgent work | Follow [Adding a New Provider](#adding-a-new-provider) below |
| **Reduce concurrency** | Too many workers for available quota | Lower `globalMaxWorkers` in policy and state |

---

## Adding a New Provider

When existing providers cannot absorb the workload:

1. **Create the credential locally** (never commit):
   - Set `ANTHROPIC_API_KEY` env var, or
   - Add to Windows Credential Manager, or
   - Add to `C:\Users\LENOVO\.claude\settings.json`

2. **Add a policy entry** in `.github/ai-policy/provider-pool-policy.json`:
   ```json
   {
     "id": "provider-tertiary",
     "label": "Tertiary Claude credential",
     "source": "env-var",
     "capabilities": ["claude-code", "print-mode"],
     "maxConcurrency": 2
   }
   ```

3. **Add a state entry** in `.github/ai-state/provider-pool.json`:
   ```json
   {
     "id": "provider-tertiary",
     "status": "available",
     "currentConcurrency": 0,
     "maxConcurrency": 2,
     "lastFailureClass": null
   }
   ```

4. **Update global limits** if needed:
   - `concurrency.globalMaxWorkers` in policy
   - `global.globalMaxWorkers` in state

5. **Verify** with the guard:
   ```bash
   node scripts/guards/check-provider-pool.js
   ```

---

## Troubleshooting

### Stale Cooldowns

**Symptom:** Guard warns that a provider's cooldown has expired but status is
still `exhausted`.

**Cause:** The state updater (`update-provider-state.ps1`) has not run since
the cooldown expired.

**Fix:**
1. Manually update the state file: set status to `available`, clear
   `cooldownExpiresAt`, reset `currentConcurrency` to 0.
2. Run the guard to verify.
3. Investigate why the state updater did not run (check cron/scheduled task).

### Provider Recovers but Workers Still Fail

**Symptom:** Provider status is `available` but workers hitting that provider
still get 429/quota errors.

**Cause:** The provider's quota has not actually reset (API-side delay), or
the credential has a different issue than what was classified.

**Fix:**
1. Manually mark the provider as `exhausted` with a longer cooldown.
2. File an issue to investigate the failure classification accuracy.

### Workers Assigned to Disabled Provider

**Symptom:** Worker receives `LIAN_PROVIDER_ID` for a disabled provider.

**Cause:** Selector read stale state, or state file was updated after selector
ran.

**Fix:**
1. Kill the affected worker.
2. Re-run the selector with fresh state.
3. Consider adding a pre-launch state freshness check.

---

## Monitoring

### What to Watch During a Batch

| Signal | Where to Check | Healthy | Action Needed |
|--------|---------------|---------|---------------|
| Provider status | `.github/ai-state/provider-pool.json` | All `available` | Check cooldowns if any `exhausted` |
| Active workers per provider | `currentConcurrency` field | Below `maxConcurrency` | Reduce batch size if at cap |
| Guard output | `check-provider-pool.js --json` | `ok: true` | Investigate violations |
| Worker telemetry | `worker-telemetry.ndjson` | No `exhaustion` failures | Check failure classification |

### Post-Batch Review

After a batch completes:

1. Run the guard: `node scripts/guards/check-provider-pool.js`.
2. Check for providers that hit exhaustion during the batch.
3. If a provider was exhausted, verify its cooldown and recovery.
4. Update the state file if the state updater did not auto-recover.

---

## Human-Required Boundaries

The following actions **always** require human intervention. Automation must
not perform these autonomously.

| Action | Why Human-Owned |
|--------|-----------------|
| Re-enabling a disabled provider | Credential rotation has security implications |
| Adding a new provider to the pool | Involves secret management decisions |
| Overriding the launch gate when all providers are exhausted | May indicate a systemic issue requiring investigation |
| Modifying cooldown durations in policy | Affects all future batches; requires risk assessment |
| Reducing global concurrency limits | Capacity planning decision |

---

## References

- [Provider Pool](provider-pool.md) — full architecture and planning
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch validation tool
- [Self-Cycle Provider Pool Preflight](self-cycle-provider-pool-preflight.md) — Step 2.5 of the self-cycle runner
- [Launch Gate](launch-gate.md) — pre-launch health and conflict validation
- [Worker Heartbeat](worker-heartbeat.md) — process-level monitoring
- [Failure Taxonomy](failure-taxonomy.md) — existing failure classification
