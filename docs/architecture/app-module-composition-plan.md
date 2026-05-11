# AppModule Composition Plan

This document defines the safe, staged order for wiring all modules into `src/app.module.ts`. Each stage is one PR. Do not skip stages.

## Current State

```typescript
// src/app.module.ts (as of commit dda0165)
@Module({
  imports: [ConfigModule, HealthModule],
})
export class AppModule {}
```

**Wired:** ConfigModule (@Global), HealthModule
**Not wired:** RedisModule, RepositoryModule, NodebbModule, FeedModule, PostsModule, ProfileModule, MessagesModule

## Dependency Graph

```
ConfigModule (@Global)
  └── RedisModule (@Global, depends on ConfigService)
        └── RepositoryModule (depends on RedisModule for IUserCacheRepository)
              └── Feature Modules (Feed, Posts, Profile, Messages)
                    └── AuthModule (guards feature endpoints)
NodebbModule (@Global, independent of Redis/Repository)
  └── Feature Modules (some inject NodeBB providers)
```

## Staged Import Order

### Stage 1: Redis Infrastructure

**Modules:** ConfigModule, HealthModule, RedisModule
**PR scope:** Add `RedisModule` to `imports[]`
**Risk:** Low — RedisModule is @Global, depends only on ConfigService (already wired), uses `lazyConnect: true`

```typescript
@Module({
  imports: [ConfigModule, HealthModule, RedisModule],
})
export class AppModule {}
```

**Validation:**
- `npm run build` passes
- `npm run test` passes (app.module.spec.ts compiles)
- `npm run start:dev` boots without Redis connection (lazyConnect)

**Rollback:** Remove `RedisModule` from imports array. No downstream consumers yet.

**Blocked by:** Nothing — RedisModule exists on main.

---

### Stage 2: Repository Layer

**Modules:** + RepositoryModule
**PR scope:** Add `RepositoryModule` to `imports[]`
**Risk:** Low — All 7 repository providers are skeletons that throw `'not implemented'`. No feature module consumes them yet.

```typescript
@Module({
  imports: [ConfigModule, HealthModule, RedisModule, RepositoryModule],
})
export class AppModule {}
```

**Validation:**
- `npm run build` passes
- `npm run test` passes
- Repository tokens are resolvable in the DI container (verify via test module compilation)

**Rollback:** Remove `RepositoryModule` from imports array. No feature modules depend on it yet.

**Blocked by:** Nothing — RepositoryModule exists on main.

