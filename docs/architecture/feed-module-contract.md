# FeedModule Migration Contract

> Contract note for implementing the FeedModule in the LIAN Nest rewrite.
> This document defines boundaries, DTOs, usecase contracts, repository
> interactions, and implementation slices. It does NOT contain runtime code.

## 1. Responsibilities

### FeedModule owns

- HTTP layer for the FEED routes (`/api/feed/*`).
- Personalized feed assembly for authenticated users.
- Feed item retrieval and enrichment.
- Pagination and cursor management for feed timelines.
- Feed scope resolution (followed channels, subscribed topics).

### FeedModule does NOT own

- **Post metadata storage** — owned by `IPostMetadataRepository` via `RepositoryModule`. FeedModule reads post records but does not write them.
- **User data** — owned by the Users Prisma slice. FeedModule reads user info for enrichment via `NodebbUsersProvider` or `IUserCacheRepository`.
- **NodeBB API calls** — owned exclusively by `NodebbModule`. FeedModule delegates any NodeBB topic/post lookup through `NodebbTopicsProvider` or `NodebbPostsProvider`.
- **Recommendation logic** — owned by `IRecommendationPrefRepository`. FeedModule may consume recommendation signals in a future iteration but does not compute them.
- **Channel/subscription management** — out of scope for the initial skeleton. A future `SubscriptionModule` or `ChannelModule` will own this.

## 2. Architectural Boundaries

```
┌─────────────────────────────────────────────────────────┐
│                      HTTP Layer                         │
│  FeedController  ──  Guards  ──  Pipes (validation)     │
└──────────────┬──────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────┐
│                     Usecase Layer                       │
│  GetFeedUsecase                                        │
│  GetFeedItemUsecase                                    │
└──────┬──────────────────────┬───────────────────────────┘
       │                      │
┌──────▼──────────┐  ┌───────▼───────────────────────────┐
│    Repositories  │  │  NodeBB Providers                 │
│  (via tokens)    │  │  NodebbTopicsProvider              │
│  IPostMetadata   │  │  NodebbPostsProvider               │
│  IUserCache      │  │  NodebbUsersProvider               │
└──────────────────┘  └───────────────────────────────────┘
```

### 2.1 Controller → Usecase

- Controller handles HTTP concerns only: route decorators, DTO validation
  (via `class-validator`), extracting request metadata (user ID from JWT),
  and shaping the response.
- Controller never calls repositories directly. Every action delegates
  to a usecase class.
- Controller applies guards (`JwtAuthGuard`) declaratively via `@UseGuards()`.

### 2.2 Usecase → Repository

- Usecases inject repository interfaces via `REPOSITORY_TOKENS`:
  - `IPostMetadataRepository` — post metadata reads
  - `IUserCacheRepository` — cached user profile reads
- Usecases are plain NestJS `@Injectable()` classes, not tied to HTTP.
  They can be called from CLI scripts, cron jobs, or event handlers.
- Each usecase is a single public `execute()` method with a typed input
  DTO and typed output DTO.

### 2.3 Usecase → NodeBB

- `GetFeedUsecase` enriches feed items with author info and topic data
  via `NodebbUsersProvider` and `NodebbTopicsProvider`.
- `GetFeedItemUsecase` enriches a single item with full post content
  via `NodebbPostsProvider` if needed.
- FeedModule NEVER imports `http`, `https`, `node-fetch`, `axios`,
  or `got`. The NodeBB boundary test enforces this.

## 3. DTO Contracts

### 3.1 Request DTOs

```typescript
// GET /api/feed
class FeedQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  perPage?: number = 20;
}
```

### 3.2 Response DTOs

```typescript
// Feed item
class FeedItemDto {
  id: string;
  postId: number;
  topicId: number;
  title: string;
  snippet: string;
  authorUid: number;
  authorUsername: string;
  createdAt: string; // ISO 8601
}

// GET /api/feed response
class FeedResponseDto {
  items: FeedItemDto[];
  totalCount: number;
  page: number;
  perPage: number;
}
```

### 3.3 Internal DTOs (usecase boundaries)

```typescript
// Input to GetFeedUsecase
interface GetFeedInput extends FeedQueryDto {
  userId: number;
}

// Input to GetFeedItemUsecase
interface GetFeedItemInput {
  feedItemId: string;
  userId: number;
}
```

## 4. Usecase Contracts

### 4.1 GetFeedUsecase

```
execute(input: GetFeedInput): Promise<FeedResponseDto>

Steps:
  1. Resolve followed channels/users for the requesting user.
  2. Query IPostMetadataRepository for recent posts in scope.
  3. Enrich with author info (NodebbUsersProvider or IUserCacheRepository).
  4. Enrich with topic title (NodebbTopicsProvider).
  5. Paginate and return FeedResponseDto.
```

### 4.2 GetFeedItemUsecase

