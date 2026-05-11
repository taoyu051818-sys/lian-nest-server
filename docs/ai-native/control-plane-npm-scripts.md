# Control-Plane npm Scripts

Catalog of `npm run ops:*` scripts that expose the final control-loop layer for AI-native orchestration.

---

## Script Catalog

| npm script | Entry point | Mode | Description |
|---|---|---|---|
| `ops:self-cycle` | `scripts/ai/run-self-cycle.ps1` | dry-run | Full self-cycle orchestrator: issue discovery, state reconciliation, health gate, launch gate, batch launch |
| `ops:webui` | `tools/provider-pool-webui/server.js` | read-only | Local-only provider pool dashboard; `--help` for usage, `--port <n>` to override default port |
| `ops:resource-sample` | `scripts/ai/sample-local-resource.ps1` | read-only | Local CPU, memory, disk, and process sampling for health checks |
| `ops:resource-sample:test` | `scripts/ai/test-resource-pressure-sampler.js` | read-only | Fixture tests for green/yellow/red resource pressure classification |
| `ops:state-reconcile` | `scripts/ai/state-reconciler.ps1` | dry-run | Detects label/PR/worker state drift without mutating |
| `ops:merge-queue` | `scripts/merge-queue-assistant.js` | dry-run | Lists eligible PRs and prints copyable `gh pr merge` commands |
| `ops:webui:smoke` | `tools/provider-pool-webui/server.test.js` | read-only | Self-contained smoke test for WebUI server: CLI flags, HTTP endpoints, security headers, action refusal, audit redaction |
| `ops:webui:console-issue` | `scripts/ai/webui-issue-control.ps1` | dry-run | Preview-first issue close/state-reconcile wrapper for WebUI control console |
| `ops:webui:console-launch` | `scripts/ai/webui-launch-control.ps1` | dry-run | Preview-first self-cycle launch wrapper for WebUI; gates behind label allowlists, health checks, MaxTasks caps |
| `ops:webui:console-merge` | `scripts/ai/webui-merge-control.ps1` | dry-run | Preview-first merge control wrapper for WebUI; wraps merge-clean-pr-batch with enforced safety defaults |
| `ops:webui:dashboard-state` | `scripts/ai/emit-control-plane-dashboard-state.js` | read-only | Combines all control-plane state projections into a single WebUI-safe dashboard state snapshot |
| `ops:webui:control-workers` | `scripts/ai/control-workers.ps1` | dry-run | Preview-first worker control with explicit PID allowlist; supports LIST, PREVIEW, STOP modes |
| `ops:webui:worker-metrics` | `scripts/ai/sample-worker-metrics.ps1` | read-only | Samples active worker metrics (pid, cpu, memory) and projects into ai-state for WebUI dashboard |
| `ops:plan-next-batch` | `scripts/ai/plan-next-batch.ps1` | dry-run | Proposes next worker batch from open issues and migration matrices; never launches workers |
| `ops:plan:check-duplicates` | `scripts/ai/check-duplicate-route-tasks.js` | read-only | Detects duplicate route conflicts across open issues before batch launch |
| `ops:plan:write-issues` | `scripts/ai/write-planned-issues.ps1` | dry-run | Turns vetted planner output into GitHub issues; dry-run by default |

---

## Safety Defaults

All write-capable automation defaults to **dry-run**:

- `ops:self-cycle` — prints every step but launches no workers. Pass `-Execute` to dispatch.
- `ops:state-reconcile` — reports drift but applies no label changes. Pass `-Apply` to suggest transitions (still no auto-mutation).
- `ops:merge-queue` — lists eligible PRs and prints merge commands. Pass `--execute` to actually merge.
- `ops:webui` — read-only dashboard; no mutation endpoints. Binds to 127.0.0.1 only.
- `ops:resource-sample` — read-only by design; no mutation possible.
- `ops:resource-sample:test` — fixture-based; no external side effects.
- `ops:webui:smoke` — fixture-based; spawns ephemeral server, no persistent side effects.
- `ops:webui:console-issue` — preview by default; pass `-Apply` to execute issue state changes.
- `ops:webui:console-launch` — preview by default; pass `-Execute` to dispatch workers.
- `ops:webui:console-merge` — preview by default; pass `-Execute` to merge PRs.
- `ops:webui:dashboard-state` — read-only; emits sanitized state snapshot.
- `ops:webui:control-workers` — LIST mode by default; PREVIEW and STOP require explicit flags.
- `ops:webui:worker-metrics` — read-only by design; no mutation possible.
- `ops:plan-next-batch` — read-only; proposes candidates, never launches workers.
- `ops:plan:check-duplicates` — read-only; detects conflicts, does not block launches.
- `ops:plan:write-issues` — dry-run by default; pass `--execute` to create GitHub issues.

