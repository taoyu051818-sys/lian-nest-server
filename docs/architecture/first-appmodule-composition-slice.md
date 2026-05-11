# First AppModule Composition Implementation Slice

Defines the first safe PR that wires infrastructure modules into `AppModule` after foundation fixes land. This document converts the staged composition plan into an actionable implementation slice with concrete boundaries, risks, and validation.

## Blocked By

| Issue | PR | Status | What It Fixes |
|-------|-----|--------|---------------|
| #50 | #53 | OPEN | Prisma client auto-generation — `npm run check` and `npm run build` fail without generated `PrismaClient` |
| #51 | #54 | OPEN | Repository boundary guard allowlist — guard rejects `src/database/**` and `src/redis/**` imports |
| #52 | #55 | OPEN | Test env defaults — `npm test` fails without developer shell `DATABASE_URL` |

**All three must merge before this slice can execute.** If any are unmerged, mark the composition PR as draft and note the blocker.

## Current AppModule State

```typescript
// src/app.module.ts
@Module({
  imports: [ConfigModule, HealthModule],
})
export class AppModule {}
```

**Wired:** ConfigModule (@Global), HealthModule
**Not wired:** DatabaseModule, RedisModule, RepositoryModule, NodebbModule, FeedModule, PostsModule, ProfileModule, MessagesModule, AuthModule

## First Slice Scope

### Modules to Wire

| Module | Decorator | Depends On | Provides | Risk |
|--------|-----------|------------|----------|------|
| DatabaseModule | @Global | ConfigService (via PrismaService) | PrismaService | Low — lazy connection, no consumers yet |
| RedisModule | @Global | ConfigService | RedisService, REDIS_CLIENT | Low — lazyConnect, no consumers yet |
| RepositoryModule | — | (none at registration) | 7 skeleton repository tokens | Low — all providers throw `'not implemented'` |

### Why These Three

1. **No endpoint behavior.** None of these modules register controllers. Wiring them adds zero HTTP routes.
2. **No cross-module dependencies.** DatabaseModule and RedisModule depend only on ConfigService (already wired). RepositoryModule has no constructor dependencies.
3. **Foundation for all feature modules.** Every feature module (Feed, Posts, Profile, Messages) will eventually inject repository tokens or PrismaService. Wiring the infrastructure first establishes the DI graph without side effects.
4. **DatabaseModule was missing from the original composition plan.** It is @Global and provides PrismaService. It must be wired before RepositoryModule providers are upgraded from skeletons to real implementations.

### Modules NOT in This Slice

| Module | Why Deferred |
|--------|-------------|
| NodebbModule | Requires runtime config (baseUrl, authMode). Medium risk — fail-fast on missing env vars. Separate PR. |
| FeedModule, PostsModule, ProfileModule, MessagesModule | Expose controllers with stub endpoints. Depends on NodebbModule (some inject NodeBB providers). Separate PR after NodeBB stage. |
| AuthModule | High risk — changes security posture. Blocked on AuthModule implementation (#43 merged, but guards/strategies not yet implemented). |

## Implementation

### Files Changed

| File | Change |
|------|--------|
| `src/app.module.ts` | Add imports for DatabaseModule, RedisModule, RepositoryModule |

No other runtime source files, package files, or test files are modified.

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

### Import Order Rationale

1. ConfigModule — must be first (all others depend on it transitively)
2. HealthModule — no dependencies, already wired
3. DatabaseModule — @Global, provides PrismaService for future repository implementations
4. RedisModule — @Global, provides RedisService for cache/session acceleration
5. RepositoryModule — depends on infrastructure above (when providers are upgraded)

The order within infrastructure modules (Database before Redis before Repository) matches the dependency direction: RepositoryModule providers will eventually consume PrismaService and RedisService.

## Validation Sequence

Run these commands in order. Each must pass before committing.

```bash
# 1. Prisma schema valid
npx prisma validate

# 2. TypeScript compiles (catches missing imports, type errors)
npm run check

# 3. Production build succeeds
npm run build

# 4. All tests pass (app.module.spec.ts, repository boundary guard, etc.)
npm test -- --runInBand

# 5. No whitespace errors
git diff --check
```

### What Each Command Validates

| Command | Catches |
|---------|---------|
| `npx prisma validate` | Schema syntax errors, relation issues |
| `npm run check` | TypeScript type errors, missing module exports, circular imports |
| `npm run build` | Compilation errors, missing barrel exports |
| `npm test -- --runInBand` | DI resolution failures, repository boundary violations, missing test env defaults |
| `git diff --check` | Trailing whitespace, mixed line endings |

### Expected Test Behavior

- `app.module.spec.ts` should compile and pass — AppModule now imports more modules, but the test module should resolve all providers
- Repository boundary guard tests should pass — #51 adds `src/database/**` and `src/redis/**` to the allowlist
- No test should require a live database or Redis connection — all providers are lazy or skeleton

## Rollback

Revert `src/app.module.ts` to import only ConfigModule and HealthModule:

```typescript
@Module({
  imports: [ConfigModule, HealthModule],
})
export class AppModule {}
```

**Impact:** Zero. No feature module, controller, or test depends on these infrastructure modules being wired into AppModule. The modules themselves remain in the codebase; only the composition is reverted.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Circular dependency | Very Low | App won't start | Modules have no cross-imports; ConfigModule is @Global |
| Missing Prisma client | Low | `npm run check` fails | Blocked on #50 (Prisma client auto-generation) |
| Repository boundary guard failure | Low | `npm test` fails | Blocked on #51 (infra allowlist) |
| Missing test DATABASE_URL | Low | `npm test` fails | Blocked on #52 (test env defaults) |
| Startup connection attempt | Very Low | Startup delay/lazyConnect | RedisModule uses `lazyConnect: true`; PrismaService uses lazy connection |

## Dependency Graph After Slice

```
ConfigModule (@Global, already wired)
  ├── HealthModule (already wired)
  ├── DatabaseModule (@Global) ─── PrismaService
  ├── RedisModule (@Global) ─── RedisService, REDIS_CLIENT
  └── RepositoryModule
        ├── AUTH_REPOSITORY (skeleton)
        ├── SESSION_REPOSITORY (skeleton)
        ├── POST_METADATA_REPOSITORY (skeleton)
        ├── USER_CACHE_REPOSITORY (skeleton)
        ├── CHANNEL_READ_REPOSITORY (skeleton)
        ├── AI_RECORD_REPOSITORY (skeleton)
        └── AUDIT_EVENT_REPOSITORY (skeleton)
```

No feature module is wired yet. The DI graph contains only infrastructure and skeleton providers.

## Next Slice (Out of Scope)

After this slice merges, the next composition PR should wire **NodebbModule.register(config)**. See [AppModule Composition Plan](app-module-composition-plan.md) Stage 3 for details. That PR has medium risk because it requires runtime config and adds @Global providers.

## References

- [AppModule Composition Plan](app-module-composition-plan.md) — Full staged plan (5 stages)
- [AppModule Composition Migration Guide](../migration/app-module-composition-plan.md) — Step-by-step instructions per stage
- [Implementation Sequence](implementation-sequence.md) — Database infrastructure PR order
- [Repository Boundary Guard](repository-boundary-guard.md) — Enforcement rules for storage boundary
- [Database Strategy](database-strategy.md) — Postgres/Redis/NodeBB ownership boundaries
