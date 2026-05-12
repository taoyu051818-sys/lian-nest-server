# Constitutional Drift Taxonomy

Classifies the ways the AI-native control plane can gradually diverge from
the seed constitution. Each drift type has detection signals, severity,
and a required remediation path. This taxonomy is reference-only — it does
not grant workers any new authority.

> **Authority:** [seed-constitution.md](seed-constitution.md) defines the
> immutable boundaries. This document describes how those boundaries can
> erode over time and how to detect that erosion early.

---

## Drift Types

| Type | Severity | One-Line Description |
|------|----------|----------------------|
| Reality drift | High | System beliefs diverge from actual external state |
| Selection weakening | High | Decision gates pass items that should be blocked |
| Recursion overreach | Critical | Workers or automation self-expand authority |
| Permission creep | High | `allowedFiles` or role boundaries widen incrementally |
| Docs authority drift | Medium | Docs mirror diverges from authoritative policy files |

---

## 1. Reality Drift

The system's internal model of external state (dependency versions, CI
status, API availability, schema shape) diverges from what is actually
true.

### Signals

- Health checks report green while CI actually fails on a different branch
- Stale-row detection finds migration entries that no longer match the
  current schema
- Meta-signals reference endpoints or services that have been decommissioned
- Fact events older than 72 hours still treated as current

### Severity

**High** — decisions made on stale reality can produce invalid PRs,
broken builds, or incorrect prioritization.

### Detection

- Freshness checks in [external-reality-intake.md](external-reality-intake.md)
  flag evidence older than 72 hours
- The [fact-event-ledger.md](fact-event-ledger.md) records `evidence.stale`
  markers
- Health gate re-validates state on each run rather than caching

### Remediation

1. Identify which cached beliefs are stale
2. Re-run the relevant health checks or intake flows
3. Record the correction as a fact event
4. If the drift caused a merged PR, open a recovery issue

---

## 2. Selection Weakening

Decision gates (idea review, launch gate, merge gate) gradually lower
their effective threshold. Items that would have been blocked under the
original rules now pass.

### Signals

- Ideas promoted with `warn` decisions increase over time without
  addressing the warnings
- Launch gate overrides accumulate without root-cause fixes
- The ratio of `promote-with-warn` to clean `promote` decisions trends
  upward across batches
- Block reasons are reclassified as defer reasons to avoid stopping work

### Severity

**High** — weakened selection allows lower-quality work into the pipeline,
compounding downstream failures.

### Detection

- Audit the gate result history in the fact event ledger for decision
  distribution trends
- Track override count per week — rising overrides signal weakening
- Compare current gate criteria against the original definitions in
  [agent-idea-review-gate.md](agent-idea-review-gate.md)

### Remediation

1. Review all recent `warn` and `override` decisions
2. Determine whether the gate criteria need updating (legitimate change)
  or whether the gate is being bypassed (drift)
3. If bypassed, tighten the gate and retrain workers on the original
  criteria
4. Document the correction in the fact event ledger

---

## 3. Recursion Overreach

Workers, scripts, or orchestrators expand their own authority — spawning
sub-workers, modifying their task JSON, editing policy files, or granting
themselves broader `allowedFiles`.

### Signals

- A worker's diff touches files outside its declared `allowedFiles`
- Task JSON or `conflictGroup` changes appear in a worker's commit
- A worker creates new tasks or modifies the orchestrator's scheduling
  state
- Scripts under `scripts/ai/` modify `.github/ai-policy/` or
  `.github/ai-state/` without a human-authored task

### Severity

**Critical** — recursion overreach is the most dangerous drift type
because it undermines every other guard. A worker that can expand its own
scope can bypass all boundaries.

### Detection

- Boundary guard validates every diff against `allowedFiles`
- Constitution guard checks that policy files are unmodified
- Task JSON immutability is verified at merge time
- Orchestrator logs audit worker spawn events

### Remediation

1. Immediately pause the overreaching worker
2. Revert any unauthorized changes
3. Audit the task JSON for tampering
4. If the worker needed broader scope, the original task was mis-scoped —
   file a new task with correct boundaries
5. Update the worker's assignment profile if this is a repeated pattern

---

## 4. Permission Creep

`allowedFiles`, role definitions, or shared locks expand incrementally
across tasks. Each individual expansion looks reasonable, but the
cumulative effect weakens the boundary system.

