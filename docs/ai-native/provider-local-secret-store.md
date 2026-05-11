# Provider Local Secret Store

Documents how provider API credentials are stored and resolved on the local
machine. All secret material stays outside the repository — the repo contains
only provider ids, policy, and sanitized state.

> **Closes:** [#534](https://github.com/taoyu051818-sys/lian-nest-server/issues/534)

---

## Overview

Workers need API credentials to call Claude and other providers. These
credentials must never appear in git, PR bodies, issue comments, telemetry logs,
or any file under `.github/`. The local secret store is the contract between the
launcher and the worker for resolving a provider id to an actual credential at
dispatch time.

---

## Secret Sources (Priority Order)

When the launcher assigns a provider id to a worker, the credential is resolved
from local sources in this order:

| Priority | Source | Mechanism | Notes |
|:--------:|--------|-----------|-------|
| 1 | Environment variable | `ANTHROPIC_API_KEY` (or provider-specific var) | Highest priority; overrides all others |
| 2 | Claude settings file | `C:\Users\LENOVO\.claude\settings.json` | Read by Claude Code natively |
| 3 | Windows Credential Manager | OS-level credential store | Accessed via `cmdkey` or .NET APIs |

If no source resolves a credential for the assigned provider, the worker fails
fast with an auth-class error. The provider is marked `disabled` in state (not
`exhausted` — this is a configuration problem, not a quota event).

---

## Resolution Flow

```
Launcher assigns LIAN_PROVIDER_ID to worker
              │
              ▼
  Worker checks: is ANTHROPIC_API_KEY set?
              │
        ┌─────┴─────┐
        │ Yes        │ No
        ▼            ▼
  Use env var    Read ~/.claude/settings.json
                       │
                 ┌─────┴─────┐
                 │ Found      │ Not found
                 ▼            ▼
           Use setting    Query Credential Manager
                               │
                         ┌─────┴─────┐
                         │ Found      │ Not found
                         ▼            ▼
                   Use cred     Fail: auth error
                                Mark provider disabled
```

---

## Supported Provider Source Types

The policy file (`provider-pool-policy.json`) declares each provider's
`source` field, which tells the launcher where to expect the credential:

| `source` Value | Meaning |
|----------------|---------|
| `env-var` | Credential lives in an environment variable |
| `claude-settings` | Credential lives in `~/.claude/settings.json` |
| `credential-manager` | Credential lives in Windows Credential Manager |
| `auto` | Try all sources in priority order (default) |

Most providers should use `auto`. Explicit source types are for cases where
the launcher needs to validate that a specific storage mechanism is available
before dispatching.

---

## Per-Provider Secret Isolation

When multiple providers are configured, each resolves independently:

```
provider-default   → ANTHROPIC_API_KEY (env var)
provider-secondary → Credential Manager entry "lianthropic-secondary"
provider-tertiary  → ~/.claude/settings.json alternate profile
```

Workers receive only the provider id — never the secret itself. The secret is
injected into the worker process environment at launch time by the launcher
script. Workers never read Credential Manager directly.

---

## Credential Manager Integration

### Windows Credential Manager

On Windows, credentials are stored using the Credential Manager API. The
launcher reads credentials using `cmdkey` or .NET `System.Net.CredentialCache`:

```powershell
# Read a stored credential (launcher only)
cmdkey /list:lianthropic-provider-secondary
```

Credential names follow the convention `lianthropic-{provider-id}` to avoid
collisions with other stored credentials.

### Storing a New Credential

```powershell
# Store a credential for a provider (one-time setup)
cmdkey /add:lianthropic-provider-secondary /user:apikey /pass:<API_KEY>
```

This is a manual step — the launcher never writes credentials, only reads them.

---

## .gitignore Boundaries

The following paths are git-ignored and must never be committed:

| Path Pattern | Reason |
|--------------|--------|
| `.env`, `.env.*` | May contain API keys |
| `C:\Users\LENOVO\.claude\settings.json` | Contains credential references |
| `*.secret`, `*.credentials` | Catch-all for local secret files |
| `.github/ai-state/provider-pool.json` | Contains sanitized state only (safe), but secrets must not leak into it |

The `.gitignore` already covers `.env` and `.env.*`. No additional gitignore
changes are needed for this contract — the existing rules are sufficient.

---

## What Workers See

Workers receive:

| Artifact | Contains Secrets? |
|----------|:-----------------:|
| `LIAN_PROVIDER_ID` env var | No — provider id only |
| `ANTHROPIC_API_KEY` env var | Yes — injected at launch |
| `provider-pool.json` (if read) | No — sanitized state only |
| `provider-pool-policy.json` (if read) | No — policy rules only |

Workers must never:
- Read Credential Manager directly
- Write secrets to logs, telemetry, or stdout
- Pass secrets through task JSON or state files
- Include secrets in error messages or PR bodies

---

## Failure Modes

| Scenario | Classification | Provider State Change | Recovery |
|----------|---------------|----------------------|----------|
| Env var not set | `auth` | `disabled` | Set the env var |
| Settings file missing entry | `auth` | `disabled` | Add entry to settings file |
| Credential Manager entry missing | `auth` | `disabled` | Store credential with `cmdkey` |
| Credential expired/revoked | `auth` | `disabled` | Replace credential |
| Credential valid but quota exhausted | `exhaustion` | `exhausted` | Auto-recover after cooldown |

Auth failures (credential not found or invalid) are always classified as `auth`,
never `exhaustion`. This ensures the provider is disabled rather than put on
cooldown — a missing credential won't fix itself.

---

## Security Invariants

1. **No secrets in git.** Every secret source is outside the working tree or
   git-ignored.
2. **No secrets in state files.** `provider-pool.json` contains status, counts,
   and cooldown timestamps — never credentials.
3. **No secrets in telemetry.** `worker-telemetry.ndjson` records provider ids
   and quota states only.
4. **No secrets in logs.** Worker stdout/stderr must not echo API keys.
5. **No secrets in PR/issue bodies.** The launcher strips credential material
   before any GitHub interaction.
6. **Fail-closed on missing credentials.** A worker that cannot resolve its
   assigned provider fails immediately — it does not fall back to an unassigned
   default.

---

## Setup Checklist

To add a new provider with local secret storage:

1. **Choose a source type** — `env-var`, `claude-settings`, `credential-manager`,
   or `auto`.
2. **Store the credential locally** (never commit):
   - Env var: `export ANTHROPIC_API_KEY=sk-ant-...`
   - Settings: add entry to `~/.claude/settings.json`
   - Credential Manager: `cmdkey /add:lianthropic-{id} /user:apikey /pass:...`
3. **Add provider to policy** in `.github/ai-policy/provider-pool-policy.json`
   with the chosen `source` field.
4. **Add provider to state** in `.github/ai-state/provider-pool.json` with
   status `available`.
5. **Test resolution** — run a dry-run dispatch and verify the worker receives
   the credential without errors.

---

## References

- [Provider Pool](provider-pool.md) — full architecture, selection strategy,
  and exhaustion handling
- [Provider Pool Guard](provider-pool-guard.md) — pre-launch validation of
  policy and state consistency
- [Self-Cycle Provider Pool Preflight](self-cycle-provider-pool-preflight.md) —
  step 2.5 of the self-cycle runner
- [Worker Permissions](worker-permissions.md) — provider-pool worker class
- [Failure Taxonomy](failure-taxonomy.md) — `exhaustion` vs `auth` vs
  `runtime` classification
