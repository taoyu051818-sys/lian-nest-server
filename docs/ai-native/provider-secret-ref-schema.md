# Provider Secret Reference Schema

Formal JSON Schema for provider secret references — pointers to locally-stored
credentials that identify providers without storing raw API keys, tokens, or
environment dumps.

> **Schema file:** [`schemas/provider-secret-ref.schema.json`](../../schemas/provider-secret-ref.schema.json)
> **Closes:** [#555](https://github.com/taoyu051818-sys/lian-nest-server/issues/555)

---

## Overview

The provider pool needs to know *where* to find a secret, not *what* the
secret is. A `ProviderSecretRef` records the source type and lookup key so
that the launcher and selector scripts can inject the correct credential into
a worker's environment at dispatch time.

| Aspect | Value |
|--------|-------|
| Schema version | `refVersion: 1` |
| JSON Schema draft | `draft-07` |
| Purpose | Reference local secrets without storing them |

---

## Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `refVersion` | `integer` (const `1`) | Schema version. Increment when the shape changes. |
| `providerId` | `string` (pattern `^provider-[a-z0-9-]+$`) | Stable provider identifier. Must match entries in provider-pool-policy.json and provider-pool.json. |
| `sourceType` | `string` enum | Where the secret lives locally. See [Source Types](#source-types). |
| `sourceKey` | `string` (1-256 chars) | Lookup key within the source. Never contains the actual secret value. |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `label` | `string` (1-128 chars) | Human-readable label (e.g. "Primary Claude credential"). |
| `capabilities` | `string[]` enum | API capabilities this credential supports. |
| `isActive` | `boolean` (default `true`) | Whether this reference is active. |
| `createdAt` | `string` (ISO-8601) | When this reference was created. |
| `notes` | `string` (max 512 chars) | Free-text notes. Must not contain secret values. |

---

## Source Types

| Source Type | `sourceKey` Meaning | Example |
|-------------|---------------------|---------|
| `env-var` | Environment variable name | `ANTHROPIC_API_KEY` |
| `credential-manager` | Windows Credential Manager target name | `lian-claude-primary` |
| `claude-settings` | Key path in `~/.claude/settings.json` | `apiKey` |

---

## Capabilities

| Capability | Description |
|------------|-------------|
| `claude-code` | Standard Claude Code API access |
| `print-mode` | Non-interactive print/pipeline mode |
| `batch` | Batch API for high-throughput processing |
| `embeddings` | Embedding model access |

---

## Security Model

### What This Schema Records

- Provider id (public identifier)
- Source type and lookup key (where to find the secret locally)
- Capabilities and label (metadata for routing)

### What This Schema Never Records

- Actual API keys, tokens, or credentials
- Cookie values or session tokens
- Environment variable values
- Contents of `~/.claude/settings.json`
- Any secret that could authenticate against an external service

The `sourceKey` field is a **pointer**, not a value. It tells the launcher
"look up `ANTHROPIC_API_KEY` in the environment" — it does not contain the
key itself.

---

## Examples

### Environment Variable Reference

```json
{
  "refVersion": 1,
  "providerId": "provider-default",
  "sourceType": "env-var",
  "sourceKey": "ANTHROPIC_API_KEY",
  "label": "Primary Claude credential",
  "capabilities": ["claude-code", "print-mode"],
  "isActive": true,
  "createdAt": "2026-05-11T12:00:00Z"
}
```

### Credential Manager Reference

```json
{
  "refVersion": 1,
  "providerId": "provider-secondary",
  "sourceType": "credential-manager",
  "sourceKey": "lian-claude-secondary",
  "label": "Secondary Claude credential",
  "capabilities": ["claude-code"],
  "isActive": true,
  "createdAt": "2026-05-11T12:00:00Z"
}
```

### Inactive Reference

```json
{
  "refVersion": 1,
  "providerId": "provider-staging",
  "sourceType": "env-var",
  "sourceKey": "STAGING_ANTHROPIC_KEY",
  "label": "Staging credential (disabled)",
  "capabilities": ["claude-code"],
  "isActive": false,
  "notes": "Quota exceeded, re-enable after 2026-06-01"
}
```

---

## Downstream Consumers

| Consumer | Fields Read | Purpose |
|----------|------------|---------|
| **Provider selector** | `providerId`, `sourceType`, `sourceKey`, `capabilities`, `isActive` | Route workers to the correct local secret. |
| **Launcher** | `sourceType`, `sourceKey` | Inject secret into worker environment at dispatch. |
| **Provider pool policy** | `providerId`, `capabilities` | Validate that policy entries have matching secret refs. |
| **Telemetry** | `providerId` | Record which provider was used (never the secret). |

---

## Validation Rules

| Rule | Enforcement |
|------|-------------|
| `sourceKey` must not contain actual secret values | Human review / policy guard |
| `providerId` must match a provider in the pool policy | Cross-file validation |
| `refVersion` must be `1` | Schema const enforcement |
| `notes` must not contain tokens or keys | Human review / policy guard |

---

## References

- [Provider Pool](provider-pool.md) — Provider pool architecture and secret flow.
- [Provider Pool Guard](provider-pool-guard.md) — Guard for quota-aware launch readiness.
- [Launch Gate](launch-gate.md) — Pre-launch health and provider availability checks.
