# WebUI Provider Key Management Screen

Screen definition for the provider key management view in the local
WebUI control console. Displays provider credential metadata without
exposing secrets. Operators can view, audit, and trigger provider
rotation from this screen.

> **Closes:** [#1118](https://github.com/taoyu051818-sys/lian-nest-server/issues/1118)

---

## Purpose

The provider key management screen gives operators a single view of all
configured provider credentials, their availability status, and secret
source health — **without ever displaying, editing, or transmitting
actual API keys, tokens, or secrets**.

This screen is the operator entry point for:

- Reviewing which providers have active credentials.
- Checking secret source availability (env var set, settings file present).
- Triggering provider rotation via the existing `provider-rotation` action.
- Auditing recent credential-related actions.

---

## Non-Goals

| Non-Goal | Reason |
|----------|--------|
| Display raw API keys or tokens | Secrets boundary — never committed or shown |
| Edit or set credential values | Credentials are managed out-of-band (env vars, local settings) |
| Add or remove providers | Requires policy file coordination — not a UI operation |
| Modify secret source paths | Policy-level decision |
| Remote access | Localhost-only dashboard |

---

## Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Provider Key Management                     [Refresh] [Export]  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ Provider Cards ────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────┐ │ │
│  │  │ provider-default │  │ provider-alt    │  │ provider-  │ │ │
│  │  │ ● available      │  │ ● exhausted     │  │ backup     │ │ │
│  │  │                  │  │                 │  │ ● disabled │ │ │
│  │  │ Source: env-var  │  │ Source: env-var │  │            │ │ │
│  │  │ Key: ANTHROPIC_  │  │ Key: OPENAI_   │  │ Source:    │ │ │
│  │  │   API_KEY ●●●●   │  │   API_KEY ●●●● │  │ settings   │ │ │
│  │  │                  │  │                 │  │ ●●●●       │ │ │
│  │  │ Concurrency: 1/2 │  │ Cooldown: 12m  │  │            │ │ │
│  │  │ Failures: 0      │  │ Failures: 3    │  │ N/A        │ │ │
│  │  │                  │  │                 │  │            │ │ │
│  │  │ [Rotate]         │  │ [Rotate]       │  │ [Rotate]   │ │ │
│  │  └─────────────────┘  └─────────────────┘  └────────────┘ │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─ Secret Source Health ───────────────────────────────────────┐│
│  │                                                             ││
│  │  Source          │ Status    │ Providers Using │ Last Check ││
│  │  ────────────────┼───────────┼─────────────────┼────────────││
│  │  ANTHROPIC_API_  │ ● Present │ provider-       │ 2m ago     ││
│  │  KEY (env-var)   │           │ default         │            ││
│  │  OPENAI_API_KEY  │ ● Present │ provider-alt    │ 2m ago     ││
│  │  (env-var)       │           │                 │            ││
│  │  ~/.claude/      │ ● Present │ provider-backup │ 2m ago     ││
│  │  settings.json   │           │                 │            ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─ Recent Key Actions ─────────────────────────────────────────┐│
│  │                                                             ││
│  │  Time       │ Action           │ Provider          │ Status ││
│  │  ───────────┼──────────────────┼───────────────────┼────────││
│  │  10:15:00   │ provider-        │ provider-default  │ success││
│  │             │ rotation         │                   │        ││
│  │  09:42:00   │ provider-        │ provider-alt      │ success││
│  │             │ rotation         │                   │        ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

---

## Provider Card Fields

Each provider card displays metadata from the merged state+policy view.
**No secret values are ever rendered.**

| Field | Source | Display Rule |
|-------|--------|-------------|
| Provider ID | state file | Always shown |
| Status | state file | Color-coded badge (green/yellow/red) |
| Secret source type | policy file | `env-var` or `settings` — never the key name |
| Secret source indicator | runtime check | `●●●●` mask — existence check only, no value |
| Secret source available | runtime check | `● Present` / `○ Missing` |
| Current concurrency | state file | `current / max` |
| Max concurrency | policy file | Numeric |
| Cooldown remaining | state file | Countdown or `—` |
| Consecutive failures | state file | Numeric |
| Last failure class | state file | `exhaustion` / `auth` / `runtime` / `—` |
| Last updated by | state file | Actor identifier |

### Secret Display Rules

| What | Shown? | How |
|------|:------:|-----|
| Provider ID | Yes | Plain text |
| Secret source name (env var key) | Yes | Plain text (`ANTHROPIC_API_KEY`) |
| Secret source type | Yes | Badge (`env-var` / `settings`) |
| Secret source existence | Yes | `● Present` / `○ Missing` indicator |
| Actual secret value | **NEVER** | Not read, not stored, not displayed |
| Secret prefix/suffix | **NEVER** | No partial key exposure |
| Settings file contents | **NEVER** | Existence check only |
| `sk-` prefixed strings | **NEVER** | Blocked at all layers |

---

## Actions

### Rotate Provider Key

| Property | Value |
|----------|-------|
| Action ID | `provider-rotation` |
| Risk | High |
| Confirmation | `RETRY` |
| Trigger | **[Rotate]** button on provider card |

The **[Rotate]** button triggers the existing `provider-rotation` action
module through the Operation Console action lifecycle:

```
Click [Rotate]  →  Preview  →  Type RETRY  →  Execute  →  Audit
```

The preview shows:
- Current provider status and failure count.
- Target state after rotation (available, failures reset, cooldown cleared).
- Secret source availability (advisory — does not block rotation).
- Validation check results.

The button is disabled (45% opacity) when:
- Provider status is `available` with zero failures (nothing to rotate).
- An action is already in progress for this provider.

### Refresh State

| Property | Value |
|----------|-------|
| Action ID | `global.refreshState` |
| Risk | Low (read-only) |
| Confirmation | `REFRESH` |
| Trigger | **[Refresh]** button in header |

Re-reads state and policy files. Updates all provider cards and the
secret source health table.

### Export Audit

| Property | Value |
|----------|-------|
| Action ID | `global.exportAudit` |
| Risk | Low (read-only) |
| Confirmation | `EXPORT` |
| Trigger | **[Export]** button in header |

Exports the full audit log as a JSON download.

---

## Secret Source Health Table

Shows the availability of each configured secret source. Data is
derived from runtime existence checks — **no secret values are read**.

| Column | Description |
|--------|-------------|
| Source | Env var name or settings file path |
| Type | `env-var` or `settings` |
| Status | `● Present` (env var set / file exists) or `○ Missing` |
| Providers Using | Provider IDs that reference this source |
| Last Check | Timestamp of last existence check |

### Health Indicators

| Status | Color | Meaning |
|--------|-------|---------|
| `● Present` | Green | Source is available; credential can be loaded |
| `○ Missing` | Red | Source not found; provider may fail on use |

---

## Recent Key Actions Table

Filtered view of the audit log showing only credential-related actions.
Data comes from `GET /api/audit?actionId=provider-rotation`.

| Column | Description |
|--------|-------------|
| Time | Execution timestamp |
| Action | Action module ID |
| Provider | Target provider ID |
| Status | `success` or `error` |
| Reason | Operator-provided reason (if any) |

The table is read-only. Clicking a row expands to show the sanitized
audit payload (no secrets).

---

## Visual Signals

Follows the standard WebUI control console visual language:

| Signal | Meaning |
|--------|---------|
| Blue border/badge | Preview mode — no mutation |
| Red border/badge | Execute mode — state will change |
| Green badge | Provider `available` |
| Yellow badge | Provider `exhausted` |
| Red badge | Provider `disabled` |
| 45% opacity | Button disabled — action unavailable |
| Pulsing red dot | Confirmation needed |
| `●●●●` mask | Secret field — value never shown |

---

## Data Flow

```
.github/ai-policy/provider-pool-policy.json   (provider definitions, source refs)
              │
              ▼
.github/ai-state/provider-pool.json            (runtime status, cooldowns)
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│  Provider Key Management Screen                              │
│                                                              │
│  1. Read policy → extract provider IDs, source refs          │
│  2. Read state  → extract status, cooldowns, failures        │
│  3. Check source existence (env var set? file exists?)        │
│  4. Render cards with masked secrets                         │
│  5. Wire [Rotate] → provider-rotation action                 │
│  6. Wire [Refresh] → global.refreshState action              │
│  7. Wire [Export] → global.exportAudit action                │
└─────────────────────────────────────────────────────────────┘
              │
              ▼
       Operation Console             Audit Log
       (preview → execute)          (append-only)
```

---

## Security Model

### What This Screen Does

| Capability | Status |
|------------|--------|
| View provider IDs | Allowed |
| View secret source names (env var keys) | Allowed |
| View secret source existence | Allowed (yes/no only) |
| View provider status and metadata | Allowed |
| Trigger provider rotation | Allowed (preview + confirm) |
| View audit trail | Allowed (sanitized) |

### What This Screen Never Does

| Capability | Status |
|------------|--------|
| Display API key values | **NEVER** |
| Display token values | **NEVER** |
| Display partial keys (prefix/suffix) | **NEVER** |
| Edit credential values | **NEVER** |
| Read settings file contents | **NEVER** |
| Transmit secrets over network | **NEVER** (localhost-only) |
| Log secret values to audit | **NEVER** (sanitizeObject enforced) |
| Store secrets in state files | **NEVER** |

### Enforcement Layers

1. **UI layer** — Cards render `●●●●` mask; no raw value binding exists.
2. **Action module** — `provider-rotation.js` checks existence only via
   `process.env[key] !== undefined`, never reads the value.
3. **Server layer** — `sanitizeObject` scrubs secret-shaped fields on
   all I/O paths.
4. **Audit layer** — All payloads pass through sanitization before
   storage.
5. **Network layer** — Server binds to `127.0.0.1` only.

---

## Integration with Existing Screens

| Screen | Relationship |
|--------|-------------|
| [Control Console](webui-control-console.md) | Key management is a sub-tab within the console |
| [Provider Rotation Action](webui-action-provider-rotation.md) | [Rotate] button invokes this action module |
| [Operation Runbook](webui-operation-runbook.md) | Rotation steps documented in Provider Operations section |
| [Provider Pool WebUI API](../contracts/provider-pool-webui-api.md) | Uses `/api/actions/*` and `/api/audit` endpoints |
| [Action Confirmation Policy](webui-action-confirmation-policy.md) | Rotation uses `RETRY` confirmation phrase |

---

## Responsive Behavior

The screen adapts to the local console viewport:

| Width | Layout |
|-------|--------|
| >= 1200px | 3-column provider card grid |
| 900–1199px | 2-column provider card grid |
| < 900px | Single-column stacked cards |

Tables scroll horizontally on narrow viewports. The header action
buttons ([Refresh], [Export]) collapse into a dropdown menu below 900px.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `R` | Focus first [Rotate] button |
| `F` | Trigger [Refresh] |
| `Esc` | Cancel active confirmation input |

---

## References

- [Provider Pool](provider-pool.md) — pool architecture
- [Provider Pool WebUI](../../tools/provider-pool-webui/README.md) — server and console overview
- [WebUI Control Console](webui-control-console.md) — full console layout and panels
- [Provider Rotation Action](webui-action-provider-rotation.md) — rotation action module
- [WebUI Action Contract](webui-action-contract.md) — action module schema
- [WebUI Operation Runbook](webui-operation-runbook.md) — step-by-step operator guide
- [WebUI Control Map](webui-control-map.md) — action-to-endpoint mapping
