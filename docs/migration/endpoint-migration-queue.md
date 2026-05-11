# Endpoint Migration Queue

Concrete, issue-ready slices that map module skeleton stubs to legacy parity
coverage. Each slice is sized for a single PR by a Claude worker. Slices are
ordered by dependency — Auth is a prerequisite for all authenticated endpoints.

> **Scope:** Feed, Posts, Messages, Notifications, Profile, and Auth.
> Other legacy families (Users, Categories, Topics, Tags, Search, Groups) are
> tracked in `route-parity-tracker.md` but out of this queue.

---

## Dependency Graph

```
Slice A1 (Auth Config + Skeleton)
  └─► Slice A2 (JWT + Guards)
        └─► Slice A3 (Login)
              ├─► Slice A4 (Register + First-Run)
              │     └─► Slice A6 (NodeBB Identity Bridge)
              └─► Slice A5 (Logout / Me / Password)

Slice A2 ──────────────────────────────────────────────┐
  ├─► Slice F1 (Feed: GetFeed + GetFeedItem)           │
  ├─► Slice P1 (Posts: list + detail)                  │
  ├─► Slice P2 (Posts: create/update/delete)           │
  ├─► Slice P3 (Posts: reactions)                      │
  ├─► Slice P4 (Posts: replies)                        │
  ├─► Slice M1 (Messages: send + list + markRead)      │
  ├─► Slice N1 (Notifications: list + unread + mark)   │
  └─► Slice PR1 (Profile: public + saved/liked/history)│
        (all feature slices require guards from A2) ───┘
```

Slices A1→A6 are serial. All feature slices (F1, P1–P4, M1, N1, PR1) can
proceed in parallel once A2 lands, subject to repository availability.

---

## Auth Slices (A1–A6)

### Slice A1 — Auth Config + Module Skeleton

| Field | Value |
|-------|-------|
| **Issue title** | `[Auth] Config skeleton and module registration` |
| **Depends on** | None |
| **Blocked by** | None |

**Files touched:**
- `src/config/env.validation.ts` — add `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_TOKEN_TTL`, `BCRYPT_ROUNDS`
- `src/config/config.service.ts` — add typed getters for auth env vars
- `src/auth/auth.module.ts` — new, empty module
- `src/auth/index.ts` — barrel export
- `src/app.module.ts` — import `AuthModule`

**Validation:**
- `npm run build` succeeds
- `npm run check` (lint + typecheck) passes
- AppModule boots with AuthModule imported

**Parity fixture expectations:**
- Module resolves in Nest DI container without errors
- ConfigService exposes auth env vars with defaults

---

### Slice A2 — JWT Strategy + Guards

| Field | Value |
|-------|-------|
| **Issue title** | `[Auth] JWT strategy, guards, and decorators` |
| **Depends on** | A1 |
| **Blocked by** | None |

**Files touched:**
- `src/auth/strategies/jwt.strategy.ts` — Passport JWT strategy
- `src/auth/guards/jwt-auth.guard.ts` — extends `AuthGuard('jwt')`
- `src/auth/guards/roles.guard.ts` — role-based access
- `src/auth/decorators/public.decorator.ts` — `@Public()`
- `src/auth/decorators/roles.decorator.ts` — `@Roles()`
- `src/auth/decorators/current-user.decorator.ts` — `@CurrentUser()`
- `src/auth/auth.module.ts` — register strategy, guards
- `package.json` — add `@nestjs/passport`, `@nestjs/jwt`, `passport`, `passport-jwt`

**Validation:**
- `npm run build` succeeds
- `npm run check` passes
- Unit test: JwtStrategy validates valid token payload
- Unit test: JwtAuthGuard rejects missing/invalid token
- Unit test: @Public() decorator skips guard

**Parity fixture expectations:**
- Valid JWT → `req.user = { id, role }`
- Expired JWT → 401 `UNAUTHORIZED`
- Missing Authorization header → 401
- @Public() route → no auth required

---

### Slice A3 — Login Usecase + Controller

| Field | Value |
|-------|-------|
| **Issue title** | `[Auth] Login endpoint implementation` |
| **Depends on** | A1, A2 |
| **Blocked by** | `IAuthRepository`, `ISessionRepository` skeleton (exists) |

**Files touched:**
- `src/auth/usecases/login.usecase.ts`
- `src/auth/dto/login.dto.ts`
- `src/auth/dto/auth-tokens.dto.ts`
- `src/auth/dto/current-user.dto.ts`
- `src/auth/auth.controller.ts` — new, `POST /api/auth/login`
- `src/auth/auth.module.ts` — register usecase, controller
- `package.json` — add `bcrypt`