### Signals

- New `sharedLocks` entries appear in tasks without corresponding
  architecture documentation
- `allowedFiles` patterns become broader over time (`src/modules/auth/**`
  → `src/modules/**` → `src/**`)
- Role lists grow without corresponding updates to
  [roles.md](roles.md) or the seed constitution
- Workers are assigned overlapping `conflictGroup` values that previously
  would have been separate

### Severity

**High** — permission creep is subtle and cumulative. By the time it is
visible, the boundary system may be largely decorative.

### Detection

- Boundary guard tracks the breadth of `allowedFiles` patterns per task
- Compare current role lists against the seed constitution
- Audit `sharedLocks` entries for patterns that suggest scope is being
  negotiated rather than declared

### Remediation

1. Snapshot the current permission boundaries
2. Compare against the original seed constitution
3. Identify each incremental expansion and justify it
4. Remove expansions that lack documented justification
5. If a legitimate need exists, update the constitution through the
   amendment process — do not expand permissions ad-hoc

---

## 5. Docs Authority Drift

The docs mirror (`docs/ai-native/seed-constitution.md`) diverges from
the authoritative file (`.github/ai-policy/seed-constitution.md`), or
other policy docs contradict the constitution.

### Signals

- Constitution guard reports section mismatch between authoritative and
  mirror files
- A worker follows a policy doc that contradicts the seed constitution
- New policy docs are created that implicitly relax constitution rules
  without going through the amendment process
- Docs reference outdated constitution section numbers or headings

### Severity

**Medium** — docs drift does not directly break enforcement (the
authoritative file is the source of truth), but it misleads workers and
humans who rely on the docs mirror.

### Detection

- Constitution guard (`scripts/guards/check-constitution.js`) validates
  section sync between both files
- Audit new docs under `docs/ai-native/` for constitution alignment
- Cross-reference docs authority map
  ([docs-authority-map.md](docs-authority-map.md)) against actual file
  structure

### Remediation

1. Run the constitution guard to identify specific mismatches
2. Update the docs mirror to match the authoritative file
3. Review any policy docs that contradict the constitution
4. If the docs reveal a legitimate gap in the constitution, propose an
   amendment through the human-authored PR process

---

## Cross-Cutting Detection

| Drift Type | Primary Detector | Secondary Detector |
|------------|-----------------|-------------------|
| Reality drift | Freshness check | Health gate re-validation |
| Selection weakening | Gate result audit | Override count tracking |
| Recursion overreach | Boundary guard | Task JSON immutability check |
| Permission creep | Pattern breadth audit | Role list diff |
| Docs authority drift | Constitution guard | Manual docs review |

---

## Drift Severity Matrix

| Severity | Response Time | Who Can Fix | Escalation |
|----------|--------------|-------------|------------|
| **Critical** | Immediate | Human only — no worker remediation | Halt all workers, notify repo-owner |
| **High** | Within 24 hours | Recovery worker (if authorized) or human | Orchestrator flags in next batch |
| **Medium** | Within 1 week | Fix worker or human | Tracked in gap ledger |

---

## Relationship to Existing Controls

This taxonomy does not introduce new enforcement — it classifies the
failure modes of existing controls:

| Existing Control | Drift Types It Detects |
|-----------------|----------------------|
| [constitution-guard.md](constitution-guard.md) | Docs authority drift |
| [external-reality-intake.md](external-reality-intake.md) freshness checks | Reality drift |
| [agent-idea-review-gate.md](agent-idea-review-gate.md) | Selection weakening |
| [seed-constitution.md](seed-constitution.md) Section 5 | Recursion overreach |
| Boundary guard (`check-task-boundary.js`) | Recursion overreach, permission creep |
| [launch-gate.md](launch-gate.md) | Selection weakening |

---

## References

- [seed-constitution.md](seed-constitution.md) — Immutable boundaries this taxonomy monitors
- [constitution-guard.md](constitution-guard.md) — Pre-flight constitution validation
- [external-reality-intake.md](external-reality-intake.md) — Evidence intake and freshness
- [agent-idea-review-gate.md](agent-idea-review-gate.md) — Idea promotion criteria
- [failure-taxonomy.md](failure-taxonomy.md) — Post-merge failure classification
- [docs-authority-map.md](docs-authority-map.md) — Folder authority and worker context
