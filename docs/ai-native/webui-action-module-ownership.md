# WebUI Action Module Ownership Boundaries

> **Covers:** `tools/provider-pool-webui/actions/` dynamic modules and `lib/action-registry.js` static registry.
> **Repository owner:** `lian-nest-server` (sole owner; legacy `lian-platform-server` is frozen).

---

## Two action systems

| System | Location | ID style | Scope |
|---|---|---|---|
| Static registry | `lib/action-registry.js` | Dot-delimited (`view.provider.status`) | 17 allowlisted actions across 6 categories |
| Dynamic modules | `actions/*.js` | Kebab-case (`compile-tasks`) | 8 runtime modules with `preview()` / `execute()` |

Both share the same conceptual namespace but use different ID conventions. The static registry is the authoritative allowlist for provider/worker management actions; dynamic modules implement operation-focused actions.

---

## Loader behavior

**File:** `tools/provider-pool-webui/server.js` (lines 133-175)

### Discovery

```
fs.readdirSync(ACTIONS_DIR)
  .filter(f => f.endsWith(".js") && !f.endsWith(".test.js"))
```

Filesystem-based scan of `tools/provider-pool-webui/actions/`. Two filters:
- Must end in `.js`
- Must **not** end in `.test.js`

### Loading (`loadActionModules`)

For each discovered file:
1. `require()` inside try/catch (broken modules silently skipped)
2. Validate `mod.id` is a string **and** `mod.label` is a string
3. If valid, register `{ id, label, description, dangerous }`
4. If invalid (missing `id` or `label`), silently skipped

### Resolution (`resolveAction`)

Scans the same file list, `require()`s each, returns the module whose `id` matches the requested `actionId`. Returns `null` if no match.

### Constraints

| Constraint | Enforcement |
|---|---|
| File must end in `.js` | `listActionModuleFiles` filter |
| File must **not** end in `.test.js` | `listActionModuleFiles` filter |
| Must export `id` (string) | `loadActionModules` check |
| Must export `label` (string) | `loadActionModules` check |
| Broken modules are skipped | try/catch (no crash) |
| No cache bypass | `require()` cache; loaded once |

---

## Test-file exclusion policy

Exclusion is **filename-based**. Three layers enforce it:

### Layer 1: Loader filter

`listActionModuleFiles()` strips `.test.js` files before any `require()` call. Test files are never loaded as action modules.

### Layer 2: `require.main` guard

Every `.test.js` exports a no-op shape when `require()`d by the inventory test (not run directly):

```js
if (require.main !== module) {
  module.exports = { id: "noop-<name>-test", label: "noop", description: "", dangerous: false };
} else {
  // actual test body
}
```

### Layer 3: Inventory test assertions

`action-modules.test.js` (lines 187-196) verifies:
- Counts `.test.js` files in the actions directory
- Asserts none appear in the loaded module list
- Asserts no loaded module `id` ends with `.test`

### Placement rules

| Rule | Detail |
|---|---|
| Same directory | Tests live next to the module, not in `__tests__/` |
| Naming | `<module-name>.test.js` (exact filename match) |
| Framework | No external framework; uses a simple `assert` helper |
| Runner | `node tools/provider-pool-webui/actions/<name>.test.js` (standalone) |
| Inert when required | `require.main !== module` guard |

---

## Required registry metadata

### Module export contract

Every dynamic module **must** export:

| Field | Type | Required | Purpose |
|---|---|---|---|
| `id` | string | Yes | Unique identifier (kebab-case or dot-delimited) |
| `label` | string | Yes | Human-readable name |
| `description` | string | No | Short description for UI |
| `dangerous` | boolean | No | If `true`, execute requires `confirm: true` |
| `preview(payload)` | function | No | Dry-run; returns preview result |
| `execute(payload)` | function | No | Performs the action; returns result |

Missing `id` or `label` causes the module to be silently skipped by the loader.

### Static registry metadata

`action-registry.js` exports `registryMeta()`:

```js
{
  schemaVersion: 1,
  totalActions: 17,
  privilegedCount: 6,
  mutableCount: 12,
  readOnlyCount: 5,
  riskLevels: ["low", "medium", "high", "critical"],
  categories: ["view", "provider", "worker", "resources", "queue", "settings"]
}
```

### Risk levels

| Level | Privilege | Preview | Confirmation |
|---|---|---|---|
| `low` | No | No | Optional |
| `medium` | No | Yes | Required |
| `high` | Yes | Yes | Required + human gate |
| `critical` | Yes | Yes | Required + human gate |

---

## Safety boundaries

### Preview-first flow

All mutating actions default to preview mode:
1. `POST /api/actions/preview` calls `module.preview(payload)` (dry-run)
2. Operator reviews the preview
3. `POST /api/actions/execute` checks `dangerous` flag; if `true` and `confirm != true`, returns 409 Conflict; otherwise calls `module.execute(payload)` and writes an audit entry

### Security measures

- Server binds to `127.0.0.1` only
- `sanitizeObject()` redacts secret-like keys/values on all payloads and results
- Dangerous modules gated with `confirm: true`
- Every execute call writes an audit entry
- `describeAction()` strips script paths from API responses
- `ALLOWED_ACTIONS`, `ACTIONS`, and `RISK` are `Object.freeze()`d

---

## Adding a new action module

1. Create `tools/provider-pool-webui/actions/<name>.js`
2. Export `{ id, label, description, dangerous, preview, execute }`
3. Create `<name>.test.js` alongside it with a `require.main` guard
4. If the action is provider/worker management, also add it to the static registry in `lib/action-registry.js`
5. Run `node tools/provider-pool-webui/actions/<name>.test.js` to verify
6. Run `node tools/provider-pool-webui/action-modules.test.js` to verify loader compatibility
