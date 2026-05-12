# Runtime Signal Intake Contract

Defines the boundary through which runtime signals (health, liveness, resource, operational, telemetry) enter the agent planning layer. All signals pass through validation, staleness checks, and secret redaction before consumption.

> **Authority:** Governance doc. Changes require repo-owner approval.
> **Folder:** `docs/ai-native/` per [docs-authority-map.md](docs-authority-map.md).
> **Closes:** [#903](https://github.com/taoyu051818-sys/lian-nest-server/issues/903)

---

## Purpose

The self-cycle runner, planning loop, and agent workers need runtime context to make risk-aware decisions. Today, each signal source writes to its own file in its own format. This contract defines the **intake boundary** — the rules that govern how signals are collected, validated, normalized, and routed to consumers without leaking secrets.

```
┌─────────────────────────────────────────────────────────────┐
│                    signal sources                            │
│                                                             │
│  health gate    heartbeat    gap ledger    resource health   │
│  fact events    worker metrics    meta-signals               │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
                ┌────────────────────────┐
                │    intake boundary     │
                │                        │
                │  1. schema validation  │
                │  2. staleness check    │
                │  3. secret redaction   │
                │  4. envelope wrap      │
                └───────────┬────────────┘
                            │
                            ▼
                ┌────────────────────────┐
                │      consumers        │
                │                        │
                │  planning loop         │
                │  launch gate           │
                │  agent workers         │
                │  WebUI console         │
                └────────────────────────┘
```

---

## Signal Sources

Each source writes to a known path under `.github/ai-state/`. The intake boundary reads from these paths. Sources are **append-only** (NDJSON) or **idempotent snapshots** (JSON).

| Source | Path | Format | Writer | Doc |
|--------|------|--------|--------|-----|
| Health state | `main-health.json` | Snapshot | `write-main-health-state.ps1` | [health-state-schema.md](health-state-schema.md) |
| Heartbeat | `monitor-state.json` | Snapshot | `wait-claude-batch.ps1` | [worker-heartbeat.md](worker-heartbeat.md) |
| Gap ledger | `gap-ledger.ndjson` | Append | `write-gap-ledger.js` | [gap-ledger.md](gap-ledger.md) |
| Fact events | `fact-events.ndjson` | Append | `write-fact-event.js` | [fact-event-ledger.md](fact-event-ledger.md) |
| Resource health | `local-resource-health.json` | Snapshot | Provider pool guard | [local-resource-health-schema.md](local-resource-health-schema.md) |
| Meta signals | `meta-signals.json` | Snapshot | `calculate-meta-signals.js` | [meta-signals.md](meta-signals.md) |
| Worker metrics | (per-worker) | Snapshot | Metrics collector | [worker-monitoring-metrics.md](worker-monitoring-metrics.md) |

### Signal Category Matrix

| Category | Sources | Criticality | Planning Impact |
|----------|---------|-------------|-----------------|
| **Health** | Health state | Red/black blocks all workers | Determines allowed worker classes |
| **Liveness** | Heartbeat, worker metrics | Stale workers indicate hangs | Friction scoring, recovery triggers |
| **Resource** | Resource health | Critical blocks dispatch | Concurrency gating |
| **Operational** | Gap ledger, fact events | Informs failure patterns | Risk-aware prioritization |
| **Aggregate** | Meta signals | Derived from above | Top-level planning summary |

---

## Intake Boundary Rules

Every consumer that reads runtime signals for planning MUST apply these rules.

### 1. Schema Validation

Before consuming a signal file, the reader MUST verify:

- The file exists and is non-empty.
- For snapshot files: the JSON parses without error and contains the required version field (`markerVersion`, `snapshotVersion`, `schemaVersion`, or `entryVersion`).
- For NDJSON files: each line parses as a valid JSON object with the required version field.

If validation fails, the consumer MUST treat the signal as **missing** and fall back to safe defaults (see [Safe Skeleton Behavior](#safe-skeleton-behavior)).

### 2. Staleness Check

Signals carry timestamps. Consumers MUST reject stale signals.

| Source | Timestamp Field | Staleness Threshold | Fallback |
|--------|-----------------|---------------------|----------|
| Health state | `capturedAt` | 60 minutes | Treat as unknown; block runtime workers |
| Heartbeat | `capturedAt` | 5 minutes | Treat worker as stale |
| Resource health | `capturedAt` | 5 minutes | Treat as unknown; block dispatch |
| Meta signals | `calculatedAt` | 15 minutes | Recalculate or treat as zeroed |
| Gap ledger | `recordedAt` | No expiry | Append-only; always current |
| Fact events | `capturedAt` | No expiry | Append-only; always current |
| Worker metrics | `cpu.sampledAt` / `memory.sampledAt` | 2 minutes | Omit resource fields |

**Staleness detection formula:**

```
isStale = (now - signalTimestamp) > threshold
```

When a signal is stale, the consumer MUST:

1. Log the staleness to the gap ledger (`gapType: "stale-row"` or `"plan-drift"`).
2. Fall back to the safe skeleton for that signal category.
3. Never propagate a stale signal value to downstream planning decisions.

### 3. Secret Redaction

The intake boundary is a **trust boundary**. Signals crossing it MUST NOT contain secrets.

**Prohibited content in any signal field:**

| Pattern | Example | Action |
|---------|---------|--------|
| API keys / tokens | `ghp_...`, `sk-...`, `Bearer ...` | Redact to `[redacted]` |
| Environment values | `DATABASE_URL=...`, `REDIS_URL=...` | Redact to `[redacted]` |
| File contents | Raw log output, stack traces with env | Truncate to 500 chars |
| Base64 blobs | 40+ char alphanumeric strings | Redact to `[redacted-token]` |
| Command output | `npm run` stdout with env vars | Sanitize before intake |

**Enforcement points:**

- Fact event ledger: sanitization applied by `write-fact-event.js` before write.
- Gap ledger: sanitization applied by `write-gap-ledger.js` before write.
- Health state: writer strips environment-specific paths.
- Heartbeat: no secret-bearing fields by design.
- Worker metrics: no secret-bearing fields by design.

**Consumer responsibility:** Consumers MUST NOT assume upstream sanitization is complete. Any field displayed to agents or stored in context bundles MUST be re-validated against the prohibited patterns above.

### 4. Envelope Wrap

When the intake boundary presents a signal to a consumer, it SHOULD wrap it in a normalized envelope:

```jsonc
{
  "signalType": "health",           // category: health | liveness | resource | operational | aggregate
  "source": "main-health.json",     // origin file
  "sourceVersion": 1,               // source schema version
  "capturedAt": "2026-05-11T12:00:00Z",
  "stale": false,                   // staleness check result
  "payload": { ... }                // source-specific data (validated, redacted)
}
```

The envelope is advisory — current consumers read source files directly. The envelope exists to document the normalized shape that future intake implementations SHOULD adopt.

---

## Safe Skeleton Behavior

When a signal source is missing, empty, stale, or fails validation, consumers MUST fall back to safe defaults:

| Signal | Safe Default | Rationale |
|--------|-------------|-----------|
| Health state | `state: "red"`, `allowedWorkerClasses: []` | Fail-closed: no workers when health is unknown |
| Heartbeat | All workers treated as unknown | No assumption of liveness |
| Resource health | `overall: "critical"` | Fail-closed: no dispatch when resources are unknown |
| Meta signals | All scores 0, trust 100, topPain "none" | Neutral baseline (matches `calculate-meta-signals.js` behavior) |
| Gap ledger | Empty (no gaps recorded) | No assumption of problems |
| Fact events | Empty (no events recorded) | No assumption of history |
| Worker metrics | No active workers | No assumption of fleet state |

**Design principle:** Health and resource signals fail-closed (block work). Operational signals fail-neutral (assume no problems). This prevents both unsafe dispatch and false alarm cascades.

---

## Consumer Contract

### What Consumers MAY Read

| Consumer | Signals Read | Purpose |
|----------|-------------|---------|
| **Planning loop** (`plan-next-batch.ps1`) | Meta signals, gap ledger | Risk-aware task prioritization |
| **Launch gate** (`check-launch-gate.ps1`) | Health state, resource health | Block/allow worker dispatch |
| **Self-cycle runner** | Health state, heartbeat, gap ledger | Gate the automated cycle |
| **Agent workers** | Health state (via context bundle) | Understand main branch safety |
| **WebUI Planning Console** | All signals via planning console state emitter | Dashboard display |
| **Meta-signal task suggestions** | Meta signals | Rank follow-up tasks |
| **State reconciler** | Heartbeat, fact events, gap ledger | Detect drift |

### What Consumers MUST NOT Do

1. **Read raw log files** outside `.github/ai-state/`. Runtime logs, `llm_io_logs/`, and process output are not signal sources.
2. **Trust signal values from stale files** without re-validating freshness.
3. **Propagate unredacted strings** from signals into PR bodies, issue comments, or context bundles.
4. **Assume signal completeness.** A missing file is a valid state, not an error.

### Schema Version Negotiation

Each signal source carries a version field. Consumers MUST:

1. Check the version field before processing.
2. If the version is unrecognized, treat the signal as missing (safe skeleton).
3. Never hard-fail on an unknown version — log and fall back gracefully.

| Source | Version Field | Current Version |
|--------|--------------|-----------------|
| Health state | `markerVersion` | 1 |
| Heartbeat | `snapshotVersion` | 1 |
| Resource health | `schemaVersion` | 1 |
| Meta signals | `snapshotVersion` | 1 |
| Gap ledger | `entryVersion` | 1 |
| Fact events | `eventVersion` | 1 |

---

## Implementation Status

| Signal | Source Exists | Intake Wired | Planning Consumes | Status |
|--------|:------------:|:------------:|:-----------------:|--------|
| Health state | Done | Done | Done (launch gate, runner) | **Operational** |
| Heartbeat | Done | Done | Done (state reconciler, meta-signals) | **Operational** |
| Gap ledger | Done | Done | Done (meta-signals calculator) | **Operational** |
| Fact events | Done | Done | Partial (context bundles) | **Operational** |
| Resource health | Done | Done | Done (launch gate) | **Operational** |
| Meta signals | Done | Done | Partial (task suggestions, not planning loop) | **Operational** |
| Worker metrics | Defined | Pending | Pending | **Schema defined, collector not wired** |

### Gaps

1. **Planning loop is signal-blind.** `plan-next-batch.ps1` does not read meta-signals or gap ledger entries. It operates purely on issue metadata. The meta-signal task suggestions script produces suggestions separately but does not feed back into planning.

2. **No unified intake layer.** Each consumer reads source files directly. There is no shared intake module that applies validation, staleness, and redaction uniformly.

3. **Worker metrics collector not implemented.** The schema is defined in [worker-monitoring-metrics.md](worker-monitoring-metrics.md) but no script produces metric rows.

4. **Telemetry budget is advisory.** Token/cost fields defined in [telemetry-budget-policy.md](telemetry-budget-policy.md) are not wired into the task or heartbeat schemas.

---

## References

- [health-state-schema.md](health-state-schema.md) — Main branch health JSON schema.
- [worker-heartbeat.md](worker-heartbeat.md) — Heartbeat monitor and state machine.
- [gap-ledger.md](gap-ledger.md) — Gap event ledger.
- [fact-event-ledger.md](fact-event-ledger.md) — Fact event ledger.
- [local-resource-health-schema.md](local-resource-health-schema.md) — Resource health schema.
- [meta-signals.md](meta-signals.md) — Meta signals calculator.
- [worker-monitoring-metrics.md](worker-monitoring-metrics.md) — Worker metrics contract.
- [failure-taxonomy.md](failure-taxonomy.md) — Health failure classification.
- [telemetry-budget-policy.md](telemetry-budget-policy.md) — Budget limits and cost policy.
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions.
- [launch-gate.md](launch-gate.md) — Launch gate validation.
- [planning-loop.md](planning-loop.md) — Batch planning loop.
- [loop-model.md](loop-model.md) — Self-cycle runner model.
- [docs-authority-map.md](docs-authority-map.md) — Folder authority rules.
