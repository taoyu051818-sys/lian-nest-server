# Provider WebUI Schema Index

Maps every JSON schema used by the provider pool WebUI control plane
to its producer, state file, and downstream consumers.

> **Closes:** [#827](https://github.com/taoyu051818-sys/lian-nest-server/issues/827)

---

## Provider Core

| Schema | File | Doc | Producer | State Path | Consumers |
|--------|------|-----|----------|------------|-----------|
| `ProviderPoolState` | [`schemas/provider-pool.schema.json`](../../schemas/provider-pool.schema.json) | [provider-pool-schema.md](provider-pool-schema.md) | `update-provider-state.ps1` | `.github/ai-state/provider-pool.json` | Launch gate, provider selector, state reconciler, monitoring |
| `ProviderAssignment` | [`schemas/provider-assignment.schema.json`](../../schemas/provider-assignment.schema.json) | [provider-assignment-schema.md](provider-assignment-schema.md) | Launcher (per dispatch) | Standalone records | Analysis, telemetry joins |
| `ProviderAssignmentState` | [`schemas/provider-assignment-state.schema.json`](../../schemas/provider-assignment-state.schema.json) | [provider-assignment-state-schema.md](provider-assignment-state-schema.md) | Launcher (post dispatch) | `.github/ai-state/provider-assignment-state.json` | Launch gate, scheduler, monitoring, state reconciler |
| `ProviderSecretRef` | [`schemas/provider-secret-ref.schema.json`](../../schemas/provider-secret-ref.schema.json) | — | Operator / config tooling | Inline in policy | Key router, launcher |

---

## Provider Key Management

| Schema | File | Doc | Producer | State Path | Consumers |
|--------|------|-----|----------|------------|-----------|
| `ProviderKeyPoolState` | [`schemas/provider-key-pool-state.schema.json`](../../schemas/provider-key-pool-state.schema.json) | [provider-key-management-webui.md](provider-key-management-webui.md) | Key pool state writer | `.github/ai-state/provider-key-pool-state.json` | WebUI Provider Settings panel |
| `ProviderKeyRouterState` | [`schemas/provider-key-router.schema.json`](../../schemas/provider-key-router.schema.json) | [provider-key-router.md](provider-key-router.md) | `provider-key-router.ps1` | `.github/ai-state/provider-key-router-state.json` | Launcher, provider selector, launch gate, monitoring |

---

## WebUI Dashboard

| Schema | File | Doc | Producer | State Path | Consumers |
|--------|------|-----|----------|------------|-----------|
| `ProviderWebUIDashboardState` | [`schemas/provider-webui-dashboard-state.schema.json`](../../schemas/provider-webui-dashboard-state.schema.json) | [control-plane-dashboard-state-actions.md](control-plane-dashboard-state-actions.md) | `emit-control-plane-dashboard-state.js` | `.github/ai-state/webui-dashboard-state.json` | WebUI dashboard |

---

## WebUI Actions

| Schema | File | Doc | Producer | State Path | Consumers |
|--------|------|-----|----------|------------|-----------|
| `WebUIActionRequest` | [`schemas/webui-action-request.schema.json`](../../schemas/webui-action-request.schema.json) | [provider-pool-webui-actions-api.md](provider-pool-webui-actions-api.md) | WebUI client (browser) | Request payload | Action handler |
| `WebUIActionResult` | [`schemas/webui-action-result.schema.json`](../../schemas/webui-action-result.schema.json) | [provider-pool-webui-actions-api.md](provider-pool-webui-actions-api.md) | Action handler | Response payload | WebUI operation console |
| `WebUIActionAudit` | [`schemas/webui-action-audit.schema.json`](../../schemas/webui-action-audit.schema.json) | [provider-pool-webui-operation-console.md](provider-pool-webui-operation-console.md) | Action handler (append) | NDJSON audit log | Audit trail viewer |

---

## WebUI Projections

| Schema | File | Doc | Producer | State Path | Consumers |
|--------|------|-----|----------|------------|-----------|
| `WebUIPlanningConsoleState` | [`schemas/webui-planning-console-state.schema.json`](../../schemas/webui-planning-console-state.schema.json) | [planning-console-state-emitter.md](planning-console-state-emitter.md) | `emit-planning-console-state.js` | `.github/ai-state/planning-console-state.json` | WebUI Planning Console |
| `WebUIQueueState` | [`schemas/webui-queue-state.schema.json`](../../schemas/webui-queue-state.schema.json) | [provider-pool-webui-api.md](provider-pool-webui-api.md) | Queue manager / state reconciler | `.github/ai-state/queue-state.json` | WebUI queue panel |

---

## Reading Order

**New to provider schemas?** Start here:

1. [provider-pool-schema.md](provider-pool-schema.md) -- canonical provider state
2. [provider-key-management-webui.md](provider-key-management-webui.md) -- key health and secret sources
3. [provider-pool-webui-architecture.md](provider-pool-webui-architecture.md) -- WebUI architecture overview
4. [provider-pool-webui-actions-api.md](provider-pool-webui-actions-api.md) -- action request/result lifecycle

---

## Security Invariants

**No secrets in any schema.** Every schema in this index is designed to store
opaque identifiers, masked references, or sanitized projections. Actual API keys,
tokens, and credentials are never committed or surfaced through the WebUI.

---

## References

- [Provider Pool Architecture](provider-pool-webui-architecture.md) -- WebUI component architecture
- [WebUI Control Map](webui-control-map.md) -- action-to-endpoint mapping
- [Docs Authority Map](docs-authority-map.md) -- documentation ownership
