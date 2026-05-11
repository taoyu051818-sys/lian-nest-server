# Fact Event Ledger

Append-only NDJSON ledger for recording observable facts about the AI-native control plane.

> **Reference:** [ai-state/README.md](../../.github/ai-state/README.md) for marker conventions, [seed-constitution.md](seed-constitution.md) for immutable boundaries.

---

## Overview

The fact event ledger is a machine-readable append-only log at `.github/ai-state/fact-events.ndjson`. Each line is a single JSON object representing an observable fact — a worker launch, a health state change, a provider event, a merge completion, or any other discrete control-plane occurrence.

Unlike projection files (which are idempotent snapshots), the ledger is **append-only**. Each new fact is a new line; previous entries are never modified or removed. This makes it safe for concurrent writers and trivial to audit.

---

## Event Schema

Each event is a single NDJSON line with the following shape:

```jsonc
{
  "eventVersion": 1,
  "eventType": "worker.launch",
  "subject": "issue #397",
  "facts": {
    "branch": "claude/wave11-...",
    "workerClass": "ai-native-tooling-worker"
  },
  "capturedAt": "2026-05-11T12:30:00Z",
  "actor": "batch-launcher"
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `eventVersion` | `number` | yes | Schema version. Currently `1`. |
| `eventType` | `string` | yes | Dot-namespaced event type. E.g. `worker.launch`, `health.red`. |
| `subject` | `string \| null` | no | What the event is about. E.g. issue number, branch name, file path. |
| `facts` | `object \| null` | no | Key-value pairs with event-specific data. |
| `capturedAt` | `string` | yes | ISO-8601 timestamp of when the event was recorded. |
| `actor` | `string \| null` | no | What produced the event. E.g. script name, worker id, orchestrator. |

### Event Types (convention)

Event types use dot-namespace notation. Common prefixes:

| Prefix | Meaning |
|--------|---------|
| `worker.*` | Worker lifecycle events (launch, complete, fail) |
| `health.*` | Health gate outcomes (green, yellow, red) |
| `merge.*` | Merge lifecycle (start, complete, conflict) |
| `provider.*` | Provider pool events (exhausted, recovered) |
| `gate.*` | Gate check outcomes (pass, block) |

---

## Sanitization

All string fields are sanitized before writing:

- Base64-like strings (40+ chars) → `[redacted-token]`
- `ghp_*` GitHub tokens → `[redacted-gh-token]`
- `Bearer *` headers → `Bearer [redacted]`
- `password=`, `secret=`, `token=` values → `[redacted]`
- String values truncated to 500 characters

Sanitization is applied to `subject`, `actor`, and all string values within `facts`.

---

## Usage

### Dry-run (default)

```bash
# Preview an event without writing
node scripts/ai/write-fact-event.js --type worker.launch --subject "issue #397"

# With facts
node scripts/ai/write-fact-event.js --type health.red --facts '{"check":"tsc"}'
```

### Live write

```bash
# Append to the ledger
node scripts/ai/write-fact-event.js --type worker.launch --live --subject "issue #397" --actor "batch-launcher"

# With facts
node scripts/ai/write-fact-event.js --type provider.exhausted --live --facts '{"provider":"default","reason":"quota"}'
```

### Self-test

```bash
node scripts/ai/write-fact-event.js --self-test
```

---

## File Location

```
.github/ai-state/fact-events.ndjson
```

Each line is a self-contained JSON object. The file grows monotonically. No line is ever modified or removed.

### Reading the ledger

```bash
# Count events
wc -l .github/ai-state/fact-events.ndjson

# Filter by event type
grep '"eventType":"worker.launch"' .github/ai-state/fact-events.ndjson

# Parse with Node.js
node -e "require('fs').readFileSync('.github/ai-state/fact-events.ndjson','utf8').split('\\n').filter(Boolean).map(JSON.parse)"
```

---

## Downstream Consumers

- **Context bundle generator**: Can include recent fact events in worker context bundles.
- **Meta signals calculator**: Can aggregate fact events into failure/friction signals.
- **State reconciler**: Can detect drift between projection state and recorded facts.
- **Monitoring/audit**: Can scan the ledger for anomalous patterns or compliance gaps.

---

## Design Decisions

- **Append-only, not snapshot.** Projections (`worker-trust.json`, `provider-pool.json`) are idempotent snapshots. The ledger is a growing log. Each serves a different read pattern.
- **No secrets.** All fields are sanitized before write. The script never stores raw tokens, credentials, or log content.
- **Dry-run by default.** Consistent with other AI-native scripts. Live writes require explicit `--live`.
- **Self-contained.** No external dependencies. Uses only `fs` and `path`.
- **`eventVersion` enables schema evolution.** Consumers should check `eventVersion` and handle unknown versions gracefully.

---

## References

- [write-fact-event.js](../../scripts/ai/write-fact-event.js) — Writer script
- [ai-state/README.md](../../.github/ai-state/README.md) — State file conventions
- [seed-constitution.md](seed-constitution.md) — Immutable boundaries
- [main-health-policy.md](main-health-policy.md) — Health state definitions
- [provider-pool.md](provider-pool.md) — Provider pool architecture
