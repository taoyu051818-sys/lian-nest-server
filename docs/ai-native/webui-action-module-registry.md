# WebUI Action Module Registry & ID Naming Conventions

Canonical reference for every action module exposed through the WebUI
control console. Covers the registry schema, ID naming rules, risk
levels, and the full module catalogue.

> **Closes:** [#731](https://github.com/taoyu051818-sys/lian-nest-server/issues/731)

---

## Overview

The WebUI control console exposes two kinds of action modules:

1. **Static registry** — allowlisted metadata in
   `tools/provider-pool-webui/lib/action-registry.js`. Used for
   validation, confirmation rendering, and API responses.
2. **Dynamic modules** — standalone `.js` files in
   `tools/provider-pool-webui/actions/`. Each exports `preview()` and
   `execute()` conforming to the action module contract.

Both systems use the same ID namespace. The static registry is the
authoritative allowlist; dynamic modules implement the runtime behavior.

```
  WebUI (localhost)
       │
       ▼
  GET /api/actions         ← reads from dynamic modules
  POST /api/actions/preview
  POST /api/actions/execute
       │
       ▼
  action-registry.js       ← allowlist + metadata
  actions/*.js             ← preview() + execute() implementations
```

---

## ID Naming Convention

Action IDs use **dot-delimited** segments following the pattern:

```
<domain>.<subject>[.<verb>]
```

### Rules

| Rule | Example | Anti-pattern |
|------|---------|--------------|
| Lowercase only | `provider.cooldown.reset` | `Provider.Cooldown.Reset` |
| Dots as delimiters | `worker.control` | `worker-control` |
| Domain-first ordering | `provider.enable` | `enable-provider` |
| Verb last (for state mutations) | `provider.cooldown.reset` | `provider.reset.cooldown` |
| No trailing dot | `view.resources` | `view.resources.` |
| No wildcards | `queue.clear` | `queue.*` |

### Domain prefixes

| Domain | Scope | Examples |
|--------|-------|---------|
| `view` | Read-only data display | `view.provider.status`, `view.queue.status` |
| `provider` | Provider lifecycle | `provider.enable`, `provider.disable`, `provider.cooldown.reset` |
| `worker` | Worker lifecycle | `worker.kill`, `worker.drain`, `worker.control` |
| `queue` | Queue management | `queue.clear` |
| `concurrency` | Resource limits | `concurrency.update` |
| `settings` | WebUI settings | `settings.key.rotate` |
| `policy` | Policy management | `policy.update` |

### Dynamic module IDs

Dynamic modules in `actions/` use kebab-case IDs that map to their
filename. These are separate from the static registry namespace:

| Module file | ID | Mapping rule |
|-------------|-----|--------------|
| `compile-tasks.js` | `compile-tasks` | filename directly |
| `create-issues.js` | `create-issues` | filename directly |
| `issue-state.js` | `issue-state` | filename directly |
| `launch-batch.js` | `launch-batch` | filename directly |
| `merge-prs.js` | `merge-prs` | filename directly |
| `plan-next-batch.js` | `plan.next.batch` | dots replace hyphens |
| `provider-rotation.js` | `provider-rotation` | filename directly |
| `worker-control.js` | `worker.control` | dots replace hyphens |

---

## Risk Levels

| Level | Label | Privilege | Default preview | Confirmation |
|-------|-------|-----------|-----------------|--------------|
| `low` | Low | No | No | Optional |
| `medium` | Medium | No | Yes | Required |
| `high` | High | Yes | Yes | Required + human gate |
| `critical` | Critical | Yes | Yes | Required + human gate |

**Privileged** actions (`privileged: true`) require elevated confirmation
and cannot be auto-executed. The WebUI displays a warning banner and
blocks the execute button until explicit human approval.

---

## Static Registry

The allowlist in `action-registry.js` defines 17 actions across 6
categories. All mutations default to preview mode.

### View (read-only)

| ID | Label | Risk | Privileged |
|----|-------|------|------------|
| `view.provider.status` | View Provider Status | Low | No |
| `view.worker.status` | View Worker Status | Low | No |
| `view.queue.status` | View Queue Status | Low | No |
| `view.resources` | View Resource Utilization | Low | No |
| `view.policy` | View Policy | Low | No |

### Provider management

| ID | Label | Risk | Privileged | Required fields |
|----|-------|------|------------|-----------------|
| `provider.cooldown.reset` | Reset Provider Cooldown | Medium | No | `providerId` |
| `provider.enable` | Enable Provider | Medium | No | `providerId` |
| `provider.disable` | Disable Provider | Medium | No | `providerId` |

### Worker management

| ID | Label | Risk | Privileged | Required fields |
|----|-------|------|------------|-----------------|
| `worker.kill` | Kill Worker | High | Yes | `workerId` |
| `worker.drain` | Drain Worker | High | Yes | `workerId` |

### Resource management

| ID | Label | Risk | Privileged | Required fields |
|----|-------|------|------------|-----------------|
| `concurrency.update` | Update Concurrency Limit | High | Yes | `target`, `value` |
| `queue.clear` | Clear Queue | High | Yes | — |

### Settings / policy

| ID | Label | Risk | Privileged | Required fields |
|----|-------|------|------------|-----------------|
| `settings.key.rotate` | Rotate Admin Token | Critical | Yes | — |
| `policy.update` | Update Policy | Critical | Yes | `field`, `value` |

---

## Dynamic Modules

Each module in `tools/provider-pool-webui/actions/` exports:

```js
module.exports = {
  id: "module-id",
  label: "Human Label",
  description: "What this module does",
  dangerous: false,           // true = requires confirm: true
  preview(payload) { ... },   // dry-run, no side effects
  execute(payload) { ... },   // performs the action
};
```

### compile-tasks

| Field | Value |
|-------|-------|
| ID | `compile-tasks` |
| Dangerous | No |
| Description | Compile issue JSON into worker task contracts |

**Preview** validates the payload and returns a summary without writing.
**Execute** returns the compiled task object. Both are non-destructive
transformation — no file I/O, no secrets, no raw logs.

### create-issues

| Field | Value |
|-------|-------|
| ID | `create-issues` |
| Dangerous | Yes |
| Description | Propose and create GitHub issues from gap analysis |

**Preview** returns proposed issues with deduplication against existing
open issues. **Execute** (with `dryRun: false`) creates issues via
`gh issue create`. Defaults to dry-run mode (`dryRun: true`).

### issue-state

| Field | Value |
|-------|-------|
| ID | `issue-state` |
| Dangerous | Yes |
| Description | Reconcile issue labels/PRs and close done issues |

**Preview** runs drift detection (merged-pr-open-issue, stale labels,
done-without-merge). **Execute** closes eligible issues with audit
comment. Refuses umbrella and human-required issues.

### launch-batch

| Field | Value |
|-------|-------|
| ID | `launch-batch` |
| Dangerous | Yes |
| Description | Run the launch gate on queued tasks and preview/execute batch dispatch |

**Preview** returns a gate report with health-state permission matrix,
conflict-group duplicate detection, shared-lock overlap check, and
running-worker conflict detection. **Execute** dispatches via
`batch-launch.ps1` only when all tasks pass the gate.

### merge-prs

| Field | Value |
|-------|-------|
| ID | `merge-prs` |
| Dangerous | Yes |
| Description | Merge an explicit allowlist of PRs with health gate and guard checks |

**Preview** runs the merge control script in dry-run mode. **Execute**
runs with `-Execute` flag. Both require explicit `prNumbers` array and
`repo` in OWNER/NAME format.

### plan-next-batch

| Field | Value |
|-------|-------|
| ID | `plan.next.batch` |
| Dangerous | No |
| Description | Preview the next worker batch: queued issues matched to provider capacity |

**Preview** reads provider pool and queue state, returns a capacity
plan respecting conflict groups. **Execute** validates an explicit
allowlist and writes the batch plan to
`.github/ai-state/webui-batch-plan.json`.

### provider-rotation

| Field | Value |
|-------|-------|
| ID | `provider-rotation` |
| Dangerous | Yes |
| Description | Preview or execute provider credential rotation via the dry-run settings bridge |

**Preview** builds a rotation plan showing current vs. target state and
secret source availability (without exposing values). **Execute**
transitions provider to `available`, clears cooldown, resets failure
countors. Uses atomic write (temp file + rename).

### worker-control

| Field | Value |
|-------|-------|
| ID | `worker.control` |
| Dangerous | Yes |
| Description | List, preview, and stop workers with explicit worker targeting |

**Preview** returns worker list or stop preview. **Execute** for `stop`
action writes updated state to the provider pool file. Requires explicit
`workerIds` array — no wildcard or "all workers" operations.

---

## Test File Placement

Each action module's tests are **co-located** in the same directory as the
module itself:

```
tools/provider-pool-webui/actions/
  compile-tasks.js           ← module
  compile-tasks.test.js      ← tests for compile-tasks
  create-issues.js
  create-issues.test.js
  ...
```

### Rules

| Rule | Detail |
|------|--------|
| Same directory | Tests live next to the module, not in a separate `__tests__/` tree |
| Naming | `<module-name>.test.js` — matches the module filename exactly |
| Framework | No external test framework; uses a simple `assert` helper |
| Runner | `node tools/provider-pool-webui/actions/<name>.test.js` (standalone) |
| Inert when required | Every `.test.js` must guard with `require.main !== module` so it exports a no-op shape when loaded by `action-modules.test.js` |
| Excluded from loader | The server loader skips files ending in `.test.js` — tests are never treated as action modules |

### Why co-located

The loader uses `readdirSync` + `.endsWith(".test.js")` filtering. Co-locating
tests keeps them discoverable alongside their module without requiring a
separate test directory or loader config. The `require.main` guard ensures the
inventory test (`action-modules.test.js`) can safely require every `.js` in
`actions/` without triggering test execution.

---

## Module Loader

The server discovers dynamic modules at startup via `loadActionModules()` in
`tools/provider-pool-webui/server.js`.

### Discovery

```
server.js
  └─ listActionModuleFiles()
       └─ readdirSync(ACTIONS_DIR)
            └─ filter: .endsWith(".js") && !.endsWith(".test.js")
  └─ loadActionModules()
       └─ require(file) for each
            └─ check: mod.id is string, mod.label is string
                 └─ push to modules array
```

### Resolution

`resolveAction(actionId)` scans the same file list and returns the module whose
`id` matches the requested `actionId`. Returns `null` if no match.

### Loader constraints

| Constraint | Enforcement |
|------------|-------------|
| File must end in `.js` | `listActionModuleFiles` filter |
| File must NOT end in `.test.js` | `listActionModuleFiles` filter |
| Module must export `id` (string) | `loadActionModules` check |
| Module must export `label` (string) | `loadActionModules` check |
| Broken modules are skipped | try/catch in loader — no crash |
| No caching bypass | `require()` cache is used; modules loaded once |

### Adding a test file

1. Create `tools/provider-pool-webui/actions/<name>.test.js`
2. Add the `require.main` guard at the top:

```js
if (require.main !== module) {
  module.exports = { id: "noop-<name>-test", label: "noop", description: "", dangerous: false };
} else {
  // ... actual test body ...
}
```

3. The loader will automatically skip it (`.test.js` filter).
4. The inventory test will safely require it (no-op export).

---

## Module Contract

Every dynamic module must satisfy:

| Requirement | Enforcement |
|-------------|-------------|
| `id` field present | Loaded module without `id` is rejected |
| `preview()` is a function | Called for `/api/actions/preview` |
| `execute()` is a function | Called for `/api/actions/execute` |
| No secrets in output | All payloads/results pass through `sanitizeObject` |
| No raw stdout/stderr | Modules return structured JSON only |
| Dangerous modules gated | `dangerous: true` requires `confirm: true` from client |

---

## Preview-First Safety

All mutating actions default to preview mode. The flow:

```
1. Client calls POST /api/actions/preview
   └─ Module.preview(payload) called
   └─ Returns dry-run result with dryRun: true

2. Operator reviews preview (blue badge in UI)

3. Client calls POST /api/actions/execute
   └─ Server checks dangerous flag
   └─ If dangerous && confirm != true → 409 Conflict
   └─ Module.execute(payload) called
   └─ Audit entry written
```

---

## Security

| Control | Detail |
|---------|--------|
| Localhost binding | Server binds to `127.0.0.1` |
| Sanitization | `sanitizeObject` on all payloads and results |
| Dangerous gate | `dangerous: true` modules require `confirm: true` |
| Audit trail | Every execute call writes an audit entry |
| No secret exposure | Module output never contains raw credentials |

---

## Adding a New Module

1. Create `tools/provider-pool-webui/actions/<name>.js`
2. Export `id`, `label`, `description`, `dangerous`, `preview()`, `execute()`
3. Create `tools/provider-pool-webui/actions/<name>.test.js` with the
   `require.main` guard (see [Test File Placement](#test-file-placement))
4. If the module manages allowlisted state, add a corresponding entry
   in `tools/provider-pool-webui/lib/action-registry.js`
5. Run `npm run check` to verify
6. Update this document with the new module entry

---

## Cross-References

- [Actions API](provider-pool-webui-actions-api.md) — endpoint contract
- [Action Registry Source](../../tools/provider-pool-webui/lib/action-registry.js) — static allowlist
- [WebUI Control Map](webui-control-map.md) — button-to-action mapping
- [Operation Console](provider-pool-webui-operation-console.md) — client-side UI
- [Control-Plane Dashboard State Actions](control-plane-dashboard-state-actions.md) — readiness signals
