# Command Steward Daily Operating Loop

Defines the day-to-day operating loop that replaces Codex manual
orchestration. The Command Steward Agent drives each phase — brief,
plan preview, launch preview, PR merge preview, issue close preview,
and health writeback — with preview-first execution and human approval
at every gate.

> **Closes:** [#1264](https://github.com/taoyu051818-sys/lian-nest-server/issues/1264)
>
> **See also:**
> [command-steward-agent.md](command-steward-agent.md) for the
> agent definition and authority boundaries,
> [codex-retirement-runbook.md](codex-retirement-runbook.md) for the
> daily workflow under self-cycle and human-owned decisions,
> [loop-model.md](loop-model.md) for the self-cycle runner phases,
> [guarded-autopilot-execute-policy.md](guarded-autopilot-execute-policy.md)
> for the guarded execute preconditions,
> [control-skill-registry.md](control-skill-registry.md) for skill
> risk classification.

---

## Purpose

The daily operating loop is the concrete sequence the Command Steward
Agent follows each working session. It replaces the Codex orchestration
pattern where a human manually ran scripts in ad-hoc order. The loop
ensures:

1. **Preview before every mutation.** No side effects without a
   preceding preview.
2. **Human owns every decision.** The Steward proposes; the human
   confirms.
3. **Health writeback closes the loop.** Every cycle records state for
   the next cycle.

```
┌─────────────────────────────────────────────────────────────┐
│                   Command Steward Daily Loop                 │
│                                                             │
│  ┌─────────┐   ┌──────────────┐   ┌───────────────┐       │
│  │  Daily   │──▶│  Plan        │──▶│  Launch       │       │
│  │  Brief   │   │  Preview     │   │  Preview      │       │
│  └─────────┘   └──────────────┘   └───────┬───────┘       │
│       ▲                                     │               │
│       │                                     ▼               │
│  ┌─────────┐   ┌──────────────┐   ┌───────────────┐       │
│  │  Health  │◀──│  Issue Close │◀──│  PR Merge     │       │
│  │  Write-  │   │  Preview     │   │  Preview      │       │
│  │  back    │   └──────────────┘   └───────────────┘       │
│  └─────────┘                                                │
│       │                                                     │
│       ▼                                                     │
│  Next session or wave                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Daily Brief

**Trigger:** Start of session or human request.

**Mode:** Read-only. No mutations, no confirmation required.

| Step | Action | Source |
|------|--------|--------|
| 1 | Read main health state | `.github/ai-state/main-health.json` |
| 2 | Count active workers and their status | `.claude/worktrees/` |
| 3 | Summarize merge queue depth (pending, processed, failed) | `.ai/merge-queue.json` |
| 4 | List stale worktrees (>2h without progress) | `.claude/worktrees/` |
| 5 | Count open issues by label and priority | GitHub API |
| 6 | Report any red/black health or blocked gates | All sources |

**Output:** Structured summary presented to the human operator. No
side effects.

**Blocked when:** Never — the brief is always read-only.

---

## Phase 2: Plan Preview

**Trigger:** Human requests next-batch proposal or follows the daily
brief.

**Mode:** Preview only. Proposes a batch; does not launch.

| Step | Action |
|------|--------|
| 1 | Read open issues with target labels (e.g., `agent:codex-action-needed`) |
| 2 | Check conflict group collisions with in-flight workers |
| 3 | Check shared lock availability |
| 4 | Compile candidate task list with scope and acceptance criteria |
| 5 | **Preview:** Show proposed batch — issue numbers, worker types, risk levels, conflict groups |
| 6 | **Pause:** Wait for human to approve, adjust, or reject the batch |

**Blocked when:**

- Health is red or black.
- All candidate issues conflict with in-flight workers.
- No issues match the target label.

**Escalation:** If blocked, the Steward explains the specific gate
failure and suggests remediation.

**Scripts:** `plan-next-batch.ps1` for batch proposals.

---

## Phase 3: Launch Preview

**Trigger:** Human approves the plan preview and requests worker
dispatch.

**Mode:** Preview first, then execute with confirmation.

| Step | Action |
|------|--------|
| 1 | Read approved task list from Phase 2 |
| 2 | Run launch gate (`check-launch-gate.ps1`) for each task |
| 3 | Check provider pool capacity |
| 4 | **Preview:** Show task JSON, provider assignment, worktree path, risk level |
| 5 | **Pause:** Wait for human confirmation |
| 6 | **Execute:** Pass to orchestrator (`batch-launch.ps1 -Execute`) |
| 7 | **Audit:** Record launch in audit log |

**Blocked when:**

- Health is red or black.
- Launch gate blocks any task (conflict group, shared lock, risk).
- Provider pool has no headroom.
- Task touches forbidden files (`src/**`, `prisma/**`, `.env`).

**Escalation:** If launch gate blocks a task, the Steward reports the
specific failure and suggests resolution before retrying.

---

## Phase 4: PR Merge Preview

**Trigger:** Workers have opened PRs and human requests merge review.

**Mode:** Preview first, then execute with confirmation.

| Step | Action |
|------|--------|
| 1 | Read PR state, checks, reviews, and mergeability for each candidate |
| 2 | Read main health — **block if not green** |
| 3 | Run eligibility checks (open, not draft, mergeable, checks green) |
| 4 | Run guard checks if requested (`-RunGuards`) |
| 5 | **Preview:** Show PR list, risk scores, guard results, batch plan |
| 6 | **Pause:** Wait for human confirmation with `MERGE` phrase |
| 7 | **Execute:** Invoke `merge-clean-pr-batch.ps1 -Execute` |
| 8 | **Audit:** Record merge batch manifest |

**Blocked when:**

- Health is not green.
- Any PR fails eligibility checks.
- Guard checks fail (when `-RunGuards` is active).
- Risk score exceeds threshold without explicit override.

**Escalation:** If merge fails mid-batch, the Steward reports which
PRs merged and which failed, and pauses for human decision.

---

## Phase 5: Issue Close Preview

**Trigger:** Human requests closure of completed issues after merge.

**Mode:** Preview first, then execute with confirmation.

| Step | Action |
|------|--------|
| 1 | Read issue status and linked PRs |
| 2 | Verify all linked PRs are merged |
| 3 | Verify validation evidence exists in PR body |
| 4 | **Preview:** Show issue number, linked PRs, completion status |
| 5 | **Pause:** Wait for human confirmation |
| 6 | **Execute:** Close issue via `gh issue close` with completion comment |
| 7 | **Audit:** Record closure in audit log |

**Blocked when:**

- Linked PRs are not all merged.
- Validation evidence is missing from PR bodies.
- Issue has `blocked` or `wip` labels.

**Escalation:** If the issue cannot be closed, the Steward lists the
blocking conditions and suggests what needs to happen first.

---

## Phase 6: Health Writeback

**Trigger:** After merge completes or at end of session.

**Mode:** Executes automatically for low-risk state writes; human
confirmation required for state transitions to red or black.

| Step | Action |
|------|--------|
| 1 | Run post-merge health gate (`post-merge-health-gate.js --quick`) |
| 2 | Read health state result |
| 3 | Write health marker (`write-main-health-state.ps1 -State <state>`) |
| 4 | **Preview (if state degraded):** Show current vs. previous state, reason |
| 5 | **Pause (if state degraded):** Wait for human acknowledgment |
| 6 | **Audit:** Record health state transition |

**Blocked when:**

- Health gate script errors or returns ambiguous result.

**Escalation:** If health degrades, the Steward reports the specific
checks that failed and suggests recovery actions.

**State transitions:**

| Transition | Confirmation | Behavior |
|-----------|-------------|----------|
| green → green | Implicit | Write marker, continue |
| green → yellow | Human acknowledgment | Write marker, warn |
| green → red | Human acknowledgment | Write marker, block next wave |
| Any → black | Human acknowledgment | Write marker, block all waves |

---

## Loop Invariants

These invariants govern the entire daily loop and cannot be overridden:

1. **Preview-first.** Every mutating phase previews before executing.
   No exceptions.
2. **Human owns every decision.** The Steward proposes; the human
   confirms. No self-approval.
3. **No gate bypass.** The Steward cannot skip, weaken, or override
   any gate (launch, health, review, constitution).
4. **No autonomous waves.** The Steward stops after one wave. The
   human decides the next action.
5. **No merge decisions.** The Steward can queue or present PRs but
   cannot merge without human confirmation.
6. **Health writeback closes the loop.** Every cycle records state for
   the next cycle. No cycle ends without a health writeback.
7. **Audit every phase.** Every phase produces an audit entry with
   timestamps and outcomes.
8. **Fail-closed.** If any check errors or returns an ambiguous result,
   the phase defaults to human-gated execution.

---

## Relationship to Existing Workflows

| Daily Loop Phase | Command Steward Workflow | Codex Retirement Runbook Section |
|-----------------|--------------------------|----------------------------------|
| Daily Brief | Workflow 1: Daily Brief | Morning Check |
| Plan Preview | Workflow 2: Launch Worker (proposal) | Morning Check step 1 |
| Launch Preview | Workflow 2: Launch Worker (execute) | During the Day step 2 |
| PR Merge Preview | Workflow 3: Merge PR | During the Day step 4 |
| Issue Close Preview | Workflow 4: Issue Close | (implicit in daily workflow) |
| Health Writeback | (new — Codex ran this manually) | Morning Check steps 2–3 |

---

## Non-Goals

- This document does not define the Command Steward Agent's authority
  or boundaries — those are in
  [command-steward-agent.md](command-steward-agent.md).
- This document does not define guarded autopilot execute — that is in
  [guarded-autopilot-execute-policy.md](guarded-autopilot-execute-policy.md).
- This document does not modify scripts, the WebUI, or the NestJS
  application.
- This document does not allow autonomous merge, wave launch, or
  constitution modification.

---

## References

- [Command Steward Agent](command-steward-agent.md) — Agent definition
  and authority boundaries
- [Codex Retirement Runbook](codex-retirement-runbook.md) — Daily
  workflow and human-owned decisions
- [Loop Model](loop-model.md) — Self-cycle runner phases
- [Guarded Autopilot Execute Policy](guarded-autopilot-execute-policy.md)
  — Guarded execute preconditions
- [Control Skill Registry](control-skill-registry.md) — Skill risk
  classification
- [Launch Gate](launch-gate.md) — Pre-launch validation
- [Main Health Policy](main-health-policy.md) — Health states and
  worker permissions
- [#1264](https://github.com/taoyu051818-sys/lian-nest-server/issues/1264)
  — This feature