**Validation:**
- `npm run build` succeeds
- Integration test: `POST /api/auth/login` with valid credentials → 200 + tokens
- Integration test: invalid credentials → 401 `UNAUTHORIZED`
- Integration test: suspended user → 401

**Parity fixture expectations:**
- Response shape: `{ accessToken, refreshToken, expiresIn, user: CurrentUserDto }`
- Password compared with bcrypt (constant-time)
- Session record created with `userAgent` and `ipAddress`
- Audit event `user.login` logged

---

### Slice A4 — Register Usecase + First-Run

| Field | Value |
|-------|-------|
| **Issue title** | `[Auth] Register endpoint with first-run admin detection` |
| **Depends on** | A3 |
| **Blocked by** | Prisma User model (for uniqueness checks) |

**Files touched:**
- `src/auth/usecases/register.usecase.ts`
- `src/auth/dto/register.dto.ts`
- `src/auth/auth.controller.ts` — add `POST /api/auth/register`

**Validation:**
- Integration test: `POST /api/auth/register` → 201 + tokens
- Integration test: duplicate email → 409 `CONFLICT`
- Integration test: duplicate username → 409 `CONFLICT`
- Integration test: first user gets `ADMIN` role

**Parity fixture expectations:**
- Response shape matches login (tokens + user)
- Password hashed with bcrypt before storage
- `AuthCredential` created with provider `local`
- Audit event `user.register` logged
- Input validation: email format, username 3–32 chars, password >= 8 chars

---

### Slice A5 — Logout + CurrentUser + ChangePassword

| Field | Value |
|-------|-------|
| **Issue title** | `[Auth] Logout, /me, and password change endpoints` |
| **Depends on** | A3 |
| **Blocked by** | None (can parallel with A4) |

**Files touched:**
- `src/auth/usecases/logout.usecase.ts`
- `src/auth/usecases/current-user.usecase.ts`
- `src/auth/usecases/change-password.usecase.ts`
- `src/auth/dto/change-password.dto.ts`
- `src/auth/auth.controller.ts` — add `POST /logout`, `GET /me`, `POST /password`

**Validation:**
- Integration test: `POST /api/auth/logout` → 200 `{ ok: true }`
- Integration test: logout is idempotent (nonexistent session → 200)
- Integration test: `GET /api/auth/me` → 200 + user profile
- Integration test: `GET /api/auth/me` without auth → 401
- Integration test: `POST /api/auth/password` with wrong current → 401
- Integration test: `POST /api/auth/password` with valid → 200

**Parity fixture expectations:**
- Logout deletes session, audit logs `user.logout`
- `/me` returns `CurrentUserDto` (no `passwordHash`)
- Password change updates hash, audit logs `user.password_change`
- All errors use `ErrorEnvelope` format from `GlobalExceptionFilter`

---

### Slice A6 — NodeBB Identity Bridge

| Field | Value |
|-------|-------|
| **Issue title** | `[Auth] NodeBB user linking on register and login enrichment` |
| **Depends on** | A4, NodebbModule (merged) |
| **Blocked by** | `NodebbUsersProvider` available |

**Files touched:**
- `src/auth/usecases/register.usecase.ts` — add NodeBB user creation
- `src/auth/usecases/login.usecase.ts` — add profile enrichment
- `src/auth/usecases/current-user.usecase.ts` — add cache lookup

**Validation:**
- Integration test: register with NodeBB bridge success → `nodebbUid` set
- Integration test: register with NodeBB bridge failure → `nodebbUid` null, user still created
- Integration test: login enriches response with NodeBB reputation/postcount

**Parity fixture expectations:**
- NodeBB failure is non-blocking (best-effort)
- `IUserCacheRepository` warmed after login
- Response includes `nodebbUid` when linked

---

## Feed Slices (F1)

### Slice F1 — Feed Endpoints

| Field | Value |
|-------|-------|
| **Issue title** | `[Feed] Implement getFeed and getFeedItem usecases` |
| **Depends on** | A2 (guards) |
| **Blocked by** | `IUserCacheRepository` or NodeBB topic provider for feed data |

**Files touched:**
- `src/feed/usecases/get-feed.usecase.ts` — replace stub with NodeBB topic fetch
- `src/feed/usecases/get-feed-item.usecase.ts` — replace stub with single topic fetch
- `src/feed/feed.module.ts` — wire into AppModule (or add to lazy imports)
- `src/app.module.ts` — import `FeedModule`

