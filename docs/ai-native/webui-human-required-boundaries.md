# WebUI Human-Required Boundaries

Defines which operation console actions must remain human-operated and
cannot be automated by workers or agents. This document is the
authoritative reference for the `humanRequired` flag in the action
registry.

> **Closes:** [#830](https://github.com/taoyu051818-sys/lian-nest-server/issues/830)

---

## Overview

The WebUI operation console exposes controlled mutations against provider
pool state, workers, and queue entries. Most actions can be previewed
and executed through the console with typed confirmation. A subset of
actions are flagged `humanRequired: true` because they involve
irreversible impact, secrets exposure risk, or judgment calls that
automation cannot safely make.

```
┌──────────────────────────────────────────────────────────┐
│  Action Registry                                          │
│                                                           │
│  ┌─────────────────┐  ┌────────────────────────────────┐ │
│  │ Standard Actions │  │ Human-Required Actions         │ │
│  │                  │  │                                │ │
│  │ • retry          │  │ • disable provider (HIGH)      │ │
│  │ • clearCooldown  │  │ • kill stale worker            │ │
│  │ • refreshState   │  │ • override health gate         │ │
│  │ • exportAudit    │  │ • adjust global max workers    │ │
│  │ • retryBlocked   │  │ • merge / block PR             │ │
│  │ • clearStale     │  │ • launch / defer wave          │ │
│  └─────────────────┘  │ • auth / DB cutover             │ │
│                        │ • secret / token rotation       │ │
│                        └────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

## Boundary Categories

### 1. Secrets and Credentials

The WebUI never reads, displays, logs, or transmits secrets. Actions
that touch secrets are completely outside the console scope.

| Boundary | Rule | Rationale |
|----------|------|-----------|
| API key rotation | Not available in WebUI | Secrets must not cross the WebUI boundary |
| Admin token change | Restart server with new env var | Token is server-side only |
| `.env` modification | Not available in WebUI | File contains credentials |
| Provider credential source | Not available in WebUI | Workers own their own secret sources |

**Operator action:** Edit `.env` or credential files directly on the
host machine. Restart the WebUI server if the admin token changes.

---

### 2. Provider Lifecycle (High-Risk)

Provider status changes affect which workers can be dispatched. The
`provider.disable` action is `humanRequired` because disabling a provider
with active workers requires judgment about whether to drain first.

| Action | Risk | Why Human-Required |
|--------|------|--------------------|
| `provider.disable` | HIGH | Active workers may be orphaned; draining strategy depends on context |
| `provider.enable` (after auth failure) | HIGH | Re-enabling a provider with unresolved auth failure wastes dispatch slots |

**WebUI shows:** Current provider status, active worker count, last
failure class, cooldown state.

**Operator does:** Review active workers on the provider, decide whether
to drain first, then confirm disable with typed `DISABLE` phrase.

---

### 3. Worker Lifecycle (Destructive)

Killing a running worker can lose uncommitted work. The WebUI shows
worker state but does not terminate processes.

| Boundary | Rule | Rationale |
|----------|------|-----------|
| Kill stale worker | Not automated; CLI only | May have uncommitted changes in worktree |
| Force-drain provider | Not automated; CLI only | Affects all workers on that provider |
| Restart failed worker | Not automated; requires re-launch | New worktree + fresh dispatch |

**WebUI shows:** Worker status, elapsed time, last output timestamp,
stale indicator, worktree branch.

**Operator does:** Check the worktree for partial progress, then use
the worker control script:

```powershell
# Preview what would stop
./scripts/ai/control-workers.ps1 -Mode Preview -Pids <PID>

# Stop with audit trail
./scripts/ai/control-workers.ps1 -Mode Stop -Pids <PID> -Reason "Stale after 10m"
```

---

### 4. Global Pool Configuration

Changes to global concurrency limits affect system-wide throughput and
resource pressure. These require human judgment about current load.

| Action | Risk | Why Human-Required |
|--------|------|--------------------|
| Adjust `globalMaxWorkers` | MEDIUM | Raising the limit may exhaust all providers; lowering may starve the queue |
| Adjust per-provider `maxConcurrency` | MEDIUM | Affects conflict group scheduling and provider cooldown frequency |

**WebUI shows:** Current vs proposed values, pressure gauge level,
affected conflict groups.

**Operator does:** Review pressure gauge and queue depth, confirm with
typed phrase.

---

### 5. Health Gate Override

If the health gate misclassifies a flake as red, the operator can
manually override. The WebUI shows health state but does not override.

| Boundary | Rule | Rationale |
|----------|------|-----------|
| Override health state | Not automated | Misclassification risk; requires human judgment about test flakiness |

**WebUI shows:** Current health state (green/yellow/red/black), last
check timestamp, failed checks list.

**Operator does:**

```powershell
./scripts/ai/write-main-health-state.ps1 -State green -Checks "tsc,build,prisma"
```

---

### 6. PR and Wave Decisions

PR merge and wave launch decisions are human-owned because they require
diff review and architectural judgment.

| Boundary | Rule | Rationale |
|----------|------|-----------|
| Merge / block a PR | Not automated | Architectural mismatch, scope drift, or security risk may not be detectable |
| Launch / defer a wave | Not automated | Wave dependencies require reviewing the prior wave's diff |

**WebUI shows:** PR number, linked issue, conflict group, review status,
guard check results, proposed batch, launch gate report.

**Operator does:** Review PR diff, apply the
[worker acceptance checklist](worker-acceptance-checklist.md), then
merge via CLI:

```powershell
./scripts/ai/merge-clean-pr-batch.ps1 -PRs <N> -Repo owner/name -Execute -RunGuards -RunHealthGate
```

---

### 7. Auth and Database Cutover

These decisions have irreversible production impact and are completely
outside the WebUI scope.

| Boundary | Rule | Rationale |
|----------|------|-----------|
| Auth system migration | Not in WebUI | Irreversible; requires `architect` + `security-reviewer` sign-off |
| Database schema migration | Not in WebUI | Irreversible; requires migration review and rollback plan |
| Production config change | Not in WebUI | Blast radius too large for console action |

---

## Enforcement Model

The `humanRequired` flag in the action registry prevents automation:

```
Action requested
    │
    ├── humanRequired: true?
    │   ├── Yes → Display warning banner
    │   │         Disable execute button
    │   │         Show "Human required" badge
    │   │         Log to audit: "blocked (human-required)"
    │   │
    │   └── No  → Normal preview → confirm → execute flow
    │
    └── Agent/worker attempts auto-execute?
        └── Guard rejects: "action requires human operator"
```

### Guard Integration

The provider pool guard (`check-provider-pool.js`) enforces
`humanRequired` at the server level. Even if a client bypasses the UI
restriction, the guard rejects automated execution of human-required
actions.

---

## Quick Reference

| Category | Human-Required Actions | Automation Allowed |
|----------|----------------------|-------------------|
| Secrets | All secret operations | None |
| Provider | Disable, enable-after-auth-failure | Retry, clearCooldown |
| Workers | Kill, force-drain, restart | List, preview |
| Pool config | Global max, per-provider max | Refresh state, export audit |
| Health | Override health gate | View health state |
| PR/Wave | Merge, block, launch, defer | View PR status, view queue |
| Auth/DB | All cutover operations | None |

---

## References

- [WebUI Control Console Runbook](webui-control-console.md) — full console documentation
- [Provider Pool WebUI Operation Console](provider-pool-webui-operation-console.md) — action registry
- [Provider Pool WebUI Security](provider-pool-webui-security.md) — security model
- [Worker Control Actions](worker-control-actions.md) — worker stop/preview interface
- [Codex Retirement Runbook](codex-retirement-runbook.md) — human-owned decisions
- [Worker Heartbeat](worker-heartbeat.md) — stale worker detection
