# Generated Code Policy

This document defines ownership, edit policy, and review expectations for machine-generated source artifacts in this repository.

## Generated Prisma Client

### Artifact Boundary

The generated Prisma client lives at `src/generated/prisma/**`. This directory is emitted by `prisma generate` and contains typed client code derived from `prisma/schema.prisma`.

> **Status:** The `src/generated/prisma/` directory does not yet exist on the current branch. Issue [#85](https://github.com/taoyu051818-sys/lian-nest-server/issues/85) (Prisma 7 prisma-client generator migration) will introduce it. The policy below describes expected post-#85 behavior.

### Never Hand-Edit

Files under `src/generated/prisma/**` are **generated source artifacts**. The following rules apply:

1. **No manual edits.** No worker, developer, or automation may directly modify any file in `src/generated/prisma/**`. Any hand edit will be overwritten on the next `prisma generate` run.
2. **No manual creation.** Do not create files in this directory by hand. The directory and its contents are produced exclusively by `npx prisma generate`.
3. **No checked-in drift.** If the generated output diverges from the schema, the fix is to re-run `prisma generate`, not to patch the generated file.

### How to Change Generated Output

To change what the Prisma client contains:

1. Edit `prisma/schema.prisma` (models, enums, fields, relations).
2. Run `npx prisma generate`.
3. Run `npm run check` to verify types resolve.
4. Commit both the schema change and the regenerated output.

### Regeneration Expectations

| Trigger | Action |
|---|---|
| `prisma/schema.prisma` modified | Run `npx prisma generate` before typecheck |
| `npm install` (fresh clone) | `postinstall` hook runs `prisma generate` automatically |
| CI pipeline | `prisma generate` runs as a pre-typecheck step |
| Merge conflict in generated files | Accept incoming schema, re-run `prisma generate` — do not manually merge |

### Diff Review Policy

When a PR includes changes to `src/generated/prisma/**`:

1. **Verify schema origin.** The diff must be explainable by a corresponding change in `prisma/schema.prisma`. If generated files changed but the schema did not, the PR is suspect.
2. **Detect deletions.** The guard checks for deleted generated files (`--diff-filter` includes `D`). A deleted generated file without a schema change is a violation — the schema and generated output have drifted apart.
3. **Do not review generated code line-by-line.** Focus review on the schema change. The generated output is a function of the schema and the Prisma CLI version.
4. **Check CLI version consistency.** The `prisma` and `@prisma/client` versions in `package.json` must match. A version mismatch can produce different generated output from the same schema.
5. **Flag unexpected additions.** If the generated diff introduces types, methods, or patterns not explained by the schema change, escalate to an architect before merging.

### Worker Permissions

| Worker Role | May Touch `src/generated/prisma/**`? | Notes |
|---|---|---|
| `backend-programmer` | No | Must not edit generated files. Schema changes go through `prisma/schema.prisma` only. |
| `backend-architect` | No | Reviews generated diffs for correctness but does not edit. |
| `migration-auditor` | No | Read-only review of generated output for parity checks. |
| `database-admin` | No | Owns migrations and schema, not generated client code. |
| `prisma-generate-worker` (future) | Yes | Dedicated automation that runs `prisma generate` and commits output. Not yet implemented. |

**No current worker role has write permission to `src/generated/prisma/**`.** If generated output needs updating, the owning worker modifies `prisma/schema.prisma` and includes a `prisma generate` step in its validation commands.

### Relationship to `node_modules/.prisma/client/`

The Prisma CLI generates into two locations:

- `node_modules/.prisma/client/` — runtime output consumed by `@prisma/client`. Not checked into git.
- `src/generated/prisma/` — source-level generated types (when configured). Checked into git for type safety.

This policy covers `src/generated/prisma/**` only. The `node_modules/` output is ephemeral and governed by `npm install` / `prisma generate`.

## Other Generated Artifacts

This policy applies to all generated source artifacts. Future additions (e.g., OpenAPI client stubs, protobuf output) should follow the same principles:

- Define the artifact boundary (directory path).
- State the generator command.
- Enforce never-hand-edit.
- Define which roles may trigger regeneration.
- Require diff review to trace changes back to the source definition.
