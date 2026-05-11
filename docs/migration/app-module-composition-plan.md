# AppModule Composition — Migration Guide

Step-by-step migration instructions for wiring modules into `AppModule`. Follow stages in order. Each stage is one PR.

## Pre-Migration Checklist

Before starting Stage 1:

- [ ] All module skeletons merged to main (RedisModule, RepositoryModule, NodebbModule, FeedModule, PostsModule, ProfileModule, MessagesModule)
- [ ] `npm run build` passes on main
- [ ] `npm run test` passes on main
- [ ] No open PRs that modify `src/app.module.ts`

## Stage 1: Wire RedisModule

**Branch:** `feat/appmodule-stage1-redis`
**Files changed:** `src/app.module.ts`
**Lines changed:** ~3

### Steps

1. Create branch from main
2. Add `RedisModule` to AppModule imports:

```typescript
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [ConfigModule, HealthModule, RedisModule],
})
export class AppModule {}
```

3. Run validation commands (see below)
4. Commit, push, open PR

### Validation

```bash
npm run build
npm run test
npm run start:dev  # Should boot without Redis connection (lazyConnect)
```

### What to verify

- App boots without REDIS_URL set (lazy connect)
- App boots with REDIS_URL set
- No new warnings in console
- `app.module.spec.ts` passes

### Rollback

Remove `RedisModule` from imports. No downstream impact.

### Risk: Low

RedisModule is @Global and uses lazyConnect. No runtime behavior changes until a consumer explicitly calls RedisService.

---

## Stage 2: Wire RepositoryModule

**Branch:** `feat/appmodule-stage2-repository`
**Files changed:** `src/app.module.ts`
**Lines changed:** ~3

### Steps

1. Create branch from main
2. Add `RepositoryModule` to AppModule imports:

```typescript
import { RepositoryModule } from './repositories/repository.module';

@Module({
  imports: [ConfigModule, HealthModule, RedisModule, RepositoryModule],
})
export class AppModule {}
```

3. Run validation commands
4. Commit, push, open PR

### Validation

```bash
npm run build
npm run test
```

### What to verify

- All 7 repository tokens are resolvable in DI container
- No startup errors (skeleton providers are @Injectable)
- `app.module.spec.ts` passes

### Rollback

Remove `RepositoryModule` from imports. No downstream impact.

### Risk: Low

All repository providers are skeletons that throw `'not implemented'`. No feature module consumes them yet.

### Note on Prisma

