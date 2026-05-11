# First AppModule Composition — Migration Guide

Step-by-step execution instructions for the first AppModule composition implementation slice. This guide converts the architecture plan into a concrete PR.

## Prerequisites

All three foundation issues must be merged to main before starting:

- [ ] **#50 / PR #53** — Prisma client auto-generation (`npm run check` and `npm run build` pass)
- [ ] **#51 / PR #54** — Repository boundary guard allowlist (`npm test` passes with `src/database/**` and `src/redis/**`)
- [ ] **#52 / PR #55** — Test env defaults (`npm test -- --runInBand` passes without developer shell env)

If any are unmerged, create the branch as draft and note the blocker in the PR body.

### Pre-Flight Verification

After all three PRs merge, verify main is green:

```bash
git checkout main && git pull
npm run check            # TypeScript compiles
npm run build            # Production build succeeds
npm test -- --runInBand  # All tests pass
npx prisma validate      # Schema valid
```

If any command fails, do not proceed. Investigate and fix on main first.

## Branch Setup

```bash
git checkout main
git pull
git checkout -b feat/appmodule-first-composition-slice
```

## Step 1: Edit `src/app.module.ts`

This is the only file changed in this PR.

### Current State

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from './config';
import { HealthModule } from './health';

@Module({
  imports: [ConfigModule, HealthModule],
})
export class AppModule {}
```

### Target State

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from './config';
import { HealthModule } from './health';
import { DatabaseModule } from './database';
import { RedisModule } from './redis';
import { RepositoryModule } from './repositories';

@Module({
  imports: [ConfigModule, HealthModule, DatabaseModule, RedisModule, RepositoryModule],
})
export class AppModule {}
```

### Changes

1. Add `import { DatabaseModule } from './database';`
2. Add `import { RedisModule } from './redis';`
3. Add `import { RepositoryModule } from './repositories';`
4. Add `DatabaseModule, RedisModule, RepositoryModule` to the `imports` array (after HealthModule)

### Import Order

The order in the imports array follows the dependency direction:

1. **ConfigModule** — must be first; all @Global modules depend on it
2. **HealthModule** — no dependencies, already wired
3. **DatabaseModule** — @Global, provides PrismaService
4. **RedisModule** — @Global, provides RedisService and REDIS_CLIENT
5. **RepositoryModule** — depends on infrastructure above (when providers are upgraded)

## Step 2: Validate

Run each command. All must pass.

```bash
# 1. Prisma schema
npx prisma validate

# 2. TypeScript
npm run check

# 3. Production build
npm run build

# 4. Tests (includes app.module.spec.ts, repository boundary guard)
npm test -- --runInBand

# 5. Whitespace
git diff --check
```

### Expected Results

| Command | Expected | Failure Indicates |
|---------|----------|-------------------|
| `npx prisma validate` | Valid schema | Schema syntax error (should not happen — no schema changes) |
| `npm run check` | No errors | Missing module export, circular import, type error |
| `npm run build` | Success | Compilation error, missing barrel export |
| `npm test -- --runInBand` | All pass | DI resolution failure, boundary guard violation, missing test env |
| `git diff --check` | No output | Trailing whitespace in edited file |

### If `npm run check` Fails

- **"Cannot find module './database'"** — DatabaseModule barrel export is missing. Check `src/database/index.ts`.
- **"Circular dependency"** — A module imports AppModule. Check import chains.
- **"PrismaClient not found"** — Issue #50 did not merge. Run `npx prisma generate` manually or wait for #53.

### If `npm test` Fails

- **Repository boundary guard** — Issue #51 did not merge. The guard rejects `src/database/**` or `src/redis/**` imports.
- **"DATABASE_URL is required"** — Issue #52 did not merge. Tests lack the default env value.
- **"Cannot resolve dependency"** — A provider in RepositoryModule, DatabaseModule, or RedisModule has an unmet dependency. Check `@Injectable()` decorators and module exports.

## Step 3: Commit and Push

