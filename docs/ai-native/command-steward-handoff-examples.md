# Command Steward Handoff Examples

Concrete examples of human-to-Command-Steward and
Command-Steward-to-system handoffs. Each example reinforces two
invariants: **preview-first** (every mutation is shown before
execution) and **gate-before-memory** (gates are checked before any
state change is persisted).

> **Closes:** [#1157](https://github.com/taoyu051818-sys/lian-nest-server/issues/1157)
>
> **Complements:**
> [command-steward-agent.md](command-steward-agent.md) for
> the agent definition and authority boundaries,
> [webui-command-steward-console.md](webui-command-steward-console.md)
> for the console UI specification.

---

## Invariants

Every handoff example below enforces these rules:

| Invariant | Meaning |
|-----------|---------|
| **Preview-first** | No mutation executes without a preceding preview. The human sees the projected outcome, affected targets, and risk level before confirming. |
| **Gate-before-memory** | Gates (launch gate, health gate, eligibility checks) are evaluated before any state write. If a gate fails, no state changes persist. |

---

## Example 1: Launch Preview

**Scenario:** Human asks the Steward to launch a worker for issue #712.

### Handoff Flow

```
Human                   Command Steward                 System
  │                           │                           │
  │  "Launch worker for #712" │                           │
  │──────────────────────────▶│                           │
  │                           │  Read issue #712          │
  │                           │──────────────────────────▶│
  │                           │  Read main health         │
  │                           │──────────────────────────▶│
  │                           │  Run launch gate          │
  │                           │──────────────────────────▶│
  │                           │                           │
  │                           │  ◀── gate: ALLOW ─────────│
  │                           │                           │
  │  ◀── PREVIEW ────────────│                           │
  │  Task JSON                │                           │
  │  Provider: anthropic      │                           │
  │  Worktree: claude/w712    │                           │
  │  Risk: low                │                           │
  │  Conflict group: docs     │                           │
  │                           │                           │
  │  "Confirm: LAUNCH"        │                           │
  │──────────────────────────▶│                           │
  │                           │  batch-launch.ps1         │
  │                           │──────────────────────────▶│
  │                           │                           │
  │  ◀── RESULT ─────────────│  ◀── worker started ──────│
  │  Worker dispatched.       │                           │
  │  Branch: claude/w712      │                           │
```

### Key Points

- The Steward reads the issue and health state before presenting the
  preview — it does not assume the issue is launchable.
- The launch gate runs **before** the preview is shown. If the gate
  blocks (e.g., main health is red), the Steward reports the block
  instead of showing a preview.
- The preview shows the exact task JSON, provider assignment, worktree
  path, and risk level. The human sees what will change.
- Confirmation requires typing `LAUNCH` — a single click is not
  sufficient for a dispatch action.

### Blocked Variant

If the launch gate blocks:

```
Human                   Command Steward
  │                           │
  │  "Launch worker for #712" │
  │──────────────────────────▶│
  │                           │  Read + gate check ...
  │                           │
  │  ◀── BLOCKED ────────────│
  │  Gate: BLOCK              │
  │  Reason: Main health is   │
  │  red. Runtime workers     │
  │  are not permitted.       │
  │  Suggested: Resolve health│
  │  or launch a recovery     │
  │  worker instead.          │
```

No preview is shown because the gate failed before the preview phase.

---

## Example 2: Merge Preview

**Scenario:** Human asks the Steward to merge PRs #456 and #478.

### Handoff Flow

```
Human                   Command Steward                 System
  │                           │                           │
  │  "Merge PRs #456, #478"   │                           │
  │──────────────────────────▶│                           │
  │                           │  Read PR states           │
  │                           │──────────────────────────▶│
  │                           │  Read main health         │
  │                           │──────────────────────────▶│
  │                           │  Run eligibility checks   │
  │                           │──────────────────────────▶│
  │                           │  Run guard checks         │
  │                           │──────────────────────────▶│
  │                           │                           │
  │                           │  ◀── all pass ────────────│
  │                           │                           │
  │  ◀── PREVIEW ────────────│                           │
  │  PR #456 — risk: low      │                           │
  │    Guards: pass           │                           │
  │    Health: green          │                           │
  │  PR #478 — risk: medium   │                           │
  │    Guards: pass           │                           │
  │    Health: green          │                           │
  │  Batch: 2 PRs, merge      │                           │
  │  order: #456 then #478    │                           │
  │                           │                           │
  │  "Confirm: MERGE"         │                           │
  │──────────────────────────▶│                           │
  │                           │  merge-clean-pr-batch.ps1 │
  │                           │──────────────────────────▶│
  │                           │                           │
  │  ◀── RESULT ─────────────│  ◀── merge complete ──────│
  │  PR #456: merged          │                           │
  │  PR #478: merged          │                           │
  │  Health gate: running ... │                           │
```

### Key Points

- Eligibility checks (open, not draft, mergeable, checks green) run
  **before** the preview. A failing PR is excluded from the preview
  with a reason, not silently dropped.
- Guard checks (`-RunGuards`) run before the preview when requested.
- The preview shows each PR's risk score, guard result, and health
  state. The human sees the full batch plan.
- Confirmation requires typing `MERGE`.
- After execution, the health gate runs automatically. The Steward
  reports the health gate result as a follow-up.

### Blocked Variant

If health is not green:

```
Human                   Command Steward
  │                           │
  │  "Merge PRs #456, #478"   │
  │──────────────────────────▶│
  │                           │  Read + health check ...
  │                           │
  │  ◀── BLOCKED ────────────│
  │  Gate: BLOCK              │
  │  Reason: Main health is   │
  │  yellow. Merge is only    │
  │  permitted when green.    │
  │  Suggested: Wait for      │
  │  health recovery or       │
  │  review health gate.      │
```

---

## Example 3: Issue Close Preview

**Scenario:** Human asks the Steward to close issue #683 (all linked
PRs merged).