**Endpoints (2):**

| Method | Route | Legacy Parity |
|--------|-------|---------------|
| GET | `/api/feed` | Paginated feed list |
| GET | `/api/feed/:feedItemId` | Single feed item |

**Validation:**
- `npm run build` succeeds
- Integration test: `GET /api/feed?page=1&perPage=10` → 200 + `FeedResponseDto`
- Integration test: `GET /api/feed/:id` → 200 + `FeedItemDto`
- Integration test: `GET /api/feed/:id` with invalid id → 404
- Integration test: unauthenticated request → 401

**Parity fixture expectations:**
- Response shape: `{ items: FeedItemDto[], totalCount, page, perPage }`
- Pagination: `page` (min 1), `perPage` (1–50, default 20)
- FeedItem fields: `id`, `postId`, `topicId`, `title`, `snippet`, `authorUid`, `authorUsername`, `createdAt`

---

## Posts Slices (P1–P4)

### Slice P1 — Posts: List + Detail

| Field | Value |
|-------|-------|
| **Issue title** | `[Posts] List posts and get post detail` |
| **Depends on** | A2 (guards) |
| **Blocked by** | `NodebbPostsProvider` for data fetching |

**Files touched:**
- `src/posts/posts.service.ts` — implement `listPosts`, `getPostDetail`
- `src/posts/posts.module.ts` — wire PostsService, register in AppModule
- `src/posts/posts.controller.ts` — inject PostsService
- `src/app.module.ts` — import `PostsModule`

**Endpoints (2):**

| Method | Route | Legacy Parity |
|--------|-------|---------------|
| GET | `/api/posts` | Paginated post list |
| GET | `/api/posts/:postId` | Single post detail |

**Validation:**
- Integration test: `GET /api/posts` → 200 + `PostPaginatedList`
- Integration test: `GET /api/posts/:postId` → 200 + `PostDetail`
- Integration test: `GET /api/posts/:postId` invalid → 404

**Parity fixture expectations:**
- `PostListItem`: `pid`, `title`, `author`, `timestamp`, `voteCount`, `replyCount`
- `PostDetail`: full body, author (`PostAuthor`), reactions (`PostReactionSummary`), replies (paginated)
- Pagination: `page`, `perPage` matching legacy

---

### Slice P2 — Posts: Create / Update / Delete

| Field | Value |
|-------|-------|
| **Issue title** | `[Posts] Create, update, and delete post` |
| **Depends on** | P1 |
| **Blocked by** | `NodebbPostsProvider` for mutation, `POST_METADATA_REPOSITORY` |

**Files touched:**
- `src/posts/posts.service.ts` — implement `createPost`, `updatePost`, `deletePost`
- `src/posts/posts.controller.ts` — wire service methods

**Endpoints (3):**

| Method | Route | Legacy Parity |
|--------|-------|---------------|
| POST | `/api/posts` | Create post (requires auth) |
| PUT | `/api/posts/:postId` | Edit post (owner only) |
| DELETE | `/api/posts/:postId` | Soft-delete (mod only) |

**Validation:**
- Integration test: `POST /api/posts` → 201 + `PostDetail`
- Integration test: `PUT /api/posts/:postId` by owner → 200
- Integration test: `PUT /api/posts/:postId` by non-owner → 403
- Integration test: `DELETE /api/posts/:postId` by mod → 200
- Integration test: `DELETE /api/posts/:postId` by non-mod → 403

**Parity fixture expectations:**
- Create: validates `CreatePostBody` fields
- Update: only owner can edit, validates `UpdatePostBody`
- Delete: soft-delete (sets status), only moderator can delete
- Input validation: `CreatePostBody` requires `title`, `content`

---

### Slice P3 — Posts: Reactions

| Field | Value |
|-------|-------|
| **Issue title** | `[Posts] Post reactions (list, add, remove)` |
| **Depends on** | P1 |
| **Blocked by** | `NodebbPostsProvider` for vote API |

**Files touched:**
- `src/posts/posts.service.ts` — implement `listReactions`, `addReaction`, `removeReaction`

**Endpoints (3):**

| Method | Route | Legacy Parity |
|--------|-------|---------------|
| GET | `/api/posts/:postId/reactions` | List reaction summary |
| POST | `/api/posts/:postId/reactions` | Add reaction (requires auth) |
| DELETE | `/api/posts/:postId/reactions/:reactionType` | Remove reaction (requires auth) |

