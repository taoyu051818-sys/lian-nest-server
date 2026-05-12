# Control Skill Registry

Defines the control skill registry model — a governed abstraction for
turning LIAN scripts and WebUI actions into reusable, auditable control
skills. Inspired by QwenPaw composable skill architecture and Refly
deterministic skill registry patterns; adapted to LIAN's
human-in-the-loop governance.

> **Closes:** [#1212](https://github.com/taoyu051818-sys/lian-nest-server/issues/1212)
>
> **See also:**
> [webui-action-module-registry.md](webui-action-module-registry.md)
> for the current dynamic module catalogue,
> [webui-action-contract.md](webui-action-contract.md) for the
> request/result/audit schemas,
> [command-steward-agent.md](command-steward-agent.md) for the
> human-facing control-plane interface,
> [knowledge-driven-scaling.md](knowledge-driven-scaling.md) for the
> knowledge writeback rule.

---

## Purpose

LIAN's WebUI already has action modules (merge-prs, launch-batch,
issue-state, status-bundle, self-cycle, etc.) with preview/execute
contracts. The control skill registry model unifies these into a
governed registry where every skill has:

- A stable identity for cross-session reference.
- A declared input schema for validation.
- A preview phase that produces no side effects.
- An execute phase gated on human approval.
- Declared facts produced for the knowledge ledger.
- An audit trail for every invocation.

This model draws from two external patterns:

1. **QwenPaw skills** — composable, self-contained operations that an
   AI agent can invoke. Each skill declares its inputs, outputs, and
   preconditions. The agent selects skills based on context and chains
   them into workflows.
2. **Refly deterministic skill registry** — a registry where every skill
   has a fixed identity, a typed input contract, and a deterministic
   execution path. Skills are discoverable, versioned, and auditable.

LIAN adapts these patterns to a human-governed control plane: skills
are not auto-selected by an agent — they are surfaced to a human
operator via the Command Steward, previewed, and executed only with
explicit confirmation.

---

## Skill Model

### Skill Identity

Every control skill has a stable `skillId` following the existing WebUI
action ID convention:

```
<domain>.<subject>[.<verb>]
```

| Segment | Rule | Example |
|---------|------|---------|
| Domain | Lowercase, dot-delimited | `merge`, `launch`, `issue` |
| Subject | Lowercase noun | `prs`, `batch`, `state` |
| Verb (optional) | Lowercase verb for state mutations | `reset`, `close` |

Dynamic modules in `tools/provider-pool-webui/actions/` use kebab-case
IDs that map to their filename (e.g., `merge-prs`, `launch-batch`).
The registry accepts both namespaces — the static dot-delimited
registry and the dynamic kebab-case modules share the same resolution
endpoint.

### Input Schema

Every skill declares a JSON input schema. The schema defines:

| Field | Purpose |
|-------|---------|
| `required` | Fields the caller must supply |
| `optional` | Fields with defaults |
| `types` | Expected types for each field |
| `constraints` | Value bounds, allowlists, enums |

The schema is used for three purposes:

1. **Client-side validation** — the WebUI form renders required fields
   and rejects incomplete submissions before the API call.
2. **Server-side validation** — the action handler checks field
   presence and type before invoking the skill.
3. **Documentation** — the schema is the contract between the skill
   author and the operator.