### Handoff Flow

```
Human                   Command Steward                 System
  │                           │                           │
  │  "Close issue #683"       │                           │
  │──────────────────────────▶│                           │
  │                           │  Read issue #683          │
  │                           │──────────────────────────▶│
  │                           │  Read linked PRs          │
  │                           │──────────────────────────▶│
  │                           │  Check PR merge status    │
  │                           │──────────────────────────▶│
  │                           │  Check validation evidence│
  │                           │──────────────────────────▶│
  │                           │                           │
  │                           │  ◀── all merged + evidence│
  │                           │                           │
  │  ◀── PREVIEW ────────────│                           │
  │  Issue #683               │                           │
  │  Title: "Add health gate" │                           │
  │  Linked PRs: #456 (merged)│                           │
  │  Validation: PASS         │                           │
  │  Labels: agent:done       │                           │
  │  Will close with comment. │                           │
  │                           │                           │
  │  "Confirm: CLOSE"         │
  │──────────────────────────▶│                           │
  │                           │  gh issue close #683      │
  │                           │──────────────────────────▶│
  │                           │                           │
  │  ◀── RESULT ─────────────│  ◀── issue closed ────────│
  │  Issue #683 closed.       │                           │
```

### Key Points

- The Steward verifies all linked PRs are merged and validation
  evidence exists **before** showing the preview.
- If any linked PR is not merged, the Steward blocks and lists the
  unmerged PRs.
- If the issue has `blocked` or `wip` labels, the Steward blocks.
- The preview shows the issue title, linked PRs, validation status,
  and labels. The human sees exactly what will close.
- Confirmation requires typing `CLOSE`.

### Blocked Variant

If a linked PR is not merged:

```
Human                   Command Steward
  │                           │
  │  "Close issue #683"       │
  │──────────────────────────▶│
  │                           │  Read + PR check ...
  │                           │
  │  ◀── BLOCKED ────────────│
  │  Gate: BLOCK              │
  │  Reason: PR #478 is still │
  │  open. All linked PRs     │
  │  must be merged before    │
  │  closing the issue.       │
  │  Suggested: Merge PR #478 │
  │  or remove the link.      │
```

---

## Example 4: Entropy Reduction Task

**Scenario:** Human asks the Steward to clean up stale worktrees
(worktree janitor).

### Handoff Flow

```
Human                   Command Steward                 System
  │                           │                           │
  │  "Clean stale worktrees"  │                           │
  │──────────────────────────▶│                           │
  │                           │  Run worktree-janitor     │
  │                           │  (dry-run mode)           │
  │                           │──────────────────────────▶│
  │                           │                           │
  │                           │  ◀── dry-run report ──────│
  │                           │                           │
  │  ◀── PREVIEW ────────────│                           │
  │  Worktree Janitor Report  │                           │
  │  Merged (will remove):    │                           │
  │    claude/w6-issue-258    │                           │
  │    claude/w6-issue-260    │                           │
  │  Stale (will flag):       │                           │
  │    claude/w7-issue-312    │                           │
  │    (>72h no activity)     │                           │
  │  Active (will keep):      │                           │
  │    claude/w8-issue-712    │                           │
  │                           │                           │
  │  "Confirm: RETRY"         │
  │──────────────────────────▶│                           │
  │                           │  worktree-janitor.ps1     │
  │                           │  -RemoveMerged            │
  │                           │──────────────────────────▶│
  │                           │                           │
  │  ◀── RESULT ─────────────│  ◀── cleanup complete ────│
  │  Removed 2 merged         │                           │
  │  worktrees.               │                           │
  │  Flagged 1 stale          │                           │
  │  worktree.                │                           │
```

### Key Points

- The janitor runs in **dry-run mode first** — no worktrees are
  removed until the human confirms.
- The preview classifies each worktree: merged (will remove), stale
  (will flag), or active (will keep). The human sees exactly what
  will change.
