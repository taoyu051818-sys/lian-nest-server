# Provider Key Router — Local Usage

Local-only script that selects a provider alias from pool state without
reading or printing raw API keys, tokens, or credentials. This is the
final control-loop layer that lets the Codex orchestrator exit routine
dispatch by routing workers to the correct provider.

> **Closes:** [#598](https://github.com/taoyu051818-sys/lian-nest-server/issues/598)

---

## Quick Start

```powershell
# Dry-run: see which provider would be selected
./scripts/ai/provider-key-router.ps1

# Dry-run with JSON output (for scripting)
./scripts/ai/provider-key-router.ps1 -Json

# Commit mode: bump concurrency in state file
./scripts/ai/provider-key-router.ps1 -Commit
```

---

## What It Does

1. Reads provider pool **policy** (allowed providers, limits, strategy).
2. Reads provider pool **state** (current status, concurrency, cooldowns).
3. Optionally reads **secret refs** to verify each provider's local secret
   source exists — without reading the secret value itself.
4. Filters to providers that are:
   - Status `available`
   - Under their concurrency cap
   - Have a resolvable local secret source
5. Selects the best provider using the configured strategy (default:
   `least-loaded` — most headroom wins).
6. In dry-run mode: prints the decision and exits.
7. In commit mode (`-Commit`): bumps the selected provider's
   `currentConcurrency` in the state file.

---

## Security Model

### What This Script NEVER Does

| Action | Status |
|--------|--------|
| Read an API key value | Never |
| Print an API key to stdout | Never |
| Write secrets to the state file | Never |
| Log secret values | Never |
| Send secrets to GitHub | Never |

### What It DOES Check (Existence Only)

| Source Type | Check Performed |
|-------------|----------------|
| `env-var` | `[Environment]::GetEnvironmentVariable($key)` returns non-empty |
| `credential-manager` | `cmdkey /list:$target` exits 0 |
| `claude-settings` | `~/.claude/settings.json` file exists |

The script checks whether a secret source **exists**, never what it
**contains**. This is the key distinction that keeps secrets local-only.

---

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `-PolicyPath` | string | `.github/ai-policy/provider-pool-policy.json` | Path to policy file |
| `-StatePath` | string | `.github/ai-state/provider-pool.json` | Path to state file |
| `-SecretRefPath` | string | (empty) | Optional path to secret-ref JSON array |
| `-Json` | switch | off | Emit machine-readable JSON |
| `-Commit` | switch | off | Bump concurrency in state file |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Provider selected successfully |
| `1` | No provider available (all exhausted, at-capacity, or no secret source) |
| `2` | Usage error (missing files, invalid JSON) |

---

## JSON Output

When `-Json` is passed:

```json
{
  "tool": "provider-key-router",
  "status": "selected",
  "providerId": "provider-default",
  "reason": "",
  "dryRun": true,
  "timestamp": "2026-05-11T14:30:00Z"
}
```

When no provider is available:

```json
{
  "tool": "provider-key-router",
  "status": "no-provider",
  "providerId": null,
  "reason": "No available provider with capacity and resolvable secret source",
  "dryRun": true,
  "timestamp": "2026-05-11T14:30:00Z"
}
```

---

## Selection Strategies

The strategy is read from `concurrency.providerSelectionStrategy` in the
policy file.

| Strategy | Behavior |
|----------|----------|
| `least-loaded` | Picks the provider with the most headroom (`maxConcurrency - currentConcurrency`). This is the default. |
| `round-robin` | Picks the first available candidate. State updater rotates order across runs. |

---

## Integration Points

### Self-Cycle Runner

The router replaces the manual provider selection step in the self-cycle
runner. It is called between the provider pool preflight (Step 2.5) and
the launch gate (Step 3):

```
Step 2.5: Provider Pool Preflight
           │
           ▼
   provider-key-router.ps1     ← this script
           │
           ▼
Step 3: Launch Gate
```

### Batch Launcher

The batch launcher (`batch-launch.ps1`) can call the router to determine
which provider to assign before dispatching a worker:

```powershell
# Get the provider id
$providerJson = & ./scripts/ai/provider-key-router.ps1 -Json
$provider = $providerJson | ConvertFrom-Json

# Set it for the worker
$env:LIAN_PROVIDER_ID = $provider.providerId
```

### State File

In commit mode, the router bumps `currentConcurrency` for the selected
provider. This is a lightweight state change — the full state updater
(`update-provider-state.ps1`) handles cooldowns, recovery, and failure
classification.

---

## Secret Ref Integration

When a `SecretRefPath` is provided, the router uses the
[Provider Secret Reference Schema](provider-secret-ref-schema.md) to
validate that each provider has an active, resolvable secret source.

```powershell
# With explicit secret refs
./scripts/ai/provider-key-router.ps1 -SecretRefPath ./secret-refs.json -Json
```

The secret-ref file is a JSON array of objects with this shape:

```json
[
  {
    "providerId": "provider-default",
    "sourceType": "env-var",
    "sourceKey": "ANTHROPIC_API_KEY",
    "isActive": true
  }
]
```

Without a secret-ref file, the router falls back to the `secretSource`
field in the policy file (if present).

---

## Dry-Run Safety

The script defaults to dry-run mode. It will:

- Read and validate all input files
- Run the full selection algorithm
- Print the decision (human or JSON)
- Exit without modifying any files

Only `-Commit` enables state file writes. This is the primary safety gate.

---

## Troubleshooting

### No Provider Available

**Symptom:** Exit code 1, "No available provider with capacity."

**Causes:**
- All providers have `status` other than `available`
- All available providers are at `currentConcurrency >= maxConcurrency`
- No provider has a resolvable secret source

**Fix:**
1. Check state file for provider statuses.
2. Wait for cooldowns to expire (exhausted providers).
3. Fix disabled providers (auth failures require manual credential fix).
4. Verify secret sources exist (env vars set, credential manager entries present).

### Secret Source Not Found

**Symptom:** Provider skipped with "secret source not available."

**Causes:**
- Environment variable not set
- Credential Manager entry missing
- `~/.claude/settings.json` does not exist

**Fix:**
1. Set the environment variable, or
2. Add the credential with `cmdkey`, or
3. Ensure `~/.claude/settings.json` exists with the API key entry

---

## File Inventory

| File | Committed? | Contains Secrets? |
|------|:---:|:---:|
| `scripts/ai/provider-key-router.ps1` | Yes | No |
| `.github/ai-policy/provider-pool-policy.json` | Yes | No |
| `.github/ai-state/provider-pool.json` | Yes | No |
| Secret ref file (if used) | No | No (pointers only) |

---

## References

- [Provider Pool](provider-pool.md) — full architecture and selection flow
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch validation
- [Provider Local Secret Store](provider-local-secret-store.md) — how secrets are stored locally
- [Provider Secret Reference Schema](provider-secret-ref-schema.md) — secret ref schema
- [Provider Quota Rotation](provider-quota-rotation.md) — exhaustion and recovery runbook
- [Provider Assignment Schema](provider-assignment-schema.md) — assignment record shape
- [#598](https://github.com/taoyu051818-sys/lian-nest-server/issues/598) — this feature
