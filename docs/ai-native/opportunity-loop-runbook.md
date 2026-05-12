# Opportunity Loop Runbook

How the control plane detects evidence-backed opportunities, compiles them
into experiments (tasks/issues), and writes results back to close the loop.

> **Closes:** [#905](https://github.com/taoyu051818-sys/lian-nest-server/issues/905)
>
> **Cross-references:**
> [meta-signals.md](meta-signals.md) for aggregate health signals,
> [gap-ledger.md](gap-ledger.md) for gap event recording,
> [fact-event-ledger.md](fact-event-ledger.md) for observable fact storage,
> [planner-create-issues-mode.md](planner-create-issues-mode.md) for gap-to-issue
> proposals, [knowledge-update-writer.md](knowledge-update-writer.md) for
> post-merge knowledge capture,
> [loop-model.md](loop-model.md) for the self-cycle runner phases.

---

## Audience

Operators, orchestrators, and architects who need to understand how the
control plane turns observed evidence into actionable work and closes the
feedback cycle with structured results.

---

## Overview

The opportunity loop is the feedback cycle that connects three stages:

```
┌─────────────────────────────────────────────────────────────┐
│                    opportunity loop                          │
│                                                             │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐ │
│  │  1. Detect   │──▶│  2. Compile  │──▶│  3. Write Result │ │
│  │  (evidence)  │   │  (experiment)│   │  (close loop)    │ │
│  └──────┬──────┘   └──────────────┘   └────────┬─────────┘ │
│         │                                       │           │
│         └───────────────────────────────────────┘           │
│                    evidence feeds next cycle                 │
└─────────────────────────────────────────────────────────────┘
```

| Stage | Input | Output | Primary Script |
|-------|-------|--------|----------------|
| **Detect** | Fact events, gap ledger, meta-signals, health gate, heartbeats | Ranked opportunity list | `suggest-next-tasks-from-meta-signals.js` |
| **Compile** | Opportunity list, open issues, migration matrix | Task proposals or new issues | `plan-next-batch.ps1`, `compile-issue-to-task-json.ps1` |
| **Write Result** | Worker PR, validation evidence, knowledge gained | Structured comments, knowledge entries, fact events | `publish-agent-result.ps1`, `write-knowledge-update.ps1`, `write-fact-event.js` |

---

## Stage 1: Detect (Evidence-Backed Opportunity Detection)

Opportunities are derived from observable evidence, not speculation. The
control plane aggregates signals from multiple sources into a single
meta-signals snapshot.

### Evidence Sources

| Source | File | What It Captures |
|--------|------|------------------|
| Fact event ledger | `.github/ai-state/fact-events.ndjson` | Worker launches, health transitions, merges, provider events |
| Gap ledger | `.github/ai-state/gap-ledger.ndjson` | Worker failures, stale workers, health gate blocks, plan drift |
| Health gate | `.github/ai-state/main-health.json` | Main branch health state (green/yellow/red) |
| Worker heartbeats | `monitor-state.json` | Worker liveness, output silence, exit codes |
| Meta-signals | `.github/ai-state/meta-signals.json` | Aggregated failure, friction, risk, cost, trust scores |

### Detection Flow

```
fact-events.ndjson ──┐
gap-ledger.ndjson ───┤
health.json ─────────┼──▶ calculate-meta-signals.js ──▶ meta-signals.json
heartbeats ──────────┤                                            │
                     │                                            ▼
                     │                    suggest-next-tasks-from-meta-signals.js
                     │                                            │
                     │                                            ▼
                     │                               next-task-suggestions.json
                     │
                     └────────── stale-row detector ──── stale-row candidates
```

### Signal Thresholds

| Signal | Threshold | Opportunity Category | Action Hint |
|--------|-----------|---------------------|-------------|
| `failureScore > 0` | Any red-state health entry | `failure` | Investigate and fix failures in the top pain area |
| `frictionScore > 30` | Significant stale/silent workers | `friction` | Check worker heartbeats, restart hung processes |
| `riskScore > 40` | Elevated unresolved risk | `risk` | Address high-risk slices before proceeding |
| `trust < 50` | Combined failure+friction eroding confidence | `trust` | Pause new launches, recover health first |
| `cost > 30` | Worker-minutes accumulating | `cost` | Review whether tasks are scoped correctly |
| All healthy | No signals triggered | `health` | Safe to proceed with next batch |

### How to Run Detection

```powershell
# Compute meta-signals from logs
node scripts/ai/calculate-meta-signals.js --healthLog health.ndjson --heartbeatLog heartbeats.ndjson

# Generate task suggestions from meta-signals
node scripts/ai/suggest-next-tasks-from-meta-signals.js --stdout
```

### Stale-Row Detection

The planning loop also detects stale migration matrix rows as opportunities.
A row is stale when:

- `impl_pr` is set but status is still `CONTRACTED`
- `test_status` is `PASS` but status is below `PARITY_TESTED`
- Status is `IMPLEMENTED` for > 14 days with no `test_status` change
- Status is `PARITY_TESTED` but `shutdown_ready` is empty

Stale-row candidates sort **ahead** of normal implementation tasks.

---

## Stage 2: Compile (Experiment Compilation)

Detected opportunities must be compiled into actionable experiments — either
task proposals for existing issues or new issue proposals for gaps.

### Path A: Existing Issues (Batch Planning)

When open issues exist that match the detected opportunity:

```
open issues (gh issue list)
        │
        ▼
plan-next-batch.ps1           (parse CONTROL APPENDIX, check readiness)
        │
        ▼
check-duplicate-route-tasks.js (detect overlapping routes)
        │
        ▼
proposed batch                 (prioritized, conflict-grouped)
        │
        ▼
compile-issue-to-task-json.ps1 (emit task JSON contracts)
        │
        ▼
check-launch-gate.ps1          (validate against health policy)
        │
        ▼
batch-launch.ps1               (dispatch workers)
```

### Path B: Gap-to-Issue (Create-Issues Mode)

When no existing issues cover the detected gap:

```
gap-ledger.ndjson
        │
        ▼
plan-next-batch.ps1 -CreateIssues   (gap analysis → issue proposals)
        │
        ▼
operator reviews proposals
        │
        ▼
gh issue create -Write              (explicit human action)
        │
        ▼
plan-next-batch.ps1                  (discovers new issues in next cycle)
```

### Deduplication

Before proposing a new issue, the create-issues mode checks existing open
issues for matching `gapKey` values. A gap is skipped when an open issue
already covers it.

### Compilation Checklist

Before launching a compiled experiment, verify:

| Check | Command | Pass Condition |
|-------|---------|----------------|
| Health is green | `node scripts/post-merge-health-gate.js --quick` | Exit 0 |
| No conflict group collision | `node scripts/ai/check-duplicate-route-tasks.js --repo owner/name` | Exit 0 |
| Launch gate passes | `./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/issue-<N>.json` | Exit 0, no blocks |
| Provider capacity | `cat .github/ai-state/provider-pool.json` | At least one available with headroom > 0 |

---

## Stage 3: Write Result (Closing the Loop)

After a worker completes, the result must be written back as structured
evidence to feed future detection cycles. Three write targets exist.

### 3a. Result Comment (publish-agent-result.ps1)

Posts a structured summary to the GitHub issue or PR.

```powershell
./scripts/ai/publish-agent-result.ps1 `
    -Repo "owner/name" `
    -TargetIssue 905 `
    -Kind execution `
    -Summary "PASS - all checks green" `
    -Body "Added opportunity loop runbook." `
    -MarkerId "issue-905-exec" `
    -StatusLabel "agent:done"
```

Result kinds: `execution`, `review`, `audit`, `metrics`.

### 3b. Knowledge Entry (write-knowledge-update.ps1)

Records structured knowledge gained from the work.

```powershell
./scripts/ai/write-knowledge-update.ps1 `
    -Category docs `
    -Summary "Opportunity loop runbook defines 3-stage detect-compile-write cycle" `
    -IssueNumber 905 `
    -Write
```

Categories: `migration`, `architecture`, `policy`, `test`, `docs`,
`infrastructure`, `security`, `performance`.

### 3c. Fact Event (write-fact-event.js)

Records an observable fact in the append-only ledger.

```bash
node scripts/ai/write-fact-event.js \
  --type worker.complete \
  --subject "issue #905" \
  --live \
  --actor "batch-launcher" \
  --facts '{"pr":910,"exitCode":0}'
```

### What NOT to Write

| Content | Why Not |
|---------|---------|
| Raw LLM transcripts | Contains secrets and unstructured noise |
| Raw stdout/stderr | Not sanitized, may leak tokens |
| `.env` contents | Secrets |
| Full PR diffs | Available via `gh pr diff`; no need to duplicate |

---

## Complete Loop Example

A full opportunity loop cycle from detection to closure:

```
1. DETECT
   $ node scripts/ai/calculate-meta-signals.js
   → failureScore: 25, topPain: "runtime compile"

   $ node scripts/ai/suggest-next-tasks-from-meta-signals.js --stdout
   → suggestion: "Investigate failures in runtime compile" (priority: high)

2. COMPILE
   $ ./scripts/ai/plan-next-batch.ps1 -Repo owner/name
   → proposes issue #412 (runtime compile fix, risk: low)

   $ ./scripts/ai/compile-issue-to-task-json.ps1 -IssueFile ./tasks/issue-412.json
   → emits task contract

   $ ./scripts/ai/check-launch-gate.ps1 -TaskFile ./tasks/issue-412.json
   → exit 0, launch allowed

   $ ./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/issue-412.json
   → worker dispatched

3. WRITE RESULT
   $ ./scripts/ai/publish-agent-result.ps1 -TargetIssue 412 -Kind execution -Summary "PASS" -MarkerId "issue-412-exec" -StatusLabel "agent:done"
   → result comment posted

   $ ./scripts/ai/write-knowledge-update.ps1 -Category infrastructure -Summary "Runtime compile failure was caused by missing type export" -IssueNumber 412 -Write
   → knowledge recorded

   $ node scripts/ai/write-fact-event.js --type worker.complete --subject "issue #412" --live
   → fact event appended

4. NEXT CYCLE
   The knowledge entry and fact event are now available as evidence
   for the next detection pass.
```

---

## Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Meta-signals file missing | `suggest-next-tasks-from-meta-signals.js` produces safe skeleton (all zeros, trust=100) | Run `calculate-meta-signals.js` to regenerate |
| Gap ledger empty | Create-issues mode finds no gaps | Normal when system is healthy; check fact events for unrecorded gaps |
| Dedup misses a gap | Two issues filed for same gapKey | Close the duplicate manually; check gapKey generation |
| Knowledge entry lost | Context bundle missing recent knowledge | Re-run `write-knowledge-update.ps1` with `-Write` |
| Fact event write fails | Script exits non-zero | Check file permissions on `.github/ai-state/`; retry |

---

## Key Files

| Path | Purpose |
|------|---------|
| `.github/ai-state/meta-signals.json` | Aggregated health signals snapshot |
| `.github/ai-state/next-task-suggestions.json` | Ranked opportunity suggestions |
| `.github/ai-state/fact-events.ndjson` | Append-only observable fact ledger |
| `.github/ai-state/gap-ledger.ndjson` | Append-only gap event ledger |
| `.github/ai-state/knowledge-updates.ndjson` | Append-only knowledge entries |
| `.github/ai-state/main-health.json` | Current health state marker |

---

## Scripts

| Script | Stage | Purpose |
|--------|-------|---------|
| `calculate-meta-signals.js` | Detect | Aggregate signals from logs into snapshot |
| `suggest-next-tasks-from-meta-signals.js` | Detect | Generate ranked suggestions from signals |
| `plan-next-batch.ps1` | Compile | Propose batch from open issues |
| `plan-next-batch.ps1 -CreateIssues` | Compile | Propose new issues from gaps |
| `check-duplicate-route-tasks.js` | Compile | Detect overlapping route conflicts |
| `compile-issue-to-task-json.ps1` | Compile | Emit task JSON contracts |
| `check-launch-gate.ps1` | Compile | Validate against health/resource policy |
| `publish-agent-result.ps1` | Write | Post structured result comments |
| `write-knowledge-update.ps1` | Write | Record knowledge from merged work |
| `write-fact-event.js` | Write | Append observable facts to ledger |

---

## References

- [Meta Signals](meta-signals.md) — Aggregate signal calculator
- [Meta-Signal Task Suggestions](meta-signal-task-suggestions.md) — Suggestion engine
- [Gap Ledger](gap-ledger.md) — Gap event recording
- [Fact Event Ledger](fact-event-ledger.md) — Observable fact storage
- [Knowledge Update Writer](knowledge-update-writer.md) — Post-merge knowledge capture
- [Planner Create-Issues Mode](planner-create-issues-mode.md) — Gap-to-issue proposals
- [Planning Loop](planning-loop.md) — Batch planning with readiness checks
- [Loop Model](loop-model.md) — Self-cycle runner phases
- [Result Publishing](result-publishing.md) — Structured result comments
- [Context Bundles](context-bundles.md) — Worker context generation