- Gate-before-memory: the janitor checks each worktree's state
  (merged branch, PR status, heartbeat) before proposing removal.
  A worktree with an unmerged PR is never proposed for removal.
- Confirmation requires typing `RETRY` (the standard high-risk
  confirmation phrase for provider/resource actions).
- After execution, the Steward reports which worktrees were removed
  and which were flagged.

### Blocked Variant

If all worktrees are active:

```
Human                   Command Steward
  │                           │
  │  "Clean stale worktrees"  │
  │──────────────────────────▶│
  │                           │  Run janitor (dry-run) ...
  │                           │
  │  ◀── NO ACTION ──────────│
  │  All worktrees are active.│
  │  No stale or merged       │
  │  worktrees detected.      │
  │  Nothing to clean.        │
```

---

## Example 5: High-Risk Escalation

**Scenario:** A worker PR touches `src/auth/` — the Steward escalates
to human rather than proceeding.

### Handoff Flow

```
Worker                  Command Steward                 Human
  │                           │                           │
  │  PR #500 opened           │                           │
  │  (touches src/auth/)      │                           │
  │──────────────────────────▶│                           │
  │                           │  Read PR diff             │
  │                           │  Detect: src/auth/ change │
  │                           │  Check: high-risk boundary│
  │                           │                           │
  │                           │  ◀── ESCALATION ──────────│
  │                           │                           │
  │                           │  ⚠ HUMAN DECISION REQUIRED│
  │                           │  PR #500 touches src/auth/│
  │                           │  Risk: HIGH               │
  │                           │  Boundary: High-risk file │
  │                           │  This requires your review│
  │                           │  and explicit approval.   │
  │                           │                           │
  │                           │  Files changed:           │
  │                           │  - src/auth/auth.guard.ts │
  │                           │  - src/auth/auth.module.ts│
  │                           │                           │
  │                           │  Suggested:               │
  │                           │  1. Review diff           │
  │                           │  2. Assign security-      │
  │                           │     reviewer              │
  │                           │  3. Approve or request    │
  │                           │     changes               │
```

### Key Points

- The Steward detects the high-risk boundary **before** presenting
  any merge or action preview. It does not offer to merge.
- The escalation includes the specific files touched, the risk level,
  and the boundary that was hit.
- The Steward suggests the appropriate reviewers (`security-reviewer`
  + `repo-owner`) but does not assign them — that is a human action.
- The Steward does **not** execute the merge. It surfaces the analysis
  and waits. This is the gate-before-memory invariant: the gate
  (high-risk boundary check) blocks the action before any state
  change.

### Self-Referential Escalation

If a proposed change would modify the Steward's own boundaries:

```
Worker                  Command Steward                 Human
  │                           │                           │
  │  PR #501 opened           │                           │
  │  (touches docs/ai-native/ │                           │
  │   command-steward-agent.md│                           │
  │   but NOT in allowedFiles)│                           │
  │──────────────────────────▶│                           │
  │                           │  Detect: self-referential │
  │                           │  change to own definition │
  │                           │                           │
  │                           │  ◀── BLOCKED ─────────────│
  │                           │                           │
  │                           │  ✕ BLOCKED                │
  │                           │  PR #501 modifies the     │
  │                           │  Command Steward agent    │
  │                           │  definition but is not in │
  │                           │  the worker's allowedFiles│
  │                           │                           │
  │                           │  This is a self-referential│
  │                           │  change. The Steward      │
  │                           │  cannot approve changes to│
  │                           │  its own boundaries.      │
  │                           │                           │
  │                           │  Escalated to: Human      │
  │                           │  Constitutional Owner     │
```

---

## Summary Table

| Example | Trigger | Gate Checked | Preview Shown | Confirmation |
|---------|---------|-------------|---------------|-------------|
| Launch Preview | "Launch worker for #N" | Launch gate (health, conflict, locks) | Task JSON, provider, worktree, risk | Type `LAUNCH` |
| Merge Preview | "Merge PRs #N, #M" | Health gate + eligibility + guards | PR list, risk scores, batch plan | Type `MERGE` |
| Issue Close Preview | "Close issue #N" | Linked PRs merged + validation evidence | Issue title, PRs, labels | Type `CLOSE` |
| Entropy Reduction | "Clean stale worktrees" | Worktree state (merged/active/stale) | Classified worktree list | Type `RETRY` |
| High-Risk Escalation | PR touches boundary | High-risk boundary check | Escalation with files + risk | Human reviews |

---

## References

- [Command Steward Agent](command-steward-agent.md) — Agent definition, authority, and workflows
- [WebUI Command Steward Console](webui-command-steward-console.md) — Console UI specification
- [Launch Gate](launch-gate.md) — Pre-launch validation policy
- [Main Health Policy](main-health-policy.md) — Health states and worker permissions
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
- [PR Handoff Template](pr-handoff-template.md) — Worker PR body requirements
- [Codex Retirement Runbook](codex-retirement-runbook.md) — Human-owned decisions and daily workflow
