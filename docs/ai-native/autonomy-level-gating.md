# Autonomy Level Gating

Investigates whether a global autonomy level concept — inspired by
Symphony's three-tier automation model — would improve LIAN's
governance safety. Maps Symphony's levels to LIAN's existing systems,
identifies the gap, and proposes a minimal `autonomy-level.json` state
file.

> **Closes:** [#1412](https://github.com/taoyu051818-sys/lian-nest-server/issues/1412)
>
> **Source:**
> Symphony `.roo/rules/01-general-rules.md` — three automation levels
> (Low / Medium / High) with per-agent enforcement.
>
> **See also:**
> [guarded-autopilot-execute-policy.md](guarded-autopilot-execute-policy.md)
> for the existing graduated execute model,
> [external-intake-human-gate.md](external-intake-human-gate.md) for
> the binary human gate,
> [control-skill-registry.md](control-skill-registry.md) for the risk
> classification model,
> [self-cycle-runner.md](self-cycle-runner.md) for the standard
> orchestrator.

---

## Source Pattern: Symphony

Symphony defines three global automation levels. Every agent checks the
current level before any delegation action:

| Level | Label | Allowed Actions | Human Gate |
|-------|-------|-----------------|------------|
| **Low** | Propose only | Generate plans, suggest changes, produce previews | All side-effects require approval |
| **Medium** | Implement + verify | Low + execute code changes, run tests, open PRs | Deployment and destructive ops require approval |
| **High** | Fully autonomous | Medium + merge, deploy, create issues, close issues | Only constitution-level boundaries require approval |

Key design properties:

1. **Global state** — a single file defines the level for the entire
   system.
2. **Per-agent check** — every agent reads the level before acting.
3. **Graduated trust** — the level can be raised as confidence grows,
   lowered on failure.
4. **Override by human** — a human can always override the level for
   a specific action.

---

## LIAN's Existing Implicit Levels

LIAN does not have a named "autonomy level" enum, but the same
graduation pattern exists across four independent systems.

### 1. Self-Cycle Runner Modes

| Mode | Flag(s) | What Executes | Human Gate |
|------|---------|---------------|------------|
| Dry-run | (none) | Plans only | All side-effects |
| Plan-first | `-PlanFirst` | Proposes batch | All side-effects |
| Autopilot plan | `-AutopilotPlan` | Full dry-run pass | All side-effects |
| Execute | `-Execute` | Launches workers | Per-action confirmation |
| Guarded execute | `-Execute -Guarded` | Auto-executes low-risk | Precondition failures |

**Mapping to Symphony:** Dry-run ≈ Low. Execute ≈ Medium. Guarded
execute ≈ Medium+ (auto-execute for low-risk only). No mode maps to
High — merge remains human-owned.

### 2. Control Skill Risk Classification

| Risk | Confirmation | Auto-Execute Eligible |
|------|-------------|----------------------|
| `low` | Optional | Yes |
| `medium` | Required | No — human gate |
| `high` | Required + human gate | No — human gate |
| `critical` | Typed phrase + reason | No — human gate |

**Mapping to Symphony:** `low` risk skills are always Low-level safe.
`medium` and above require Medium-level autonomy. No skill currently
declares itself High-level autonomous.

### 3. External Intake Pipeline

| Stage | Gate | Current Behavior |
|-------|------|------------------|
| Capture | Reliability tier | All tiers recorded |
| Classify | Source class | Automatic |
| Route | Signal type | Automatic |
| Idea review | 5-criteria gate | Automatic pass/fail |
| Human gate | Boundary check | Binary block/pass |
| Issue creation | After gate | Automatic if gate passes |

**Mapping to Symphony:** The intake pipeline is effectively Medium — it
automatically creates issues when gates pass. Low would mean stopping
before issue creation. High would mean auto-launching workers on created
issues.

### 4. Health State Gating

| Health | Workers | Merge | Launch |
|--------|---------|-------|--------|
| `green` | Allowed | Allowed | Allowed |
| `yellow` | Allowed | Human gate | Human gate |
| `red` | Recovery only | Blocked | Blocked |
| `black` | Blocked | Blocked | Blocked |

**Mapping to Symphony:** Green health permits Medium-level operations.
Yellow forces Low. Red/Black force below-Low (recovery only).

---

## Gap Analysis

LIAN's implicit levels are **scattered and inconsistent**:

| Concern | Symphony | LIAN Current |
|---------|----------|--------------|
| Single source of truth | One file | Four independent systems |
| Per-agent check | Every agent reads level | Each system has its own gates |
| Graduated trust | Explicit level promotion | Implicit via runner flags |
| Failure response | Lower level on failure | Health degrades, but runner mode is manual |
| Human override | Override per action | Override per gate system |
| Cross-pipeline consistency | Same level applies everywhere | Intake and self-cycle are independent |

The critical gap: **no single file that the self-cycle runner, the
intake pipeline, and the control skill registry all consult before
acting.** A human must currently set the runner mode, trust the intake
pipeline's binary gate, and rely on the skill risk classification —
three separate governance surfaces.

---

## Proposed State File

### Schema

```json
{
  "schemaVersion": 1,
  "level": "low",
  "setBy": "repo-owner-handle",
  "setAt": "2026-05-13T00:00:00.000Z",
  "reason": "Initial state — conservative default",
  "overrides": [],
  "history": [
    {
      "level": "low",
      "setBy": "repo-owner-handle",
      "setAt": "2026-05-13T00:00:00.000Z",
      "reason": "Initial state"
    }
  ]
}
```

### Level Definitions

| Level | Label | Self-Cycle Allowed | Intake Allowed | Skills Allowed |
|-------|-------|-------------------|----------------|----------------|
| `low` | Propose only | Dry-run, plan-first, autopilot-plan | Capture, classify, score, route | `low` risk only |
| `medium` | Implement + verify | Low + execute (with gates) | Low + issue creation | `low` + `medium` risk |
| `high` | Fully autonomous | Medium + guarded auto-execute | Medium + auto-launch workers | `low` + `medium` + `high` risk |

### Hard Boundaries (Never Overridable by Level)

These boundaries apply regardless of autonomy level — they are
constitution-level constraints:

1. Seed constitution cannot be modified by any level.
2. `critical` risk skills always require typed phrase + reason.
3. `src/**` and `prisma/**` are never auto-executable.
4. Merge remains human-owned at `low` and `medium`.
5. Health state `red` or `black` blocks all side-effects regardless
   of level.

### Integration Points

**Self-cycle runner** (`run-self-cycle.ps1`):

```
Read autonomy-level.json
  → level = low   → force -AutopilotPlan (ignore -Execute)
  → level = medium → honor -Execute if passed
  → level = high   → honor -Execute -Guarded if passed
```

**External intake pipeline** (`propose-external-intake-issues.js`):

```
Read autonomy-level.json
  → level = low   → stop after signal routing (no issue creation)
  → level = medium → proceed through human gate to issue creation
  → level = high   → proceed through human gate + auto-launch
```

**Control skill registry** (WebUI action handler):

```
Read autonomy-level.json
  → level = low   → block execute for medium/high/critical skills
  → level = medium → block execute for high/critical skills
  → level = high   → block execute for critical skills only
```

**Safety gate** (`check-self-cycle-safety-gate.js`):

```
Add autonomy level check as gate criterion #5:
  → If action requires level X but current level < X → block
```

### Promotion / Demotion

| Trigger | Action | Actor |
|---------|--------|-------|
| Human raises level | Update file, record in history | `repo-owner` via WebUI or commit |
| Health degrades to red | Auto-demote to `low` | `auto-trigger-health-gate.js` |
| Post-merge regression | Auto-demote to `low` | `auto-trigger-health-gate.js` |
| Human lowers level | Update file, record in history | `repo-owner` via WebUI or commit |
| Constitution violation | Auto-demote to `low` | `check-constitution-health.js` |

Auto-demotion is always to `low` — never to a higher level. Promotion
always requires a human.

---

## Decision Flow

```
  ┌──────────────────────┐
  │  Action requested    │
  └──────────┬───────────┘
             │
             v
  ┌──────────────────────┐
  │  Read autonomy level │
  └──────────┬───────────┘
             │
             v
  ┌──────────────────────┐     ┌──────────────────────┐
  │  Action requires     │────▶│  Level sufficient?   │
  │  level X?            │     └──────────┬───────────┘
  └──────────────────────┘                │
                                ┌─────────┴──────────┐
                                │ No                 │ Yes
                                v                    v
                       ┌────────────────┐   ┌────────────────────┐
                       │ Block action   │   │ Existing gates     │
                       │ "Autonomy      │   │ (health, risk,     │
                       │  level too low"│   │  allowlist, human) │
                       └────────────────┘   └────────┬───────────┘
                                                     │
                                                     v
                                            ┌────────────────┐
                                            │ Gate pass?     │
                                            └────────┬───────┘
                                           ┌─────────┴──────────┐
                                           │ No                 │ Yes
                                           v                    v
                                  ┌────────────────┐   ┌────────────────┐
                                  │ Block action   │   │ Execute        │
                                  └────────────────┘   └────────────────┘
```

---

## Relationship to Existing Systems

| Existing System | Interaction with Autonomy Level |
|----------------|--------------------------------|
| Guarded autopilot | Level `high` enables guarded-execute; lower levels restrict to dry-run/plan |
| Human gate | Level does not bypass human gate boundaries — it adds a pre-check |
| Risk classification | Level determines which risk tiers are auto-executable |
| Health state | Health gates are independent — health can further restrict beyond level |
| Seed constitution | Constitution boundaries are independent — level cannot weaken them |
| Autonomy readiness | Readiness verdict informs whether a level promotion is safe |

The autonomy level is **additive and upstream** — it does not replace
any existing gate. It adds a single check that all pipelines consult
before reaching their own gate logic.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Level set too high prematurely | Auto-demotion on health degradation; constitution boundaries still apply |
| Level file corrupted or missing | Default to `low` — fail-closed |
| Level bypassed by script | Guard scripts check level as gate criterion #5 |
| Level changes without audit | `history` array in the file records all changes |
| Level conflicts with runner flags | Level is more restrictive — if level says `low` but runner says `-Execute`, level wins |

---

## Implementation Scope

This document is **research only**. Implementation would require:

1. Create `.github/ai-state/autonomy-level.json` with `low` default.
2. Add level check to `check-self-cycle-safety-gate.js` (gate #5).
3. Add level check to `propose-external-intake-issues.js`.
4. Add level check to WebUI action handler.
5. Add auto-demotion to `auto-trigger-health-gate.js`.
6. Add WebUI action for level promotion/demotion.
7. Update `guarded-autopilot-execute-policy.md` to reference levels.
8. Update `external-intake-human-gate.md` to reference levels.

All changes are additive — no existing gate is weakened.

---

## Non-Goals

- This document does not modify any scripts or state files.
- This document does not weaken existing gates or the seed constitution.
- This document does not enable autonomous merge — merge remains
  human-owned at all levels except potentially `high` (which would
  require a separate constitution amendment).
- This document does not replace the guarded autopilot policy — it
  provides the upstream governance layer.

---

## References

- [Guarded Autopilot Execute Policy](guarded-autopilot-execute-policy.md) — existing graduated execute model
- [External Intake Human Gate](external-intake-human-gate.md) — binary human gate
- [External Intake Executable Loop](external-intake-executable-loop.md) — full intake pipeline
- [Control Skill Registry](control-skill-registry.md) — risk classification model
- [Self-Cycle Runner](self-cycle-runner.md) — standard orchestrator
- [Health State Schema](health-state-schema.md) — health state definitions
- [Seed Constitution](seed-constitution.md) — immutable boundaries
- [Autonomy Readiness](emit-command-steward-autonomy-readiness.js) — readiness verdict script
- [#1412](https://github.com/taoyu051818-sys/lian-nest-server/issues/1412) — this investigation