**Validation:**
- Integration test: `GET /api/posts/:postId/reactions` → 200 + `PostReactionSummary`
- Integration test: `POST /api/posts/:postId/reactions` → 200 (idempotent)
- Integration test: `DELETE /api/posts/:postId/reactions/:type` → 200
- Integration test: invalid `reactionType` → 400

**Parity fixture expectations:**
- `PostReactionType` enum: `LIKE`, `LOVE`, `HAHA`, `WOW`, `SAD`, `ANGRY`
- Double-add is idempotent (no double-count)
- Remove is idempotent (no 404 on missing reaction)

---

### Slice P4 — Posts: Replies

| Field | Value |
|-------|-------|
| **Issue title** | `[Posts] Post replies (list, create, delete)` |
| **Depends on** | P1 |
| **Blocked by** | `NodebbPostsProvider` for reply API |

**Files touched:**
- `src/posts/posts.service.ts` — implement `listReplies`, `createReply`, `deleteReply`

**Endpoints (3):**

| Method | Route | Legacy Parity |
|--------|-------|---------------|
| GET | `/api/posts/:postId/replies` | List replies (paginated) |
| POST | `/api/posts/:postId/replies` | Create reply (requires auth) |
| DELETE | `/api/posts/:postId/replies/:replyId` | Delete reply (owner or mod) |

**Validation:**
- Integration test: `GET /api/posts/:postId/replies` → 200 + paginated `PostReply[]`
- Integration test: `POST /api/posts/:postId/replies` → 201 + `PostReply`
- Integration test: `DELETE /api/posts/:postId/replies/:replyId` by owner → 200
- Integration test: `DELETE /api/posts/:postId/replies/:replyId` by non-owner → 403

**Parity fixture expectations:**
- `PostReply`: `rid`, `content`, `author`, `timestamp`, `voteCount`
- Pagination: `page`, `perPage`
- Delete: owner or moderator only

---

## Messages Slices (M1)

### Slice M1 — Messages: Send + List + MarkRead

| Field | Value |
|-------|-------|
| **Issue title** | `[Messages] Implement message send, list, and mark-read` |
| **Depends on** | A2 (guards) |
| **Blocked by** | `NodebbModule` message provider (or direct NodeBB API) |

**Files touched:**
- `src/messages/use-cases/messages.use-case.ts` — replace stubs
- `src/messages/messages.module.ts` — wire into AppModule
- `src/app.module.ts` — import `MessagesModule`

**Endpoints (3):**

| Method | Route | Legacy Parity |
|--------|-------|---------------|
| POST | `/api/messages` | Send message (requires auth) |
| GET | `/api/messages` | List messages (requires auth, paginated) |
| POST | `/api/messages/:messageId/read` | Mark as read (requires auth) |

**Validation:**
- Integration test: `POST /api/messages` → 201 + `MessageResponseDto`
- Integration test: `GET /api/messages` → 200 + `MessageListResponseDto`
- Integration test: `POST /api/messages/:id/read` → 200
- Integration test: unauthenticated → 401

**Parity fixture expectations:**
- `MessageResponseDto`: `messageId`, `fromUid`, `toUid`, `content`, `timestamp`, `read`
- `MessageListResponseDto`: `messages`, `totalCount`, `page`, `perPage`
- `CreateMessageDto` validation: `toUid` (number), `content` (string), `roomId?` (number)

---

## Notifications Slices (N1)

### Slice N1 — Notifications: List + UnreadCount + MarkRead

| Field | Value |
|-------|-------|
| **Issue title** | `[Notifications] Implement notification list, unread count, and mark-read` |
| **Depends on** | A2 (guards) |
| **Blocked by** | `NodebbNotificationsProvider` for data |

**Files touched:**
- `src/messages/use-cases/notifications.use-case.ts` — replace stubs
- `src/messages/messages.module.ts` — ensure NotificationsUseCase registered

**Endpoints (3):**

| Method | Route | Legacy Parity |
|--------|-------|---------------|
| GET | `/api/notifications` | List notifications (requires auth) |
| GET | `/api/notifications/unread-count` | Get unread count (requires auth) |
| POST | `/api/notifications/:nid/read` | Mark as read (requires auth) |

**Validation:**
- Integration test: `GET /api/notifications` → 200 + `NotificationListResponseDto`
- Integration test: `GET /api/notifications/unread-count` → 200 + `{ count: number }`
- Integration test: `POST /api/notifications/:nid/read` → 200
- Integration test: unauthenticated → 401

