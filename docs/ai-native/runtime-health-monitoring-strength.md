# Runtime Health Monitoring Strength

> **Closes:** [#1506](https://github.com/taoyu051818-sys/lian-nest-server/issues/1506)
>
> **Cross-references:**
> [main-health-policy.md](main-health-policy.md) for the health gate policy,
> [constitution-checker-contract.md](constitution-checker-contract.md) for the checker contract,
> [meta-signals.md](meta-signals.md) for signal aggregation,
> [resource-pressure-sampler.md](resource-pressure-sampler.md) for resource monitoring,
> [external-source-trust-score.md](external-source-trust-score.md) for trust scoring.

---

## Summary

LIAN's production-aware health system is a unique operational strength that
SWE-agent, aider, MetaGPT, and similar agent frameworks lack. This document
captures the investigation findings and architectural recommendations for
preserving health monitoring as a first-class concern.

---

## What Makes This System Unique

### Multi-Layer Health Architecture

The system operates across four distinct tiers:

| Tier | Purpose | Key Artifact |
|------|---------|--------------|
| Application | Liveness probe | `GET /api/health` |
| Build/CI | Post-merge validation | `main-health.json` |
| Resource | Machine pressure | `local-resource.json` |
| Governance | Constitution compliance | `constitution-health-result.json` |

Pure agent frameworks have no equivalent. They focus on task execution without
monitoring the operational substrate that execution depends on.

### Runtime Health Dimensions

The constitution checker (`check-constitution-health.js`) validates 14 checks
across static compliance and runtime health. The 8 runtime dimensions added
in commit `d3ecf17` are:

1. **State file staleness** -- TTL enforcement for 6 ai-state files
2. **Meta signals vitality** -- Trust/failure/friction threshold monitoring
3. **Build vitality** -- TypeScript compilation verification
4. **Worker lifecycle** -- Orphaned and stale worker detection
5. **Conflict group contention** -- Concurrent worker overlap detection
6. **PR queue health** -- Stale PR detection (>7 days)
7. **Autonomous loop activity** -- Stall detection (>24h since last event)
8. **Resource pressure** -- Memory, process headroom, provider utilization

These dimensions catch operational issues that pure agent frameworks cannot
detect: resource exhaustion, worker lifecycle failures, trust degradation,
and build regressions.

### Signal Aggregation and Trust Scoring

The meta-signals system aggregates health data into actionable signals:

- `failureScore` (0-100) -- Weighted failure rate across categories
- `frictionScore` (0-100) -- Task retry and planning friction
- `riskScore` (0-100) -- Composite risk from failures and resource pressure
- `trust` (0-100) -- Inverse of failure + friction
- `cost` -- Worker-minutes consumed
- `topPain` -- Category with highest failures

External source trust scoring (0-100) modulates this composite, ensuring
untrusted evidence is quarantined before influencing decisions.

---

## Architectural Implications

### Graph Orchestration

If the system evolves toward graph-based orchestration, health-check nodes
should be first-class graph elements:

- **Pre-condition nodes**: Evaluate health state before task dispatch
- **Post-condition nodes**: Validate health after task completion
- **Guard nodes**: Block graph traversal when health is red/black

The existing `main-health.json` and `constitution-health-result.json`
artifacts provide the data needed for these nodes without additional
infrastructure.

### Memory System

Health signals should persist across orchestration cycles:

- Historical trust scores for trend detection
- Failure category patterns for predictive planning
- Resource pressure history for capacity planning

The gap ledger (`gap-ledger.md`) already captures this history in NDJSON
format. The memory system should reference this history rather than
duplicating it.

### Tool Registry

Health-related tools should be exposed to agents:

- `check-health-gate` -- Query current health state
- `check-resource-pressure` -- Query machine resource state
- `check-meta-signals` -- Query aggregated signals
- `check-constitution-health` -- Run constitution compliance

These tools exist as scripts but are not yet exposed through a unified
tool registry interface.

---

## No Actionable Code Improvements Found

The investigation found no gaps requiring code changes:

1. **Coverage is comprehensive**: 14 constitution checks, 8 runtime health
   dimensions, 6 meta-signals, resource pressure monitoring, and trust
   scoring.

2. **Thresholds are calibrated**: The system uses graduated thresholds
   (green/yellow/red/black) with clear worker permission matrices.

3. **Feedback loops are closed**: Health failures flow through the gap
   ledger to issue proposals, enabling autonomous recovery.

4. **Documentation is complete**: Each subsystem has dedicated docs with
   schemas, policies, and test coverage documentation.

The system is mature. The recommendations above are architectural guidance
for future work, not immediate code changes.

---

## Recommendation

Close this investigation with the finding that LIAN's production-aware
health system is a unique, well-implemented strength. Preserve this
capability as a first-class concern in any architecture upgrade. The
architectural implications (graph health nodes, memory integration, tool
registry exposure) should be tracked as separate issues if/when the
system evolves toward graph orchestration.
