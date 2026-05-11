# Prisma 7 Client Lifecycle

## Overview

This document describes how the LIAN Nest server installs, generates, validates, and builds with Prisma 7. It captures the expected `PrismaClient` import pattern and provides troubleshooting guidance for common Prisma 7 type errors.

The project uses Prisma 7.8.0 with the **driver adapter** pattern (`@prisma/adapter-pg`), not the legacy binary engine.

## Package Inventory

| Package | Version | Role |
|---|---|---|
| `prisma` | ^7.8.0 (devDep) | CLI: schema parsing, migration, codegen |
| `@prisma/client` | ^7.8.0 | Generated client runtime + types |
| `@prisma/adapter-pg` | ^7.8.0 | Driver adapter connecting Prisma to `pg` (node-postgres) |

## Lifecycle Order

The following steps must execute in this exact sequence. Skipping or reordering steps causes type errors or stale generated code.

### 1. Install

```bash
npm install
```

Installs all dependencies including `prisma`, `@prisma/client`, and `@prisma/adapter-pg`. The `postinstall` script in `package.json` automatically runs `prisma generate` after install completes.

### 2. Generate

```bash
npx prisma generate
# or: npm run prisma:generate
```

Reads `prisma/schema.prisma` and emits the typed Prisma Client into `node_modules/.prisma/client/`. The `@prisma/client` package re-exports from that generated directory.

**When to re-run:** After any change to `prisma/schema.prisma` (adding models, modifying fields, changing the generator block). The `postinstall` script handles initial generation, but schema edits require an explicit `prisma generate`.

### 3. Validate

```bash
npx prisma validate
# or: npm run prisma:validate
```

Checks `prisma/schema.prisma` for syntactic and semantic errors without generating code or touching the database. This is a fast, offline check suitable for CI lint steps.

### 4. Typecheck

```bash
npm run check
```

Runs the TypeScript compiler in `--noEmit` mode. This is where Prisma 7 import issues surface: if `prisma generate` did not run or produced incompatible output, `tsc` reports missing members on `@prisma/client`.

### 5. Build

```bash
npm run build
```

Compiles the NestJS application. Depends on steps 1-4 having succeeded. A clean build confirms that generated types, source imports, and runtime adapters are all consistent.

### Summary: Required Order

```
npm install          # 1. install deps (triggers postinstall → prisma generate)
npx prisma generate  # 2. regenerate after any schema change
npx prisma validate  # 3. fast schema lint (CI-friendly)
npm run check        # 4. typecheck — catches import/type mismatches
npm run build        # 5. full compilation
```

## Expected PrismaClient Import Pattern

This project uses a **hand-rolled PrismaService** that extends `PrismaClient` directly with the Prisma 7 driver adapter pattern. It does **not** use `@nestjs/prisma`.

### Source: `src/database/prisma.service.ts`

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    const adapter = new PrismaPg(connectionString);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### Key characteristics

- **Import source:** `import { PrismaClient } from '@prisma/client'` -- the standard Prisma 7 import path.
- **Driver adapter:** `PrismaPg` from `@prisma/adapter-pg` is passed to `super({ adapter })`. This replaces the legacy binary engine with a direct `pg` connection.
- **No `prisma/config.ts`:** This project does not use Prisma 7's programmatic configuration file. The `datasource` block in `prisma/schema.prisma` resolves the connection URL from the `DATABASE_URL` environment variable at runtime.
- **NestJS lifecycle:** `OnModuleInit` calls `$connect()`, `OnModuleDestroy` calls `$disconnect()`. This ensures the connection pool is managed by NestJS's module lifecycle.
- **Repository pattern:** Other modules inject `PrismaService` -- no file outside `src/database/` imports from `@prisma/client` directly.

## Dependency on Issue #68

> **Status: OPEN** -- The Prisma 7 generated client import currently causes typecheck failures.

