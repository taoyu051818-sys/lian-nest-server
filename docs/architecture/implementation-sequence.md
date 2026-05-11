# Implementation Sequence

This document defines the order of implementation for database infrastructure after the Nest bootstrap PR merges. Each step is one PR.

## Phase 1: Foundation

### 1.1 — Prisma DatabaseModule

**Depends on:** Bootstrap PR (Nest project scaffold, basic module structure)

- Install `prisma` and `@prisma/client`.
- Install `@nestjs/prisma` for NestJS integration.
- Create `prisma/schema.prisma` with provider, connection URL from env, and initial empty schema.
- Create `DatabaseModule` that wraps `PrismaService` as a global injectable.
- Add `docker-compose.yml` with Postgres and Redis services for local dev.
- Validate: `npx prisma generate` succeeds, `npx prisma db push` works against local Postgres, Nest app starts with DatabaseModule injected.

### 1.2 — Redis Module

**Depends on:** 1.1 (docker-compose provides Redis)

- Install `ioredis` (or `@nestjs/plus/cache-manager` with Redis store).
- Create `RedisModule` with a configurable Redis client provider.
- Expose `RedisService` for cache operations (get, set, del, ttl).
- Add health check endpoint for Redis connectivity.
- Validate: Nest app starts, Redis health check passes.

## Phase 2: Core Slices

### 2.1 — Users Slice

**Depends on:** 1.1

- Add `User`, `UserRole`, `UserStatus` to `prisma/schema.prisma`.
- Run `prisma migrate dev` to generate and apply migration.
- Create `UsersModule` with `UsersRepository` (wraps Prisma calls) and `UsersService`.
- Create `UsersController` with basic CRUD endpoints.
- Add unit tests for repository and service.
- Validate: CRUD operations work against local Postgres, tests pass.

### 2.2 — Sessions Slice

**Depends on:** 2.1 (User must exist first)

- Add `Session` to schema.
- Create `SessionsModule` with repository and service.
- Implement refresh token creation, validation, and revocation.
- Validate: session lifecycle works, cascade delete on user removal works.

### 2.3 — Post Metadata Slice

**Depends on:** 2.1

- Add `PostMeta`, `PostStatus` to schema.
- Create `PostMetaModule` with repository and service.
- Implement CRUD + status transitions (draft → published → archived).
- Validate: post metadata operations work, NodeBB reference fields are nullable.

## Phase 3: Extended Slices

### 3.1 — Recommendation Preferences

**Depends on:** 2.1

- Add `RecommendationPref` to schema.
- Create module with repository and service.
- Validate: preferences CRUD works, JSON weight field is flexible.

### 3.2 — AI Interaction Records

**Depends on:** 2.1

- Add `AiInteraction` to schema.
- Create module with repository and service.
- Implement logging for AI feature calls.
- Validate: interactions are recorded, nullable userId works for system-initiated calls.

### 3.3 — Audit Events

**Depends on:** 2.1

- Add `AuditEvent` to schema.
- Create module with repository and service.
- Implement append-only logging with query by actor, action, and time range.
- Validate: events are written and queryable, no update/delete operations exposed.

## Phase 4: Integration

### 4.1 — NodeBB Reference Wiring

**Depends on:** 2.1, 2.3

- Create `NodeBBModule` (the only module allowed to call NodeBB).
- Wire `nodebb_uid` population on user creation.
- Wire `nodebb_tid`, `nodebb_pid`, `nodebb_slug` population on post publish.
- Validate: reference fields are populated after NodeBB interactions, failures do not block LIAN operations.

### 4.2 — Redis Caching Layer

**Depends on:** 1.2, 2.1, 2.3

- Add cache-aside patterns for hot queries (user profile, post metadata).
- Implement TTL-based invalidation.
- Validate: cache hits reduce Postgres queries, cache miss falls back correctly.

## Dependency Graph

```
Bootstrap PR
    └── 1.1 Prisma DatabaseModule
    │       ├── 1.2 Redis Module
    │       ├── 2.1 Users Slice
    │       │       ├── 2.2 Sessions Slice
    │       │       ├── 2.3 Post Metadata Slice
    │       │       ├── 3.1 Recommendation Prefs
    │       │       ├── 3.2 AI Interactions
    │       │       └── 3.3 Audit Events
    │       └── 4.1 NodeBB Reference Wiring (needs 2.1, 2.3)
    └── 4.2 Redis Caching Layer (needs 1.2, 2.1, 2.3)
```

## Principles

- **One slice per PR.** Keeps reviews small and focused.
- **Schema migration in the same PR as the module.** Schema and code stay in sync.
- **Tests with every slice.** No untested repository or service code merges.
- **Repository pattern enforced.** Controllers and services never call Prisma directly — always through a repository class.
