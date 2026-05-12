# Command Steward State-to-Action Decision Table

Defines how the Command Steward Agent converts observed system state
into recommended actions. Every row is a deterministic mapping: given
the state inputs, the Steward proposes exactly one action (or explicitly
no action). All mutating actions require human confirmation before
execution.

> **Closes:** [#1153](https://github.com/taoyu051818-sys/lian-nest-server/issues/1153)
>
> **See also:**
> [command-steward-agent.md](command-steward-agent.md) for role
> definition and authority boundaries,
> [webui-command-steward-console.md](webui-command-steward-console.md)
> for console rendering of these decisions,
> [main-health-policy.md](main-health-policy.md) for health state
> definitions and worker launch permissions.

---

## Decision Inputs

The Steward reads these signals to determine the current state:

| Input | Source | Values |
|-------|--------|--------|
| Health state | `.github/ai-state/main-health.json` | `green`, `yellow`, `red`, `black` |
| Active workers | `.claude/worktrees/` + heartbeat | Count, status (active / stale / cooling) |
| Open PR backlog | GitHub API | PR count, check status, mergeability |
| Merge queue | `.ai/merge-queue.json` | Pending entries, depth |
| Issue queue | GitHub API | Open issues by label (`agent:ready`, `agent:done`, `blocked`) |
| Provider pool | `/api/state` → `providers` | Available / exhausted / disabled count |
| Trust score | `/api/state` → `actionReadiness` | 0-100 |

---

## Primary Decision Table

Rows are evaluated top-to-bottom. The first matching row wins.

| # | Health | Queue / PR State | Workers | Recommended Action | Risk | Confirmation | Notes |
|---|--------|-----------------|---------|-------------------|------|-------------|-------|
| 1 | **black** | any | any | **No action — escalate to human** | — | — | System halted. Steward surfaces black-state notice and waits for human recovery. |
| 2 | **red** | any | any active non-recovery | **Hold all non-recovery workers** | High | `HOLD` | Cancel or defer workers whose type is not `foundation-fix` or `health-gate-repair`. |
| 3 | **red** | any | none or only recovery | **Launch recovery worker** | High | `LAUNCH` | Dispatch foundation-fix or health-gate-repair worker. Requires human confirmation. |
| 4 | **yellow** | any | any runtime / refactor active | **Hold runtime/refactor workers** | High | `HOLD` | Yellow blocks runtime and refactor types per main-health-policy.md. |
| 5 | **yellow** | merge queue has pending PRs | any | **No action — block merges** | — | — | Merges require green health. Surface blocked-merge notice. |
| 6 | **yellow** | issues with `agent:ready` label, docs/test-only scope | permitted slots available | **Launch docs/test-only batch** | Medium | `LAUNCH` | Docs and test-only workers are permitted in yellow. |
| 7 | **green** | merge queue has pending PRs, PRs eligible | any | **Process merge queue** | High | `MERGE` | Present merge candidates for human review. Steward does not auto-merge. |
| 8 | **green** | issues with `agent:done` label, linked PRs merged | any | **Close done issues** | High | `CLOSE` | Verify linked PRs merged and validation evidence exists. |
| 9 | **green** | queue has ready tasks, providers available, no conflict | slots available | **Launch batch** | High | `LAUNCH` | Compile task JSON, preview batch, pause for human confirmation. |
| 10 | **green** | queue has ready tasks, providers exhausted | any | **Provider rotation** | High | `RETRY` | Exhausted providers blocking progress. Propose rotation. |
| 11 | **green** | queue has blocked tasks (conflict) | workers active | **No action — report conflict** | — | — | Conflict group collision. Surface conflicting task pairs. |
| 12 | **green** | no ready tasks, no pending PRs, no done issues | any healthy | **No action — system idle** | — | — | System is healthy and idle. No recommendation. |
| 13 | **green** | trust < 40 | any | **Export audit** | Low | Single click | Low trust score. Recommend operator reviews recent actions. |
| 14 | any | server unreachable | any | **No action — connection lost** | — | — | Surface connection error. No mutations possible. |

---

## No-Action Outcomes

The Steward explicitly proposes "no action" in these cases. It never
silently skips — every state produces a visible recommendation or
no-action notice.

| Condition | No-Action Rationale | UI Signal |
|-----------|-------------------|-----------|
| Health black | System halted; human must intervene at infrastructure level | Red banner: "System halted — black state" |
| Health red, no recovery task identifiable | Cannot determine correct recovery action | Yellow banner: "Red health — manual diagnosis needed" |
| Health yellow, no permitted worker types queued | Nothing to do within yellow constraints | Gray notice: "Yellow state — only docs/test workers permitted" |
| Green, all queues empty | Nothing to process | Green notice: "System idle — no actions needed" |
| Green, conflict blocks all ready tasks | Cannot launch until conflicts resolve | Yellow notice: "Conflicts blocking queue — resolve first" |
| Trust < 40, no audit to export | First session, no history | Gray notice: "Low trust — no audit history yet" |
| Server unreachable | Cannot read state | Red banner: "Connection lost — check server" |

---

## Human-Required Actions

These actions are always gated behind explicit human confirmation.
The Steward proposes and previews, but never executes autonomously.

| Action | Risk Level | Confirmation Phrase | Gate |
|--------|-----------|---------------------|------|
| Launch worker batch | High | `LAUNCH` | Health must be green (or yellow for permitted types). Conflict group check. |
| Merge PRs | High | `MERGE` | Health must be green. All PRs must pass eligibility + guards. |
| Close issues | High | `CLOSE` | All linked PRs merged. Validation evidence present. |
| Hold / cancel workers | High | `HOLD` | Health dropped. Steward proposes hold; human confirms which workers. |
| Provider rotation | High | `RETRY` | Providers exhausted. Human confirms rotation scope. |
| Kill stale worker | High | Worker ID | Worker stale > 5 min. Human confirms after checking worktree. |
| Override health gate | Critical | `OVERRIDE` + reason | Health misclassified. Requires justification. Full audit logged. |
| Architecture change | Critical | `ARCHITECTURE` + reviewers | Routes to architect + repo-owner. Steward does not execute. |

---

## State Transition Triggers

The Steward re-evaluates the decision table when these events occur:

| Event | Source | Effect |
|-------|--------|--------|
| Health gate completes | `post-merge-health-gate.js` | Health state changes; re-evaluate all rows |
| Worker exits | Process exit or heartbeat timeout | Worker count changes; may open launch slots |
| PR merged | GitHub webhook or merge script | Queue depth changes; health may shift |
| Issue labeled | GitHub API | New `agent:ready` or `agent:done` changes queue |
| Provider state changes | Provider pool health check | Available capacity changes |
| Merge queue updated | `.ai/merge-queue.json` write | New merge candidates surfaced |
| Trust score changes | Action audit aggregation | Low trust may trigger audit recommendation |

---

## Conflict Resolution

When multiple rows could match, the Steward uses these tiebreakers:

1. **Health severity wins.** Black > red > yellow > green. A worse
   health state always takes priority over queue-level actions.
2. **Recovery before feature.** In red state, recovery workers launch
   before any feature work resumes.
3. **Merge before launch.** In green state, clearing the merge queue
   takes priority over launching new workers (frees capacity).
4. **Close before launch.** Closing done issues is cheap and reduces
   queue noise before new dispatch.

---

## Boundary Enforcement

The decision table respects these hard boundaries from the
[Seed Constitution](seed-constitution.md) and
[command-steward-agent.md](command-steward-agent.md):

| Boundary | Enforcement |
|----------|-------------|
| Seed Constitution files | Steward never proposes modifications |
| High-risk files (`src/**`, `prisma/**`, `.env`) | Worker `allowedFiles` enforced; Steward does not broaden |
| Policy files (`.github/ai-policy/**`) | Read-only; changes routed through issues |
| Guard scripts | Invoked as-is; never modified by Steward |
| Architecture changes | Routed to architect + repo-owner; Steward does not execute |
| Self-referential changes | Blocked immediately; escalated to Constitutional Owner |

---

## Cross-References

- [Command Steward Agent](command-steward-agent.md) — Role definition, authority, workflows
- [WebUI Command Steward Console](webui-command-steward-console.md) — Console rendering and UI signals
- [Main Health Policy](main-health-policy.md) — Health states and worker type permissions
- [Launch Gate](launch-gate.md) — Pre-launch validation
- [Loop Model](loop-model.md) — Self-cycle runner phases
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
- [Codex Exit Readiness Gate](codex-exit-readiness-gate.md) — Gate decision rules
- [Controlled Auto-Merge](controlled-auto-merge.md) — Merge safety and guard integration
