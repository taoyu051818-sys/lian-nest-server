# Fact Event JSON Schema

Schema for entries in the append-only fact event ledger.
Each line in `.github/ai-state/fact-events.ndjson` conforms to this schema.

> **Closes:** [#459](https://github.com/taoyu051818-sys/lian-nest-server/issues/459)

---

## Schema Location

`schemas/fact-event.schema.json`

---

## Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `eventVersion` | Yes | `1` (const) | Schema version. |
| `eventType` | Yes | string (dot-namespaced) | What happened. E.g. `worker.launch`, `health.red`. |
| `subject` | No | string or null | What the event is about. E.g. issue number, branch name. |
| `facts` | No | object or null | Key-value pairs with event-specific data. |
| `capturedAt` | Yes | date-time | ISO-8601 timestamp of when the event was recorded. |
| `actor` | No | string or null | What produced the event. E.g. script name, worker id. |

---

## Event Type Conventions

Event types use dot-namespace notation. Common prefixes:

| Prefix | Meaning | Examples |
|--------|---------|----------|
| `worker.*` | Worker lifecycle | `worker.launch`, `worker.complete`, `worker.fail` |
| `health.*` | Health gate outcomes | `health.green`, `health.yellow`, `health.red` |
| `merge.*` | Merge lifecycle | `merge.start`, `merge.complete`, `merge.conflict` |
| `provider.*` | Provider pool events | `provider.exhausted`, `provider.recovered` |
| `gate.*` | Gate check outcomes | `gate.pass`, `gate.block` |

The `eventType` pattern `^[a-zA-Z0-9]+(\.[a-zA-Z0-9_-]+)*$` requires at least one segment of alphanumeric characters, optionally followed by dot-separated segments that may include hyphens and underscores.

---

## Sanitization

All string fields are sanitized by the writer script before writing:

- Base64-like strings (40+ chars) → `[redacted-token]`
- `ghp_*` GitHub tokens → `[redacted-gh-token]`
- `Bearer *` headers → `Bearer [redacted]`
- `password=`, `secret=`, `token=` values → `[redacted]`
- String values truncated to 500 characters

Applied to: `subject`, `actor`, and all string values within `facts`.

---

## Example: Worker Launch

```json
{
  "eventVersion": 1,
  "eventType": "worker.launch",
  "subject": "issue #397",
  "facts": {
    "branch": "claude/wave11-20260510-090000-issue-397",
    "workerClass": "ai-native-tooling-worker"
  },
  "capturedAt": "2026-05-11T12:30:00.000Z",
  "actor": "batch-launcher"
}
```

---

## Example: Health Event

```json
{
  "eventVersion": 1,
  "eventType": "health.red",
  "subject": "main branch",
  "facts": {
    "check": "tsc",
    "exitCode": 1,
    "commit": "abc1234"
  },
  "capturedAt": "2026-05-11T13:00:00.000Z",
  "actor": "health-checker"
}
```

---

## Example: Minimal Event

```json
{
  "eventVersion": 1,
  "eventType": "provider.exhausted",
  "subject": null,
  "facts": null,
  "capturedAt": "2026-05-11T14:00:00.000Z",
  "actor": null
}
```

---

## Integration

### Fact Event Ledger

The canonical ledger file is `.github/ai-state/fact-events.ndjson`.
Each line is a self-contained JSON object conforming to this schema.
See [fact-event-ledger.md](fact-event-ledger.md) for the full ledger specification.

### Writer Script

Events are written by `scripts/ai/write-fact-event.js`.
The script applies sanitization and defaults to dry-run mode.
See [fact-event-ledger.md](fact-event-ledger.md#usage) for CLI usage.

### Downstream Consumers

- **Context bundle generator** — includes recent fact events in worker context bundles.
- **Meta signals calculator** — aggregates fact events into failure/friction signals.
- **State reconciler** — detects drift between projection state and recorded facts.
- **Monitoring/audit** — scans the ledger for anomalous patterns.

---

## Validation

The schema uses JSON Schema draft-07. Validate fact events against it:

```bash
# Using ajv-cli (if installed)
npx ajv validate -s schemas/fact-event.schema.json -d <event-file>.json

# Using any draft-07 compatible validator
```

---

## See Also

- [Fact Event Ledger](fact-event-ledger.md) — Full ledger specification and usage
- [Gate Result Schema](gate-result-schema.md) — Gate decision outputs
- [Context Bundle Fact Projection](context-bundle-fact-projection.md) — Fact events in context bundles
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [#459](https://github.com/taoyu051818-sys/lian-nest-server/issues/459) — This feature