RepositoryModule currently has skeleton providers. When Prisma lands (PR #30), the providers will be replaced with real implementations. This does NOT require changing AppModule imports — the provider swap happens inside RepositoryModule.

---

## Stage 3: Wire NodebbModule

**Branch:** `feat/appmodule-stage3-nodebb`
**Files changed:** `src/app.module.ts`
**Lines changed:** ~15

### Steps

1. Create branch from main
2. Add `NodebbModule.register(config)` to AppModule imports:

```typescript
import { NodebbModule } from './nodebb/nodebb.module';
import { ConfigService } from './config/config.module';

@Module({
  imports: [
    ConfigModule,
    HealthModule,
    RedisModule,
    RepositoryModule,
    NodebbModule.register({
      baseUrl: process.env.NODEBB_URL || '',
      authMode: (process.env.NODEBB_AUTH_MODE as any) || 'NONE',
      apiToken: process.env.NODEBB_API_TOKEN,
      sessionCookie: process.env.NODEBB_SESSION_COOKIE,
    }),
  ],
})
export class AppModule {}
```

3. Run validation commands
4. Commit, push, open PR

### Validation

```bash
npm run build
npm run test
npm run start:dev  # Requires NODEBB_URL in .env
```

### What to verify

- App boots with NODEBB_URL set
- App fails fast if NODEBB_URL is missing (ConfigService Joi validation)
- NodeBB providers (Topics, Posts, Users, Notifications, Tags) are globally available
- `app.module.spec.ts` passes

### Rollback

Remove `NodebbModule.register(...)` from imports. No downstream impact.

### Risk: Medium

NodebbModule requires runtime config. If env vars are missing, Joi validation in ConfigService will throw at startup. This is intentional fail-fast behavior.

### Note on Config

NodebbModule uses a static `register()` factory, not `forRoot()`. The config is read from env vars at module registration time. ConfigService's Joi validation ensures required vars are present.

---

## Stage 4: Wire Feature Skeletons

**Branch:** `feat/appmodule-stage4-features`
**Files changed:** `src/app.module.ts`
**Lines changed:** ~8

### Steps

1. Create branch from main
2. Add all 4 feature modules to AppModule imports:

```typescript
import { FeedModule } from './feed/feed.module';
import { PostsModule } from './posts/posts.module';
import { ProfileModule } from './profile/profile.module';
import { MessagesModule } from './messages/messages.module';

@Module({
  imports: [
    ConfigModule,
    HealthModule,
    RedisModule,
    RepositoryModule,
    NodebbModule.register({ /* config */ }),
    FeedModule,
    PostsModule,
    ProfileModule,
    MessagesModule,
  ],
})
export class AppModule {}
```

3. Run validation commands
4. Commit, push, open PR

### Validation

```bash
npm run build
npm run test
npm run start:dev
curl http://localhost:3000/feed      # Expect 500, 'not implemented'
curl http://localhost:3000/posts     # Expect 500, 'not implemented'
curl http://localhost:3000/profile   # Expect 500, 'not implemented'
curl http://localhost:3000/messages  # Expect 500, 'not implemented'
```

### What to verify

- All feature modules compile and register in DI container
- Controllers are reachable (500 proves the route exists)
- No circular dependency errors
- `app.module.spec.ts` passes

### Rollback

Remove all 4 feature modules from imports. No downstream impact.

### Risk: Medium

Feature endpoints are now exposed but return 500. This is expected and intentional — it proves the module graph compiles and controllers are reachable. Endpoints will become functional when repository implementations land.

### Note on Auth

Feature endpoints are currently unauthenticated. AuthModule (Stage 5) will add guards. This is acceptable for development but must be resolved before production.

---

## Stage 5: Wire AuthModule (Future)

**Branch:** `feat/appmodule-stage5-auth`
**Files changed:** `src/app.module.ts`, feature module controllers
**Lines changed:** ~10

### Status: BLOCKED

AuthModule does not exist yet. PRs #42 and #43 are open for AuthModule skeleton.

### Steps (when ready)

1. Wait for AuthModule PR to merge
2. Create branch from main
3. Add `AuthModule` to AppModule imports
4. Add `@UseGuards(AuthGuard)` to feature controllers
5. Run validation commands
6. Commit, push, open PR

### Validation

```bash
npm run build
npm run test
npm run start:dev
curl http://localhost:3000/feed      # Expect 401 without token
curl http://localhost:3000/feed -H "Authorization: Bearer <token>"  # Expect 200 or 500
```

### What to verify

- Unauthenticated requests return 401
- Authenticated requests reach the controller
- `app.module.spec.ts` passes

### Rollback

Remove `AuthModule` from imports, remove `@UseGuards` from controllers.

### Risk: High

AuthModule changes the security posture of the application. All feature endpoints become protected. Must be tested thoroughly.

---

## Final AppModule State (After All Stages)

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { RepositoryModule } from './repositories/repository.module';
import { NodebbModule } from './nodebb/nodebb.module';
import { FeedModule } from './feed/feed.module';
import { PostsModule } from './posts/posts.module';
import { ProfileModule } from './profile/profile.module';
import { MessagesModule } from './messages/messages.module';
import { AuthModule } from './auth/auth.module'; // Stage 5

@Module({
  imports: [
    // Infrastructure (order matters: Config first, then dependencies)
    ConfigModule,
    HealthModule,
    RedisModule,
    RepositoryModule,
    NodebbModule.register({
      baseUrl: process.env.NODEBB_URL || '',
      authMode: (process.env.NODEBB_AUTH_MODE as any) || 'NONE',
      apiToken: process.env.NODEBB_API_TOKEN,
      sessionCookie: process.env.NODEBB_SESSION_COOKIE,
    }),

    // Feature modules
    FeedModule,
    PostsModule,
    ProfileModule,
    MessagesModule,

    // Auth (Stage 5)
    // AuthModule,
  ],
})
export class AppModule {}
```

## Troubleshooting

### Circular dependency error

If you see `Cannot resolve dependency` errors, check that:
- RepositoryModule does not import any feature module
- Feature modules do not import each other
- NodebbModule does not import RepositoryModule

### Startup failure with missing env vars

If the app fails to start with `NODEBB_URL is required`, ensure your `.env` file has all required variables. See `src/config/config.module.ts` for the full list.

### Tests failing after wiring

If `app.module.spec.ts` fails after wiring a new module:
1. Check that the module's providers are @Injectable
2. Check that all required dependencies are available in the test module
3. Check for circular dependencies

## References

- [AppModule Composition Plan (Architecture)](../architecture/app-module-composition-plan.md)
- [Implementation Sequence](../architecture/implementation-sequence.md)
- [Auth Module Contract](../architecture/auth-module-contract.md)
- [Repository Boundary Guard](../architecture/repository-boundary-guard.md)
