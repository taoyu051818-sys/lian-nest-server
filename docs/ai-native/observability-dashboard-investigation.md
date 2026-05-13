# Observability Dashboard Investigation

**Issue:** #1502 — Investigate: streaming-trace-visualization
**Date:** 2026-05-13
**Status:** Research complete; actionable recommendations below

## Problem Statement

LIAN logs to raw NDJSON files and `.ai/loop-logs/` — debugging requires reading text files with no filtering, no search, no visualization. Comparable systems (LangSmith for LangGraph, CrewAI control plane, OpenHands web UI) offer structured traces, live dashboards, and streaming output from running workers.

## Current Observability Inventory

### What Exists (mature)

| Layer | Location | Format | Purpose |
|-------|----------|--------|---------|
| NDJSON ledgers | `.github/ai-state/*.ndjson` | Append-only | Worker telemetry, loop events, spending, contributions, gaps |
| JSON projections | `.github/ai-state/*.json` | Idempotent snapshots | Active workers, provider pool, health, trust, signals |
| Calculators | `scripts/ai/calculate-*.js` | Node.js | Aggregate raw events into meta-signals, entropy, risk |
| Emitters | `scripts/ai/emit-*.js` | Node.js | Compose projections into dashboard-ready snapshots |
| WebUI | `tools/provider-pool-webui/` | HTTP @ 127.0.0.1:4179 | Provider pool, workers, queue, planning, command steward |
| Schemas | `schemas/*.schema.json` | JSON Schema | 52 typed schemas for all state/event shapes |
| Docs | `docs/ai-native/*.md` | Markdown | 150+ files covering every subsystem |

### What's Missing (the gap)

1. **No structured cycle traces.** Loop-logs (`cycle-N-TIMESTAMP.log`) are plaintext console output, not parseable NDJSON. Step-level timing (health gate duration, provider preflight duration, launch gate evaluation) is buried in prose.

2. **No worker step-level trace.** Worker telemetry captures start/heartbeat/complete lifecycle events, but not the individual steps inside a worker run (file reads, edits, validations, API calls). LangSmith-style step traces don't exist.

3. **No real-time streaming.** The WebUI serves static JSON snapshots via HTTP polling. No SSE, WebSocket, or long-polling for live cycle updates.

4. **No trace search/filter.** With 120+ cycle logs and 17 worker batches, there's no way to filter by issue number, conflict group, outcome, time range, or worker class without manually reading files.

5. **No external-intake-specific observability.** External research intake events are logged to `external-intake-events.ndjson`, but there's no dedicated view in the WebUI for intake pipeline status.

## Recommendations

### Priority 1: Structured Cycle Traces (low effort, high value)

Convert cycle logs from plaintext to structured NDJSON. Each cycle step becomes an event:

```json
{"event":"cycle.step","cycle":42,"step":"health-gate","startedAt":"...","endedAt":"...","durationMs":320,"outcome":"green"}
{"event":"cycle.step","cycle":42,"step":"provider-preflight","startedAt":"...","endedAt":"...","durationMs":150,"outcome":"ok","availableSlots":5}
{"event":"cycle.step","cycle":42,"step":"launch-gate","startedAt":"...","endedAt":"...","durationMs":80,"outcome":"blocked","reason":"health yellow"}
```

**Implementation:** Add a `write-cycle-step-event.js` writer (follows existing `write-*-event.js` pattern) and call it from the self-cycle runner at each step boundary. Output to `.github/ai-state/cycle-step-events.ndjson`.

**Files:** `scripts/ai/write-cycle-step-event.js` (new), `scripts/ai/self-cycle-runner.js` (modify), `schemas/cycle-step-event.schema.json` (new)

### Priority 2: Simple HTML Trace Viewer (medium effort, high value)

Add a lightweight HTML page that reads cycle-step-events NDJSON and renders a timeline/table view. Could be a new page in the existing WebUI or a standalone file.

**Features:**
- Timeline per cycle showing step durations as horizontal bars
- Filter by cycle number, date range, outcome
- Color-coded by outcome (green/yellow/red)
- Click to expand step details

**Implementation:** New `public/trace.html` + `public/trace.js` in `tools/provider-pool-webui/`, new `GET /api/traces` endpoint in `server.js` that reads and serves cycle-step-events.

**Files:** `tools/provider-pool-webui/public/trace.html` (new), `tools/provider-pool-webui/public/trace.js` (new), `tools/provider-pool-webui/server.js` (modify)

### Priority 3: Worker Step Tracing (higher effort, medium value)

Instrument the Codex SDK wrapper to emit step-level events. Each API call, file operation, and validation becomes a trace span.

**Event shape:**
```json
{"event":"worker.step","issue":1502,"step":"api.call","startedAt":"...","endedAt":"...","durationMs":1200,"model":"claude-sonnet-4-20250514","inputTokens":4500,"outputTokens":800}
{"event":"worker.step","issue":1502,"step":"file.edit","file":"docs/ai-native/foo.md","linesChanged":15}
{"event":"worker.step","issue":1502,"step":"validation","command":"npm run check","exitCode":0,"durationMs":8000}
```

**Implementation:** New `write-worker-step-event.js` writer, instrument the worker runner script.

### Priority 4: SSE Streaming (higher effort, low-medium value)

Add Server-Sent Events endpoint to the WebUI for live updates:

```
GET /api/events/stream → text/event-stream
```

Emits events for: cycle start/step/complete, worker start/heartbeat/complete, health state changes.

**Tradeoff:** Adds complexity to the server. Only valuable if someone is actively watching the dashboard. Lower priority than structured traces.

### Priority 5: Intake Pipeline Dashboard Tab (low effort, medium value)

Add a dedicated tab to the existing WebUI showing external intake pipeline status: proposals pending, issues created, success/failure rates, source reliability scores.

**Data source:** `external-intake-events.ndjson` + `external-intake-proposals.json`

## Effort Estimates

| Priority | Effort | Impact | Dependencies |
|----------|--------|--------|-------------|
| P1: Structured cycle traces | 1-2 days | High | Self-cycle runner code |
| P2: HTML trace viewer | 2-3 days | High | P1 (needs structured data) |
| P3: Worker step tracing | 3-5 days | Medium | Worker runner, Codex SDK |
| P4: SSE streaming | 2-3 days | Low-Medium | P1 + WebUI server |
| P5: Intake dashboard tab | 1 day | Medium | Existing intake events |

## Recommendation

Start with P1 + P2 as a single PR. This gives the most value for the least effort: structured traces that are programmatically queryable, plus a simple visual timeline. P3-P5 can follow as separate issues.

The existing infrastructure (NDJSON writers, JSON schemas, emitter pattern, WebUI server) provides a strong foundation. The gap is not in the data model but in the cycle-level granularity and visualization layer.
