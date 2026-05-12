# Amendment Proposal: Knowledge-Driven Scaling

Proposal to add a Knowledge-Driven Scaling section to the seed
constitution. This codifies the principle that worker dispatch and
scaling decisions must consult accumulated knowledge artifacts before
allocation — not rely on static thresholds alone.

> **Closes:** [#1171](https://github.com/taoyu051818-sys/lian-nest-server/issues/1171)
>
> **See also:**
> [seed-constitution.md](../../.github/ai-policy/seed-constitution.md) for the
> current constitution,
> [resource-slot-scheduling.md](resource-slot-scheduling.md) for the
> slot model,
> [knowledge-update-writer.md](knowledge-update-writer.md) for the
> knowledge ledger,
> [knowledge-loop-lock-policy.md](knowledge-loop-lock-policy.md) for
> lock tiers,
> [meta-signal-task-suggestions.md](meta-signal-task-suggestions.md)
> for signal-driven suggestions.

---

## 1. Amendment Metadata

```markdown
- **Target file:** .github/ai-policy/seed-constitution.md (authoritative)
- **Mirror file:** docs/ai-native/seed-constitution.md
- **Affected sections:** New section 6 (after existing section 5)
- **Proposal type:** add
- **Proposed by:** docs-worker (draft for human review)
```

---

## 2. Problem Statement

The current seed constitution defines five sections governing high-risk
boundaries, merge allowlists, main-red launch stops, legacy read-only
policy, and worker scope expansion. These sections constrain *what*
workers may do, but do not govern *how* the orchestrator decides to
scale worker count, priority, or type.

Today, scaling decisions flow through:

1. **Resource slot scheduling** (`resource-slot-scheduling.md`) — a
   four-dimension capacity model (provider quota, local machine, GitHub
   API, user-max).
2. **Meta-signal task suggestions** (`meta-signal-task-suggestions.md`)
   — a signal-driven suggestion engine that reads health, friction,
   failure, risk, cost, and trust.
3. **Planning loop** (`planning-loop.md`) — batch planning that
   consults meta-signals for wave sizing.

These systems are well-designed, but the link between *accumulated
knowledge* (fact events, knowledge entries, gap ledger) and *scaling
decisions* is implicit. There is no constitutional requirement that:

- The orchestrator consults the knowledge ledger before dispatching a
  worker into a domain where prior failures are recorded.
- Gap ledger entries influence whether a batch grows or shrinks.
- Fact event reliability tiers gate the aggressiveness of scaling.

Without this codification, the orchestrator could dispatch workers into
areas with known failures, ignore accumulated gap evidence, or scale
aggressively in domains with low-reliability evidence — all without
violating any constitutional rule.

### Evidence

| # | Source | Class | Reliability | Summary |
|---|--------|-------|-------------|---------|
| 1 | `knowledge-updates.ndjson` | state-file | High | Knowledge entries record post-merge learnings but are not required inputs to dispatch decisions |
| 2 | `gap-ledger.ndjson` | state-file | High | Gap entries record failures and stale workers but have no constitutional link to scaling |
| 3 | `fact-events.ndjson` | state-file | High | Fact event reliability tiers exist but do not gate worker scaling aggressiveness |
| 4 | `resource-slot-scheduling.md` | docs | High | Slot model uses capacity dimensions but does not consult knowledge artifacts |
| 5 | `meta-signal-task-suggestions.md` | docs | High | Suggestion engine uses computed signals but knowledge ledger is not a required input |

---

## 3. Proposed Change

Add a new section 6 to the seed constitution:

```diff
  ## 5. No Worker Scope Expansion
  ...
  If a task cannot be completed within its declared boundaries, the
  worker stops and documents the blocker. The orchestrator or a human
  decides next steps.

+ ---
+
+ ## 6. Knowledge-Driven Scaling
+
+ Worker dispatch and scaling decisions MUST consult accumulated
+ knowledge artifacts before allocation. The orchestrator MUST NOT
+ scale worker count, priority, or type based solely on static
+ thresholds or capacity headroom.
+
+ ### Required Knowledge Inputs
+
+ Before dispatching a worker, the orchestrator MUST read:
+
+ | Artifact | File | Scaling Rule |
+ |----------|------|-------------|
+ | Knowledge entries | `.github/ai-state/knowledge-updates.ndjson` | If recent entries (last 7 days) record failures in the target domain, the orchestrator MUST reduce batch size or require explicit human approval before dispatch. |
+ | Gap ledger | `.github/ai-state/gap-ledger.ndjson` | If unresolved gaps exist for the target issue area, the orchestrator MUST surface the gap count and require human acknowledgment before dispatch. |
+ | Fact events | `.github/ai-state/fact-events.ndjson` | If the most recent fact events for the target domain have reliability tier `low` or `untrusted`, the orchestrator MUST NOT auto-dispatch; human review is required. |
+ | Meta-signals | `.github/ai-state/meta-signals.json` | Existing meta-signal rules continue to apply. Knowledge artifacts supplement (not replace) meta-signal thresholds. |
+
+ ### Scaling Guardrails
+
+ 1. **No blind scaling.** The orchestrator MUST NOT increase batch
+    size when the knowledge ledger contains unresolved failures in
+    the target area.
+ 2. **Evidence-weighted priority.** Task priority MUST be adjusted
+    downward when gap ledger entries indicate repeated failures in
+    the same domain.
+ 3. **Reliability-gated dispatch.** Workers MUST NOT be auto-dispatched
+    into domains where the most recent fact events are classified as
+    `low` or `untrusted` reliability without human review.
+ 4. **Knowledge freshness.** Knowledge entries older than 30 days are
+    treated as stale and do not influence scaling decisions.
+ 5. **Transparency.** The orchestrator MUST log which knowledge
+    artifacts were consulted and what scaling adjustment was made
+    (if any) in the dispatch audit trail.
+
+ ### Exceptions
+
+ - **Main-red recovery:** When health is red, recovery workers bypass
+   knowledge-driven scaling rules. Recovery takes priority per
+   section 3.
+ - **Human override:** A human operator may explicitly override
+   knowledge-driven scaling constraints by providing a documented
+   reason in the issue or dispatch command.
+
+ ---
```

---

## 4. Impact Assessment

| Dimension | Impact |
|-----------|--------|
| Workers affected | All worker types — scaling rules apply before dispatch |
| Gates affected | Launch gate (`check-launch-gate.ps1`) — must add knowledge artifact reads |
| Policies affected | `resource-slot-scheduling.md`, `planning-loop.md`, `launch-gate.md` |
| Backward compatibility | No — existing task JSON contracts are unchanged; this adds a pre-dispatch check |

---

## 5. Three Laws Check

| Law | Question | Answer |
|-----|----------|--------|
| **Reality** | Does the proposal reflect an observed need grounded in evidence? | Yes — the knowledge ledger, gap ledger, and fact event infrastructure exist but have no constitutional link to scaling decisions. Workers can be dispatched into domains with known failures without violating any rule. |
| **Selection** | Is this the minimal change that solves the problem? | Yes — the proposal adds one section with five guardrails and two exceptions. It does not modify existing sections or require new scripts. It supplements (not replaces) existing meta-signal rules. |
| **Governed Recursion** | Does the proposal preserve the principle that no actor can expand its own authority? | Yes — the section constrains the orchestrator (the actor doing scaling) by requiring it to consult external knowledge artifacts. It does not grant any actor new authority. The human override exception preserves human final authority. |

---

## 6. Red-Team Notes

- **Misuse vector:** The orchestrator could superficially "consult" the knowledge ledger (read it but ignore findings) and claim compliance. **Mitigation:** The dispatch audit trail must log which artifacts were consulted and what adjustment was made. A constitution auditor can verify the log.
- **Unintended consequence:** Overly conservative scaling — the orchestrator may refuse to dispatch workers in domains with any recent gap entries, even if the gaps are minor. **Mitigation:** The proposal uses "reduce batch size" and "require human acknowledgment" rather than hard blocks. The human override exception provides an escape valve.
- **Stale knowledge risk:** Knowledge entries older than 30 days could block dispatch in domains that have since been fixed. **Mitigation:** Section 6, guardrail 4 explicitly treats entries older than 30 days as stale.

---

## 7. Simulation

| Scenario | Method | Result |
|----------|--------|--------|
| Dispatch into domain with recent gap entries | Manual walkthrough of planning loop + gap ledger | Orchestrator would surface gap count and require human acknowledgment — no auto-dispatch |
| Dispatch into domain with `low`-reliability fact events | Manual walkthrough of fact event routing + launch gate | Launch gate would block auto-dispatch; human review required |
| Batch size increase with unresolved knowledge failures | Manual walkthrough of resource slot model + knowledge entries | Batch size capped; human approval required to override |
| Main-red recovery with knowledge gaps | Manual walkthrough of section 3 override | Recovery workers bypass knowledge rules — correct behavior |

---

## 8. Rollout Plan

1. Human reviews and approves this proposal.
2. Merge constitution PR adding section 6 to both:
   - `.github/ai-policy/seed-constitution.md` (authoritative)
   - `docs/ai-native/seed-constitution.md` (mirror)
3. Update `resource-slot-scheduling.md` to document the knowledge-artifact pre-check.
4. Update `launch-gate.md` to include knowledge artifact reads in the pre-dispatch validation.
5. Add knowledge-artifact consultation logging to the dispatch audit trail.
6. Run constitution guard: `node scripts/guards/check-constitution.js --json`

---

## 9. Rollback Plan

1. Revert the constitution PR (removes section 6 from both files).
2. Revert any updates to `resource-slot-scheduling.md` and `launch-gate.md`.
3. Remove knowledge-artifact consultation logging from the dispatch audit trail.
4. Run constitution guard to verify integrity.

Rollback is a clean `git revert` — no downstream state requires cleanup.

---

## 10. Validation

```bash
# Docs consistency
npm run check

# Constitution guard (post-merge)
node scripts/guards/check-constitution.js --json
```

---

## Non-Goals

This proposal does NOT:

- Modify the resource slot scheduling model's four-dimension capacity logic.
- Change the meta-signal calculation formulas.
- Add new scripts or automation (knowledge reads are added to existing orchestration).
- Grant any actor new authority beyond consulting knowledge artifacts.

---

## References

- [Seed Constitution](../../.github/ai-policy/seed-constitution.md) — Authoritative constitution
- [Resource Slot Scheduling](resource-slot-scheduling.md) — Four-dimension capacity model
- [Knowledge Update Writer](knowledge-update-writer.md) — Post-merge knowledge ledger
- [Knowledge Loop Lock Policy](knowledge-loop-lock-policy.md) — Lock tiers for knowledge artifacts
- [Gap Ledger](gap-ledger.md) — Failure and gap recording
- [Fact Event Ledger](fact-event-ledger.md) — Append-only evidence ledger
- [Meta-Signal Task Suggestions](meta-signal-task-suggestions.md) — Signal-driven suggestion engine
- [Launch Gate](launch-gate.md) — Pre-launch validation
- [Planning Loop](planning-loop.md) — Batch planning
- [Constitution Amendment Template](constitution-amendment-template.md) — Proposal format
- [#1171](https://github.com/taoyu051818-sys/lian-nest-server/issues/1171) — This issue
