# Human Strategy Notes Contract

Defines how human-authored strategic direction enters the fact layer as
observable evidence — without bypassing policy, gates, or worker boundaries.

> **Closes:** [#900](https://github.com/taoyu051818-sys/lian-nest-server/issues/900)

---

## Overview

Humans (repo-owner, architect, pm-gate) sometimes need to inject strategic
context into the AI-native loop — prioritization signals, architectural
preferences, known risks, or sequencing constraints. These notes must flow
through the existing fact layer so that:

1. Workers see them as **evidence**, not commands.
2. All policy gates and boundaries remain intact.
3. The notes are auditable, sanitized, and append-only.

Human strategy notes are **not** policy files. They do not modify
`.github/ai-policy/` or `.github/ai-state/`. They are recorded in the
fact event ledger and surfaced to workers via context bundles.

---

## Entry Point

Strategy notes enter the system through the fact event ledger:

```
.github/ai-state/fact-events.ndjson
```

They use the standard `write-fact-event.js` writer with event type
`human.strategy-note`. All existing sanitization, dry-run defaults, and
append-only guarantees apply.

---

## Event Schema

```jsonc
{
  "eventVersion": 1,
  "eventType": "human.strategy-note",
  "subject": "wave 27 prioritization",
  "facts": {
    "scope": "batch-planning",
    "priority": "high",
    "note": "Prioritize docs-only tasks before runtime slices to unblock review queue",
    "issuedBy": "repo-owner",
    "expiresAfter": "2026-06-01T00:00:00Z"
  },
  "capturedAt": "2026-05-12T10:00:00Z",
  "actor": "human"
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `eventVersion` | `1` | yes | Schema version. |
| `eventType` | `"human.strategy-note"` | yes | Fixed event type. |
| `subject` | string | yes | Brief label for the note topic. |
| `facts.scope` | string | yes | Where the note applies: `batch-planning`, `worker-dispatch`, `merge-decision`, `health-gate`, `global`. |
| `facts.priority` | string | no | `high`, `medium`, `low`. Default: `medium`. |
| `facts.note` | string | yes | The strategic direction. Max 500 chars (enforced by sanitization). |
| `facts.issuedBy` | string | yes | Role that issued the note: `repo-owner`, `architect`, `pm-gate`. |
| `facts.expiresAfter` | string | no | ISO-8601 timestamp after which the note is stale. If absent, the note persists indefinitely. |
| `capturedAt` | string | yes | ISO-8601 timestamp (auto-set by writer). |
| `actor` | `"human"` | yes | Always `"human"` for strategy notes. |

### Scope Values

| Scope | Applies To | Consumers |
|-------|-----------|-----------|
| `batch-planning` | Wave sequencing, issue prioritization | `plan-next-batch.ps1`, planner |
| `worker-dispatch` | Worker launch order, conflict group hints | `batch-launch.ps1`, launch gate |
| `merge-decision` | Merge priority, hold instructions | Merge queue assistant |
| `health-gate` | Recovery urgency, defer/accelerate hints | Post-merge health gate |
| `global` | Cross-cutting strategic direction | All consumers |

---

## What Strategy Notes CAN Do

- Provide prioritization hints to the batch planner.
- Flag known risks or constraints for workers to consider.
- Communicate sequencing preferences (e.g., "finish docs wave before runtime").
- Surface human judgment about urgency or deferral.
- Attach context to a specific wave, issue, or time window.

## What Strategy Notes CANNOT Do

| Constraint | Why |
|------------|-----|
| Modify policy files | Seed constitution §5 prohibits policy modification outside amendment process. |
| Override gate decisions | Launch gate, health gate, and review gate are authoritative. Notes are advisory. |
| Expand worker scope | Worker `allowedFiles` is immutable (seed constitution §2, §5). |
| Bypass main-red stop | Main-red launch stop is absolute (seed constitution §3). |
| Contain secrets | Sanitization strips tokens, credentials, and base64-like strings. |
| Issue commands | Notes are evidence. Workers evaluate them within their existing constraints. |

---

## Consumption Rules

Workers and orchestrators reading strategy notes MUST:

1. **Treat as evidence, not commands.** A note suggesting "prioritize X" does
   not override a gate blocking X. The gate still applies.
2. **Check expiry.** If `expiresAfter` is in the past, ignore the note.
3. **Respect scope.** A `batch-planning` note does not affect merge decisions.
4. **Log consumption.** When a worker acts on a strategy note, it should
   reference the note's `capturedAt` and `subject` in its PR body or commit
   message for auditability.
5. **Not self-author.** Workers MUST NOT write `human.strategy-note` events.
   Only humans (via the writer script) may create these entries.

---

## Writing a Strategy Note

### Dry-run (default)

```bash
node scripts/ai/write-fact-event.js \
  --type human.strategy-note \
  --subject "wave 27 prioritization" \
  --facts '{"scope":"batch-planning","priority":"high","note":"Prioritize docs-only tasks before runtime slices","issuedBy":"repo-owner"}'
```

### Live write

```bash
node scripts/ai/write-fact-event.js \
  --type human.strategy-note \
  --live \
  --subject "wave 27 prioritization" \
  --facts '{"scope":"batch-planning","priority":"high","note":"Prioritize docs-only tasks before runtime slices","issuedBy":"repo-owner","expiresAfter":"2026-06-01T00:00:00Z"}'
```

---

## Integration

```
Human (repo-owner / architect / pm-gate)
       |
       v
write-fact-event.js --type human.strategy-note
       |
       v
fact-events.ndjson          (append-only ledger)
       |
       v
generate-context-bundle.js  (include recent notes in worker context)
       |
       v
Workers read notes as evidence within their existing boundaries
```

### Downstream Consumers

| Consumer | How It Uses Strategy Notes |
|----------|---------------------------|
| Context bundle generator | Includes recent non-expired notes in worker context bundles. |
| Batch planner | Reads `batch-planning` notes to inform prioritization. |
| Launch gate | Surfaces `worker-dispatch` notes as advisory context. |
| Merge queue assistant | Reads `merge-decision` notes for hold/priority hints. |
| Health gate | Reads `health-gate` notes for recovery urgency signals. |

---

## Design Decisions

- **Fact layer, not policy layer.** Strategy notes are observations, not rules.
  They belong in the append-only fact ledger, not in `.github/ai-policy/`.
- **Advisory, not authoritative.** Gates and boundaries remain the source of
  truth for what workers may do. Notes provide context for prioritization.
- **Scoped, not global.** The `scope` field prevents a planning note from
  accidentally influencing merge decisions or health gates.
- **Expiry-aware.** Strategy notes have a shelf life. Stale notes are ignored
  to prevent outdated direction from persisting.
- **Human-only authorship.** Workers cannot create strategy notes. This
  prevents self-reinforcing loops where automation generates its own direction.
- **Reuses existing infrastructure.** No new scripts, schemas, or state files.
  The fact event ledger and writer already exist.

---

## References

- [Fact Event Ledger](fact-event-ledger.md) — Append-only NDJSON specification
- [Fact Event Schema](fact-event-schema.md) — JSON schema for all fact events
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
- [SOP.md](SOP.md) — Lifecycle and hard rules
- [Context Bundles](context-bundles.md) — How notes reach workers
- [Loop Model](loop-model.md) — Automated loop phases
- [Knowledge Update Writer](knowledge-update-writer.md) — Related NDJSON writer pattern
