# Legacy Orchestration Retirement Status

Machine-readable status fact for legacy orchestration retirement.
Consumed by the autonomy readiness report to evaluate duty-7 without
human memory.

> **Closes:** [#1281](https://github.com/taoyu051818-sys/lian-nest-server/issues/1281)
>
> **See also:**
> [codex-duty-exit-checklist.md](codex-duty-exit-checklist.md) for the
> full duty ownership map,
> [codex-exit-readiness-gate.md](codex-exit-readiness-gate.md) for the
> gate decision rule,
> [command-steward-agent.md](command-steward-agent.md) for the
> human-facing control-plane interface.

---

## Purpose

The autonomy readiness report evaluates 8 codex duties. Duty-7
("Legacy orchestration retired") was previously hardcoded as `blocked`
because no machine-readable status existed. This document and its
companion state file (`.github/ai-state/legacy-orchestration-retirement.json`)
provide the fact that the readiness script needs to evaluate duty-7
from committed state rather than human memory.

---

## State File Schema

```jsonc
{
  "markerVersion": 1,
  "capturedAt": "ISO-8601",
  "status": "pending | in_progress | complete | rolled_back",
  "duties": {
    "duty-1": { "name": "string", "status": "met | partial | blocked" },
    "duty-2": { "name": "string", "status": "met | partial | blocked" },
    "duty-3": { "name": "string", "status": "met | partial | blocked" },
    "duty-4": { "name": "string", "status": "met | partial | blocked" },
    "duty-5": { "name": "string", "status": "met | partial | blocked" },
    "duty-6": { "name": "string", "status": "met | partial | blocked" },
    "duty-7": { "name": "string", "status": "met | partial | blocked" }
  },
  "blockingDutiesMet": "integer",
  "blockingDutiesTotal": "integer",
  "nextAction": "string",
  "sourceDocs": ["string"]
}
```

### Status Values

| Status | Meaning |
|--------|---------|
| `pending` | Retirement not yet started. Duty-7 remains blocked. |
| `in_progress` | Retirement underway. Duty-7 evaluates from per-duty status. |
| `complete` | All duties met. Duty-7 is unblocked. |
| `rolled_back` | Retirement rolled back. Duty-7 is blocked. |

### Per-Duty Status

Each duty in the `duties` map mirrors the duty ownership map from
[codex-duty-exit-checklist.md](codex-duty-exit-checklist.md). The
autonomy readiness script reads the overall `status` field and the
`duty-7` entry to determine duty-7 evaluation.

---

## Autonomy Readiness Integration

The `emit-command-steward-autonomy-readiness.js` script reads
`.github/ai-state/legacy-orchestration-retirement.json` and evaluates
duty-7 as follows:

| State File Status | duty-7 Status | Readiness Result |
|-------------------|---------------|-----------------|
| Missing or unreadable | — | `blocked` (legacy migration status not available) |
| `pending` | any | `blocked` |
| `in_progress` | `met` | `met` |
| `in_progress` | `partial` | `partial` |
| `in_progress` | `blocked` | `blocked` |
| `complete` | any | `met` |
| `rolled_back` | any | `blocked` |

---

## Downstream Consumers

- **Autonomy readiness report**: Reads `status` and `duties.duty-7`
  to evaluate duty-7 without hardcoded assumptions.
- **Command Steward daily brief**: Can include retirement status in
  the session summary.
- **State reconciler**: Can detect stale retirement markers via
  `capturedAt`.

---

## Update Workflow

The retirement status file is updated manually or by the state
reconciler when duty ownership changes. It is not auto-written by
CI — a human or Command Steward confirms each status transition.

```
codex-duty-exit-checklist.md (source of truth for duty ownership)
        |
        v
legacy-orchestration-retirement.json (machine-readable projection)
        |
        v
emit-command-steward-autonomy-readiness.js (consumer)
```

---

## Non-Goals

- This document does not define the retirement runbook — that is in
  [codex-retirement-runbook.md](codex-retirement-runbook.md).
- This document does not weaken any gate or safety invariant.
- This document does not auto-trigger retirement transitions.

---

## References

- [Codex Duty Exit Checklist](codex-duty-exit-checklist.md) — Duty
  ownership map
- [Codex Exit Readiness Gate](codex-exit-readiness-gate.md) — Gate
  decision rule and two-cycle acceptance test
- [Command Steward Agent](command-steward-agent.md) — Human-facing
  control-plane interface
- [#1281](https://github.com/taoyu051818-sys/lian-nest-server/issues/1281)
  — This feature
