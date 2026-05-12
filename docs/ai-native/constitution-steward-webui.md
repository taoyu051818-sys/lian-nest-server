# Constitution Steward WebUI

Defines WebUI views for constitutional audit results, amendment
proposals, red-team notes, and human approval status. Surfaces
constitution health to operators so they can monitor, review, and
approve constitutional changes without running CLI guards manually.

> **Status:** Concept. No implementation exists yet.
>
> **Closes:** [#1005](https://github.com/taoyu051818-sys/lian-nest-server/issues/1005)
>
> **Reference:** [seed-constitution.md](seed-constitution.md) for
> immutable boundaries, [constitution-guard.md](constitution-guard.md)
> for pre-flight validation,
> [fact-event-ledger.md](fact-event-ledger.md) for the append-only
> event log, [external-reality-intake.md](external-reality-intake.md)
> for evidence classification.

---

## Purpose

The seed constitution defines immutable boundaries for the AI-native
control plane — high-risk human-required gates, merge allowlists,
main-red launch stop, legacy read-only policy, and no worker scope
expansion. Today, constitution compliance is enforced by CLI guards
(`check-constitution.js`, `check-task-boundary.js`) that run at
pre-merge validation time.

This concept defines WebUI views that let operators:

1. See the current constitution audit status without running scripts.
2. Review and manage amendment proposals before they reach PR stage.
3. Record and review red-team findings against constitutional rules.
4. Track human approval status for high-risk actions that require
   explicit authorization.

---

## Design Principles

| Principle | Meaning |
|-----------|---------|
| **Read-first** | The primary views are read-only dashboards. Mutations (approval, rejection) require explicit human action. |
| **No self-approval** | The WebUI never auto-approves constitutional changes. Every amendment requires a human-authored PR reviewed by `architecture-review`. |
| **Append-only audit** | All actions taken through the WebUI are recorded in the fact event ledger. Nothing is silently changed. |
| **Constitution is authoritative** | The seed constitution at `.github/ai-policy/seed-constitution.md` remains the single source of truth. The WebUI reflects it; it does not modify it. |
| **Gate-compatible** | Constitutional actions flow through the same launch gate, health policy, and review requirements as any other control-plane operation. |

---

## WebUI Views

### 1. Constitution Audit Dashboard

**Purpose:** Display the current constitution guard status — whether the
seed constitution is present, structurally correct, and in sync between
the authoritative file and docs mirror.

**Data sources:**

| Source | What It Provides |
|--------|-----------------|
| `check-constitution.js --json` | Guard pass/fail, per-check results, section headings |
| `check-task-boundary.js --json` | Boundary violations from recent worker diffs |
| Fact event ledger | Recent `constitution.audit` events |

**Dashboard layout:**

```
┌─────────────────────────────────────────────────────┐
│  Constitution Audit Dashboard                       │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │ Guard Status: PASS                           │   │
│  │ Last checked: 2026-05-12T10:00:00Z           │   │
│  │ Authoritative file: present                  │   │
│  │ Docs mirror: present                         │   │
│  │ Section sync: in sync (5/5)                  │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────────────┐  ┌────────────────────────┐   │
│  │ Recent Audits     │  │ Boundary Violations   │   │
│  │                   │  │                        │   │
│  │ [pass] 10:00 AM   │  │ None in last 7 days    │   │
│  │ [pass] 09:00 AM   │  │                        │   │
│  │ [fail] 08:00 AM   │  │                        │   │
│  │   mirror missing  │  │                        │   │
│  └──────────────────┘  └────────────────────────┘   │
│                                                     │
│  Constitution Sections                              │
│  ┌──────────────────────────────────────────────┐   │
│  │ [ok] §1 High-Risk Human-Required Boundaries  │   │
│  │ [ok] §2 Explicit Merge Allowlists            │   │
│  │ [ok] §3 Main-Red Launch Stop                 │   │
│  │ [ok] §4 Legacy Backend Read-Only Policy      │   │
│  │ [ok] §5 No Worker Scope Expansion            │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `guardStatus` | string | `pass` or `fail` |
| `lastCheckedAt` | ISO-8601 | Timestamp of most recent audit |
| `authoritativeExists` | boolean | `.github/ai-policy/seed-constitution.md` present |
| `mirrorExists` | boolean | `docs/ai-native/seed-constitution.md` present |
| `sectionSync` | object | Per-section pass/fail for all 5 required sections |
| `boundaryViolations` | array | Recent worker diff violations (last 7 days) |

**Behavior:**

1. Reads the constitution guard JSON output.
2. Reads recent `constitution.audit` events from the fact event ledger.
3. Displays pass/fail status with drill-down into individual checks.
4. A failing guard highlights the specific check that failed with a
   human-readable explanation.
5. Boundary violations link to the relevant PR or worker diff.

---

### 2. Amendment Proposal Panel

**Purpose:** Track proposed changes to the seed constitution before they
reach PR stage. Every amendment requires a human-authored PR reviewed by
`architecture-review` — this panel surfaces proposals for operator
awareness, not for automated approval.

**Fields:**

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `proposalId` | string | yes | Unique identifier (auto-generated) |
| `title` | string | yes | One-line description of the proposed change |
| `targetSection` | string | yes | Constitution section: `1` through `5` |
| `rationale` | string | yes | Why the change is needed (max 500 chars) |
| `proposedBy` | string | yes | Role: `repo-owner`, `architect`, `human` |
| `status` | string | yes | `proposed`, `under-review`, `approved`, `rejected`, `merged` |
| `linkedPR` | string | no | GitHub PR number if one exists |
| `capturedAt` | ISO-8601 | yes | When the proposal was recorded |

**Lifecycle:**

```
proposed → under-review → approved → merged (PR merged)
proposed → under-review → rejected (archived with reason)
proposed → rejected (direct rejection)
```

**Ledger event shape:**

```json
{
  "eventVersion": 1,
  "eventType": "constitution.amendment-proposed",
  "subject": "Add §6 Provider Rotation Policy",
  "facts": {
    "proposalId": "amend-2026-0512-001",
    "targetSection": "new",
    "rationale": "Provider key rotation needs explicit constitution-level boundaries",
    "proposedBy": "architect",
    "status": "proposed"
  },
  "capturedAt": "2026-05-12T10:00:00Z",
  "actor": "human"
}
```

**Behavior:**

1. Operator creates a proposal from the WebUI form or a proposal is
   recorded from an issue comment.
2. The proposal is written to the fact event ledger as
   `constitution.amendment-proposed`.
3. The panel shows all open proposals sorted by capture date.
4. Status transitions are append-only events.
5. Linking a PR records a `constitution.amendment-pr-linked` event.
6. Merging or rejecting records a terminal status event.

**What this panel does NOT do:**

- Does not auto-create PRs for amendment proposals.
- Does not modify `.github/ai-policy/seed-constitution.md`.
- Does not bypass the `architecture-review` requirement.

---

### 3. Red-Team Notes Panel

**Purpose:** Record and review findings from red-team exercises,
adversarial reviews, or manual audits that test constitutional
boundaries. These notes surface potential weaknesses or edge cases
in the constitution's enforcement.

**Fields:**

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `findingId` | string | yes | Unique identifier (auto-generated) |
| `title` | string | yes | One-line summary of the finding |
| `targetSection` | string | yes | Constitution section tested: `1` through `5` |
| `severity` | string | yes | `info`, `low`, `medium`, `high`, `critical` |
| `description` | string | yes | Detailed finding (max 1000 chars) |
| `reproductionSteps` | string | no | How to verify the finding |
| `status` | string | yes | `open`, `acknowledged`, `mitigated`, `false-positive` |
| `recordedBy` | string | yes | Role or identity of the reviewer |
| `capturedAt` | ISO-8601 | yes | When the finding was recorded |

**Ledger event shape:**

```json
{
  "eventVersion": 1,
  "eventType": "constitution.red-team-finding",
  "subject": "Boundary guard bypass via broad glob pattern",
  "facts": {
    "findingId": "rt-2026-0512-001",
    "targetSection": "2",
    "severity": "high",
    "description": "Worker with allowedFiles=['src/modules/**'] can edit any module, crossing boundaries not explicitly checked",
    "status": "open",
    "recordedBy": "architect"
  },
  "capturedAt": "2026-05-12T10:00:00Z",
  "actor": "human"
}
```

**Behavior:**

1. Reviewer records a finding from the WebUI form.
2. The finding is written to the fact event ledger as
   `constitution.red-team-finding`.
3. Findings are sorted by severity descending, then age.
4. Status transitions are append-only events.
5. High and critical findings surface on the Constitution Audit
   Dashboard as warnings.

**Filters:**

| Filter | Values |
|--------|--------|
| Target section | `1`, `2`, `3`, `4`, `5` |
| Severity | `info`, `low`, `medium`, `high`, `critical` |
| Status | `open`, `acknowledged`, `mitigated`, `false-positive` |
| Age | `< 24h`, `< 7d`, `< 30d`, `> 30d` |

---

### 4. Human Approval Status

**Purpose:** Track the approval state of high-risk actions that require
explicit human authorization per seed constitution §1. Shows which
actions are pending approval, which have been approved or rejected, and
which boundaries are currently blocking.

**Data sources:**

| Source | What It Provides |
|--------|-----------------|
| Fact event ledger | `constitution.approval-requested`, `constitution.approved`, `constitution.rejected` events |
| Launch gate | Actions blocked by high-risk boundaries |
| Worker diffs | Boundary violations requiring human intervention |

**Dashboard layout:**

```
┌─────────────────────────────────────────────────────┐
│  Human Approval Status                              │
│                                                     │
│  Pending Approvals                                  │
│  ┌──────────────────────────────────────────────┐   │
│  │ [pending] PR #456 — Modify Prisma schema     │   │
│  │   Requested: 2026-05-12 09:00                │   │
│  │   Boundary: §1 (Data integrity)              │   │
│  │   Requester: worker-auth-slice               │   │
│  │                                               │   │
│  │ [pending] Issue #789 — Add dependency         │   │
│  │   Requested: 2026-05-12 08:30                │   │
│  │   Boundary: §1 (Supply chain risk)           │   │
│  │   Requester: planner                         │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Recent Decisions                                   │
│  ┌──────────────────────────────────────────────┐   │
│  │ [approved] PR #450 — Secret rotation          │   │
│  │   Approved by: repo-owner, 2026-05-11        │   │
│  │                                               │   │
│  │ [rejected] PR #448 — Force-push to main       │   │
│  │   Rejected by: repo-owner, 2026-05-11        │   │
│  │   Reason: Use merge queue instead             │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  Boundary Block Summary                             │
│  ┌──────────────────────────────────────────────┐   │
│  │ §1 High-Risk: 2 pending                      │   │
│  │ §2 Allowlists: 0 pending                     │   │
│  │ §3 Main-Red: 0 pending                       │   │
│  │ §4 Legacy: 0 pending                         │   │
│  │ §5 Scope: 0 pending                          │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Ledger event shape:**

```json
{
  "eventVersion": 1,
  "eventType": "constitution.approval-requested",
  "subject": "PR #456 requires Prisma schema change",
  "facts": {
    "targetPR": 456,
    "boundary": "1",
    "boundaryReason": "Data integrity",
    "requester": "worker-auth-slice",
    "status": "pending"
  },
  "capturedAt": "2026-05-12T09:00:00Z",
  "actor": "worker"
}
```

**Approval actions:**

| Action | Actor | Effect |
|--------|-------|--------|
| Approve | `repo-owner` | Records `constitution.approved` event, unblocks the action |
| Reject | `repo-owner` | Records `constitution.rejected` event with reason, action remains blocked |
| Escalate | Any operator | Records `constitution.escalated` event, surfaces to architect review |

**Behavior:**

1. When a worker or orchestrator encounters a high-risk boundary, it
   records an `constitution.approval-requested` event.
2. The panel displays pending approvals sorted by age (oldest first).
3. Only `repo-owner` role can approve or reject.
4. All decisions are append-only events in the ledger.
5. Rejected actions require a new request if circumstances change.

---

## Integration with Existing Systems

### Constitution Guard

The audit dashboard reads from `check-constitution.js --json` output.
If the guard has not been run recently (no event in last 24 hours),
the dashboard shows a "stale" indicator.

| Guard Check | Dashboard Surface |
|-------------|-------------------|
| `authoritative-exists` | Authoritative file status |
| `docs-mirror-exists` | Docs mirror status |
| `authoritative-sections` | Section completeness |
| `mirror-sections` | Mirror section completeness |
| `section-sync` | Section sync indicator |

### Fact Event Ledger

All constitution steward actions write append-only events to
`.github/ai-state/fact-events.ndjson`. New event types:

| Event Type | When |
|------------|------|
| `constitution.audit` | Constitution guard run completed |
| `constitution.amendment-proposed` | New amendment proposal recorded |
| `constitution.amendment-pr-linked` | PR linked to amendment proposal |
| `constitution.amendment-status` | Amendment proposal status changed |
| `constitution.red-team-finding` | Red-team finding recorded |
| `constitution.finding-status` | Finding status changed |
| `constitution.approval-requested` | High-risk action needs approval |
| `constitution.approved` | Action approved by repo-owner |
| `constitution.rejected` | Action rejected by repo-owner |
| `constitution.escalated` | Action escalated for architect review |

### Seed Constitution

The WebUI reflects the constitution; it does not modify it. The five
constitution sections are displayed as read-only reference in the audit
dashboard. Amendment proposals link to the constitution sections they
target but do not auto-generate diffs.

### Planning Loop

The planning loop can read open red-team findings and pending approvals
as context for batch decisions. High-severity findings may influence
prioritization (e.g., deprioritizing tasks that touch a weakened
boundary).

### Context Bundles

Workers receive recent constitution events in their context bundles:

| Event Type | Inclusion Rule |
|------------|---------------|
| `constitution.red-team-finding` | Include if `severity >= medium` and `status = open` |
| `constitution.approval-requested` | Include if `status = pending` and relevant to worker scope |
| `constitution.amendment-proposed` | Include if `targetSection` affects worker's boundary checks |

---

## Boundaries

### What the Constitution Steward WebUI Does

- Displays constitution guard status and audit history.
- Surfaces amendment proposals for operator awareness.
- Records and filters red-team findings.
- Tracks human approval status for high-risk actions.
- Records all actions as append-only ledger events.

### What the Constitution Steward WebUI Does Not Do

- Modify `.github/ai-policy/seed-constitution.md`.
- Auto-approve high-risk or constitutional changes.
- Bypass the `architecture-review` requirement for amendments.
- Override the main-red launch stop.
- Expand worker `allowedFiles` or `conflictGroup`.
- Store secrets, tokens, or unredacted payloads.

---

## Implementation Status

| View | Status | Notes |
|------|--------|-------|
| Constitution Audit Dashboard | **Concept** | Reads from `check-constitution.js --json` |
| Amendment Proposal Panel | **Concept** | Requires proposal state store and form |
| Red-Team Notes Panel | **Concept** | Requires finding state store and form |
| Human Approval Status | **Concept** | Requires approval request/approval event flow |

---

## References

- [Seed Constitution](seed-constitution.md) — Immutable boundaries this view surfaces.
- [Seed Constitution (authoritative)](../../.github/ai-policy/seed-constitution.md) — Single source of truth.
- [Constitution Guard](constitution-guard.md) — Pre-flight validation producing audit data.
- [Fact Event Ledger](fact-event-ledger.md) — Append-only event log for all steward actions.
- [External Reality Intake](external-reality-intake.md) — Evidence classification and reliability tiers.
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Gate pattern this view extends for amendments.
- [Human Strategy Notes Contract](human-strategy-notes-contract.md) — Similar human-authored evidence pattern.
- [External Intake WebUI Concept](external-intake-webui-concept.md) — Parallel WebUI concept for external evidence.
- [Codex Exit WebUI Criteria](codex-exit-webui-criteria.md) — WebUI readiness criteria pattern.
