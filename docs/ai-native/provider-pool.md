# API Provider Pool for Quota-Aware Concurrency

Manages multiple Claude/API credentials from a local provider pool so that
parallel workers can route across available credentials and automatically back
off when a provider is exhausted.

> **Closes:** [#353](https://github.com/taoyu051818-sys/lian-nest-server/issues/353)

---

## Problem

The current Claude Code configuration uses a single fixed credential under
`C:\Users\LENOVO\.claude`. When multiple workers hit the same credential
concurrently, they share a single quota and rate limit. A 429 or quota
exhaustion blocks all workers — there is no failover path.

## Goals

- Select among multiple API/provider credentials for parallel workers.
- Increase safe concurrency by routing across provider pool capacity.
- Automatically stop routing to an exhausted credential until it recovers.
- Keep all secrets out of GitHub, repo files, task JSON, logs, and PR bodies.

## Non-Goals

- No commit of `C:\Users\LENOVO\.claude\settings.json` or copied secrets.
- No bypass of provider terms or account policy.
- No production runtime behavior change (this is local orchestration only).

---

## Architecture

```
                         ┌─────────────────────────────┐
                         │  .github/ai-policy/          │
                         │  provider-pool-policy.json   │
                         │  (allowed providers, limits) │
                         └──────────────┬──────────────-┘
                                        │
          ┌─────────────────────────────┼──────────────────────────────┐
          │                             │                              │
          ▼                             ▼                              ▼
┌─────────────────┐        ┌─────────────────────┐       ┌────────────────────┐
│  Local Secret    │        │  Provider Selector   │       │  State Updater     │
│  Sources         │        │  (select-api-        │       │  (update-provider- │
│                  │        │   provider.ps1)       │       │   state.ps1)       │
│  - ~/.claude     │        │                      │       │                    │
│  - Credential    │        │  Reads policy +      │       │  Records quota     │
│    Manager       │        │  state, picks a      │       │  exhaustion,       │
│  - Env vars      │        │  provider for the    │       │  cooldowns,        │
│                  │        │  next worker          │       │  recovery           │
└─────────────────┘        └──────────┬──────────-┘       └────────┬───────────┘
                                      │                            │
                                      ▼                            ▼
                           ┌─────────────────────┐      ┌────────────────────┐
                           │  Worker receives      │      │  .github/ai-state/ │
                           │  LIAN_PROVIDER_ID     │      │  provider-pool.json│
                           │  env var (no secret)  │      │  (sanitized state) │
                           └─────────────────────┘      └────────────────────┘
```

---

## Components

### Policy File

**Path:** `.github/ai-policy/provider-pool-policy.json`

Defines the provider pool configuration. Read by the launcher and orchestrator
before dispatching workers.

| Field | Purpose |
|-------|---------|
| `providers[]` | List of allowed provider definitions with ids, capabilities, max concurrency |
| `concurrency` | Global max workers, selection strategy, fallback behavior |
| `exhaustion` | Triggers (429, quota, auth), cooldown durations, recovery rules |
| `failureClassification` | Patterns to distinguish exhaustion from runtime/auth failures |
| `workerIntegration` | How workers receive provider assignment (env var, no secrets) |
| `launchGateIntegration` | How the launch gate checks provider availability |
| `secretSources` | Allowed and forbidden secret source locations |

### State File

**Path:** `.github/ai-state/provider-pool.json`

Sanitized projection of current provider pool status. Never contains secrets.
Updated by `scripts/ai/update-provider-state.ps1`.

| Field | Purpose |
|-------|---------|
| `providers[]` | Per-provider status, concurrency, cooldown, failure class |
| `global` | Aggregate counts: active workers, available/exhausted/disabled providers |
| `stateVersion` | Schema version for evolution |

#### Provider Statuses

| Status | Meaning | Auto-Recovery |
|--------|---------|:---:|
| `available` | Has capacity, no cooldown | — |
| `exhausted` | Quota or rate limit hit; cooling down | Yes, after cooldown |
| `disabled` | Auth failure or manual disable | No |

### Selector Script (future)

**Path:** `scripts/ai/select-api-provider.ps1` (planned)

Reads the policy and state, picks a provider for the next worker using the
configured selection strategy (`least-loaded`), and exports the provider id.

### State Updater Script (future)

**Path:** `scripts/ai/update-provider-state.ps1` (planned)

Records quota exhaustion events, manages cooldown timers, and handles provider
recovery after cooldown expires.

---

## Provider Selection Flow

```
batch-launch.ps1
       │
       ▼
  read provider-pool-policy.json + provider-pool.json
       │
       ▼
  select-api-provider.ps1 (planned)
       │
       ├── all providers exhausted/disabled? → block launch (fail-closed)
       │
       ▼
  pick provider with capacity (least-loaded strategy)
       │
       ▼
  set LIAN_PROVIDER_ID env var for worker
       │
       ▼
  worker reads LIAN_PROVIDER_ID, injects secret from local source
       │
       ▼
  worker records provider id in telemetry
```

---

## Exhaustion Handling

### Trigger → Action Mapping

| Trigger | Action | Cooldown | Notes |
|---------|--------|----------|-------|
| HTTP 429 | `mark-exhausted` | 15 min | Rate limit. Auto-recovers after cooldown. |
| Quota exhausted | `mark-exhausted` | 60 min | Quota resets are slower than rate limits. |
| Auth failure (401/403) | `mark-disabled` | None | Credential is invalid. Requires manual fix. |
| Transient error (5xx) | No state change | — | Provider is not marked exhausted for transient errors. |

### Failure Classification

Failures are classified by pattern matching against provider responses:

| Class | Patterns | Severity | Effect on Provider |
|-------|----------|----------|-------------------|
| `exhaustion` | 429, "quota exceeded", "rate limit" | yellow | Marked exhausted, cooldown starts |
| `auth` | 401, 403, "invalid api key" | red | Marked disabled, no auto-recovery |
| `runtime` | timeout, 500, 502, 503 | yellow | Not marked exhausted (transient) |

This distinction is critical: exhaustion is a **resource constraint**, not a
code bug. The launch gate treats them differently.

---

## Integration Points

### Launch Gate

The launch gate (`check-launch-gate.ps1`) reads `provider-pool.json` before
dispatching. When all providers are exhausted or at capacity, the gate blocks
the batch:

```
provider-pool.json: all providers exhausted → gate blocks → batch delayed
provider-pool.json: 1 provider available   → gate passes → batch dispatched
```

### Current Controlled Rehearsal Capacity

For the current local self-cycle rehearsal, `provider-default` is projected
with `maxConcurrency: 30`, and `globalMaxWorkers` is also 30. This does not
store or expose credentials; it only lets the launch gate schedule up to the
validated local operating target when resource, conflict, risk, review, and
merge gates also allow it.

The effective worker count can still be lower than 30 when:

- local resource state is stale, constrained, or critical;
- active workers already consume provider capacity;
- tasks share a `conflictGroup` or `sharedLocks`;
- risk policy serializes a task;
- review or merge capacity is saturated.

Do not raise this value to bypass provider exhaustion. If Claude Code reports
quota or rate-limit failures, mark the provider exhausted and let the launcher
fail closed.

### Worker Telemetry

Workers record provider metadata in `worker-telemetry.ndjson`:

```json
{
  "providerId": "provider-default",
  "quotaState": "available",
  "taskStartAt": "2026-05-11T12:00:00Z",
  "taskEndAt": "2026-05-11T12:15:00Z"
}
```

No secrets are recorded — only the provider id and quota state.

### Worker Heartbeat

The heartbeat monitor is provider-agnostic — it tracks process state, not
provider state. If a worker fails due to provider exhaustion, the failure is
classified at the provider pool level, not the heartbeat level.

---

## Security Model

### Secret Flow

```
Local secret source (never committed)
       │
       ▼
  select-api-provider.ps1 injects secret into worker env
       │
       ▼
  worker uses secret for API calls
       │
       ▼
  telemetry records provider id only (no secret)
```

### What Is Never Committed

| Artifact | Status |
|----------|--------|
| API keys, tokens, credentials | Never committed |
| `C:\Users\LENOVO\.claude\settings.json` | Never committed |
| Raw provider responses with account details | Never committed |
| Provider secrets in issue/PR bodies | Never committed |
| Secrets in telemetry logs | Never committed |

### What IS Safe to Commit

| Artifact | Location |
|----------|----------|
| Provider policy (ids, limits, rules) | `.github/ai-policy/provider-pool-policy.json` |
| Provider state (status, cooldown, counts) | `.github/ai-state/provider-pool.json` |
| Provider id in telemetry | `worker-telemetry.ndjson` |

---

## Current State

This is the **planning slice** (issue #353). The following are defined:

- [x] Policy file schema and fields
- [x] State file schema and fields
- [x] Failure classification taxonomy
- [x] Exhaustion handling rules
- [x] Security model and secret flow
- [x] Integration point definitions

### Future Slices

- [ ] `scripts/ai/select-api-provider.ps1` — provider selection script
- [ ] `scripts/ai/update-provider-state.ps1` — state update script
- [ ] Launch gate integration — read `provider-pool.json` before dispatch
- [ ] Worker telemetry integration — record provider id per task
- [ ] Multiple provider configurations — add real provider entries to policy
- [ ] Dry-run provider selection with fake providers
- [ ] Credential manager integration for secret injection

---

## Adding a New Provider

To add a new provider to the pool:

1. **Add a policy entry** in `.github/ai-policy/provider-pool-policy.json`:
   ```json
   {
     "id": "provider-secondary",
     "label": "Secondary Claude credential",
     "source": "env-var",
     "capabilities": ["claude-code", "print-mode"],
     "maxConcurrency": 2
   }
   ```

2. **Add a state entry** in `.github/ai-state/provider-pool.json`:
   ```json
   {
     "id": "provider-secondary",
     "status": "available",
     "currentConcurrency": 0,
     "maxConcurrency": 2
   }
   ```

3. **Configure the local secret** (never committed):
   - Set `ANTHROPIC_API_KEY` env var, or
   - Add to Windows Credential Manager, or
   - Add to `C:\Users\LENOVO\.claude\settings.json`

4. **Update global limits** if needed:
   - `concurrency.globalMaxWorkers` in policy
   - `global.globalMaxWorkers` in state

---

## References

- [Launch Gate](launch-gate.md) — pre-launch health and conflict validation
- [Parallel Work Policy](parallel-work-policy.md) — conflict group rules
- [Worker Heartbeat](worker-heartbeat.md) — process-level monitoring
- [Failure Taxonomy](failure-taxonomy.md) — existing failure classification
- [Orchestration](orchestration.md) — self-hosted batch launcher
- [Worker Task Contract](worker-task-contract.md) — task JSON schema