Issue [#68](https://github.com/taoyu051818-sys/lian-nest-server/issues/68) tracks the bug where `npm run check` fails after `prisma generate`:

- `@prisma/client` has no exported member `PrismaClient`
- `$connect` / `$disconnect` missing on `PrismaService`

The root cause is that the generated client output in `node_modules/.prisma/client/` is not being resolved correctly by the TypeScript compiler. The `@prisma/client` package's `index.d.ts` re-exports from `.prisma/client/default`, but the generated types may not be present or may have a different export structure in Prisma 7.

**Until #68 is resolved:**
- `npx prisma validate` passes (schema is valid).
- `npm run check` fails (generated types are not resolvable).
- The import pattern documented above (`import { PrismaClient } from '@prisma/client'`) is the **correct** Prisma 7 import -- the issue is with generation/output, not with the import statement.
- Once #68 lands, the full lifecycle (install -> generate -> validate -> check -> build) should pass cleanly.

**If you encounter these errors:** Do not change the import path. The fix belongs in the generation configuration (issue #68), not in the consuming code.

## Troubleshooting

### `@prisma/client has no exported member PrismaClient`

**Cause:** `prisma generate` either did not run, ran against a different schema, or produced output that TypeScript cannot resolve.

**Fix sequence:**
```bash
rm -rf node_modules/.prisma node_modules/@prisma/client
npm install
npx prisma generate
npm run check
```

If the error persists after a clean regenerate, check:
1. `prisma/schema.prisma` has a `generator client { provider = "prisma-client-js" }` block.
2. The `prisma` CLI version matches the `@prisma/client` version (`npx prisma --version`).
3. No `compilerOptions.paths` in `tsconfig.json` overrides `@prisma/client` resolution.

### Missing `prisma/config`

**Cause:** Prisma 7 introduced an optional `prisma/config.ts` for programmatic configuration. This project does **not** use it -- configuration is handled entirely by the `datasource` block in `prisma/schema.prisma` and the `DATABASE_URL` environment variable.

**If you see errors about missing `prisma/config`:** This likely means a Prisma plugin or documentation you are following assumes the config file exists. It is not needed for this project. Do not create it unless the project's requirements change.

### Missing `$connect` / `$disconnect` on PrismaService

**Cause:** TypeScript cannot resolve the `PrismaClient` base class, so the methods inherited from it (`$connect`, `$disconnect`, model accessors) are missing from the type.

**This is a symptom of the same root cause as "no exported member PrismaClient."** Fix the generation issue first (see above), and `$connect`/`$disconnect` will resolve automatically.

### `PrismaClient` import works but model accessors are missing

**Cause:** `prisma generate` ran against an older schema that did not include the model you are trying to access.

**Fix:**
```bash
npx prisma generate
```

Ensure `prisma/schema.prisma` contains the model definition before generating.

### `DATABASE_URL` not set at generation time

**Note:** `prisma generate` does **not** require `DATABASE_URL`. It reads the schema file and emits types. The environment variable is only needed at runtime (when `PrismaService` instantiates the `PrismaPg` adapter). If generation fails with a database connection error, the issue is elsewhere (e.g., a `prisma migrate` step, not `prisma generate`).

## Generated Client Ownership

The Prisma client generated output is a **generated source artifact**. The full policy is defined in [Generated Code Policy](../ai-native/generated-code-policy.md).

### Key Rules

- **Never hand-edit** `src/generated/prisma/**`. All changes must flow through `prisma/schema.prisma` followed by `npx prisma generate`.
- **No worker role** has direct write permission to generated Prisma files. Schema changes are the source of truth.
- **Diff review** for generated files must trace back to a corresponding schema change. If the schema did not change, the generated diff is suspect.

### Ownership Summary

| Concern | Owner |
|---|---|
| `prisma/schema.prisma` | `backend-programmer` (implementation), `backend-architect` (review) |
| `src/generated/prisma/**` | `prisma generate` CLI (no human/worker owner) |
| Migration files (`prisma/migrations/`) | `database-admin` |

## References

- [Database Strategy](./database-strategy.md) -- PostgreSQL ownership boundaries
- [ORM Recommendation](./orm-recommendation.md) -- Why Prisma was chosen
- [Generated Code Policy](../ai-native/generated-code-policy.md) -- Ownership and review rules for generated Prisma client
- [Issue #68](https://github.com/taoyu051818-sys/lian-nest-server/issues/68) -- Fix Prisma 7 generated client import (blocks full typecheck)
- [Issue #70](https://github.com/taoyu051818-sys/lian-nest-server/issues/70) -- This document
- [Issue #85](https://github.com/taoyu051818-sys/lian-nest-server/issues/85) -- Prisma 7 generator migration (introduces `src/generated/prisma/`)
- [Issue #100](https://github.com/taoyu051818-sys/lian-nest-server/issues/100) -- Generated Prisma client ownership policy