```
execute(input: GetFeedItemInput): Promise<FeedItemDto>

Steps:
  1. Look up post metadata by feedItemId.
  2. Verify the item is in the user's feed scope.
  3. Enrich with author and topic data.
  4. Return FeedItemDto.
```

## 5. Repository Interaction Map

| Usecase          | IPostMetadataRepository | IUserCacheRepository | NodebbTopicsProvider | NodebbPostsProvider | NodebbUsersProvider |
|------------------|------------------------|---------------------|---------------------|--------------------|--------------------|
| GetFeed          | findByScope (paginated)| findById (batch)    | getByTid (batch)    | —                  | getByUid (batch)   |
| GetFeedItem      | findById               | findById            | getByTid            | getByPid (optional)| getByUid           |

## 6. Implementation Slices

Each slice is sized for a separate PR. Dependencies are noted.

### Slice 1: Feed Module Skeleton

**PR scope:**
- Create `src/feed/` module skeleton: DTOs, usecase stubs, controller, module, tests.
- Add `feed-module-contract.md` to `docs/architecture/`.
- No real endpoint behavior — all usecases throw `not implemented`.

**Dependencies:** None.

**Blocked by:** None.

---

### Slice 2: Feed Query Usecase (Stub Repository)

**PR scope:**
- Implement `GetFeedUsecase` with mock/stub repository calls.
- Add `JwtAuthGuard` to feed routes.
- Integration test with mocked repositories.
- Wire `IPostMetadataRepository` injection.

**Dependencies:** Slice 1, `IPostMetadataRepository` interface (exists).

**Blocked by:** Repository real implementations (issue #9) for integration tests.

---

### Slice 3: Feed Enrichment (NodeBB Integration)

**PR scope:**
- Wire `NodebbTopicsProvider` and `NodebbUsersProvider` into feed usecases.
- Enrich feed items with author names and topic titles.
- Integration tests with mocked NodebbModule.

**Dependencies:** Slice 2, NodebbModule (merged, issue #3).

**Blocked by:** None (NodebbModule is already merged).

---

### Slice 4: Feed Item Detail

**PR scope:**
- Implement `GetFeedItemUsecase` with full enrichment.
- Add `GET /api/feed/:feedItemId` route handler.
- Integration tests for single item retrieval.

**Dependencies:** Slice 3.

**Blocked by:** Repository real implementations for integration tests.

---

### Slice 5: Feed Personalization

**PR scope:**
- Integrate recommendation preferences from `IRecommendationPrefRepository`.
- Implement feed scope resolution (followed channels, subscriptions).
- Cursor-based pagination support.

**Dependencies:** Slice 2, `IRecommendationPrefRepository` interface.

**Blocked by:** Subscription/channel module design (future).

### Dependency Graph

```
Slice 1 (Skeleton)
  └─► Slice 2 (Query Usecase)
        └─► Slice 3 (NodeBB Enrichment)
              └─► Slice 4 (Feed Item Detail)
        └─► Slice 5 (Personalization)  [parallel with 3+4]
```

## 7. Legacy Behavior Parity Checklist

Each item maps to a legacy endpoint behavior that must be verified
against the new implementation before marking the FEED family as MIGRATED.

### 7.1 Feed List (`GET /api/feed`)

- [ ] Returns paginated feed items matching `FeedResponseDto` shape.
- [ ] Default page is 1, default perPage is 20.
- [ ] perPage is clamped to 1–50.
- [ ] Returns 401 if not authenticated.
- [ ] Items are ordered by createdAt descending (newest first).
- [ ] Each item includes author username and topic title.

### 7.2 Feed Item Detail (`GET /api/feed/:feedItemId`)

- [ ] Returns single item matching `FeedItemDto` shape.
- [ ] Returns 404 if item not found or not in user's feed scope.
- [ ] Returns 401 if not authenticated.
- [ ] Includes full snippet (not truncated).

### 7.3 Cross-cutting parity

- [ ] All feed errors use the `ErrorEnvelope` format from `GlobalExceptionFilter`.
- [ ] Error codes match: `UNAUTHORIZED` (401), `NOT_FOUND` (404).
- [ ] No NodeBB HTTP calls from FeedModule — all via providers.
- [ ] Feed items are scoped to the authenticated user (no cross-user leakage).

## 8. Open Questions

1. **Feed scope source** — What determines "your feed"? Options:
   - Followed channels/topics (subscription model).
   - All public posts (global timeline).
   - Recommendation engine output.
   Recommendation: start with global timeline, add personalization later.

2. **Cursor vs offset pagination** — Offset is simpler but breaks on
   insertions. Cursor-based (using post ID or timestamp) is more robust.
   Recommendation: offset for skeleton, cursor in Slice 5.

3. **Feed caching** — Should the feed be cached in Redis per user?
   Recommendation: yes, with short TTL (30s–60s). Deferred to a
   performance slice after basic functionality works.

4. **Real-time updates** — Should new posts push to active feed sessions
   via WebSocket? Recommendation: yes, but deferred to a future slice.
