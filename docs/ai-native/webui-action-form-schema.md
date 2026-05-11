# WebUI Action Form Schema Helpers

Pure helpers that derive form metadata from action registry descriptors.
Used by the WebUI operation console to render typed form fields, risk badges,
and submit/preview labels without hardcoding UI logic per action.

> **Closes:** [#692](https://github.com/taoyu051818-sys/lian-nest-server/issues/692)

---

## Module

`tools/provider-pool-webui/lib/action-form-schema.js`

All exports are pure functions. No DOM, no server, no side effects.

---

## Public API

| Function | Input | Returns |
|----------|-------|---------|
| `buildFieldDescriptor(name)` | field name (string) | field descriptor object |
| `buildFormFields(requiredFields)` | array of field names | array of field descriptors |
| `buildFormSchema(actionId)` | action id (string) | form schema or `null` |
| `buildFormSchemas([actionIds])` | optional array of ids | array of form schemas |
| `buildFormSchemasByCategory()` | — | `{ category: schema[] }` |
| `formSchemaMeta()` | — | summary metadata object |
| `riskBadge(risk)` | risk level string | badge descriptor or `null` |

---

## Field Type Inference

Known fields get typed descriptors automatically. Unknown fields default to `text`.

| Field | Type | Label | Extra |
|-------|------|-------|-------|
| `providerId` | text | Provider ID | autocomplete: provider |
| `workerId` | text | Worker ID | autocomplete: worker |
| `target` | text | Target | — |
| `value` | number | Value | min: 1, step: 1 |
| `field` | text | Policy Field | — |

All fields have `required: true`.

---

## Risk Badges

| Risk Level | Color | CSS Class | Label |
|------------|-------|-----------|-------|
| `low` | green | `risk-low` | Low Risk |
| `medium` | yellow | `risk-medium` | Medium Risk |
| `high` | orange | `risk-high` | High Risk |
| `critical` | red | `risk-critical` | Critical Risk |

---

## Form Schema Shape

```json
{
  "actionId": "provider.cooldown.reset",
  "title": "Reset Provider Cooldown",
  "description": "Clear the cooldown timer...",
  "category": "provider",
  "risk": "medium",
  "riskBadge": { "level": "medium", "color": "yellow", "label": "Medium Risk", "cssClass": "risk-medium" },
  "privileged": false,
  "readOnly": false,
  "defaultPreview": true,
  "fields": [
    { "name": "providerId", "type": "text", "label": "Provider ID", "placeholder": "e.g. provider-default", "required": true, "autocomplete": "provider" }
  ],
  "hasConfirmMessage": true,
  "submitLabel": "Execute",
  "previewLabel": "Preview"
}
```

### Submit label rules

- Read-only actions: `"View"`
- Privileged actions: `"Execute (Privileged)"`
- All others: `"Execute"`

---

## Usage

```js
const { buildFormSchema, buildFormSchemasByCategory } = require("./lib/action-form-schema");

// Single action form
const schema = buildFormSchema("worker.kill");
if (schema) {
  // render form fields from schema.fields
  // show risk badge from schema.riskBadge
}

// All forms grouped by category
const grouped = buildFormSchemasByCategory();
for (const [category, schemas] of Object.entries(grouped)) {
  // render category section with schemas
}
```

---

## Safety

- Pure helpers only — no DOM, no network, no file I/O.
- Returns frozen objects (immutable).
- Never exposes script paths or secrets.
- All schemas derived from the action registry at call time.

---

## Tests

Run: `node tools/provider-pool-webui/action-form-schema.test.js`
