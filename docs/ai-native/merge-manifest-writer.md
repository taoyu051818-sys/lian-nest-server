# Merge Manifest Writer

Describes the manifest write behavior of `merge-clean-pr-batch.ps1`.
Every run produces a machine-readable manifest that records the batch
outcome, per-PR results, and any guard/eligibility failures.

> **Closes:** [#402](https://github.com/taoyu051818-sys/lian-nest-server/issues/402)

---

## Behavior

The script writes a manifest to `.ai/merge-batch-manifests/` in **all**
execution paths:

| Path | Mode | Manifest fields |
|------|------|-----------------|
| Dry-run (all eligible) | `dry-run` | PRs as `eligible`, `healthGate: "skipped"` |
| Execute (all merged) | `execute` | PRs as `merged`, `preCommit`/`postCommit`, health gate result |
| Execute (merge failure) | `execute` | Partial outcomes, `failureReason` with PR number and error |
| Execute (health gate fail) | `execute` | Full outcomes, `failureReason` with exit code |
| Blocked (guard/eligibility) | `dry-run` | `blockedPrs` with reasons, `failureReason` describing the block |

Every manifest includes a `batchId` matching `^merge-batch-[a-z0-9-]+$`.

---

## Schema Conformance

Manifests conform to `schemas/merge-manifest.schema.json`. The schema
requires:

| Field | Type | Description |
|-------|------|-------------|
| `batchId` | string | Unique batch identifier |
| `timestamp` | string | ISO 8601 UTC |
| `repository` | string | `OWNER/NAME` |
| `mode` | string | `dry-run` or `execute` |
| `prs` | array | Per-PR outcomes (min 1) |
| `blockedPrs` | array | PRs blocked before merge |
| `failureReason` | string\|null | Top-level abort reason |

Validate a manifest against the schema:

```bash
npx ajv validate -s schemas/merge-manifest.schema.json -d .ai/merge-batch-manifests/merge-batch-*.json
```

---

## Self-Test

Run a focused self-test that validates manifest write behavior without
contacting GitHub:

```bash
pwsh ./scripts/ai/merge-clean-pr-batch.ps1 -SelfTest
```

The self-test creates a temp directory, writes sample manifests (dry-run
with blocked PRs, execute success, merge failure), and verifies:

- `batchId` is present and matches the expected pattern
- `blockedPrs` is populated correctly when guards exclude PRs
- `failureReason` is set on batch abort and null on success
- `mode` is correct for each path
- Partial outcomes are preserved on merge failure

---

## Integration

- **merge-clean-pr-batch.ps1** — script that writes manifests
- **merge-manifest-schema.md** — schema documentation with examples
- **merge-policy.md** — policy flags including `requireTelemetryMarker`
- **merge-closure-sop.md** — post-merge audit procedure

---

## References

- [Merge Manifest Schema](./merge-manifest-schema.md) — Field definitions and examples
- [Controlled Auto-Merge](./controlled-auto-merge.md) — Batch merge script docs
- [Merge Policy](./merge-policy.md) — Eligibility and guard policy
