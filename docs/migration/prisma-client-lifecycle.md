# Prisma 7 Client Lifecycle -- Migration Notes

## Purpose

This document captures Prisma 7 migration-specific guidance for workers moving from Prisma 5/6 patterns or setting up the database layer for the first time. For the full lifecycle and architecture, see [Prisma Client Lifecycle (Architecture)](../architecture/prisma-client-lifecycle.md).

## What Changed in Prisma 7

### Driver Adapters Replace Binary Engines

Prisma 7 uses **driver adapters** instead of the Query Engine binary. This project uses `@prisma/adapter-pg` to connect via `node-postgres` (`pg`).

**Before (Prisma 5/6):**
```typescript
// Binary engine managed the connection internally
const prisma = new PrismaClient();
```

**After (Prisma 7, this project):**
```typescript
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });
```

Implications:
- No `engineType` field in the generator block.
- No binary engine downloads during `prisma generate`.
- Connection pooling is handled by the `pg` pool, not the Prisma engine.
- `DATABASE_URL` is consumed by the adapter at runtime, not by `prisma generate`.

### No `prisma/config.ts` Required

Prisma 7 supports an optional `prisma/config.ts` for programmatic configuration. This project does **not** use it. All configuration lives in `prisma/schema.prisma` (generator + datasource blocks) and environment variables.

Do not create `prisma/config.ts` unless a specific requirement demands it.

### `postinstall` Runs `prisma generate`

The `package.json` `postinstall` script ensures that `prisma generate` runs automatically after every `npm install`. This keeps the generated client in sync with the schema without manual intervention.

## Migration Checklist for New Workers

When setting up the database layer on a fresh clone:

```bash
# 1. Install -- triggers postinstall which runs prisma generate
npm install

# 2. Verify schema is valid
npx prisma validate

# 3. Verify types resolve
npm run check

# 4. Verify full build
npm run build
```

If step 3 fails with Prisma import errors, see the troubleshooting section in the [architecture doc](../architecture/prisma-client-lifecycle.md#troubleshooting).

## Schema Change Workflow

When modifying `prisma/schema.prisma`:

```bash
# 1. Edit prisma/schema.prisma
# 2. Regenerate the client
npx prisma generate

# 3. If adding/changing models, create a migration
npx prisma migrate dev --name <descriptive-name>

# 4. Verify types
npm run check

# 5. Verify build
npm run build
```

Never skip `prisma generate` after a schema edit. The generated client in `node_modules/.prisma/client/` must match the current schema or typecheck will fail.

## Known Blockers

### Issue #68: Generated Client Import Failure

`npm run check` currently fails because the Prisma 7 generated client types are not resolvable by TypeScript. This is tracked in [#68](https://github.com/taoyu051818-sys/lian-nest-server/issues/68).

**Impact:** The lifecycle documented here is architecturally correct, but the typecheck step (step 3 above) will fail until #68 is resolved.

**What NOT to do:** Do not change the import path (`import { PrismaClient } from '@prisma/client'`) as a workaround. The fix belongs in the generation configuration, not in consuming code.

## References

- [Prisma Client Lifecycle (Architecture)](../architecture/prisma-client-lifecycle.md) -- Full lifecycle, import pattern, troubleshooting
- [Database Strategy](../architecture/database-strategy.md) -- PostgreSQL ownership boundaries
- [ORM Recommendation](../architecture/orm-recommendation.md) -- Why Prisma was chosen
- [Issue #68](https://github.com/taoyu051818-sys/lian-nest-server/issues/68) -- Fix Prisma 7 generated client import
- [Issue #70](https://github.com/taoyu051818-sys/lian-nest-server/issues/70) -- This document
