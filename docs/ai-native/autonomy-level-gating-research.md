# Autonomy-Level Gating Research

Investigation into whether LIAN should adopt a global autonomy-level state
file inspired by Symphony's three-tier automation model (Low / Medium / High).

> **Closes:** [#1437](https://github.com/taoyu051818-sys/lian-nest-server/issues/1437)
>
> **Source evidence:** `external-agent-research/Symphony/.roo/rules/01-general-rules.md`
> (reliability: high)
>
> **See also:**
> [guarded-autopilot-execute-policy.md](guarded-autopilot-execute-policy.md)
> for the existing low-risk auto-execute model,
> [control-skill-registry.md](control-skill-registry.md) for per-skill risk
> classification,
> [health-state-schema.md](health-state-schema.md) for the health gate,
> [codex-exit-readiness.md](codex-exit-readiness.md) for retirement gates.

---

## Symphony Model (External Evidence)

Symphony defines three global automation levels that every agent checks
before any delegation action:

| Level | Behavior | Trust Model |
|-------|----------|-------------|
| **Low** | Propose only. Needs human approval for every action. | Minimal trust. Agent is a research assistant. |
| **Medium** | Implement + verify. Needs approval for deployment/merge. | Moderate trust. Agent can write code, human gates merges. |
| **High** | Fully autonomous. Agent produces issues, implements, merges. | Full trust. Human reviews only on escalation. |

The key property: **every agent checks the global autonomy level before
any delegation action.** This prevents runaway autonomous behavior while
allowing graduated trust.

---

## LIAN's Current Autonomy Architecture

LIAN does not have a single "automation level" field. Instead, autonomy
is expressed through **five independent, overlapping mechanisms**:

### 1. Health State (green / yellow / red / black)

The health gate in `.github/ai-state/main-health.json` controls whether
workers may launch:

| Health | Workers Allowed |
|--------|----------------|
| `green` | All |
| `yellow` | `fix-only`, `docs` |
| `red` | None |
| `black` | None |

**Gap:** Health is reactive (responds to CI failures), not proactive
(a deliberate trust setting). A green health state does not mean the
operator trusts autonomous operation.

### 2. Control Skill Risk Levels (low / medium / high / critical)

Each skill in the control skill registry carries a risk level that
governs confirmation requirements:

| Risk | Confirmation | Eligible for Guarded Execute |
|------|-------------|------------------------------|
| `low` | Optional | Yes |
| `medium` | Required | No |
| `high` | Required + human gate | No |
| `critical` | Typed phrase + reason | No |

**Gap:** Risk is per-skill, not global. There is no way for an operator
to say "I want everything to require confirmation today" without
modifying each skill individually.

### 3. Guarded Autopilot Execute (`-Execute -Guarded`)

A mode flag that auto-executes low-risk tasks when all 8 preconditions
pass (green health, low risk, bounded allowlists, preview-first, etc.).

**Gap:** Binary (on/off). No graduated middle ground between "every step
needs confirmation" and "low-risk tasks auto-execute."

### 4. Codex Exit Readiness (7 gates)

Evaluates whether Codex can exit routine orchestration. Verdict is
`ready`, `partial`, or `not_ready`.

**Gap:** Forward-looking (are we ready to retire Codex?), not
backward-looking (what is the operator's trust level right now?).

### 5. External Intake Human Gate (4 boundaries)

Blocks ideas that match high-risk, policy-change, auth/security, or
broad-direction boundaries until a human approves.

**Gap:** Applies only to the intake pipeline, not to the self-cycle
runner or worker dispatch.

---

## Gap Analysis

The five mechanisms above are well-designed for their specific domains.
What is missing is a **global, operator-controlled trust parameter** that
the self-cycle runner checks before each action.

Consider these scenarios:

| Scenario | Current Behavior | With Autonomy Level |
|----------|-----------------|---------------------|
| Operator wants to pause all autonomous work for a day | Must manually gate every cycle | Set `autonomy-level: low` — all actions require confirmation |
| Green health, but operator doesn't trust autonomous merges | Guarded execute would auto-run low-risk tasks | Set `autonomy-level: low` — overrides guarded execute |
| First week of Codex retirement | Must babysit every step | Set `autonomy-level: low`, gradually increase as trust builds |
| Operator on vacation, wants limited autonomous operation | No explicit control | Set `autonomy-level: medium` — workers implement, merge is human-gated |

---

## Proposed Design

### State File

**Path:** `.github/ai-state/autonomy-level.json`

```json
{
  "schemaVersion": 1,
  "level": "low",
  "capturedAt": "2026-05-13T00:00:00.000Z",
  "setBy": "repo-owner",
  "reason": "Initial state — conservative default"
}
```

### Level Definitions (LIAN-Adapted)

| Level | Self-Cycle Allowed Actions | Guarded Execute | Worker Dispatch | Issue Creation | Merge |
|-------|---------------------------|-----------------|-----------------|----------------|-------|
| **low** | Read-only preview, merge/close (with confirmation) | Disabled | Human gate | Disabled | Human gate |
| **medium** | All preview + implement (guarded eligible) | Enabled (low-risk only) | Auto if low-risk | Human gate | Human gate |
| **high** | All actions including autonomous issue creation | Enabled (low-risk only) | Auto if low-risk | Auto if low-risk | Human gate |

Key invariant: **Merge is always human-gated**, regardless of autonomy
level. This aligns with the seed constitution and the codex retirement
runbook.

### Integration Points

```
autonomy-level.json
       |
       +---> self-cycle runner (Step 2: read level before dispatch)
       |
       +---> check-self-cycle-safety-gate.js (5th gate criterion)
       |
       +---> guarded-autopilot-execute-policy.md (precondition #9)
       |
       +---> issue creation pipeline (level=high required)
       |
       +--→ health gate (red/black forces level→low)
```

### Interaction with Existing Mechanisms

| Mechanism | Interaction |
|-----------|------------|
| Health gate | `red`/`black` health overrides autonomy level to `low` regardless of setting |
| Skill risk levels | Autonomy level is additive: a `high`-risk skill still requires human gate even at `high` autonomy |
| Guarded execute | `low` autonomy disables guarded execute entirely |
| Codex exit readiness | Exit readiness gates inform whether `medium`/`high` is safe, but do not enforce it |
| Human gate boundaries | Still apply at all autonomy levels |

---

## Recommendation

**Adopt, with conservative defaults and explicit operator control.**

### Rationale

1. **Fills a real gap.** The existing mechanisms are domain-specific.
   There is no global "how much do I trust the automation right now?"
   knob. This is the most common operator question during Codex
   retirement.

2. **Low implementation cost.** The self-cycle runner already reads
   `main-health.json` at Step 2. Adding an autonomy-level check is a
   single additional file read and gate criterion.

3. **Conservative default.** `low` means "behave as if everything needs
   confirmation." This is strictly safer than the current behavior
   where guarded execute can auto-run low-risk tasks.

4. **Composable with existing gates.** Autonomy level does not replace
   risk classification, health gates, or human gate boundaries. It sits
   above them as a global override.

### Implementation Path (If Approved)

| Step | Scope | Files |
|------|-------|-------|
| 1 | Define schema and write initial state file | `.github/ai-state/autonomy-level.json` |
| 2 | Document policy | `docs/ai-native/autonomy-level-gating.md` |
| 3 | Add gate criterion to safety checker | `scripts/ai/check-self-cycle-safety-gate.js` |
| 4 | Add precondition to guarded execute policy | `docs/ai-native/guarded-autopilot-execute-policy.md` |
| 5 | Wire into self-cycle runner Step 2 | `scripts/ai/run-self-cycle.ps1` |

All steps are within `docs/ai-native/**` and `scripts/ai/**` (allowed
files). No changes to `src/**`, `prisma/**`, or `package.json`.

### Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Operator forgets to reset level after maintenance | Health gate `red`/`black` auto-forces `low` |
| Level conflicts with per-skill risk | Level is additive (more restrictive wins) |
| New state file adds operational complexity | Single JSON file, same pattern as `main-health.json` |
| Level drift (set to `high` and forgotten) | Codex exit readiness gates check alignment |

---

## Conclusion

Symphony's three-tier autonomy model addresses a gap in LIAN's control
plane: a global, operator-controlled trust parameter. The existing
health gates, skill risk levels, and guarded execute policies are
well-designed but domain-specific. An `autonomy-level.json` state file
would provide a single knob that operators can use to control the
system's autonomous behavior, especially during the Codex retirement
transition.

The recommended default is `low` (conservative). The implementation is
bounded to `docs/ai-native/**` and `scripts/ai/**` and composable with
all existing gates.
