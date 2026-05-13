# Runtime Sandboxing Research

Investigates Docker container isolation as a defense-in-depth layer for
LIAN worker runtime sandboxing. Current worker isolation is entirely
logical; this research evaluates what physical container boundaries
would add and whether the complexity is justified.

> **Closes:** [#1447](https://github.com/taoyu051818-sys/lian-nest-server/issues/1447)
>
> **Source:** External research on OpenHands runtime sandboxing
> (`file://external-agent-research/OpenHands/openhands/runtime/`).
> Source class: `external-doc`, reliability tier: high.
>
> **See also:**
> [worker-permissions.md](worker-permissions.md) for file boundary definitions,
> [external-source-threat-model.md](external-source-threat-model.md) for threat model,
> [seed-constitution.md](seed-constitution.md) for immutable boundaries,
> [worker-trust.md](worker-trust.md) for trust scoring,
> [bounded-experiment-policy.md](bounded-experiment-policy.md) for experiment scoping.

---

## Current Isolation Model

LIAN workers today are isolated through five logical mechanisms. None
involve OS-level or container-level boundaries.

| Mechanism | Scope | Enforced By |
|-----------|-------|-------------|
| Git worktree per worker | Filesystem isolation (each worker has its own branch/checkout) | `batch-launch.ps1` worktree creation |
| `allowedFiles` / `forbiddenFiles` in task JSON | File write boundary | PreToolUse hook (blocks forbidden file writes) |
| Worker trust scores + behavioral policy | Decision authority | Orchestrator scheduling + `check-worker-behavior-policy.js` |
| Seed constitution immutable boundaries | Hard policy limits | Boundary guard + worker honor system |
| Launch gate + health state | Scheduling constraints | `check-launch-gate.ps1` |

### What Logical Isolation Does NOT Prevent

| Capability | Current State | Risk |
|------------|--------------|------|
| **Network access** | Workers can make arbitrary HTTP requests, `curl`, `npm install` from public registries | Exfiltration, data poisoning, C2 callbacks |
| **Package installation** | Workers can run `npm install`, `pip install`, or download arbitrary binaries | Supply chain attack, persistent backdoor |
| **Reading files outside boundary** | `forbiddenFiles` blocks **writes** only; workers can **read** any repo file | Context window poisoning, secret exposure via read |
| **Process spawning** | Workers can spawn child processes, run arbitrary shell commands | Resource exhaustion, hidden computation |
| **Environment variable access** | Workers inherit the host environment including secrets | Secret exfiltration via network or file write |

---

## OpenHands Approach (External Reference)

OpenHands runs agent actions in sandboxed Docker containers with these
properties:

1. **Isolated filesystem** — agents see only a mounted workspace, not the
   host filesystem.
2. **Network control** — a runtime proxy enforces allowed domains; agents
   cannot make arbitrary outbound requests.
3. **Resource limits** — CPU, memory, and disk are capped per container.
4. **Capability boundaries** — tool calls go through a runtime proxy that
   enforces what actions are permitted.
5. **No host access** — agents cannot install packages on the host, read
   host environment variables, or access host services.

This is a **physical isolation** model — the OS kernel enforces boundaries
rather than relying on the agent's compliance with policy.

---

## Gap Analysis: LIAN vs. Container Sandboxing

| Dimension | LIAN Today | With Docker Sandboxing | Gap Severity |
|-----------|-----------|----------------------|:------------:|
| Filesystem boundary | Logical (write-only enforcement via PreToolUse hook) | Physical (mount only `allowedFiles` paths as read-write) | **Medium** — write enforcement exists; read boundary missing |
| Network boundary | None | Container network namespace + proxy allowlist | **High** — no current mitigation for exfiltration or supply chain |
| Package installation | Unrestricted | Container image is immutable; no `npm install` at runtime | **High** — current trust model assumes workers don't install packages |
| Process isolation | None (shares host PID namespace) | Container PID namespace | **Low** — workers are Claude Code sessions, not arbitrary binaries |
| Resource limits | None (soft time budgets only) | cgroup limits (CPU, memory, disk) | **Medium** — straggler policy handles time; resource exhaustion unmitigated |
| Secret isolation | Workers inherit host env | Secrets injected selectively per task | **Medium** — risk exists but mitigated by no-secret-logging rules |
| Environment reproducibility | Host-dependent (Node.js version, global packages) | Pinned container image per worker class | **Low** — reproducibility nice-to-have, not a security gap |

---

## Proposed Architecture (If Pursued)

### Container Per Worker Class

Map each worker class to a container image with pre-installed
dependencies. The launcher starts a container per worker instead of
(or alongside) a git worktree.

```
┌─────────────────────────────────────────────────────────────┐
│  batch-launch.ps1                                           │
│                                                             │
│  For each task:                                             │
│    1. Create git worktree (existing)                        │
│    2. Select container image by worker class                │
│    3. Start container with:                                 │
│       - worktree mounted read-write at /workspace            │
│       - repo root mounted read-only at /repo                │
│       - network restricted to allowed domains               │
│       - resource limits from task JSON budgets              │
│       - secrets injected from task-specific env vars        │
│    4. Run Claude Code inside container                      │
│    5. Collect output, stop container                        │
└─────────────────────────────────────────────────────────────┘
```

### Image Mapping

| Worker Class | Base Image | Pre-installed | Network |
|-------------|------------|---------------|---------|
| `docs` | `node:20-slim` | None (markdown only) | Blocked |
| `tests` | `node:20-slim` + full `node_modules` | Full dev dependencies | Blocked (no npm registry) |
| `tooling` | `node:20-slim` | `scripts/` dependencies | Restricted (GitHub API only) |
| `runtime-feature` | `node:20-slim` + full `node_modules` | Full dev dependencies | Blocked |
| `runtime-foundation` | `node:20-slim` + full `node_modules` | Full dev dependencies | Blocked |
| `prisma` | `node:20-slim` + Prisma CLI | Prisma + DB drivers | Blocked |
| `review` | `node:20-slim` | None (read-only) | Blocked |
| `merge` | `node:20-slim` | Git only | Blocked |
| `state-reconciler` | `node:20-slim` | None | Blocked |
| `provider-pool` | `node:20-slim` | None | Blocked |
| `meta-loop` | `node:20-slim` | None | Blocked |

### Network Policy

```
Default: deny-all outbound

Allowlist (per worker class):
  - tooling: api.github.com (for gh CLI)
  - (no other class needs network access)
```

### Filesystem Mounts

```
/workspace           ← worktree directory (read-write)
/repo                ← repo root (read-only, for reference files)
/repo/node_modules   ← shared node_modules (read-only)
/repo/.env           ← NOT mounted (secret isolation)
```

---

## Cost-Benefit Analysis

### Benefits

| Benefit | Impact | Likelihood |
|---------|--------|------------|
| Prevent secret exfiltration via network | High | High — workers today can `curl` secrets out |
| Prevent supply chain attacks (malicious `npm install`) | High | Medium — requires a compromised prompt or injection |
| Enforce read boundary (not just write boundary) | Medium | Medium — prevents context window poisoning from sensitive files |
| Reproducible worker environment | Low | Low — nice-to-have but not security-critical |
| Resource limit enforcement | Medium | Low — straggler policy already handles runaway workers |

### Costs

| Cost | Impact | Likelihood |
|------|--------|------------|
| Docker dependency on developer machines / CI | High | Certain — requires Docker Desktop or equivalent |
| Container build and maintenance for 11 worker classes | Medium | Certain — images must stay in sync with `package.json` |
| Slower worker startup (container pull + start) | Medium | Certain — adds 10-30s per worker launch |
| Debugging complexity (logs inside containers) | Medium | Certain — harder to inspect running workers |
| Windows compatibility | High | High — Docker Desktop on Windows has WSL2 dependency, resource overhead |
| CI environment constraints | High | High — GitHub Actions runners have Docker but with resource limits |

### Verdict

The **highest-value gap** is network isolation — it is the only current
gap with no logical mitigation. Package installation risk is secondary
(attack requires prompt injection, which the threat model already
addresses at the intake layer).

**Recommendation:** If pursuing containerization, start with a
**network-only proxy** rather than full Docker sandboxing. A lightweight
outbound proxy that blocks all network except an explicit allowlist
would close the highest-severity gap without the operational cost of
full container management.

---

## Alternative: Lightweight Network Proxy

Instead of full Docker containers, a network proxy per worker process
closes the exfiltration gap with minimal infrastructure:

```
┌──────────────────────────────────────────────────┐
│  Worker process (Claude Code)                    │
│       │                                          │
│       ▼                                          │
│  HTTP_PROXY=localhost:<port>                     │
│       │                                          │
│       ▼                                          │
│  ┌──────────────────────┐                        │
│  │  Worker Network Proxy│                        │
│  │                      │                        │
│  │  - deny-all default  │                        │
│  │  - allowlist:        │                        │
│  │    api.github.com    │                        │
│  │    registry.npmjs.org│ (if npm install needed) │
│  │  - log all requests  │                        │
│  │  - rate limit        │                        │
│  └──────────────────────┘                        │
└──────────────────────────────────────────────────┘
```

**Advantages over full Docker:**
- No Docker dependency (works on any OS)
- No container image maintenance
- No startup latency
- Compatible with existing worktree-based launch
- Can be added to `batch-launch.ps1` as a pre-launch step

**Disadvantages:**
- Does not enforce filesystem read boundary
- Does not enforce resource limits
- Proxy can be bypassed if worker sets its own HTTP_PROXY (mitigated:
  clear env vars before launch)

---

## Decision Matrix

| Approach | Closes Network Gap | Closes Read Boundary | Closes Resource Gap | Operational Cost | Windows Compatible |
|----------|:------------------:|:-------------------:|:------------------:|:----------------:|:------------------:|
| Full Docker sandboxing | Yes | Yes | Yes | High | Partial (WSL2) |
| Network proxy only | Yes | No | No | Low | Yes |
| Network proxy + read-only mounts | Yes | Partial | No | Medium | Yes |
| Status quo (logical only) | No | No | No | None | Yes |

---

## Hard Boundaries

1. **Docker files are high-risk.** Per `risk-policy.json`, `docker*`,
   `Dockerfile*`, `docker-compose*` require architect review and
   foundation-fix-or-higher workers. Any implementation PR must go
   through the high-risk review path.

2. **No package.json changes.** Adding Docker dependencies (e.g.,
   `dockerode`, `docker-compose` npm packages) modifies `package.json`,
   which is a constitution-protected boundary requiring human approval.

3. **Seed constitution applies.** Container isolation cannot weaken
   existing immutable boundaries. If a container allows a worker to
   bypass `allowedFiles`, the container configuration violates the
   constitution.

4. **Launcher script changes are constitution-protected.** Modifying
   `batch-launch.ps1` to add container launching requires human approval
   per seed constitution boundary #7 ("Changing the launch gate, health
   gate, or batch launcher scripts").

---

## Follow-Up Actions

| Action | Owner | Priority | Dependency |
|--------|-------|----------|------------|
| Prototype outbound network proxy for worker processes | tooling worker | High | None |
| Evaluate Docker Desktop availability on developer machines | Human | Medium | None |
| Draft container image specs for top-3 worker classes | docs worker | Low | Docker decision |
| Add network access logging to existing worker telemetry | tooling worker | Medium | Proxy prototype |
| Update threat model with network exfiltration vector | docs worker | Medium | None |

---

## References

- [Worker Permissions](worker-permissions.md) — 11 worker class file boundaries
- [External Source Threat Model](external-source-threat-model.md) — Threat categories for external data
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
- [Worker Trust](worker-trust.md) — Trust scoring and scheduling
- [Bounded Experiment Policy](bounded-experiment-policy.md) — Experiment scoping
- [Backend Worker Layers](backend-worker-layers.md) — Layer model and launch order
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [External Research Intake Loop](external-research-intake-loop.md) — How external research enters the control plane
- [Risk Policy](../../.github/ai-policy/risk-policy.json) — Docker files classified as high-risk
