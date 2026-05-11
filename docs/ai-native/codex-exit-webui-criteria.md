# Codex Exit WebUI Criteria

Documents the WebUI-visible criteria that must pass before Codex exits
routine orchestration. Each criterion maps to a WebUI surface (button,
panel, or dashboard field) so operators can verify readiness from the
browser without running CLI scripts manually.

> **Closes:** [#825](https://github.com/taoyu051818-sys/lian-nest-server/issues/825)
>
> **Complements:** [codex-exit-readiness.md](codex-exit-readiness.md)
> for the gate-level readiness checks,
> [webui-control-console.md](webui-control-console.md)
> for the full control console runbook.

---

## Purpose

This document answers: **What must the WebUI show green before Codex
steps back from per-task orchestration?**

The WebUI control console is the human-facing surface for monitoring and
controlling the self-cycle loop. When every panel, action, and indicator
listed below reports ready, an operator can run the full cycle from the
browser — and Codex is no longer needed for routine dispatch.

---

## Criteria by Surface

### 1. Launch Control

The launch-batch action and launch gate must operate without Codex
intervention.

| # | Criterion | WebUI Surface | Pass Condition | Reference |
|---|-----------|---------------|----------------|-----------|
| 1.1 | Launch gate blocks red health | Action readiness: `launch-worker` | `blockedReasons` does not contain `"health state is red"` | [webui-launch-control.md](webui-launch-control.md) |
| 1.2 | Launch gate blocks exhausted providers | Action readiness: `launch-worker` | `blockedReasons` does not contain `"no available providers"` | [control-plane-dashboard-state-actions.md](control-plane-dashboard-state-actions.md) |
| 1.3 | Launch gate blocks low-trust workers | Action readiness: `launch-worker` | `blockedReasons` does not contain trust threshold violation | [control-plane-dashboard-state-actions.md](control-plane-dashboard-state-actions.md) |
| 1.4 | Launch action preview works dry-run | `POST /api/actions/preview` for `launch-batch` | Preview returns task list without executing | [webui-action-launch-batch.md](webui-action-launch-batch.md) |
| 1.5 | MaxTasks cap enforced | Launch action parameters | Preview respects `-MaxTasks` limit; no excess workers dispatched | [webui-launch-control.md](webui-launch-control.md) |
| 1.6 | Label allowlist enforced | Launch action validation | Non-allowlisted label is rejected at preview time | [webui-launch-control.md](webui-launch-control.md) |

---

### 2. Merge Control

The merge-prs action must enforce guard checks and health gates without
Codex triage.

| # | Criterion | WebUI Surface | Pass Condition | Reference |
|---|-----------|---------------|----------------|-----------|
| 2.1 | Merge blocked on red health | Action readiness: `merge-pr` | `blockedReasons` does not contain `"health state is red"` | [control-plane-dashboard-state-actions.md](control-plane-dashboard-state-actions.md) |
| 2.2 | Merge blocked on high risk | Action readiness: `merge-pr` | `blockedReasons` does not contain `"risk score N exceeds threshold"` | [control-plane-dashboard-state-actions.md](control-plane-dashboard-state-actions.md) |
| 2.3 | Guard checks run in execute mode | Merge execute flow | Guards run by default unless `-SkipGuards` | [webui-merge-control.md](webui-merge-control.md) |
| 2.4 | Health gate runs post-merge | Merge execute flow | Post-merge health check runs unless `-SkipHealthGate` | [webui-merge-control.md](webui-merge-control.md) |
| 2.5 | Confirmation prompt on execute | WebUI merge dialog | Typed confirmation required before merge; `-Force` skips only in CI | [webui-merge-control.md](webui-merge-control.md) |
| 2.6 | Manifest written after merge | Audit log / manifest file | Every merge run produces a JSON manifest | [webui-merge-control.md](webui-merge-control.md) |

---

### 3. Issue Close

The issue-state action must handle label reconciliation and done-issue
closure without Codex routing.

| # | Criterion | WebUI Surface | Pass Condition | Reference |
|---|-----------|---------------|----------------|-----------|
| 3.1 | Dry-run is default | Issue-state action preview | Preview runs without `-Execute`; no issues closed | [webui-issue-control.md](webui-issue-control.md) |
| 3.2 | Explicit allowlist required | Issue-state execute parameters | Execute requires `-IssueNumbers`; no mass-close | [webui-issue-control.md](webui-issue-control.md) |
| 3.3 | Umbrella issues refused | Issue-state refuse rules | Issues with umbrella title pattern are skipped | [webui-issue-control.md](webui-issue-control.md) |
| 3.4 | Human-required issues refused | Issue-state refuse rules | Issues with `human-required` label are skipped | [webui-issue-control.md](webui-issue-control.md) |
| 3.5 | State reconciler runs read-only | Issue-state sub-call | State reconciler runs in `-DryRun` mode always | [webui-issue-control.md](webui-issue-control.md) |

---

### 4. Worker Control

Worker list and stop operations must be explicit and auditable without
Codex supervision.

| # | Criterion | WebUI Surface | Pass Condition | Reference |
|---|-----------|---------------|----------------|-----------|
| 4.1 | Worker list is live | Worker view panel | `worker.control` list action returns current workers | [webui-action-worker-control.md](webui-action-worker-control.md) |
| 4.2 | Stop requires explicit targeting | Worker stop action | All stop operations require specific `workerIds`; no wildcard | [webui-action-worker-control.md](webui-action-worker-control.md) |
| 4.3 | Stop requires reason | Worker stop action | `reason` field is mandatory for audit | [webui-action-worker-control.md](webui-action-worker-control.md) |
| 4.4 | Preview before execute | Worker stop flow | Preview mode shows affected workers before mutation | [webui-action-worker-control.md](webui-action-worker-control.md) |
| 4.5 | Dangerous action confirmation | Worker stop UI | Confirmation required (`confirm: true`) for stop | [webui-action-worker-control.md](webui-action-worker-control.md) |

---

### 5. Health State

The health gate must classify state correctly and surface it in the
dashboard without Codex interpretation.

| # | Criterion | WebUI Surface | Pass Condition | Reference |
|---|-----------|---------------|----------------|-----------|
| 5.1 | Health state is green or yellow | Dashboard health indicator | `main-health.json` state is not `red` | [main-health-policy.md](main-health-policy.md) |
| 5.2 | Health gate classifies state | `POST /api/state` response | Health state is computed, not unknown | [codex-exit-readiness-verdict.md](codex-exit-readiness-verdict.md) |
| 5.3 | Health state recorded | Dashboard state snapshot | `inputSources.healthLoaded` is `true` | [codex-exit-readiness-verdict.md](codex-exit-readiness-verdict.md) |
| 5.4 | Red state blocks non-recovery workers | Action readiness | All launch/merge actions show `blockedReasons` on red | [control-plane-dashboard-state-actions.md](control-plane-dashboard-state-actions.md) |
| 5.5 | Recovery workers permitted on red | Launch gate policy | `foundation-fix` and `health-repair` worker types pass gate on red | [main-health-policy.md](main-health-policy.md) |

---

### 6. Telemetry

Meta-signals and planning console data must be present and current so
operators can assess risk without Codex summaries.

| # | Criterion | WebUI Surface | Pass Condition | Reference |
|---|-----------|---------------|----------------|-----------|
| 6.1 | Meta-signals loaded | Planning console | `inputSources.metaSignalsLoaded` is `true` | [codex-exit-readiness-verdict.md](codex-exit-readiness-verdict.md) |
| 6.2 | Trust score visible | Planning console: Meta Signals | Trust value displayed with range 0–100 | [webui-planning-console-view.md](webui-planning-console-view.md) |
| 6.3 | Failure score visible | Planning console: Meta Signals | Failure value displayed with range 0–100 | [webui-planning-console-view.md](webui-planning-console-view.md) |
| 6.4 | Friction score visible | Planning console: Meta Signals | Friction value displayed with range 0–100 | [webui-planning-console-view.md](webui-planning-console-view.md) |
| 6.5 | Risk score visible | Planning console: Meta Signals | Risk value displayed with range 0–100 | [webui-planning-console-view.md](webui-planning-console-view.md) |
| 6.6 | Top pain category displayed | Planning console: Meta Signals | `topPain` string rendered | [webui-planning-console-view.md](webui-planning-console-view.md) |
| 6.7 | Active workers loaded | Dashboard state | `inputSources.activeWorkersLoaded` is `true` | [codex-exit-readiness-verdict.md](codex-exit-readiness-verdict.md) |
| 6.8 | Queue state loaded | Dashboard state | `inputSources.queueLoaded` is `true` | [codex-exit-readiness-verdict.md](codex-exit-readiness-verdict.md) |

---

### 7. Human-Required Gates

High-risk actions must require explicit human confirmation. These gates
survive Codex exit and are non-negotiable.

| # | Criterion | WebUI Surface | Pass Condition | Reference |
|---|-----------|---------------|----------------|-----------|
| 7.1 | Dangerous actions require reason | Confirmation dialog | Actions with `dangerous: true` require typed reason input | [webui-operation-runbook.md](webui-operation-runbook.md) |
| 7.2 | High-risk actions require typed confirmation | Confirmation dialog | High/critical risk actions require exact-phrase input | [webui-operation-runbook.md](webui-operation-runbook.md) |
| 7.3 | No auto-execute on dangerous actions | Action runner | `confirm: true` is mandatory; server rejects unconfirmed dangerous calls | [webui-action-runner.md](webui-action-runner.md) |
| 7.4 | Audit log records all mutations | Audit log panel | Every execute produces an audit entry with timestamp and payload | [webui-action-audit-store.md](webui-action-audit-store.md) |
| 7.5 | No secrets in any response | All panels | `sanitizeObject` applied to all payloads; no raw keys/tokens | [webui-control-map.md](webui-control-map.md) |
| 7.6 | Loopback-only binding | Server startup | Server binds to `127.0.0.1`; no remote access | [provider-pool-webui-security.md](provider-pool-webui-security.md) |

---

## Decision Rule

Codex exits routine orchestration when **all criteria in sections 1–7
pass** in the live WebUI. A single failing criterion in any section
means Codex continues as orchestrator for that surface.

| Section | Blocking for Exit? |
|---------|-------------------|
| 1 — Launch Control | **Yes** |
| 2 — Merge Control | **Yes** |
| 3 — Issue Close | **Yes** |
| 4 — Worker Control | **Yes** |
| 5 — Health State | **Yes** |
| 6 — Telemetry | **Yes** |
| 7 — Human-Required Gates | **Yes** |

All sections are blocking. The WebUI is the operator's single pane of
glass; every surface must be green before Codex steps back.

---

## Verification

Run the dashboard state emitter and exit readiness verdict to check
all criteria programmatically:

```bash
# Emit dashboard state (includes action readiness)
node scripts/ai/emit-control-plane-dashboard-state.js --stdout

# Emit exit readiness verdict (evaluates all gates)
node scripts/ai/emit-codex-exit-readiness.js --stdout
```

The exit readiness verdict `verdict` field must be `ready`. The
dashboard state `actionReadiness.allReady` must be `true`.

---

## References

- [codex-exit-readiness.md](codex-exit-readiness.md) — Gate definitions and CLI verification commands.
- [codex-exit-readiness-verdict.md](codex-exit-readiness-verdict.md) — Machine-readable verdict schema.
- [webui-control-console.md](webui-control-console.md) — Full control console runbook.
- [webui-control-map.md](webui-control-map.md) — Every button to backing script mapping.
- [webui-operation-runbook.md](webui-operation-runbook.md) — Human operator step-by-step runbook.
- [control-plane-dashboard-state-actions.md](control-plane-dashboard-state-actions.md) — Dashboard state v2 with action readiness.
- [codex-retirement-runbook.md](codex-retirement-runbook.md) — Full retirement criteria.
