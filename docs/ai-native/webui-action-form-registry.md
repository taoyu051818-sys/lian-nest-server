# WebUI Structured Action Form Registry Contract

Defines how action modules expose structured forms to the WebUI
operation console. Maps each action ID to its form descriptor fields,
validation rules, risk classification, and safety gates.

> **Closes:** [#1156](https://github.com/taoyu051818-sys/lian-nest-server/issues/1156)

---

## Purpose

The WebUI renders action-specific forms by reading each module's
structured form descriptor. This contract defines the descriptor shape,
the field-to-type mapping, the safety rules each form must enforce,
and the complete registry of supported action forms.

This doc complements:
- [Action Form Schema Helpers](webui-action-form-schema.md) — field
  type inference and risk badge rendering
- [Action Form Contract](webui-action-form-contract.md) — submit flow
  and validation boundaries
- [Action Module Registry](webui-action-module-registry.md) — module
  catalogue and ID naming conventions

---

## Form Descriptor Shape

Every action module that exposes a structured form produces a descriptor
with this shape:

```
{
  actionId,            // string — dot-delimited or kebab-case ID
  title,               // string — human-readable form title
  description,         // string — one-line purpose
  category,            // string — see Category table
  risk,                // "low" | "medium" | "high" | "critical"
  dangerous,           // boolean — server requires confirm: true
  previewDefault,      // boolean — true for all mutating actions
  fields[],            // array of field descriptors
  confirmPhrase,       // string | null — typed confirmation phrase
  submitLabel,         // string — button label
  previewLabel,        // string — always "Preview"
  validationRules[]    // string[] — additional validation constraints
}
```

### Field Descriptor Shape

Each entry in `fields[]`:

```
{
  name,                // string — payload key
  type,                // "text" | "number" | "select" | "textarea"
  label,               // string — human-readable label
  placeholder,         // string — example value
  required,            // boolean
  autocomplete?,       // "provider" | "worker" | "off"
  options?,            // string[] — valid values for select fields
  min?, step?,         // number — present when type is "number"
  description?,        // string — field-level help text
  condition?           // object — when to show this field (see below)
}
```

### Conditional Field Display

Some fields appear only when a parent field has a specific value.
The `condition` object:

```
{
  field,               // string — parent field name
  value                // string — required value to show this field
}
```

Example: `reason` field appears only when `action` is `"stop"`.

---

## Categories

| Category | Scope | Actions |
|----------|-------|---------|
| `planning` | Task planning and batch preparation | `compile-tasks`, `plan.next.batch` |
| `launch` | Worker dispatch and batch launch | `launch-batch` |
| `worker` | Worker lifecycle management | `worker.control` |
| `provider` | Provider credential management | `provider-rotation` |
| `merge` | PR merge operations | `merge-prs` |

---

## Form Registry

### compile-tasks

| Property | Value |
|----------|-------|
| Action ID | `compile-tasks` |
| Category | `planning` |
| Risk | `low` |
| Dangerous | `false` |
| Preview default | `true` |
| Confirm phrase | None (single click) |
| Submit label | `Execute` |

**Form fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `targetIssue` | number | yes | GitHub issue number |
| `taskType` | select | yes | One of: `execution`, `research`, `review` |
| `risk` | select | yes | One of: `low`, `medium`, `high` |
| `conflictGroup` | text | yes | Concurrency group identifier |
| `allowedFiles` | textarea | yes | Glob patterns for editable files (one per line) |
| `validationCommands` | textarea | yes | Commands to run before PR (one per line) |
| `rolePacket.actorRole` | text | yes | Worker actor role name |
| `outputMode` | select | no | `v1` (default) or `v2` |

**Validation rules:**

- `allowedFiles` must contain at least one entry
- `validationCommands` must contain at least one entry
- `taskType` must be one of the enum values
- `risk` must be one of the enum values
- `rolePacket.actorRole` must be non-empty

**Safety gates:**

- Non-destructive pure transformation — no file I/O
- Both preview and execute are read-only operations
- Preview returns summary counts only; execute returns full task JSON

---

### plan.next.batch

| Property | Value |
|----------|-------|
| Action ID | `plan.next.batch` |
| Category | `planning` |
| Risk | `low` (preview) / `medium` (execute) |
| Dangerous | `false` |
| Preview default | `true` |
| Confirm phrase | None (single click) |
| Submit label | `Execute` |

**Form fields:**

No required input fields for preview. Execute mode requires:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `allowlist` | textarea | for execute | Issue numbers to include (one per line) |
| `reason` | text | for execute | Human-readable justification |

**Validation rules (execute only):**

- `allowlist` must be a non-empty array of positive integers
- `reason` must be a non-empty string
- Every planned issue must appear in the allowlist

**Safety gates:**

- Preview is fully read-only — no file writes, no GitHub mutations
- Execute validates allowlist before writing batch plan file
- No secrets exposed — provider keys and source paths stripped

---

### launch-batch

| Property | Value |
|----------|-------|
| Action ID | `launch-batch` |
| Category | `launch` |
| Risk | `high` |
| Dangerous | `true` |
| Preview default | `true` |
| Confirm phrase | `LAUNCH` |
| Submit label | `Execute (Privileged)` |

**Form fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tasks` | textarea | no | JSON array of task objects (falls back to queue) |

Each task object in `tasks`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `targetIssue` | number | — | GitHub issue number |
| `conflictGroup` | text | `null` | Concurrency group |
| `risk` | select | `"medium"` | `low`, `medium`, `high` |
| `taskType` | select | `"execution"` | `execution`, `research` |
| `mainHealthPolicy` | text | `null` | Health policy override |
| `allowedFiles` | textarea | `[]` | Editable file globs |
| `sharedLocks` | textarea | `[]` | Shared lock names |
| `budget.maxFiles` | number | — | Max files per worker |
| `budget.maxLinesChanged` | number | — | Max lines changed |
| `budget.softTimeMinutes` | number | — | Soft time limit |
| `budget.hardTimeMinutes` | number | — | Hard time limit |

**Validation rules:**

- When `tasks` is empty or omitted, reads from queue state file
- Health state is resolved from `.github/ai-state/main-health.json`
- Worker type classification applies permission matrix
- Conflict detection: duplicate groups, shared lock overlap, running worker conflicts

**Safety gates:**

- `dangerous: true` — server requires `confirm: true`
- Typed confirmation phrase `LAUNCH` required from operator
- Launch gate blocks dispatch when any task fails validation
- Preview returns full gate report and launch plan without side effects
- Execute refuses to launch when `allAllowed` is false

---

### worker.control

| Property | Value |
|----------|-------|
| Action ID | `worker.control` |
| Category | `worker` |
| Risk | `high` |
| Dangerous | `true` |
| Preview default | `true` |
| Confirm phrase | Worker ID (type the target worker ID) |
| Submit label | `Execute (Privileged)` |

**Form fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | select | yes | `list` or `stop` |
| `workerIds` | textarea | for stop | Worker IDs to stop (one per line) |
| `reason` | text | for execute stop | Human-readable justification |

**Conditional fields:**

- `workerIds` shown only when `action` is `"stop"`
- `reason` shown only when `action` is `"stop"`

**Validation rules:**

- `action` must be `"list"` or `"stop"`
- `workerIds` must be a non-empty array of valid worker IDs
- `reason` must be non-empty after trimming whitespace
- Wildcard `["*"]` is rejected — no wildcard matching allowed
- If any worker ID is not found, the entire operation fails (atomic)

**Safety gates:**

- `dangerous: true` — server requires `confirm: true`
- Explicit worker targeting required — no "all workers" operations
- Atomic failure — partial stops do not occur
- Concurrency values floored at 0 (never negative)
- `list` action is read-only; `stop` mutates provider pool state

---

### provider-rotation

| Property | Value |
|----------|-------|
| Action ID | `provider-rotation` |
| Category | `provider` |
| Risk | `high` |
| Dangerous | `true` |
| Preview default | `true` |
| Confirm phrase | `RETRY` |
| Submit label | `Execute (Privileged)` |

**Form fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `providerId` | text | yes | Provider to rotate (autocomplete: provider) |
| `reason` | text | no | Human-readable reason (execute only) |

**Validation rules:**

- `providerId` must be non-empty
- Provider must exist in both state and policy files
- State file must be writable

**Safety gates:**

- `dangerous: true` — server requires `confirm: true`
- Preview returns rotation plan without modifying state
- Execute uses atomic write (temp file + rename)
- Secret source checked for *existence only* — never reads or exposes values
- Rotation always possible regardless of current provider status
- All output passes through `sanitizeObject()`

**Rotation effects by current status:**

| Status | Effect |
|--------|--------|
| `available` | Resets failure counters, preserves concurrency |
| `exhausted` | Clears cooldown, resets failures, re-enables |
| `disabled` | Re-enables provider, clears cooldown |

---

### merge-prs

| Property | Value |
|----------|-------|
| Action ID | `merge-prs` |
| Category | `merge` |
| Risk | `high` |
| Dangerous | `true` |
| Preview default | `true` |
| Confirm phrase | `MERGE` |
| Submit label | `Execute (Privileged)` |

**Form fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prNumbers` | textarea | yes | PR numbers to merge (one per line) |
| `repo` | text | no | Repository in OWNER/NAME format |

**Validation rules:**

- `prNumbers` must be a non-empty array of positive integers
- Negative numbers, zero, floats, and non-integer values rejected
- No wildcard `*` or `all` keyword
- `repo` must match OWNER/NAME format if provided; falls back to `GH_REPO` env

**Safety gates:**

- `dangerous: true` — server requires `confirm: true`
- Explicit allowlist only — no PR discovery or guessing
- Preview runs merge control script in dry-run mode
- Execute runs with `-Execute -Force` flags
- Seven guards run during execute (see guard inventory below)
- Health gate runs automatically in execute mode
- High-risk paths (`src/**`, `prisma/**`, `src/modules/auth/**`) blocked from auto-merge

**Guard inventory:**

| Guard | Blocking | Purpose |
|-------|----------|---------|
| Explicit allowlist | Yes | PRs must be explicitly listed |
| Task boundary | Yes | Respects `.ai/task-manifest.json` |
| PR handoff | Yes | Validates PR body |
| Generated Prisma freshness | Yes | Checks PR changed files |
| Secret scan | Yes | Scans PR changed files |
| Forbidden files | Yes | Checks against forbidden patterns |
| Docs authority | No (warn) | Warns on `docs/` changes |

---

## Risk Classification Summary

| Action | Risk | Dangerous | Confirm Phrase |
|--------|------|-----------|----------------|
| `compile-tasks` | low | No | — |
| `plan.next.batch` | low / medium | No | — |
| `launch-batch` | high | Yes | `LAUNCH` |
| `worker.control` | high | Yes | Worker ID |
| `provider-rotation` | high | Yes | `RETRY` |
| `merge-prs` | high | Yes | `MERGE` |

---

## Confirmation Escalation

| Risk Level | Confirmation | Behavior |
|------------|-------------|----------|
| Low | Single click | Preview enabled, execute after minimal confirmation |
| Medium | Single click or dialog | Preview enabled, confirmation dialog |
| High | Typed phrase | Text input must match exact phrase before execute |
| Critical | Typed phrase + reason | Full confirmation dialog with justification |

---

## Common Safety Rules

All form actions share these safety constraints:

| Rule | Enforcement |
|------|-------------|
| Preview-first | All mutating actions default to dry-run mode |
| Typed confirmation | High-risk actions require exact phrase match |
| No secrets | All payloads and results pass through `sanitizeObject` |
| Loopback only | Server binds to `127.0.0.1`; no remote access |
| Admin token | All endpoints require Bearer token |
| Audit every execute | Every `POST /api/actions/execute` writes audit entry |
| Dangerous flag gate | Server requires `confirm: true` for dangerous actions |
| Frozen descriptors | Form descriptors are `Object.freeze()`d |

---

## Wire-Format Validation

Three JSON Schemas enforce the formal contract at the wire level:

| Schema | Purpose | Key constraints |
|--------|---------|-----------------|
| `webui-action-request` | Request envelope | `mode: "execute"` requires `allowlist` + `reason`; `riskLevel: "high"/"critical"` requires `humanRequired: true` |
| `webui-action-result` | Result envelope | `outcome` is one of `success`, `blocked`, `error`, `skipped`; error messages must not contain secrets |
| `webui-action-audit` | Audit entry (NDJSON) | Append-only; every request produces exactly one entry |

---

## Field Type Inference

Known fields get typed descriptors automatically from `FIELD_TYPES`:

| Field | Type | Label | Extra |
|-------|------|-------|-------|
| `providerId` | text | Provider ID | autocomplete: provider |
| `workerId` | text | Worker ID | autocomplete: worker |
| `target` | text | Target | — |
| `value` | number | Value | min: 1, step: 1 |
| `field` | text | Policy Field | — |
| `title` | text | Title | — |
| `gapKey` | text | Gap Key | — |
| `labels` | text | Labels | — |
| `prNumbers` | textarea | PR Numbers | — |
| `workerIds` | textarea | Worker IDs | — |
| `tasks` | textarea | Tasks (JSON) | — |
| `allowlist` | textarea | Allowlist | — |
| `allowedFiles` | textarea | Allowed Files | — |
| `validationCommands` | textarea | Validation Commands | — |
| `sharedLocks` | textarea | Shared Locks | — |
| `reason` | text | Reason | — |

Unknown fields default to `type: "text"` with a humanized label.

---

## Cross-References

- [Action Form Schema Helpers](webui-action-form-schema.md) — field type inference, risk badges, form schema shape
- [Action Form Contract](webui-action-form-contract.md) — submit flow, validation boundaries, secret-safe behavior
- [Action Module Registry](webui-action-module-registry.md) — module catalogue, ID naming, loader contract
- [Action Registry](webui-action-registry.md) — static allowlist, privilege model, preview defaults
- [Operation Forms](webui-operation-forms.md) — UI wiring, form inputs, client vs server actions
- [Command Steward Console](webui-command-steward-console.md) — status brief, recommendations, preview buttons
- [Action Confirmation Policy](webui-action-confirmation-policy.md) — confirmation escalation rules
- [WebUI Action: compile-tasks](webui-action-compile-tasks.md) — module detail
- [WebUI Action: plan.next.batch](webui-action-plan-next-batch.md) — module detail
- [WebUI Action: launch-batch](webui-action-launch-batch.md) — module detail
- [WebUI Action: worker.control](webui-action-worker-control.md) — module detail
- [WebUI Action: provider-rotation](webui-action-provider-rotation.md) — module detail
- [WebUI Action: merge-prs](webui-action-merge-prs.md) — module detail