```bash
git add src/app.module.ts
git commit -m "feat: wire DatabaseModule, RedisModule, and RepositoryModule into AppModule

First composition slice: infrastructure modules with no endpoint behavior.
All providers are @Global, lazy-connect, or skeleton (throw 'not implemented').

Depends on: #50, #51, #52
Closes #57"
git push -u origin feat/appmodule-first-composition-slice
```

## Step 4: Open PR

```bash
gh pr create --title "feat: first AppModule composition slice — infrastructure modules (#57)" --body "$(cat <<'EOF'
## Summary

Wires DatabaseModule, RedisModule, and RepositoryModule into AppModule. This is the first implementation slice of the staged composition plan — infrastructure modules only, no endpoint behavior.

## Linked Issues

Closes #57

Depends on (must merge first):
- #50 / #53 — Prisma client auto-generation
- #51 / #54 — Repository boundary guard infra allowlist
- #52 / #55 — Test env defaults for AppModule compile tests

## What Changes

**File:** `src/app.module.ts`

Adds three @Global infrastructure modules to the AppModule imports array:

| Module | Provides | Behavior |
|--------|----------|----------|
| DatabaseModule | PrismaService | Lazy Prisma connection, no queries until consumed |
| RedisModule | RedisService, REDIS_CLIENT | `lazyConnect: true`, no connection until consumed |
| RepositoryModule | 7 skeleton repository tokens | All providers throw `'not implemented'` |

No controllers, no endpoints, no runtime behavior change.

## Non-Goals

- Does not wire NodebbModule (medium risk, separate PR)
- Does not wire feature modules (Feed, Posts, Profile, Messages — separate PR after NodeBB)
- Does not wire AuthModule (high risk, deferred)
- Does not modify any module source files

## Validation

```
npx prisma validate       — PASS
npm run check             — PASS
npm run build             — PASS
npm test -- --runInBand   — PASS
git diff --check          — PASS
```

## Risk / Rollback

**Risk:** Low. No endpoint behavior. All infrastructure modules are lazy or skeleton.

**Rollback:** Revert `src/app.module.ts` to import only ConfigModule and HealthModule. Zero downstream impact — no feature module depends on these being wired.

## Next Slice

After this PR, wire NodebbModule.register(config). See docs/architecture/app-module-composition-plan.md Stage 3.
EOF
)"
```

## Step 5: Verify PR

```bash
gh pr view
```

Confirm:
- Title links to #57
- Body includes dependency notes for #50, #51, #52
- Only `src/app.module.ts` is changed
- CI passes (if configured)

## Rollback Procedure

If the PR needs to be reverted after merge:

```bash
git revert <merge-commit-sha>
git push
```

Or manually revert `src/app.module.ts` to:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from './config';
import { HealthModule } from './health';

@Module({
  imports: [ConfigModule, HealthModule],
})
export class AppModule {}
```

No other files need rollback. The modules themselves (DatabaseModule, RedisModule, RepositoryModule) remain in the codebase — only the composition is reverted.

## Troubleshooting

### "Module has no exported member 'DatabaseModule'"

Check that `src/database/index.ts` exports `DatabaseModule`. The barrel export was added in PR #30.

### "Module has no exported member 'RedisModule'"

Check that `src/redis/index.ts` exports `RedisModule`. The barrel export was added in PR #29.

### "Module has no exported member 'RepositoryModule'"

Check that `src/repositories/index.ts` exports `RepositoryModule`. The barrel export was added in PR #28.

### App boots but Redis connection error in logs

RedisModule uses `lazyConnect: true`. If you see connection errors, a provider is calling RedisService at startup. Check that no module eagerly invokes Redis operations in `onModuleInit`.

### `app.module.spec.ts` fails with "Cannot resolve dependency"

The test module needs to import the same modules as AppModule. Update the test to include DatabaseModule, RedisModule, and RepositoryModule in its imports, or use `overrideModule` to mock them.

## References

- [First Composition Slice — Architecture](../architecture/first-appmodule-composition-slice.md) — Risk analysis and design rationale
- [AppModule Composition Plan](../architecture/app-module-composition-plan.md) — Full 5-stage plan
- [AppModule Composition Migration Guide](app-module-composition-plan.md) — All stages
- [Repository Boundary Guard](../architecture/repository-boundary-guard.md) — Enforcement rules
