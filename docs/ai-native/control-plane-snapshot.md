---
owner: ai-native
status: current
topic: control-plane-snapshot
authority: governance
lastReviewed: 2026-05-15
---

# Control Plane Snapshot

The control plane reads many state projections from `.github/ai-state/`. Those
reads were previously duplicated across Command Steward, WebUI, launch planning,
and monitoring scripts.

`scripts/ai/lib/control-plane/snapshot.js` is the shared read model for this
state surface.

## Purpose

The snapshot gives control-plane consumers one normalized view of:

- main health
- provider pool capacity
- local resource capacity
- active worker state
- launch candidates
- worker telemetry presence
- concurrency blockers
- issue pool top-up pressure

Consumers should prefer this module when they need to answer:

```text
What is the current control-plane state?
How many workers were requested and effectively allowed?
Is concurrency blocked, and why?
Is the issue pool large enough for the requested worker wave?
```

## Current Consumers

- `scripts/ai/emit-command-steward-brief.js`
- `scripts/ai/emit-control-plane-dashboard-state.js`
- `scripts/ai/emit-command-steward-status-bundle.js`
- `scripts/ai/emit-command-steward-autonomy-readiness.js`
- `scripts/ai/emit-codex-exit-readiness.js`
- `scripts/ai/detect-codex-owned-duties.js`

## Intended Consumers

- WebUI dashboard state emitter
- launch controller
- self-cycle runner
- adaptive concurrency planner
- issue producer

## Rule

One fact should be loaded once, normalized once, then reused.

Avoid adding new direct reads of `.github/ai-state/*.json` when the value belongs
in the shared control-plane snapshot.

## Agent-First Entry Principle

The first decision surface must be an agent-facing state projection, not a tool
handler.

Tools may execute an approved action, but they must not intercept the first
intent, decide the work, or hide facts from the agent layer. The intended flow is:

```text
Human intent or autonomous tick
  -> Command Steward / agent state interpretation
  -> shared control-plane snapshot
  -> recommendation or task proposal
  -> tool adapter preview / execute
  -> fact and ledger writeback
```

This keeps the system agent-led instead of script-led. WebUI actions, PowerShell
commands, and local utilities are adapters behind the agent-facing control
plane.

## Non-Goals

The snapshot does not mutate state, launch workers, merge PRs, close issues, or
classify runtime backend behavior. It is a read-only projection layer.
