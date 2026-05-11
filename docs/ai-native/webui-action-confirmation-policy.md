# WebUI Action Confirmation Copy Policy

Defines the confirmation copy, risk badges, and reason-field rules for
dangerous actions in the WebUI Operation Console. Keeps confirmation UX
consistent across client-side and server-side action flows.

> **Closes:** [#815](https://github.com/taoyu051818-sys/lian-nest-server/issues/815)

---

## Scope

This policy governs **copy and UI behavior** at confirmation time. It does
not define risk levels, action schemas, or server-side guard logic — those
are covered by the [Action Contract](webui-action-contract.md) and
[Risk Policy](risk-policy.md).

---

## Risk Badge Wording

Every action card displays a risk badge. The badge label must match
the table below exactly.

| Risk Level | Badge Label  | Color  | CSS Class      |
|------------|-------------|--------|----------------|
| `low`      | Low Risk    | green  | `risk-low`     |
| `medium`   | Medium Risk | yellow | `risk-medium`  |
| `high`     | High Risk   | orange | `risk-high`    |
| `critical` | Critical Risk | red  | `risk-critical`|

Source of truth: `riskBadge()` in
`tools/provider-pool-webui/lib/action-form-schema.js`.

---

## Confirmation Warning Banner

When a user clicks Execute, a warning banner appears above the
confirmation input. Banner style varies by risk level.

### Banner Structure

```
[icon] ACTION LABEL — RISK LEVEL
Description of what this action does and its consequences.
Notice line (high/critical only).
```

### Banner Style Rules

| Risk Level | Background            | Border               | Icon |
|------------|----------------------|----------------------|------|
| `low`      | green tint (8% alpha) | green (30% alpha)   | `▶`  |
| `medium`   | yellow tint (10% alpha)| yellow (35% alpha)  | `▶`  |
| `high`     | red tint (10% alpha)  | red (35% alpha)     | `⚠`  |

CSS classes: `confirm-warning`, `confirm-warning--low`,
`confirm-warning--medium`, `confirm-warning--high`.

### Notice Line

High-risk and `humanRequired` actions append:

> This action cannot be auto-executed and requires explicit human confirmation.

---

## Action-Specific Description Copy

Each known action has a dedicated description shown in the warning banner.
If an action is not in the table, the module's `description` field is used.

| Action ID                | Description |
|--------------------------|-------------|
| `provider.retry`         | Re-enabling this provider will allow new task assignments to be routed to it. If the underlying issue (quota, auth, rate limit) is not resolved, tasks may fail again. |
| `provider.clearCooldown` | Clearing the cooldown removes the safety timer. If the provider is still rate-limited or quota-exhausted, immediate re-assignment may trigger another failure. |
| `provider.disable`       | Disabling this provider will immediately stop new task assignments. In-flight workers will drain but no new work will start until a human re-enables it. |
| `queue.retryBlocked`     | Retrying blocked tasks will re-queue them for dispatch. If the original blocker (exhaustion, conflict) is still active, these tasks will fail again. |
| `queue.clearStale`       | Stale entries will be permanently removed from the queue. This cannot be undone — tasks must be re-created from their source issues if needed. |
| `global.refreshState`    | Forces an immediate re-read of provider pool and worker state files. No data is mutated, but cached state will be replaced. |
| `global.exportAudit`     | Opens a download of the current-session audit log. Read-only, no side effects. |

Source of truth: `RISK_DESCRIPTIONS` in
`tools/provider-pool-webui/public/app.js`.

---

## Required Reason Field

### When Required

A reason input is **required** for actions at `medium` or `high` risk
level, and for all server-side actions with `dangerous: true`.

Low-risk actions do not show a reason input.

### Copy Rules

| Element | Copy |
|---------|------|
| Label   | `Reason for "<action label>" (required):` |
| Placeholder | `Describe why this action is needed…` |

### Validation

The Execute button remains disabled until **both** conditions are met:

1. The confirmation phrase matches exactly.
2. The reason input is non-empty (after trim).

Empty or whitespace-only reasons are rejected client-side. The server
does not receive the execute request until validation passes.

---

## Confirmation Phrase Rules

### Client-Side Actions

Prompt copy:

```
Type "<confirmPhrase>" to confirm execution of "<action label>":
```

The `confirmPhrase` value is defined per action in `ACTION_REGISTRY`.

### Server-Side Actions (Non-Dangerous)

Prompt copy:

```
Type "EXECUTE" to run "<action label>" on server:
```

### Server-Side Actions (Dangerous)

Prompt copy:

```
Type "EXECUTE" to confirm "<action label>" — this will mutate server state:
```

The word **EXECUTE** must be uppercase in the prompt and in the
validation check.

---

## Dangerous Server Actions

Server action modules with `dangerous: true` get an enhanced warning
banner at confirmation time:

```
[⚠] ACTION LABEL — DANGEROUS
<module description or fallback>
Dangerous actions require explicit confirmation and pass through the
full risk gate chain on the server.
```

The fallback description when the module provides none:

> This action performs a server-side mutation with real side effects.
> Review the preview carefully before confirming.

Dangerous actions also require a reason input (same rules as medium/high).

---

## Focus Order

When the confirmation dialog opens:

- If a reason input is present, focus moves to the reason field first.
- Otherwise, focus moves to the confirmation phrase input.

This ensures the operator provides justification before typing the
confirmation phrase.

---

## Audit Trail

The reason value is recorded in the audit entry for every execution:

- Client-side actions: `reason` field in the client audit log.
- Server-side actions: `reason` field in the server audit entry and
  the `WebUIActionAudit` schema.

Reasons are human-written justification text. They must **never** contain
tokens, keys, secrets, or credentials.

---

## No-Secret Guidance

Confirmation copy, reason placeholders, and audit entries must never
include or encourage the inclusion of:

- API keys or tokens
- Passwords or passphrases
- Database connection strings
- Internal URLs with embedded credentials
- Environment variable values from `.env` files

If a reason field contains a string matching common secret patterns
(`sk-`, `Bearer `, `ghp_`, `xoxb-`), the UI should strip or redact it
before recording in the audit log.

---

## References

- [Action Contract](webui-action-contract.md) — request/result schemas and risk levels
- [Action Form Schema](webui-action-form-schema.md) — risk badge helpers and form fields
- [Operation Forms](webui-operation-forms.md) — form layout and safety model
- [Risk Policy](risk-policy.md) — file-area risk categories
- [WebUI Action Runner](webui-action-runner.md) — module execution engine
