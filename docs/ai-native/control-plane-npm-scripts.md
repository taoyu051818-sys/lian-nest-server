# Control-Plane npm Scripts

Catalog of `npm run ops:*` scripts that expose the final control-loop layer for AI-native orchestration.

---

## Script Catalog

| npm script | Entry point | Mode | Description |
|---|---|---|---|
| `ops:self-cycle` | `scripts/ai/run-self-cycle.ps1` | dry-run | Full self-cycle orchestrator: issue discovery, state reconciliation, health gate, launch gate, batch launch |
| `ops:webui` | *(not yet implemented)* | — | Provider pool dashboard placeholder; see [provider-pool-webui-architecture.md](provider-pool-webui-architecture.md) |
| `ops:resource-sample` | `scripts/ai/sample-local-resource.ps1` | read-only | Local CPU, memory, disk, and process sampling for health checks |
| `ops:resource-sample:test` | `scripts/ai/test-resource-pressure-sampler.js` | read-only | Fixture tests for green/yellow/red resource pressure classification |
| `ops:state-reconcile` | `scripts/ai/state-reconciler.ps1` | dry-run | Detects label/PR/worker state drift without mutating |
| `ops:merge-queue` | `scripts/merge-queue-assistant.js` | dry-run | Lists eligible PRs and prints copyable `gh pr merge` commands |

---

## Safety Defaults

All write-capable automation defaults to **dry-run**:

- `ops:self-cycle` — prints every step but launches no workers. Pass `-Execute` to dispatch.
- `ops:state-reconcile` — reports drift but applies no label changes. Pass `-Apply` to suggest transitions (still no auto-mutation).
- `ops:merge-queue` — lists eligible PRs and prints merge commands. Pass `--execute` to actually merge.
- `ops:resource-sample` — read-only by design; no mutation possible.
- `ops:resource-sample:test` — fixture-based; no external side effects.

---

## Prerequisites

- **PowerShell 7+** (`pwsh`) — required by `ops:self-cycle`, `ops:resource-sample`, `ops:state-reconcile`
- **Node.js >= 20** — required by `ops:resource-sample:test`, `ops:merge-queue`
- **GitHub CLI** (`gh`) — required by `ops:self-cycle`, `ops:state-reconcile`, `ops:merge-queue` for repository access
- `GH_REPO` env var or `--repo` flag — required by `ops:merge-queue` when not using a fixture

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

### Merge queue (dry-run)

```bash
npm run ops:merge-queue -- --repo owner/name
```

### Merge queue (execute)

```bash
npm run ops:merge-queue -- --repo owner/name --execute
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
