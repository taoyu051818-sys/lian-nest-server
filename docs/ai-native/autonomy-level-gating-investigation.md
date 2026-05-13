# Autonomy Level Gating — Investigation

Investigates whether a graduated autonomy-level concept (low / medium / high)
would add actionable value to LIAN's existing safety-gate architecture.

> **Closes:** [#1437](https://github.com/taoyu051818-sys/lian-nest-server/issues/1437)
>
> **Source evidence:** Symphony `.roo/rules/01-general-rules.md` defines three
> automation levels: Low (propose only, needs human approval), Medium (implement
> + verify, needs approval for deployment), High (fully autonomous). Every agent
> checks the global autonomy level before any delegation action.
>
> **Cross-references:**
> [guarded-autopilot-execute-policy.md](guarded-autopilot-execute-policy.md) for
> the current binary gating model,
> [self-cycle-runner.md](self-cycle-runner.md) for the orchestrator,
> [main-health-policy.md](main-health-policy.md) for health-gated worker
> permissions,
> [worker-trust.md](worker-trust.md) for trust-score scheduling,
> [external-intake-human-gate.md](external-intake-human-gate.md) for intake
> boundaries.

---

## Summary

LIAN already has a **multi-layered safety-gate architecture** that covers most
of what Symphony's autonomy levels provide. The key gap is that LIAN's model is
**implicit and distributed** across several independent gates rather than a
single, explicit, human-readable autonomy-level state file. Adding a lightweight
`autonomy-level.json` state file would provide a **single coordination point**
for operators to control the system's overall behavior without changing the
underlying gate logic.

**Recommendation:** Add a `docs/ai-native/autonomy-level.md` governance doc and
a `.github/ai-state/autonomy-level.json` state file. This is a low-risk,
incremental change that does not modify any existing gate scripts.

---

## Current State: How LIAN Gates Autonomy Today

LIAN uses four independent gate layers. Each layer makes decisions without
consulting the others — there is no shared "autonomy level" concept.

### Layer 1: Health Gate (green / yellow / red / black)

The `main-health.json` state controls which **worker types** may launch.

| Health State | Permitted Workers |
|:---:|---|
| green | All worker types |
| yellow | docs, test-only, health-gate, foundation-fix |
| red | foundation-fix, health-gate only |
| black | No launches |

**Source:** [main-health-policy.md](main-health-policy.md)

This is the closest LIAN has to an autonomy-level gate, but it reacts to
**build health**, not to operator intent about how much autonomy to grant.

### Layer 2: Guarded Autopilot Execute Policy

The `guarded-autopilot-execute-policy.md` defines a **binary** gate:

- **Human-gated** (default): Every action requires human confirmation.
- **Guarded-execute** (`-Execute -Guarded`): Auto-execute low-risk tasks when
  8 preconditions pass (green health, low risk, bounded allowlists, etc.).

This is a two-level model (off / on) rather than a graduated three-level model.
It does not distinguish between "propose only" and "implement + verify" — those
are separate runner modes (`-PlanFirst` vs `-Execute`).

**Source:** [guarded-autopilot-execute-policy.md](guarded-autopilot-execute-policy.md)

### Layer 3: Risk Classification

Each task carries a `risk` field (`low` / `medium` / `high` / `critical`). The
safety gate blocks high-risk and critical actions, warns on medium, and passes
low-risk actions. This is **per-action**, not a global system setting.

**Source:** `check-self-cycle-safety-gate.js`

### Layer 4: External Intake Human Gate

External ideas matching four boundary categories (HIGH_RISK, POLICY_CHANGE,
AUTH_DB_SECURITY, BROAD_DIRECTION) are blocked for human review regardless of
other gate results.

**Source:** [external-intake-human-gate.md](external-intake-human-gate.md)

---

## Gap Analysis: Symphony Levels vs LIAN Gates

| Symphony Level | Symphony Behavior | LIAN Equivalent | Gap |
|---|---|---|---|
| **Low** — Propose only | Agent proposes actions, human approves all | Dry-run mode (`run-self-cycle.ps1` default) + `-PlanFirst` | **No gap** — fully covered |
| **Medium** — Implement + verify, human approves deployment | Agent implements and verifies, human approves final merge/deploy | Guarded-execute mode (`-Execute -Guarded`) for low-risk tasks; standard execute for medium/high-risk | **Partial gap** — guarded-execute is binary (on/off), not graduated by task category |
| **High** — Fully autonomous | Agent produces issues, implements, verifies, merges, deploys | Not implemented. Merge is always human-owned per codex retirement runbook | **Explicit gap** — by design, LIAN does not support this level |

### What LIAN Lacks

1. **No single autonomy-level state file.** Operators cannot glance at one file
   to know "the system is currently at Medium autonomy." The effective autonomy
   level is an emergent property of health state + runner flags + task risk +
   guarded-execute eligibility.

2. **No pre-action autonomy check.** Symphony agents check the global level
   before every delegation. LIAN agents check health, risk, allowlists, and
   human-gate independently. There is no single gate that says "autonomy is
   Medium, so this action is allowed / blocked."

3. **No explicit High level.** By design, LIAN's constitution prevents fully
   autonomous operation (merge is human-owned, seed constitution is immutable,
   no self-expansion). This is intentional — the issue asks whether it should
   exist, and the answer is: not without a constitutional amendment.

---

## Proposed Design: Autonomy Level State File

### State File

A new `.github/ai-state/autonomy-level.json`:

```json
{
  "schemaVersion": 1,
  "level": "low",
  "capturedAt": "2026-05-13T00:00:00.000Z",
  "setBy": "repo-owner",
  "reason": "Initial state — conservative default",
  "allowedActions": {
    "propose": true,
    "implement": false,
    "verify": false,
    "merge": false,
    "produceIssues": false
  }
}
```

### Levels

| Level | `allowedActions` | Effective Behavior |
|---|---|---|
| `low` | propose only | Self-cycle runs in dry-run / plan-first mode. No workers launched. No issues auto-produced. |
| `medium` | propose + implement + verify | Self-cycle can launch workers in guarded-execute mode for low-risk tasks. Merge remains human-owned. Issues can be auto-produced for low-risk categories. |
| `high` | all actions | **Requires constitutional amendment.** Not implemented in this investigation. Reserved for future consideration. |

### Integration Points (Non-Breaking)

The autonomy level would be checked **alongside** existing gates, not replacing
them. Integration points (future work, not this PR):

1. `run-self-cycle.ps1` — read `autonomy-level.json` at startup; if `low`,
   force dry-run regardless of `-Execute` flag.
2. `check-self-cycle-safety-gate.js` — add a fifth gate criterion
   "Autonomy Level Gate" that blocks actions not permitted at the current level.
3. `propose-self-cycle-issues.js` — check level before auto-producing issues.
4. WebUI control console — display current autonomy level; require human
   confirmation to change level.

### Safety Properties

- **Fail-closed:** If `autonomy-level.json` is missing or malformed, default to
  `low` (most restrictive).
- **Human-only transitions:** Level changes require a `repo-owner` action.
  The system never self-promotes its autonomy level.
- **Constitutional boundary:** `high` level requires a constitution amendment
  per [constitution-amendment-protocol.md](constitution-amendment-protocol.md).
  The seed constitution's "No Worker Scope Expansion" rule prevents autonomous
  merge without amendment.
- **Non-breaking:** The state file is additive. Existing gates continue to
  operate independently. The autonomy level is an additional filter, not a
  replacement.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| State file drifts from actual runner behavior | Low | Medium | Runner reads file at startup; mismatch produces a warning, not silent behavior change |
| Operator forgets to update level after incident | Low | Low | Default to `low` on missing file; health gate degradation could auto-reset to `low` |
| Adds governance overhead for small teams | Medium | Low | Single file, single field; no scripts required for initial implementation |
| Constitutional concern with `high` level | N/A | N/A | `high` is explicitly gated by constitution amendment; not implemented here |

---

## Implementation Scope (This Investigation)

This investigation produces:

1. **This document** — governance-level analysis and proposed design.
2. **No script changes** — existing gates are unaffected.
3. **No state file** — the state file would be created in a follow-up
   implementation PR if the design is approved.

### Follow-Up Work (If Approved)

| Task | Effort | Risk |
|---|---|---|
| Create `autonomy-level.json` state file with `low` default | Small | Low |
| Create `autonomy-level.md` schema doc | Small | Low |
| Add autonomy-level check to `check-self-cycle-safety-gate.js` | Medium | Low |
| Add autonomy-level read to `run-self-cycle.ps1` | Medium | Low |
| Add WebUI autonomy-level display and control | Medium | Medium |
| Constitution amendment for `high` level | Large | High |

---

## References

- [Guarded Autopilot Execute Policy](guarded-autopilot-execute-policy.md) —
  Current binary gating model
- [Self-Cycle Runner](self-cycle-runner.md) — Top-level orchestrator
- [Main Health Policy](main-health-policy.md) — Health-gated worker permissions
- [Worker Trust](worker-trust.md) — Trust-score scheduling
- [External Intake Human Gate](external-intake-human-gate.md) — Intake
  boundaries
- [Constitution Amendment Protocol](constitution-amendment-protocol.md) —
  Required for `high` level
- [Autonomy Readiness](emit-command-steward-autonomy-readiness.js) — Current
  readiness report (8 codex duties)
- [#1437](https://github.com/taoyu051818-sys/lian-nest-server/issues/1437) —
  This investigation
