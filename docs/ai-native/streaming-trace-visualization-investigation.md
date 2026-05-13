# Streaming Trace Visualization Investigation

> **Closes:** [#1449](https://github.com/taoyu051818-sys/lian-nest-server/issues/1449)
> **Type:** research | **Risk:** low

---

## Goal

LIAN logs to raw NDJSON files and `.github/ai-state/` snapshots. Debugging requires reading text files with no filtering, no search, no visualization. This investigation assesses the gap and proposes a bounded path to a lightweight observability layer.

---

## Current State

### What Exists Today

| Layer | Format | Location | Strengths | Weaknesses |
|-------|--------|----------|-----------|------------|
| Worker telemetry events | NDJSON (append-only) | `worker-telemetry-events.ndjson` | Start/complete lifecycle per worker | No step-level granularity, no live streaming |
| Heartbeat liveness | JSON snapshot | `monitor-state.json` | Alive/dead signal, silence detection | Binary liveness, no phase detail |
| Monitoring metrics | JSON snapshot | per-worker metric row | CPU, memory, phase, budget utilization | Point-in-time only, no history retention |
| Telemetry calculator | JSON snapshot | `worker-telemetry.json` | Token usage, cost, changed files, gate outcome | Post-hoc only, not live |
| Meta signals | JSON snapshot | `meta-signals.json` | failureScore, frictionScore, riskScore, cost, trust | Aggregate only, no per-worker drill-down |
| Dashboard state emitter | JSON snapshot | `dashboard-state.json` | Combines 7 sources into one view | 30s polling, no push, no trace timeline |
| Provider Pool WebUI | HTML SPA | `tools/provider-pool-webui/` | Fleet table, action console, audit trail | No trace viewer, no event timeline, no search |
| Loop logs | NDJSON | `autonomous-loop-events.ndjson` | Loop-start, cycle-complete, loop-end | No per-worker step traces |

### External Tool Comparison

| Tool | What LIAN Has | What LIAN Lacks |
|------|---------------|-----------------|
| **LangSmith** (LangGraph) | Telemetry events with token/cost tracking | Step-level trace tree, parent-child span nesting, prompt/response capture, latency waterfall |
| **CrewAI Control Plane** | Control-plane dashboard state, action readiness | Agent task graph visualization, inter-agent dependency arrows, real-time progress bars |
| **OpenHands** | Worker fleet screen, phase tracking | Streaming event log viewer, terminal-in-browser, live output tailing |

### Key Gap Summary

1. **No step-level traces.** Workers emit start/complete events but nothing between. The `progressMilestones` field in telemetry is optional and rarely populated. There is no visibility into what a worker did between launch and finish.

2. **No streaming output.** Worker stdout/stderr goes to worktree-local files. The WebUI cannot tail or display live worker output. Debugging requires SSH-ing into the machine and reading files.

3. **No trace timeline.** The WebUI shows a flat table of workers. There is no timeline view showing phase transitions, validation runs, or gate checks over time for a single worker.

4. **No search/filter.** NDJSON files are append-only text. Finding a specific worker's events requires `grep` or manual reading. The WebUI has no search across event history.

5. **No inter-worker correlation.** Each worker is an isolated worktree. There is no way to see which workers ran in the same wave, which PRs they produced, or how they relate to the self-cycle loop.

---

## Existing Infrastructure That Can Be Reused

The system already has the building blocks for observability. No new data format or protocol is needed.

| Building Block | How It Helps |
|----------------|--------------|
| `worker-telemetry-events.ndjson` | Ready-made lifecycle events per worker. Adding a `step` event type is trivial. |
| `calculate-worker-telemetry.js` reader pattern | `readNdjson()` with graceful missing-file handling. Reusable for trace aggregation. |
| `emit-control-plane-dashboard-state.js` emitter pattern | Proven pattern: read N state files, emit combined snapshot. Same pattern works for trace aggregation. |
| WebUI polling architecture (30s) | Trace viewer can use the same polling model. No WebSocket needed for MVP. |
| `write-worker-telemetry-event.js` writer pattern | Dry-run default, sanitization, atomic append. Same pattern for new event types. |
| Worker phase enum (`worker-monitoring-metrics.md`) | 9 documented phases already define the trace vocabulary. |

---

## Recommended Approach: Three Phases

### Phase 1: Structured Step Events (minimal, closes this issue)

Add a `step` event type to `worker-telemetry-events.ndjson`. Workers already report phases; this formalizes them as trace events.

**New event shape:**

```json
{
  "eventVersion": 1,
  "eventType": "step",
  "capturedAt": "2026-05-13T10:15:00Z",
  "taskId": "claude/issue-1449-worker-001",
  "issueNumber": 1449,
  "actorRole": "research-worker",
  "step": {
    "phase": "reading-context",
    "label": "Read GitHub issue body",
    "durationMs": 3200,
    "status": "complete"
  }
}
```

**Changes required:**

| File | Change |
|------|--------|
| `scripts/ai/write-worker-telemetry-event.js` | Add `step` to allowed `eventType` values; validate `step.phase` against documented phases |
| `scripts/ai/calculate-worker-telemetry.js` | Read step events, populate `timing.progressMilestones[]` from them |
| `docs/ai-native/worker-telemetry-schema.md` | Document the `step` event type and its fields |
| `schemas/worker-telemetry-events.schema.json` | Add `step` to the `eventType` enum |

**Effort:** Small. The writer, reader, and schema patterns are already established.

### Phase 2: Trace Aggregation Emitter (follow-up)

New script `scripts/ai/emit-worker-trace.js` that reads `worker-telemetry-events.ndjson`, groups events by `taskId`, and emits a per-worker trace timeline as a JSON snapshot.

**Output shape:**

```json
{
  "schemaVersion": 1,
  "emittedAt": "2026-05-13T10:20:00Z",
  "traces": [
    {
      "taskId": "claude/issue-1449-worker-001",
      "issueNumber": 1449,
      "actorRole": "research-worker",
      "startedAt": "2026-05-13T10:00:00Z",
      "completedAt": "2026-05-13T10:25:00Z",
      "steps": [
        { "phase": "initializing", "label": "Load context", "at": "2026-05-13T10:00:00Z", "durationMs": 1500 },
        { "phase": "reading-context", "label": "Read issue", "at": "2026-05-13T10:00:02Z", "durationMs": 3200 },
        { "phase": "implementing", "label": "Write research doc", "at": "2026-05-13T10:00:05Z", "durationMs": 900000 }
      ]
    }
  ]
}
```

**Effort:** Medium. Follows the `emit-control-plane-dashboard-state.js` pattern exactly.

### Phase 3: WebUI Trace Tab (future)

Add a "Traces" tab to the Provider Pool WebUI that reads the trace snapshot and renders a timeline per worker. This is a UI-only change; no new API endpoints needed.

**Non-goals (explicitly out of scope):**

- WebSocket streaming (polling at 30s is sufficient for MVP)
- Prompt/response capture (privacy concern, high data volume)
- Inter-worker dependency graph (the six-layer model is already documented)
- External trace backends (Jaeger, Zipkin, etc.) -- keep it self-hosted

---

## Blockers and Risks

| Risk | Mitigation |
|------|------------|
| Workers may not emit step events reliably | Events are best-effort; missing steps produce a gap in the timeline, not an error |
| NDJSON file grows unbounded | Existing telemetry budget policy applies; old events can be archived |
| Step event volume increases storage | Each step event is ~200 bytes. At 10 steps/worker, 30 workers/day = ~60KB/day |
| Phase 1 requires modifying writer script | Change is additive (new eventType), no existing behavior changes |

---

## Conclusion

LIAN already has 80% of the observability infrastructure needed. The missing piece is **step-level events** between worker start and complete. Phase 1 is a small, additive change to the existing telemetry event writer that enables all downstream visualization. Phases 2 and 3 build on the same patterns already proven in the codebase.

**Recommendation:** Implement Phase 1 as a bounded PR. Phases 2-3 can be follow-up issues.
