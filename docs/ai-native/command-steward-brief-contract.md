# Command Steward Brief Contract

Defines the fields, fact sources, fallback behavior, and
verification rules for the Command Steward daily brief and
WebUI status brief.

> **Closes:** [#1152](https://github.com/taoyu051818-sys/lian-nest-server/issues/1152)
>
> **See also:**
> [command-steward-agent.md](command-steward-agent.md) for the
> agent definition and daily brief workflow,
> [webui-command-steward-console.md](webui-command-steward-console.md)
> for the WebUI status brief layout.

---

## Purpose

The Command Steward brief is a read-only system health snapshot.
It has two surfaces:

1. **Daily brief** — a structured text summary produced at session
   start or on human request. Follows the seven-step workflow in
   [command-steward-agent.md § Daily Brief](command-steward-agent.md#1-daily-brief).
2. **Status brief** — a WebUI dashboard panel in the Command Steward
   console. Follows the layout in
   [webui-command-steward-console.md § Status Brief](webui-command-steward-console.md#section-1-status-brief).

Both surfaces read from the same fact sources. Neither surface
produces mutations or requires confirmation.

---

## Field Table

| # | Field | Type | Fact Source | Source Type | Description |
|---|-------|------|-------------|-------------|-------------|
| 1 | Health State | `green \| yellow \| red \| black` | `.github/ai-state/main-health.json` → `state` | State file | Main branch health classification |
| 2 | Health Checks | string list | `.github/ai-state/main-health.json` → `checks` | State file | Checks evaluated in the last health gate run |
| 3 | Health Failed Checks | string list | `.github/ai-state/main-health.json` → `failedChecks` | State file | Checks that failed (empty when green) |
| 4 | Health Reason | string | `.github/ai-state/main-health.json` → `reason` | State file | Human-readable reason for non-green state |
| 5 | Active Workers | number | `.claude/worktrees/` directory scan | Filesystem | Count of active worktrees |
| 6 | Worker Status | object | `.claude/worktrees/` directory scan | Filesystem | Per-worker state (active, stale, cooling) |
| 7 | Stale Worktrees | worktree list | `.claude/worktrees/` directory scan | Filesystem | Worktrees with no progress for > 2 hours |
| 8 | Merge Queue Depth | number | `.ai/merge-queue.json` | State file | Total queued PRs |
| 9 | Merge Queue Breakdown | object | `.ai/merge-queue-state.json` | State file | Pending, processed, and failed counts |
| 10 | Open Issues by Label | count map | GitHub API via `gh issue list` | GitHub | Issue counts grouped by label |
| 11 | Open Issues by Priority | count map | GitHub API via `gh issue list` | GitHub | Issue counts grouped by priority label |
| 12 | Blocked Gates | gate list | Launch gate + health gate cross-reference | Computed | Gates currently blocking worker dispatch |
| 13 | Providers (WebUI) | object | `GET /api/state` → `global` | API | Available vs. total providers, exhausted count |
| 14 | Queue (WebUI) | object | `GET /api/queue` | API | Pending count, blocked-by-exhaustion, blocked-by-conflict |
| 15 | Trust Score (WebUI) | number 0–100 | `GET /api/state` → `actionReadiness` | API | Current trust level for action gating |
| 16 | Pressure (WebUI) | `normal \| elevated \| critical` | `GET /api/state` → computed | API | Utilization level derived from provider/worker load |
| 17 | Governance | object | Computed from brief fields | Computed | Facts, recommendations, and human-required items separated for agent consumption |

---

## Fact Source Types

| Type | Trust Level | Notes |
|------|-------------|-------|
| **State file** | Gate-verified | Written by an automated script after a gate passes. Schema-enforced. |
| **Filesystem** | Observable | Direct scan of `.claude/worktrees/`. Reflects actual disk state. |
| **GitHub** | Authoritative | Read via `gh` CLI. Matches GitHub's source of truth. |
| **API** | Runtime | Served by the WebUI backend. May lag behind filesystem state by one poll cycle. |
| **Computed** | Derived | Calculated from other fields at read time. Not independently stored. |

---

## Worker Summaries Are Not Facts

Worker-generated summaries, status messages, or output logs are
**not** brief facts. They become facts only after one of these
verification events:

| Verification | What It Proves |
|--------------|----------------|
| Health gate pass (`post-merge-health-gate.js` exit 0) | Worker output compiles and passes checks |
| PR merge | Human approved the worker's changes |
| State file write (`write-main-health-state.ps1`) | Health state updated by an authorized script |
| Label reconciliation (`state-reconciler.ps1` exit 0) | Issue/PR/label state is consistent |

A worker claiming "task complete" in its output does not make
the health state green. Only the health gate does.

---

## Missing-File Fallback

When a fact source is absent or unreadable, the brief reports
the field as unknown and logs the fallback reason. The brief
never invents data to fill a gap.

| Missing Source | Field(s) Affected | Fallback Value | Escalation |
|----------------|-------------------|----------------|------------|
| `.github/ai-state/main-health.json` | Health State, Checks, Failed Checks, Reason | `unknown` | Treat as **red** for safety. Prompt operator to run health gate. |
| `.ai/merge-queue.json` | Merge Queue Depth | `unknown` | Report "merge queue state unavailable." |
| `.ai/merge-queue-state.json` | Merge Queue Breakdown | `unknown` | Report "merge queue tracking unavailable." |
| `.claude/worktrees/` directory | Active Workers, Worker Status, Stale Worktrees | `unknown` | Report "worktree scan unavailable." |
| GitHub API unreachable | Open Issues by Label, Open Issues by Priority | `unknown` | Report "GitHub API unavailable." |
| `GET /api/state` unreachable | Providers, Trust Score, Pressure | `unknown` | Report "WebUI API unavailable." |
| `GET /api/queue` unreachable | Queue (WebUI) | `unknown` | Report "WebUI queue API unavailable." |

### Safety Rule

When health state is `unknown`, the brief treats it as **red** for
all launch-permission decisions. This is the fail-safe default
from [main-health-policy.md](main-health-policy.md) — a missing
health marker means no launches until the gate is re-run.

---

## Validation

| Check | Command | Expected |
|-------|---------|----------|
| Docs consistency | `npm run check` | Exit 0 |

---

## Cross-References

- [Command Steward Agent](command-steward-agent.md) — Agent definition, daily brief workflow
- [WebUI Command Steward Console](webui-command-steward-console.md) — Status brief layout and color coding
- [Main Health Policy](main-health-policy.md) — Health states and launch permissions
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [Loop Model](loop-model.md) — Self-cycle runner phases
- [Codex Exit Readiness Gate](codex-exit-readiness-gate.md) — Gate verification requirements