---

## Prerequisites

- **PowerShell 7+** (`pwsh`) — required by `ops:self-cycle`, `ops:resource-sample`, `ops:state-reconcile`, `ops:webui:console-*`, `ops:webui:control-workers`, `ops:webui:worker-metrics`, `ops:plan-next-batch`, `ops:plan:write-issues`
- **Node.js >= 20** — required by `ops:resource-sample:test`, `ops:merge-queue`, `ops:webui:smoke`, `ops:webui:dashboard-state`, `ops:plan:check-duplicates`
- **GitHub CLI** (`gh`) — required by `ops:self-cycle`, `ops:state-reconcile`, `ops:merge-queue`, `ops:plan-next-batch`, `ops:plan:check-duplicates`, `ops:plan:write-issues` for repository access
- `GH_REPO` env var or `--repo` flag — required by `ops:merge-queue`, `ops:plan-next-batch`, `ops:plan:check-duplicates` when not using a fixture

---

## Usage Examples

### Self-cycle (dry-run)

```bash
npm run ops:self-cycle -- -IssueLabel "agent:codex-action-needed" -Repo "owner/repo"
```

### Self-cycle (execute)

```bash
npm run ops:self-cycle -- -TaskFile ./task.json -Execute
```

### Resource sampling

```bash
npm run ops:resource-sample
npm run ops:resource-sample -- -Json
npm run ops:resource-sample -- -DryRun
```

### Resource pressure classification tests

```bash
npm run ops:resource-sample:test
```

### State reconciliation (dry-run)

```bash
npm run ops:state-reconcile -- -Repo "owner/repo"
npm run ops:state-reconcile -- -FixturePath ./state-snapshot.json
```

### Provider pool WebUI

```bash
# Start the dashboard (default port 4179)
npm run ops:webui

# Custom port
npm run ops:webui -- --port 4000

# Show help
npm run ops:webui -- --help
```

### Merge queue (dry-run)

```bash
npm run ops:merge-queue -- --repo owner/name
```

### Merge queue (execute)

```bash
npm run ops:merge-queue -- --repo owner/name --execute
```

### WebUI smoke test

```bash
npm run ops:webui:smoke
```

### WebUI console — issue control (dry-run)

```bash
npm run ops:webui:console-issue
```

### WebUI console — launch control (dry-run)

```bash
npm run ops:webui:console-launch
```

### WebUI console — merge control (dry-run)

```bash
npm run ops:webui:console-merge
```

### WebUI dashboard state

```bash
npm run ops:webui:dashboard-state
npm run ops:webui:dashboard-state -- --stdout
```

### WebUI worker control

```bash
# List workers (default)
npm run ops:webui:control-workers

# Preview stop for specific PID
npm run ops:webui:control-workers -- -Mode PREVIEW -Pid 12345
```

### WebUI worker metrics

```bash
npm run ops:webui:worker-metrics
npm run ops:webui:worker-metrics -- -Json
```

### Planning — next batch (dry-run)

```bash
npm run ops:plan-next-batch -- -Repo owner/name
npm run ops:plan-next-batch -- -Repo owner/name -Json
```

### Planning — check duplicates

```bash
npm run ops:plan:check-duplicates -- --repo owner/name
npm run ops:plan:check-duplicates -- --repo owner/name --json
```

### Planning — write issues (dry-run)

```bash
npm run ops:plan:write-issues -- -Repo owner/name
npm run ops:plan:write-issues -- -Repo owner/name -Execute
```

---

## Adding New Control-Plane Scripts

1. Create or locate the entry-point script under `scripts/` or `scripts/ai/`.
2. Add an `ops:<name>` entry in `package.json` under `"scripts"`.
3. Default all write-capable scripts to dry-run; require an explicit `--execute` or `-Execute` flag to mutate.
4. Update this document with the new row in the Script Catalog table.
5. Run `npm run check && npm run build` to validate.

---

## See Also

- [self-cycle-runner.md](self-cycle-runner.md) — full self-cycle orchestrator spec
- [state-reconciler.md](state-reconciler.md) — drift rules and fixture format
- [merge-queue-assistant.md](merge-queue-assistant.md) — merge queue eligibility and execution
- [local-resource-sampler.md](local-resource-sampler.md) — resource sampling spec
- [resource-pressure-sampler.md](resource-pressure-sampler.md) — classification thresholds
- [provider-pool-webui-architecture.md](provider-pool-webui-architecture.md) — planned WebUI architecture
- [provider-pool-webui-smoke-test.md](provider-pool-webui-smoke-test.md) — smoke test spec
- [provider-pool-webui-operation-console.md](provider-pool-webui-operation-console.md) — operation console spec
- [planning-loop.md](planning-loop.md) — planning loop and batch proposal spec
