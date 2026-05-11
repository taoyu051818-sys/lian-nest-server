# Merge Result Fact Projection

Describes how merge manifests, PR state, issue labels, and main health
produce machine-readable facts that feed the next iteration of the
self-cycle loop.

> **Closes:** [#467](https://github.com/taoyu051818-sys/lian-nest-server/issues/467)

---

## Overview

After a merge batch completes, four data sources emit structured facts
that the orchestrator, planning loop, and state reconciler consume to
decide what happens next. Each source is an idempotent snapshot or
append-only record — no source rewrites history.

```
┌──────────────────┐   ┌──────────────────┐
│  merge manifest  │   │  PR state (gh)   │
│  .ai/merge-      │   │  open/merged/    │
│  batch-manifests/│   │  closed          │
└────────┬─────────┘   └────────┬─────────┘
         │                      │
         ▼                      ▼
┌──────────────────────────────────────────┐
│         fact event ledger                │
│  .github/ai-state/fact-events.ndjson     │
│         + meta-signals                   │
│  .github/ai-state/meta-signals.json      │
└──────────────────────────────────────────┘
         ▲                      ▲
         │                      │
┌────────┴─────────┐   ┌───────┴──────────┐
│  issue labels    │   │  main health     │
│  agent:* / type  │   │  .github/ai-     │
│  / priority      │   │  state/main-     │
│                  │   │  health.json     │
└──────────────────┘   └──────────────────┘
```

---

## Fact Sources

### 1. Merge Manifests

| Aspect | Detail |
|--------|--------|
| Location | `.ai/merge-batch-manifests/merge-batch-<timestamp>.json` |
| Writer | `merge-clean-pr-batch.ps1` |
| Schema | `schemas/merge-manifest.schema.json` |
| Mode | Snapshot per batch run (idempotent) |

Each manifest records the full outcome of one merge batch:

| Fact | Field | Next-loop use |
|------|-------|---------------|
| Which PRs merged | `prs[].status` | Update issue labels, close issues |
| Which PRs failed | `prs[].status == "failed"` | Re-queue or flag for review |
| Commit range | `preCommit`, `postCommit` | Health gate anchor, rollback target |
| Health gate outcome | `healthGate` | Decide launch permissions |
| Blocked PRs | `blockedPrs[]` | Identify guard violations for next wave |
| Abort reason | `failureReason` | Root-cause analysis |

**Example: feeding the next loop from a manifest**

```jsonc
// merge-batch-20260511-173000.json
{
  "mode": "execute",
  "prs": [
    { "number": 42, "title": "feat: add TagsModule", "status": "merged" },
    { "number": 45, "title": "docs: update SOP", "status": "merged" }
  ],
  "preCommit": "abc1234def5678",
  "postCommit": "9876fedcba4321",
  "healthGate": "pass",
  "blockedPrs": []
}
// Facts produced:
//   - #42 and #45 are resolved → close issues, remove agent:done
//   - main moved from abc1234 to 9876fed → health gate runs against 9876fed
//   - healthGate: pass → green state, all worker types may launch
```

---

### 2. PR State

| Aspect | Detail |
|--------|--------|
| Source | GitHub API (`gh pr view`) |
| Reader | state-reconciler, merge queue assistant, health gate |
| Refresh | On-demand per loop iteration |

PR state is the GitHub-hosted record of each pull request's lifecycle.
The orchestrator reads it to detect drift between what the manifest says
and what GitHub shows.

| Fact | Query | Next-loop use |
|------|-------|---------------|
| Merged | `state == MERGED` | Confirm manifest accuracy |
| Closed without merge | `state == CLOSED` | Detect abandoned work |
| Mergeable | `mergeable == MERGEABLE` | Pre-merge eligibility |
| Review decision | `reviewDecision == APPROVED` | Gate merge approval |
| Conflict | `mergeable == CONFLICTING` | Block merge, request rebase |
| Status checks | `statusCheckRollup` | Detect flaky or broken CI |

**Precedence rule:** when PR state conflicts with a manifest, PR state
is authoritative. The manifest is a point-in-time snapshot; GitHub is
the live record.

---

### 3. Issue Labels

| Aspect | Detail |
|--------|--------|
| Source | GitHub API (`gh issue view`) |
| Writer | result publisher (`-StatusLabel`), orchestrator, pm-gate |
| Schema | Convention-based (no formal schema) |

Labels encode issue lifecycle state and classification. Three label
families produce facts for the next loop:

#### Agent Labels (lifecycle state)

| Label | Fact produced | Next-loop use |
|-------|---------------|---------------|
| `agent:queued` | Issue is waiting for a worker | Include in next batch planning |
| `agent:running` | Worker is active | Check heartbeat, detect stale |
| `agent:blocked` | Worker hit a blocker | Exclude from batch, investigate |
| `agent:done` | Worker completed, PR opened | Verify PR exists, run review gate |

#### Type Labels (work classification)

| Label | Fact produced | Next-loop use |
|-------|---------------|---------------|
| `type:feature` | New functionality | Risk policy: high if touches `src/**` |
| `type:bug` | Defect fix | May qualify for fast-track merge |
| `type:docs` | Documentation only | Always low-risk, green/yellow allowed |
| `type:infra` | Build/CI/tooling | Risk policy: high for infra scripts |
| `type:migration` | Legacy parity | Requires migration-auditor review |

#### Priority Labels (scheduling)

| Label | Fact produced | Next-loop use |
|-------|---------------|---------------|
| `priority:critical` | Blocks other work | First in batch queue |
| `priority:high` | Current wave | Included in active batch |
| `priority:medium` | Next wave | Deferred until current wave closes |
| `priority:low` | Backlog | Excluded from automated batching |

**Label transitions after merge:**

```
agent:done  →  (PR merged)  →  agent:done removed, issue closed
agent:done  →  (PR closed)  →  agent:queued (re-queued)
agent:running  →  (heartbeat stale)  →  agent:blocked
```

---

### 4. Main Health

| Aspect | Detail |
|--------|--------|
| Location | `.github/ai-state/main-health.json` |
| Writer | `write-main-health-state.ps1` |
| Schema | `schemas/health-state.schema.json` |
| Mode | Snapshot per health gate run (overwrites) |

The health marker is the single source of truth for whether main is
safe for automated work. Every merge batch either confirms the existing
state or transitions it.

| Health state | Fact produced | Next-loop use |
|--------------|---------------|---------------|
| `green` | All checks pass | All worker types may launch |
| `yellow` | Non-critical failure | Only fix-only, docs, health-repair, research |
| `red` | Critical failure | Only foundation-fix and health-repair |
| `black` | Unrecoverable | Manual intervention required |

**Fields consumed by the next loop:**

| Field | Consumer | Purpose |
|-------|----------|---------|
| `state` | Launch gate, self-cycle runner | Permit/block worker dispatch |
| `allowedWorkerClasses` | Launch gate | Filter which tasks may run |
| `failedChecks` | Follow-up creator | Generate recovery issues |
| `failureClassifications` | Meta-signals, planning loop | Score failure severity |
| `commitSha` | Health gate, merge scripts | Anchor state to a specific commit |
| `capturedAt` | Monitoring | Detect stale markers |

---

## Fact Flow Into the Next Loop

Each loop iteration reads facts from all four sources in this order:

```
1. Read main health          →  determine allowed worker types
2. Read issue labels         →  build candidate queue (agent:queued, priority)
3. Read merge manifests      →  confirm resolved issues, detect partial batches
4. Read PR state             →  reconcile drift, verify merge outcomes
        │
        ▼
5. State reconciler          →  compare heartbeats vs PR/label state
6. Meta-signals calculator   →  score failure, friction, risk, trust
7. Planning loop             →  rank candidates by risk and priority
8. Launch gate               →  validate each candidate against health + conflict groups
9. Batch launcher            →  dispatch approved workers
```

### State Reconciler Input

The reconciler compares three evidence sources:

| Priority | Source | Example fact |
|----------|--------|--------------|
| 1 (highest) | Worker heartbeat | `state: "done"`, `exitCode: 0` |
| 2 | PR state | `state: MERGED` |
| 3 (lowest) | Issue labels | `agent:running` |

When sources disagree, the reconciler produces a drift report with
suggested label transitions. For example: heartbeat says `done` but
issue still has `agent:running` → suggest transition to `agent:done`.

### Meta-Signals Input

The meta-signals calculator aggregates merge results into scores:

| Signal | Derived from |
|--------|-------------|
| `failureScore` | Health gate failures from merge manifests and main health |
| `frictionScore` | Stale workers detected from heartbeat vs PR state |
| `trust` | Inverse of failure + friction |
| `topPain` | Most frequent failure category from `failureClassifications` |

### Planning Loop Input

The planner uses meta-signals and issue labels to rank candidates:

| Factor | Source | Effect |
|--------|--------|--------|
| Priority label | Issue labels | `critical` issues ranked first |
| Risk level | Task JSON + merge manifest history | High-risk tasks deferred in yellow/red |
| Conflict group | Task JSON | Prevents concurrent work on same area |
| Recent failures | Meta-signals | Avoids re-launching into known-broken areas |
| Health state | Main health | Filters by `allowedWorkerClasses` |

---

## Recording Facts to the Ledger

Merge-related facts are appended to the fact event ledger
(`.github/ai-state/fact-events.ndjson`) as discrete events:

| Event type | When | Key facts |
|------------|------|-----------|
| `merge.complete` | PR successfully merged | PR number, commit SHA, batch ID |
| `merge.conflict` | PR has merge conflicts | PR number, conflict status |
| `merge.batch` | Batch run finished | Batch ID, PR count, health gate result |
| `health.green` | Health gate passed | Commit SHA, checks evaluated |
| `health.red` | Health gate failed | Failed checks, failure category |
| `worker.complete` | Worker finished | Exit code, elapsed time, issue number |
| `worker.stale` | Worker heartbeat stale | No-output duration, issue number |

All events are sanitized before writing — no tokens, credentials, or
raw log content is recorded. See [fact-event-ledger.md](fact-event-ledger.md)
for the event schema and sanitization rules.

---

## Downstream Consumers

| Consumer | Facts consumed | Output |
|----------|---------------|--------|
| **Launch gate** | Health state, issue labels | Per-task pass/block verdict |
| **Self-cycle runner** | All four sources | Loop orchestration decisions |
| **State reconciler** | PR state, issue labels, heartbeats | Drift report |
| **Meta-signals** | Health failures, heartbeats | Score snapshot |
| **Planning loop** | Meta-signals, issue labels | Ranked candidate list |
| **Follow-up creator** | Failed checks, blocked PRs | Recovery issue proposals |
| **Monitoring** | Health marker timestamps | Stale-state alerts |

---

## Design Decisions

- **Four independent sources, not one unified store.** Each source has
  a different write pattern (snapshot vs append-only vs API-hosted).
  Forcing them into one store would couple unrelated lifecycles.
- **Manifests are point-in-time snapshots.** They record what happened
  during one batch run. PR state (GitHub) is authoritative when they
  diverge.
- **Labels are convention, not schema.** The `agent:*`, `type:*`, and
  `priority:*` families are enforced by convention and the result
  publisher's `-StatusLabel` parameter. No formal schema exists because
  labels are a GitHub primitive, not a local file.
- **Health state overwrites, not appends.** The main health marker is
  always the latest snapshot. History is preserved in the fact event
  ledger, not in the marker file itself.
- **No secrets in facts.** All four sources are designed to contain only
  control-plane metadata. The fact event ledger applies additional
  sanitization before writing.

---

## References

- [merge-manifest-schema.md](merge-manifest-schema.md) — Manifest field definitions and examples
- [merge-manifest-writer.md](merge-manifest-writer.md) — Manifest write behavior
- [controlled-auto-merge.md](controlled-auto-merge.md) — Batch merge script and manifest production
- [merge-closure-sop.md](merge-closure-sop.md) — Post-merge procedure
- [main-health-policy.md](main-health-policy.md) — Health states and worker permissions
- [health-state-schema.md](health-state-schema.md) — Health marker JSON schema
- [fact-event-ledger.md](fact-event-ledger.md) — Append-only fact ledger
- [meta-signals.md](meta-signals.md) — Aggregated planning signals
- [issue-lifecycle.md](issue-lifecycle.md) — Issue states and labels
- [loop-model.md](loop-model.md) — Self-cycle loop phases
- [state-reconciler.md](state-reconciler.md) — Drift detection
- [result-publishing.md](result-publishing.md) — Label transitions after worker completion
