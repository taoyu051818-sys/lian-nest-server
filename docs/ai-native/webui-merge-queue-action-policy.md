# WebUI Merge Queue Action Policy

Policy for merge queue operations exposed through the WebUI control
console. Defines the safety boundaries, allowlist rules, dry-run
defaults, gate markers, and human-required actions for all merge queue
interactions.

> **Closes:** [#818](https://github.com/taoyu051818-sys/lian-nest-server/issues/818)

---

## Scope

This policy covers every merge queue action surfaced in the WebUI:

| Action | Script | Docs |
|--------|--------|------|
| Merge PRs | `webui-merge-control.ps1` | [webui-action-merge-prs.md](webui-action-merge-prs.md) |
| Add to Queue | `ops:merge-queue` | [webui-operation-runbook.md](webui-operation-runbook.md) |
| Process Queue | `ops:merge-queue --execute` | [webui-operation-runbook.md](webui-operation-runbook.md) |
| Retry Failed | `ops:merge-queue --retry` | [webui-operation-runbook.md](webui-operation-runbook.md) |
| Reset Queue | `ops:merge-queue --reset` | [webui-operation-runbook.md](webui-operation-runbook.md) |

---

## Explicit PR Allowlist

All merge actions require an explicit PR allowlist. The system never
discovers, guesses, or auto-selects PRs.

| Rule | Enforcement |
|------|-------------|
| Inline PR numbers required | `merge-prs` action rejects empty `prNumbers` |
| No wildcard discovery | Module validates each PR number individually |
| Queue file is the source of truth | Queue actions only process PRs listed in `.ai/merge-queue.json` |
| No `*` or `all` keyword | Any attempt to merge all PRs is rejected |

When using the queue, PRs must be explicitly added via the **Add to Queue**
action before they can be processed.

---

## Dry-Run Defaults

Every merge queue action defaults to dry-run (preview) mode. Real
merges only happen when `confirm: true` is explicitly passed.

| Action | Default Mode | Execute Requires |
|--------|-------------|------------------|
| Merge PRs | preview (dry-run) | `confirm: true` on `dangerous` action |
| Process Queue | preview | `confirm: true` + `MERGE` confirmation text |
| Add to Queue | preview | `confirm: true` + `ADD` confirmation text |
| Retry Failed | preview | `confirm: true` + `RETRY` confirmation text |
| Reset Queue | preview | `confirm: true` + `RESET` confirmation text |

**Invariant:** No merge queue action mutates state without an explicit
confirmation signal. The `dangerous: true` flag on the `merge-prs` action
causes the server to reject execute calls that lack `confirm: true`.

---

## Gate Markers

Merge queue actions check gate markers before executing. A failing gate
blocks the merge.

| Gate | Path | Required State | Blocking |
|------|------|----------------|----------|
| Health gate | `.github/ai-state/main-health.json` | `green` or `yellow` | Yes |
| Action readiness | (console state) | `drain-queue` not blocked | Yes |
| Guard checks | (inline) | All guards pass | Yes (execute mode) |

### Health Gate

- Post-merge health gate runs by default after successful merges.
- The `merge-prs` action passes `-RunHealthGate` to the underlying script.
- If the health gate fails, the batch result reports `healthGate: "fail"`.

### Guard Checks

Guard checks run by default in execute mode. They enforce:

- Task boundary validation
- PR handoff structure
- Docs authority (non-blocking, warn-only)
- Generated Prisma freshness
- Secret scan
- Forbidden files

Guard failures block the merge (fail-closed). Override with `-SkipGuards`
only for troubleshooting.

---

## Human-Required Boundaries

Certain actions and conditions require a human operator — no automation
or agent may bypass these.

| Boundary | Why | Enforcement |
|----------|-----|-------------|
| `dangerous` confirmation | Irreversible state change | Server rejects without `confirm: true` |
| Confirmation text (`MERGE`, `ADD`, etc.) | Prevents accidental clicks | Operator must type exact text |
| High-risk PR review | `src/**`, `prisma/**`, auth code | Merge policy blocks auto-merge for high-risk |
| Health gate yellow/red | Main branch may be degraded | Gate blocks queue processing |
| Failed PR retry | Root cause must be investigated first | Preview shows failed PRs; operator verifies fix |

### What Agents Cannot Do

- Execute merge queue actions without `confirm: true`
- Skip the confirmation text prompt
- Override health gate failures
- Merge PRs not in the allowlist or queue file
- Bypass guard checks unless explicitly instructed by a human operator

---

## Safety Guarantees

| Guarantee | How |
|-----------|-----|
| Dry-run default | No merges without explicit confirmation |
| Explicit allowlist | PR numbers must be provided; no discovery |
| Fail-fast | Processing stops on first merge failure |
| Health gate | Post-merge health check runs by default |
| Guard checks | Boundary enforcement in execute mode |
| Audit trail | Every action writes a manifest to `.ai/` |
| Sanitized output | No raw stdout/stderr or secrets in responses |

---

## Manifest Output

Every merge queue action writes a JSON manifest for audit and WebUI
consumption:

| Action | Manifest Path |
|--------|---------------|
| Merge PRs | `.ai/webui-merge-manifests/` |
| Queue operations | `.ai/merge-batch-manifests/` |

Manifests include batch ID, timestamp, mode, PR numbers, health gate
result, guard result, and failure reason (if any).

---

## References

- [WebUI Action: merge-prs](webui-action-merge-prs.md) — merge action module contract
- [WebUI Merge Control](webui-merge-control.md) — underlying PowerShell wrapper
- [Merge Policy](merge-policy.md) — eligibility, guards, risk policy
- [Auto-Merge Queue Mode](auto-merge-queue-mode.md) — queue state and processing
- [WebUI Operation Runbook](webui-operation-runbook.md) — step-by-step queue operations
- [Controlled Auto-Merge](controlled-auto-merge.md) — batch merge script
