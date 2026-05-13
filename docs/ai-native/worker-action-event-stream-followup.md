# Worker Action Event Stream — Follow-Up Issues

Three bounded improvements identified in
[durable-event-stream-investigation.md](durable-event-stream-investigation.md)
that give LIAN most of the debugging and recovery value of a full event
stream.

> **Parent:** [#1444](https://github.com/taoyu051818-sys/lian-nest-server/issues/1444)

---

## Issue 1: Worker Action Fact Events

**Title:** Extend fact event schema with worker action event types

**Scope:**

- Add new event types to `fact-event.schema.json`:
  - `worker.action.tool-call` — tool invocation detected
  - `worker.action.file-edit` — file modification recorded
  - `worker.action.checkpoint` — structured progress marker
- Document event types in `fact-event-schema.md`
- No runtime code changes — schema and docs only

**Acceptance criteria:**

- [ ] Event types documented in `fact-event-schema.md`
- [ ] `write-fact-event.js` accepts new event types (validation)
- [ ] Example events in ledger for each new type

**Effort:** Low (docs + schema extension)

**Layer:** Contract / Planning (Layer 1)

---

## Issue 2: Structured Worker Output Protocol

**Title:** Define structured checkpoint markers for worker stdout

**Scope:**

- Define a `::checkpoint::` marker format that workers can emit
- Extend `wait-claude-batch.ps1` to parse checkpoint markers from stdout
- Write checkpoint markers as `worker.action.checkpoint` fact events
- Document the protocol in `worker-heartbeat.md`

**Marker format:**

```
::checkpoint::<issue-id>::<step-description>::<progress-summary>
```

**Acceptance criteria:**

- [ ] Marker format documented
- [ ] Heartbeat monitor parses markers from stdout
- [ ] Checkpoint events written to fact event ledger
- [ ] Workers can receive last checkpoint as recovery context

**Effort:** Low-Medium (stdout parsing + event writing)

**Layer:** Health / Diagnostic (Layer 3)

---

## Issue 3: Partial Progress Recovery

**Title:** Extend recovery policy with partial-progress-aware restart

**Scope:**

- When a worker crashes, read worktree git state (committed + uncommitted)
- Generate a `worker.recovery.partial-progress` fact event
- Launch recovery worker with partial progress summary as context
- Update `parallel-recovery-policy.md` with the new recovery path

**Acceptance criteria:**

- [ ] Recovery worker receives partial progress context
- [ ] Partial progress fact event recorded before recovery launch
- [ ] Recovery policy doc updated with partial-progress path
- [ ] Recovery worker can build on committed changes (cherry-pick or rebase)

**Effort:** Medium (git state analysis + recovery worker context injection)

**Layer:** Health / Diagnostic (Layer 3)

---

## Sequencing

```
Issue 1 (schema)  ──▶  Issue 2 (protocol)  ──▶  Issue 3 (recovery)
   Layer 1                Layer 3                  Layer 3
```

Issue 1 is unblocked immediately. Issues 2 and 3 depend on Issue 1's
event types being defined.

---

## References

- [Durable Event Stream Investigation](durable-event-stream-investigation.md)
- [Fact Event Schema](fact-event-schema.md)
- [Worker Heartbeat](worker-heartbeat.md)
- [Parallel Recovery Policy](parallel-recovery-policy.md)
