# Worker Architecture Decision Summary

Archives the discussion from
[#96](https://github.com/taoyu051818-sys/lian-nest-server/issues/96)
into a structured decision record. Issue #96 remains open for
further discussion.

> **Source discussion:** [#96](https://github.com/taoyu051818-sys/lian-nest-server/issues/96)
> — "讨论：沉淀 LIAN 后端 Worker 架构分层与执行规范"
>
> **See also:**
> [backend-worker-layers.md](backend-worker-layers.md) for the
> canonical layer model,
> [main-health-policy.md](main-health-policy.md) for health-gated
> launch permissions,
> [generated-code-policy.md](generated-code-policy.md) for Prisma
> client ownership,
> [worker-task-contract.md](worker-task-contract.md) for the task
> JSON schema,
> [launch-gate.md](launch-gate.md) for pre-launch validation.

---

## Decisions Made

### 1. Six-Layer Worker Model

**Decision:** Backend workers are organized into six ordered layers
with strict dependency ordering.

| # | Layer | Status |
|---|-------|--------|
| 1 | Contract / Planning | Implemented — [backend-worker-layers.md](backend-worker-layers.md) |
| 2 | Runtime Foundation | Implemented — [backend-worker-layers.md](backend-worker-layers.md) |
| 3 | Health / Diagnostic | Implemented — [backend-worker-layers.md](backend-worker-layers.md) |
| 4 | Feature / Repository | Implemented — [backend-worker-layers.md](backend-worker-layers.md) |
| 5 | Review / Audit | Implemented — [backend-worker-layers.md](backend-worker-layers.md) |
| 6 | Merge / Release | Implemented — [backend-worker-layers.md](backend-worker-layers.md) |

**Rationale:** The original discussion proposed three layers (#68/#69/#70
pattern). The owner's comment expanded this to four layers (adding
Contract/Planning as Layer 0). The final implementation settled on six
layers to also cover review/audit and merge/release as distinct phases.

**Implementation:** [backend-worker-layers.md](backend-worker-layers.md)
defines the layer model, launch order, parallelism policy, and
`blockedBy` relationships.

---

### 2. Three Gates (Launch, Review, Merge)

**Decision:** Three gates govern worker dispatch, PR quality, and
merge eligibility.

| Gate | Purpose | Status |
|------|---------|--------|
| Launch Gate | Pre-dispatch validation: health state, conflict groups, file boundaries | Implemented — [launch-gate.md](launch-gate.md) |
| Review Gate | PR quality: files within `allowedFiles`, no `forbiddenFiles` violations, handoff evidence | Implemented — [worker-task-contract.md](worker-task-contract.md) |
| Merge Gate | Merge eligibility: allowlist, non-draft, clean state, post-merge health gate | Implemented — [main-health-policy.md](main-health-policy.md) |

**Rationale:** The discussion identified that without gates, parallel
workers would regress into "anyone can touch infrastructure." Each gate
is enforced programmatically.

---

### 3. Health-Gated Launch Permissions

**Decision:** Main branch health state (green/yellow/red/black) controls
which worker types may launch.

| Main State | Allowed Layers |
|------------|---------------|
| Green | All (1–6) |
| Red (runtime) | Layer 1, Layer 2 |
| Red (health gate) | Layer 1, Layer 2, Layer 3 |
| Red (feature test) | Layer 1, Layer 2, Layer 3, Layer 5 |

**Rationale:** The discussion specified that high-risk infrastructure
tasks (database, Redis, auth, migration) must have a health gate /
failure classifier before parallel feature work proceeds. The
implementation generalized this into a state matrix.

**Implementation:** [main-health-policy.md](main-health-policy.md)
defines the matrix. [launch-gate.md](launch-gate.md) enforces it
at dispatch time.

---

### 4. Generated Prisma Client as Source Artifact

**Decision:** `src/generated/prisma/**` is a generated source artifact
that may be committed but must never be hand-edited.

| Rule | Enforcement |
|------|-------------|
| No manual edits | Guard script |
| No manual creation | Guard script |
| Schema change requires regenerate | CI step |
| Diff review traces to schema change | PR review policy |

**Rationale:** The discussion proposed that Prisma 7 generated client
should be treated as a generated artifact, not ordinary source. The
owner's comment added stale-guard and hand-edit-guard requirements.

**Implementation:** [generated-code-policy.md](generated-code-policy.md)
defines ownership, edit policy, and review expectations.

---

### 5. Task JSON Required Fields

**Decision:** Every backend worker task contract must include scheduling
metadata and boundary fields.

| Field | Purpose | Status |
|-------|---------|--------|
| `allowedFiles` | File boundary — worker may only modify these | Implemented |
| `forbiddenFiles` | Hard exclusions | Implemented |
| `conflictGroup` | Parallelism control | Implemented |
| `risk` | Risk classification (low/medium/high) | Implemented |
| `validationCommands` | Gate commands the worker must run | Implemented |
| `layer` | Worker layer assignment | Implemented |
| `rolePacket` | Actor role and description | Implemented |
| `budgets` | File count, line count, time limits | Implemented |

**Rationale:** The discussion listed `allowedFiles`, `forbiddenFiles`,
`conflictGroup`, `risk`, `validation`, `pmPhase`, `requiredReviewRoles`,
and `stragglerPolicy` as required. The owner's comment added
`sourceOfTruthDocs`, `handoffOutputs`, `blockedBy`, `mainHealthPolicy`,
and `generatedCodePolicy`. The implemented schema covers all of these
either as direct fields or as derived behavior.

**Implementation:** [worker-task-contract.md](worker-task-contract.md)
defines the full JSON schema.

---

### 6. Diagnostic Worker Before Parallel Feature Work

**Decision:** Infrastructure domains must have a health gate / failure
classifier before feature workers may run in parallel against them.

| Domain | Required Diagnostic |
|--------|-------------------|
| Database / Prisma | Prisma failure classifier |
| Redis / queues / cache | Queue health gate |
| Auth / session / guards | Auth diagnostic gate |
| Migration scripts | Migration validation gate |

**Rationale:** The discussion stated that without classifiers, workers
misdiagnose infrastructure failures as their own code bugs. The owner's
comment reinforced this as a hard prerequisite for Layer 4 launch.

**Implementation:** Layer ordering in
[backend-worker-layers.md](backend-worker-layers.md) enforces Layer 3
before Layer 4. [main-health-policy.md](main-health-policy.md) blocks
feature workers when health is red.

---

## Open Decisions

These items from the #96 discussion are not yet resolved:

| # | Topic | Status | Notes |
|---|-------|--------|-------|
| 1 | `generatedCodePolicy` as explicit task JSON field | Not implemented | Currently derived from worker role permissions, not a task-level field |
| 2 | `sourceOfTruthDocs` as explicit task JSON field | Not implemented | Workers read issue body and referenced docs; no formal field |
| 3 | `handoffOutputs` as explicit task JSON field | Not implemented | PR body serves as implicit handoff |
| 4 | `stragglerPolicy` in task JSON | Partially implemented | Stale worktree detection exists but is not a task-level field |
| 5 | Generated Prisma stale guard script | Not implemented | Policy exists but no `scripts/check-generated-prisma.js` |
| 6 | PR handoff template guard | Not implemented | No `scripts/check-pr-handoff.js` |
| 7 | NodeBB adapter auth mode diagnostic | Not implemented | No dedicated failure classifier |

---

## Downstream Issues

The #96 discussion proposed splitting into these follow-up issues.
Status as of this summary:

| Proposed Issue | Status |
|---------------|--------|
| Add backend worker layer model doc | Done — [backend-worker-layers.md](backend-worker-layers.md) |
| Add task JSON backend required fields | Done — [worker-task-contract.md](worker-task-contract.md) |
| Add generated Prisma client ownership policy | Done — [generated-code-policy.md](generated-code-policy.md) |
| Add generated Prisma stale guard | Open |
| Add PR handoff template guard | Open |
| Add main health launch policy | Done — [main-health-policy.md](main-health-policy.md) |

---

## References

- [#96 — Discussion: 沉淀 LIAN 后端 Worker 架构分层与执行规范](https://github.com/taoyu051818-sys/lian-nest-server/issues/96)
- [backend-worker-layers.md](backend-worker-layers.md)
- [main-health-policy.md](main-health-policy.md)
- [generated-code-policy.md](generated-code-policy.md)
- [worker-task-contract.md](worker-task-contract.md)
- [launch-gate.md](launch-gate.md)
- [command-steward-agent.md](command-steward-agent.md)
