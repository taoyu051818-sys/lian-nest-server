# Provider Rotation Local Secrets Runbook

Step-by-step guide for managing local provider secrets used by the provider
rotation system. All secrets stay on the local machine and are never committed.

> **Closes:** [#468](https://github.com/taoyu051818-sys/lian-nest-server/issues/468)

---

## Prerequisites

- Claude Code installed with a working `~/.claude` directory
- Access to at least one Anthropic API credential
- Provider pool policy file present at `.github/ai-policy/provider-pool-policy.json`

---

## Secret Source Priority

The provider selector resolves secrets in this order:

| Priority | Source | Location |
|----------|--------|----------|
| 1 | Environment variable | `ANTHROPIC_API_KEY` in current shell |
| 2 | Claude settings | `C:\Users\LENOVO\.claude\settings.json` (apiKey field) |
| 3 | Windows Credential Manager | Stored under `claude-code` or custom target |

The first source that provides a valid-looking key wins. If all sources are
empty, the worker fails at startup with an auth error (classified as `auth`
failure, not `exhaustion`).

---

## Adding a New Provider Credential

### Option A: Environment Variable

Set the key before launching workers:

```powershell
$env:ANTHROPIC_API_KEY_SECONDARY = "sk-ant-..."
```

Then reference it in the provider policy entry's `secretSource` field:

```json
{
  "id": "provider-secondary",
  "secretSource": "env:ANTHROPIC_API_KEY_SECONDARY"
}
```

### Option B: Windows Credential Manager

1. Open **Credential Manager** > **Windows Credentials**
2. Add a new generic credential:
   - **Target:** `claude-code-provider-secondary`
   - **Username:** `api-key`
   - **Password:** your API key
3. Reference in policy:
   ```json
   {
     "id": "provider-secondary",
     "secretSource": "credman:claude-code-provider-secondary"
   }
   ```

### Option C: Claude Settings (Default Provider)

The default provider reads from `C:\Users\LENOVO\.claude\settings.json`. This
is the same key Claude Code itself uses. No additional configuration is needed
for the default provider entry.

**Do not copy this file into the repo or any PR.**

---

## Rotating a Credential

When a key is compromised or expired:

1. **Revoke the old key** at the provider console.
2. **Generate a new key** at the provider console.
3. **Update the local secret** in whichever source the provider uses:
   - Env var: update in `$PROFILE` or `.env.local` (not committed)
   - Credential Manager: edit the stored credential
   - Claude settings: update `settings.json`
4. **Reset provider state** if the provider was marked `disabled`:
   ```json
   // .github/ai-state/provider-pool.json
   {
     "id": "provider-secondary",
     "status": "available",
     "currentConcurrency": 0
   }
   ```
5. **Verify** with the provider pool guard:
   ```bash
   node scripts/guards/check-provider-pool.js
   ```

---

## Handling Auth Failures

When a worker hits a 401 or 403:

| Symptom | Cause | Fix |
|---------|-------|-----|
| Provider status `disabled` | Key revoked or expired | Rotate credential (see above) |
| Guard reports `auth` failure class | Invalid key in local source | Check the secret source is correct |
| All providers `disabled` | No valid credentials configured | Add at least one working credential |

Auth failures do **not** auto-recover. The provider stays `disabled` until the
credential is fixed and the state is manually reset.

---

## Handling Exhaustion

When a worker hits a 429 or quota limit:

1. The provider is marked `exhausted` with a cooldown timer.
2. After cooldown expires, the state updater recovers it automatically.
3. If no provider is available, the launch gate blocks new workers.

**Manual recovery** (if cooldown seems stuck):

```powershell
# Check current state
node scripts/guards/check-provider-pool.js --json

# Reset a specific provider (if cooldown expired but state is stale)
# Edit .github/ai-state/provider-pool.json:
#   "status": "available", "currentConcurrency": 0
```

---

## Verifying Secret Configuration

Run these checks before launching a batch:

```bash
# 1. Confirm at least one provider is available
node scripts/guards/check-provider-pool.js

# 2. Confirm the secret source resolves (no actual key printed)
# The selector logs which source it used, not the key value
node scripts/guards/check-provider-pool.js --json | grep -i "provider"

# 3. Dry-run a single worker to test the full path
# (uses --dry-run, no API call made)
```

---

## Secret Hygiene Checklist

Before committing any file:

- [ ] No API keys in staged files
- [ ] No `settings.json` from `~/.claude` in staged files
- [ ] No `.env` or `.env.local` files in staged files
- [ ] No raw provider responses with account details in logs
- [ ] Policy file has `id` and `secretSource` but not the actual secret

---

## File Inventory

| File | Committed? | Contains Secrets? |
|------|:---:|:---:|
| `.github/ai-policy/provider-pool-policy.json` | Yes | No |
| `.github/ai-state/provider-pool.json` | Yes | No |
| `C:\Users\LENOVO\.claude\settings.json` | **No** | Yes |
| `.env.local` (if used) | **No** | Yes |
| Windows Credential Manager entries | N/A | Yes |

---

## References

- [Provider Pool](provider-pool.md) — architecture and selection flow
- [Provider Pool Guard](provider-pool-guard.md) — validation tool usage
- [Self-Cycle Provider Pool Preflight](self-cycle-provider-pool-preflight.md) — pre-launch availability check
- [Failure Taxonomy](failure-taxonomy.md) — failure class definitions