Input schemas are co-located with the action module (exported as
`inputSchema` or documented in the module's companion `.md` file).

### Preview Phase

Every skill has a `preview()` function that:

- Validates inputs against the schema.
- Computes the effects the skill **would** have.
- Returns a structured result with `dryRun: true`.
- Produces **no side effects** — no file writes, no API calls, no
  process launches.

Preview is the default mode for all mutating skills. The WebUI always
calls preview first; execute requires explicit opt-in.

### Execute Phase

Every skill has an `execute()` function that:

- Re-validates inputs.
- Checks human confirmation (`confirm: true`).
- Applies the action.
- Returns a structured result with outcome, effects, and duration.
- Produces an audit entry.

Execute is blocked for dangerous skills unless the operator provides
explicit confirmation through the WebUI.

### Risk Classification

Every skill carries a risk level that governs the confirmation
requirement and audit verbosity.

| Risk | Confirmation | Audit | Example Skills |
|------|-------------|-------|----------------|
| `low` | Optional | Minimal | `status-bundle`, `health-state` |
| `medium` | Required | Standard | `issue-state` |
| `high` | Required + human gate | Full | `merge-prs`, `launch-batch` |
| `critical` | Typed phrase + reason | Full + escalation | (reserved) |

Risk levels are declared in the skill metadata and enforced by the
WebUI server. The server refuses to execute a `high` or `critical`
skill without the required confirmation.

### Human Approval Gate

Skills at `medium` risk and above require human approval before
execute. The approval flow:

```
1. Operator selects skill in WebUI
2. WebUI calls preview — shows projected effects
3. Operator reviews and clicks "Execute"
4. WebUI renders confirmation dialog
5. Operator confirms (click or typed phrase)
6. WebUI calls execute with confirm: true
7. Server validates, executes, audits
```

Skills at `high` or `critical` risk additionally require:

- The `humanRequired: true` flag in the action contract.
- The server to reject automated (non-human) invocations.

This aligns with the Command Steward Agent's constraint: it never
self-approves. Skills that would bypass this constraint are blocked.

### Facts Produced

Every skill declares what knowledge artifacts it produces on successful
execution. This integrates with the Knowledge-Driven Scaling rule
(see [knowledge-driven-scaling.md](knowledge-driven-scaling.md)).

| Skill | Artifacts Produced | Ledger |
|-------|-------------------|--------|
| `merge-prs` | Merge result fact event, knowledge entry with commit SHAs | `fact-events.ndjson`, `knowledge-updates.ndjson` |
| `launch-batch` | Worker launch fact event, batch plan JSON | `fact-events.ndjson`, `.github/ai-state/webui-batch-plan.json` |
| `issue-state` | Issue closure fact event, knowledge entry with issue number | `fact-events.ndjson`, `knowledge-updates.ndjson` |
| `health-state` | Health state fact event (on transition) | `fact-events.ndjson` |
| `status-bundle` | None (read-only) | — |
| `self-cycle` | None (preview-only) | — |

Skills that produce no artifacts on execute are flagged as
`unverified-value` in the Command Steward daily brief until a knowledge
entry is written by a downstream process.

### Audit Trail

Every skill invocation (preview and execute) produces an audit entry
conforming to the `WebUIActionAudit` schema
(see [webui-action-contract.md](webui-action-contract.md)).

| Audit Field | Source |
|-------------|--------|
| `auditId` | Generated UUID |
| `requestId` | From the request |
| `skillId` | From the action module `id` |
| `mode` | `preview` or `execute` |
| `riskLevel` | From skill metadata |
| `humanRequired` | From skill metadata |
| `outcome` | `success`, `blocked`, `error`, or `skipped` |
| `effects` | List of effects produced or projected |
| `requestedAt` | ISO-8601 timestamp |
| `capturedAt` | ISO-8601 timestamp |
| `durationMs` | Wall-clock time |

The audit log is append-only. Entries cannot be modified or deleted.
The Command Steward reads the audit log for the daily brief and for
repeated failure detection.

---

## Skill Catalogue

The following skills are currently registered or planned. Each maps to
an existing WebUI action module.

### merge-prs

| Property | Value |
|----------|-------|
| Skill ID | `merge-prs` |
| Risk | `high` |
| Human required | Yes |
| Dangerous | Yes |
| Description | Merge an explicit allowlist of PRs with health gate and guard checks |
| Input | `prNumbers` (number[]), `repo` (string, OWNER/NAME) |
| Preview | Dry-run merge control script — returns eligibility, guard results, batch plan |
| Execute | Runs merge script with `-Execute` flag |
| Facts produced | Merge result fact event, knowledge entry with commit SHAs |
| Module | `tools/provider-pool-webui/actions/merge-prs.js` |

### launch-batch

| Property | Value |
|----------|-------|
| Skill ID | `launch-batch` |
| Risk | `high` |
| Human required | Yes |
| Dangerous | Yes |
| Description | Run launch gate on queued tasks and preview/execute batch dispatch |
| Input | `tasks` (object[], optional — falls back to queue state) |
| Preview | Gate report with health matrix, conflict detection, launch plan |
| Execute | Dispatches via `batch-launch.ps1` when all tasks pass gate |
| Facts produced | Worker launch fact event, batch plan JSON |
| Module | `tools/provider-pool-webui/actions/launch-batch.js` |

### issue-state

| Property | Value |
|----------|-------|
| Skill ID | `issue-state` |
| Risk | `medium` |
| Human required | No |
| Dangerous | Yes |
| Description | Reconcile issue labels/PRs and close done issues |
| Input | `issueNumber` (number, optional — scans all if omitted) |
| Preview | Drift report: merged-pr-open-issue, stale labels, done-without-merge |
| Execute | Closes eligible issues with audit comment |
| Facts produced | Issue closure fact event, knowledge entry |
| Module | `tools/provider-pool-webui/actions/issue-state.js` |

### health-state (refresh-health)

| Property | Value |
|----------|-------|
| Skill ID | `refresh-health` |
| Risk | `low` |
| Human required | No |
| Dangerous | No |
| Description | Re-read health state from `.github/ai-state/main-health.json` |
| Input | None |
| Preview | Returns current health state (same as execute — read-only) |
| Execute | Returns current health state |
| Facts produced | Health state fact event (on transition only) |
| Module | Static registry (`view.*` domain) |

### status-bundle

| Property | Value |
|----------|-------|
| Skill ID | `status-bundle` |
| Risk | `low` |
| Human required | No |
| Dangerous | No |
| Description | Return sanitized JSON bundle with health, workers, PRs, issues, telemetry, blockers |
| Input | None |
| Preview | Returns full status bundle (same as execute — read-only) |
| Execute | Blocked (preview-only module) |
| Facts produced | None (read-only) |
| Module | `tools/provider-pool-webui/actions/status-bundle.js` |

### self-cycle

| Property | Value |
|----------|-------|
| Skill ID | `self-cycle` |
| Risk | `low` |
| Human required | No |
| Dangerous | No |
| Description | Surface self-cycle pipeline state (health gate, provider pool preflight, queue status) |
| Input | None |
| Preview | Returns pipeline state as sanitized JSON |
| Execute | Blocked (preview-only module) |
| Facts produced | None (read-only) |
| Module | `tools/provider-pool-webui/actions/self-cycle.js` |

---

## Relation to WebUI Action Registry

The control skill registry model is a **governance layer** on top of
the existing WebUI action infrastructure. It does not replace the
action module system — it documents the policy that governs it.

```
┌──────────────────────────────────────────────────────────────┐
│  Control Skill Registry (this document)                      │
│  Policy layer: skill identity, risk, approval, facts, audit  │
├──────────────────────────────────────────────────────────────┤
│  WebUI Action Module Registry                                │
│  Static allowlist (action-registry.js)                       │
│  Dynamic modules (actions/*.js)                              │
├──────────────────────────────────────────────────────────────┤
│  WebUI Action Contract                                       │
│  Request / Result / Audit schemas                            │
├──────────────────────────────────────────────────────────────┤
│  Command Steward Agent                                       │
│  Human-facing control-plane interface                        │
└──────────────────────────────────────────────────────────────┘
```

| Concern | Handled By |
|---------|-----------|
| Skill discovery | Dynamic module loader (`loadActionModules()`) |
| Skill allowlist | Static registry (`action-registry.js`) |
| Input validation | Module `preview()` / `execute()` + schema |
| Risk enforcement | Server-side `dangerous` flag + confirmation |
| Human approval | Command Steward Agent + WebUI confirmation dialog |
| Audit trail | `WebUIActionAudit` schema + append-only log |
| Knowledge writeback | Knowledge-Driven Scaling rule + fact event writers |

The registry model adds two things the action system does not
currently enforce:

1. **Declared facts produced** — skills must state what knowledge
   artifacts they create, enabling the Knowledge-Driven Scaling rule
   to verify writeback compliance.
2. **Skill-level governance documentation** — each skill has a
   documented contract that operators and auditors can reference
   without reading source code.

---

## Governance Rules

### Rule 1 — No Self-Approval

No skill may execute without explicit human confirmation. The
`preview()` function is always safe; `execute()` requires `confirm: true`
and, for high-risk skills, a human-initiated request through the WebUI.

### Rule 2 — Preview-First

All mutating skills default to preview mode. The WebUI calls
`preview()` before `execute()`. The operator sees projected effects
before committing.

### Rule 3 — Bounded Blast Radius

Skills that operate on explicit targets (PR numbers, issue numbers,
provider IDs) require an `allowlist` in execute mode. The handler
rejects any target not in the allowlist.

### Rule 4 — Audit Every Invocation

Every skill call (preview or execute) produces an audit entry. The
audit log is the single source of truth for what happened and why.

### Rule 5 — Knowledge Writeback

Skills that produce side effects (merge, launch, close) must declare
the knowledge artifacts they produce. The launch gate checks writeback
compliance before dispatching the next batch.

### Rule 6 — No Gate Bypass

Skills cannot skip, weaken, or override any gate (launch, health,
review, constitution). If a skill's action would violate a gate, the
skill blocks and explains why.

---

## Adding a New Skill

1. Create `tools/provider-pool-webui/actions/<name>.js`
2. Export `id`, `label`, `description`, `dangerous`, `preview()`,
   `execute()`
3. Create `tools/provider-pool-webui/actions/<name>.test.js` with the
   `require.main` guard
4. Document the skill in this file's [Skill Catalogue](#skill-catalogue)
   section
5. Declare the skill's risk level, human approval requirement, and
   facts produced
6. Run `npm run check` to verify

---

## Non-Goals

- This document does not define runtime behavior — it defines policy.
- This document does not replace the WebUI action module registry — it
  governs it.
- This document does not integrate external projects (QwenPaw, Refly)
  — it draws inspiration from their patterns.
- This document does not modify scripts, the WebUI, or the NestJS
  application.

---

## References

- [WebUI Action Module Registry](webui-action-module-registry.md) —
  Dynamic module catalogue and naming conventions
- [WebUI Action Contract](webui-action-contract.md) —
  Request/result/audit schemas
- [WebUI Action Registry](webui-action-registry.md) —
  Static allowlist and risk levels
- [Command Steward Agent](command-steward-agent.md) —
  Human-facing control-plane interface
- [Knowledge-Driven Scaling](knowledge-driven-scaling.md) —
  Knowledge writeback and verifiable value rules
- [Worker Architecture Decision Summary](worker-architecture-decision-summary.md) —
  Task JSON fields, gates, and layer model
- [Launch Gate](launch-gate.md) — Pre-launch validation
- [WebUI Action: merge-prs](webui-action-merge-prs.md) —
  Merge PRs action module
- [WebUI Action: launch-batch](webui-action-launch-batch.md) —
  Launch batch action module
- [WebUI Action: issue-state](webui-action-issue-state.md) —
  Issue state action module
- [#1212](https://github.com/taoyu051818-sys/lian-nest-server/issues/1212) —
  This feature