**Note:** Repository providers will remain skeletons until Prisma DatabaseModule lands (PR #30). This is safe because no feature module injects repository tokens yet.

---

### Stage 3: NodeBB Integration

**Modules:** + NodebbModule
**PR scope:** Add `NodebbModule.register(config)` to `imports[]`
**Risk:** Medium — NodebbModule requires runtime config (baseUrl, authMode, apiToken, sessionCookie). Missing config causes startup failure.

```typescript
@Module({
  imports: [
    ConfigModule,
    HealthModule,
    RedisModule,
    RepositoryModule,
    NodebbModule.register({
      baseUrl: configService.nodebbConfig.url,
      authMode: configService.nodebbConfig.authMode,
      apiToken: configService.nodebbConfig.apiToken,
      sessionCookie: configService.nodebbConfig.sessionCookie,
    }),
  ],
})
export class AppModule {}
```

**Validation:**
- `npm run build` passes
- `npm run test` passes with mock ConfigService
- `npm run start:dev` boots with NODEBB_URL set
- `npm run start:dev` fails gracefully if NODEBB_URL is missing (ConfigService Joi validation)

**Rollback:** Remove `NodebbModule.register(...)` from imports array.

**Blocked by:** Nothing — NodebbModule exists on main. ConfigService already validates NODEBB_* env vars.

**Risk detail:** NodebbModule uses `@Global()` so its providers (Topics, Posts, Users, Notifications, Tags) become globally available. No feature module consumes them yet, so this is safe.

---

### Stage 4: Feature Skeletons

**Modules:** + FeedModule, PostsModule, ProfileModule, MessagesModule
**PR scope:** Add all 4 feature modules to `imports[]`
**Risk:** Medium — Feature modules expose controllers with endpoints. All usecases throw `'not implemented'`. Endpoints will return 500 until repository implementations land.

```typescript
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

**Validation:**
- `npm run build` passes
- `npm run test` passes
- Endpoint smoke test: GET /feed, GET /posts, GET /profile, GET /messages return 500 with `'not implemented'` (expected behavior)

**Rollback:** Remove all 4 feature modules from imports array.

**Blocked by:** Stage 3 (NodebbModule must be wired first — some feature modules may inject NodeBB providers).

**Risk detail:** Exposing stub endpoints is intentional for contract verification. The 500 responses confirm the module graph compiles and controllers are reachable.

---

### Stage 5: Auth Guards (Future)

**Modules:** + AuthModule
**PR scope:** Add `AuthModule` to `imports[]`, wire guards to feature controllers
**Risk:** High — AuthModule does not exist yet (PRs #42, #43 are open). Guards will block unauthenticated requests to all feature endpoints.

**Blocked by:** AuthModule PR (#42 or #43) must merge first.

**Note:** This stage is deferred until AuthModule skeleton lands. The composition plan will be updated when AuthModule is available.

---

## Prisma Dependencies

| Stage | Prisma Dependency | Current Status |
|-------|-------------------|----------------|
| Stage 1 (Redis) | None | Ready |
| Stage 2 (Repository) | None (skeletons only) | Ready |
| Stage 3 (NodeBB) | None | Ready |
| Stage 4 (Features) | None (stubs throw) | Ready |
| Stage 5 (Auth) | AuthModule depends on Prisma | Blocked by PR #30, #42/#43 |

**Key insight:** Stages 1–4 can proceed without Prisma because:
- RepositoryModule providers are skeletons
- Feature usecases throw `'not implemented'`
- No actual database calls occur

When Prisma lands (PR #30), RepositoryModule providers will be replaced with real implementations. This is a separate PR that does not change the AppModule imports.

## Auth Dependencies

| Module | Auth Dependency | Impact |
|--------|-----------------|--------|
| FeedModule | Needs auth guard on GET /feed | Stage 5 |
| PostsModule | Needs auth guard on CRUD endpoints | Stage 5 |
| ProfileModule | Needs auth guard on profile endpoints | Stage 5 |
| MessagesModule | Needs auth guard on messages/notifications | Stage 5 |
| HealthModule | No auth (public health check) | None |

**Key insight:** Feature modules can be wired (Stage 4) before auth guards (Stage 5). The endpoints will be unprotected until AuthModule lands. This is acceptable in development but must be resolved before production.

## Risk Summary

| Stage | Risk Level | Mitigation |
|-------|------------|------------|
| Stage 1 | Low | lazyConnect, no runtime dependency |
| Stage 2 | Low | Skeleton providers, no consumers |
| Stage 3 | Medium | Config validation prevents bad startup |
| Stage 4 | Medium | Expected 500s on stub endpoints |
| Stage 5 | High | AuthModule not yet implemented |

## Conflict Avoidance

- Each stage is a separate PR to minimize merge conflicts
- Stages 1–3 are infrastructure-only (no new controllers/endpoints)
- Stage 4 is the only stage that adds new HTTP endpoints
- Stage 5 is deferred until AuthModule PRs merge
- If AuthModule PRs merge before Stage 4, reorder: Stage 5 becomes Stage 4b

## AppModule Single-Writer Rule

`app.module.ts` is a single-writer resource. When multiple feature modules need
to be wired into the `imports[]` array, each wiring task MUST execute
sequentially, not in parallel. This applies even when the feature modules are
otherwise independent.

**Why:** NestJS module imports are a flat list. Two workers appending to
`imports[]` concurrently produce a last-write-wins conflict — one worker's
import is silently lost. There is no merge strategy that recovers the lost entry.

**Enforcement:** Each wiring task declares `sharedLocks: ["app-module"]` in its
task JSON. The launch gate rejects batches where multiple tasks claim the same
lock. See [Parallel Work Policy §Rule 5](../ai-native/parallel-work-policy.md).

**Example — future onboarding wave:** When SearchModule, GroupsModule, and
TopicsModule are each ready to wire, they get separate PRs but serialize on the
AppModule lock:

```
appmodule-wire-search → appmodule-wire-groups → appmodule-wire-topics
```

This preserves single-responsibility (each module gets its own PR) while
preventing concurrent writes to `app.module.ts`.

**Not a conflict group:** These tasks have distinct `conflictGroup` values (they
are independent features). The shared lock is a finer-grained mechanism that
serializes only the file-level write, not the entire task scope.

## Validation Commands

For each stage PR, run:

```bash
npm run build          # TypeScript compilation
npm run test           # Unit tests including app.module.spec.ts
npm run lint           # ESLint
git diff --check       # No whitespace errors
```

## References

- [Implementation Sequence](implementation-sequence.md) — Database infrastructure PR order
- [Auth Module Contract](auth-module-contract.md) — AuthModule design
- [Repository Boundary Guard](repository-boundary-guard.md) — Enforcement rules
- [NodeBB Integration](nodebb-integration.md) — NodebbModule architecture