**Parity fixture expectations:**
- `NotificationResponseDto`: `nid`, `type`, `bodyShort`, `bodyLong?`, `fromUid`, `datetime`, `read`
- `NotificationListResponseDto`: `notifications`, `totalCount`
- Mark-read is idempotent (no 404 on already-read notification)

---

## Profile Slices (PR1)

### Slice PR1 — Profile: Public Profile + Saved/Liked/History

| Field | Value |
|-------|-------|
| **Issue title** | `[Profile] Public profile and collection endpoints` |
| **Depends on** | A2 (guards) |
| **Blocked by** | `NodebbUsersProvider` for profile data |

**Files touched:**
- `src/profile/profile.usecase.ts` — replace stubs
- `src/profile/profile.module.ts` — wire into AppModule
- `src/app.module.ts` — import `ProfileModule`

**Endpoints (4):**

| Method | Route | Legacy Parity |
|--------|-------|---------------|
| GET | `/api/profile/:uid` | Public profile |
| GET | `/api/profile/:uid/saved` | Saved items (paginated) |
| GET | `/api/profile/:uid/liked` | Liked items (paginated) |
| GET | `/api/profile/:uid/history` | View history (paginated) |

**Validation:**
- Integration test: `GET /api/profile/:uid` → 200 + `PublicProfile`
- Integration test: `GET /api/profile/:uid/saved` → 200 + `ProfileCollection<SavedItem>`
- Integration test: `GET /api/profile/:uid/liked` → 200 + `ProfileCollection<LikedItem>`
- Integration test: `GET /api/profile/:uid/history` → 200 + `ProfileCollection<HistoryItem>`
- Integration test: `GET /api/profile/999999` → 404

**Parity fixture expectations:**
- `PublicProfile`: `uid`, `username`, `displayName`, `avatar`, `bio`, `postCount`, `reputation`, `joinedAt`
- `SavedItem`: `id`, `type` (topic|post), `targetId`, `savedAt`
- `LikedItem`: `id`, `type` (topic|post), `targetId`, `likedAt`
- `HistoryItem`: `id`, `type` (topic|post), `targetId`, `viewedAt`
- `ProfileCollection<T>`: `items`, `total`, `page`, `pageSize`

---

## Execution Order Summary

| Order | Slice | Module | Endpoints | Serial? |
|-------|-------|--------|-----------|---------|
| 1 | A1 | Auth | 0 (skeleton) | Yes |
| 2 | A2 | Auth | 0 (guards) | Yes |
| 3 | A3 | Auth | 1 (login) | Yes |
| 4 | A4 | Auth | 1 (register) | Yes (parallel OK with A5) |
| 5 | A5 | Auth | 3 (logout, me, password) | Yes (parallel OK with A4) |
| 6 | A6 | Auth | 0 (bridge) | Yes (after A4) |
| 7 | F1 | Feed | 2 | After A2 |
| 8 | P1 | Posts | 2 | After A2 |
| 9 | P2 | Posts | 3 | After P1 |
| 10 | P3 | Posts | 3 | After P1 |
| 11 | P4 | Posts | 3 | After P1 |
| 12 | M1 | Messages | 3 | After A2 |
| 13 | N1 | Notifications | 3 | After A2 |
| 14 | PR1 | Profile | 4 | After A2 |

**Total endpoints:** 28 (5 auth + 2 feed + 11 posts + 3 messages + 3 notifications + 4 profile)

---

## Assumptions and Follow-Up

1. **Repository implementations** — Auth slices A3–A6 require `IAuthRepository` and `ISessionRepository` real implementations (Prisma-backed). These are tracked in `implementation-sequence.md` Slice 2.2.
2. **NodeBB provider availability** — Feed (F1), Posts (P1–P4), Messages (M1), Notifications (N1), and Profile (PR1) all depend on NodeBB providers from `NodebbModule`. The providers exist as skeletons; data fetching must be implemented.
3. **Prisma User model** — Registration (A4) needs a `User` table for uniqueness checks and first-run detection. This is tracked in `implementation-sequence.md` Slice 2.1.
4. **GlobalExceptionFilter** — All error responses must use the `ErrorEnvelope` format. Verify the filter is active before marking any slice as MIGRATED.
5. **Legacy parity fixtures** — Each slice's fixture expectations above define the contract. Workers should create fixture files (JSON snapshots) alongside integration tests to verify response shape parity.
6. **Other families** — Users, Categories, Topics, Tags, Search, Groups are not in this queue. They depend on the same Auth foundation and should be queued in a follow-up document after A2 lands.
