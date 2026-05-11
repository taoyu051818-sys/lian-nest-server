# NodeBB Adapter — Auth-Mode Matrix and Guard Gaps

> Contract doc for [#200](https://github.com/taoyu051818-sys/lian-nest-server/issues/200).
> Maps providers to read/write auth modes and documents remaining guard gaps.
> Runtime code is out of scope — this is a documentation-only contract.

---

## 1. Auth-mode reference

Three modes are defined in `src/nodebb/types.ts`:

| Mode        | Header sent                       | Config source                  |
|-------------|-----------------------------------|--------------------------------|
| `api_token` | `Authorization: Bearer <token>`   | `NODEBB_API_TOKEN` env var     |
| `session`   | `Cookie: <session cookie>`        | `NODEBB_SESSION_COOKIE` or per-call `NodebbAuth.sessionCookie` |
| `none`      | *(no auth header)*                | —                              |

Resolution order in `NodebbHttpClient.buildAuthHeaders()`:

1. Per-call `NodebbAuth` override (if caller passes one)
2. Module-level config defaults (from `NodebbModule.register()`)
3. No auth header (fallback for `NONE` mode)

---

## 2. Provider auth-mode matrix

### 2.1 NodebbTopicsProvider (`src/nodebb/providers/nodebb-topics.provider.ts`)

| Method           | Auth required? | Auth param | Callers pass auth? |
|------------------|---------------|------------|--------------------|
| `getById(tid)`   | No (optional) | `auth?`    | No — uses module default |
| `list(options)`  | No (optional) | `auth?`    | No — uses module default |
| `create(data)`   | **Yes**       | `auth`     | Not yet wired       |
| `update(tid)`    | **Yes**       | `auth`     | Not yet wired       |
| `delete(tid)`    | **Yes**       | `auth`     | Not yet wired       |

**Callers:** `GetFeedUsecase.list()`, `PostsService.getById()` — both pass no auth.

### 2.2 NodebbPostsProvider (`src/nodebb/providers/nodebb-posts.provider.ts`)

| Method           | Auth required? | Auth param | Callers pass auth? |
|------------------|---------------|------------|--------------------|
| `getByPid(pid)`  | No (optional) | `auth?`    | No — uses module default |
| `getByTid(tid)`  | No (optional) | `auth?`    | No — uses module default |
| `create(data)`   | **Yes**       | `auth`     | Not yet wired       |
| `update(pid)`    | **Yes**       | `auth`     | Not yet wired       |
| `delete(pid)`    | **Yes**       | `auth`     | Not yet wired       |

**Callers:** `GetFeedUsecase.getByPid()`, `PostsService.getByPid()`, `PostsService.getByTid()` — all pass no auth.

### 2.3 NodebbUsersProvider (`src/nodebb/providers/nodebb-users.provider.ts`)

| Method           | Auth required? | Auth param | Callers pass auth? |
|------------------|---------------|------------|--------------------|
| `getByUid(uid)`  | No (optional) | `auth?`    | No — uses module default |
| `getBySlug(slug)`| No (optional) | `auth?`    | No — uses module default |
| `getSaved(uid)`  | No (optional) | `auth?`    | No — uses module default |

**Callers:** `GetFeedUsecase.getByUid()`, `ProfileUsecase.getByUid()`, `ProfileUsecase.getSaved()` — all pass no auth. No write methods exist on this provider.

### 2.4 NodebbNotificationsProvider (`src/nodebb/providers/nodebb-notifications.provider.ts`)

| Method            | Auth required? | Auth param | Callers pass auth? |
|-------------------|---------------|------------|--------------------|
| `list(auth)`      | **Yes**       | `auth`     | Hardcoded `{ mode: NodebbAuthMode.NONE }` |
| `markRead(nid)`   | **Yes**       | `auth`     | Not yet wired (throws "Not implemented") |

**Callers:** `NotificationsUseCase.list()` — explicitly overrides auth to `NONE`, ignoring module default. The `uid` parameter is accepted but discarded (`void uid`).

### 2.5 NodebbTagsProvider (`src/nodebb/providers/nodebb-tags.provider.ts`)

| Method        | Auth required? | Auth param | Callers pass auth? |
|---------------|---------------|------------|--------------------|
| `list(auth?)` | No (optional) | `auth?`    | No callers found   |

No write methods exist. No callers outside the provider itself.

### 2.6 NodebbSearchProvider (`src/nodebb/providers/nodebb-search.provider.ts`)

| Method                | Auth required? | Auth param | Callers pass auth? |
|-----------------------|---------------|------------|--------------------|
| `search(term, options?, auth?)` | No (optional) | `auth?`    | Not yet wired       |

**Callers:** None found in the codebase. The provider is exported from the barrel but not yet consumed by any service or controller.

**Error normalization contract:**
The provider delegates to `client.get()` and returns the `NodebbNormalizedResponse` envelope as-is — it does not transform or wrap errors. Callers receive:
- `BodyStatus.OK` with populated or empty `matches` array on success
- `BodyStatus.NOT_FOUND` when the client returns HTTP 404
- `BodyStatus.ERROR` for all other HTTP error codes (401, 429, 500, 502, etc.)

**Empty-result contract:**
A successful search with no matches returns `{ status: 'ok', data: { matches: [], matchCount: 0, pagination: { page: 1, pageCount: 0, itemsPerPage: 10 } } }`. The `matches` array is always present (never `null`).

---

## 3. Controller uid placeholder matrix

Every controller that consumes NodeBB providers currently uses `uid = 0` as a placeholder. None extract real user identity from the request.

| Controller file | Placeholder | TODO reference |
|-----------------|-------------|----------------|
| `src/feed/feed.controller.ts` | `const userId = 0` (lines 15, 21) | `TODO(#33): Extract userId from authenticated request (JwtAuthGuard)` |
| `src/messages/controllers/notifications.controller.ts` | `const uid = 0` (lines 16, 27, 38) | `TODO: Extract uid from auth context (session/JWT)` |
| `src/messages/controllers/messages.controller.ts` | `const fromUid = 0`, `const uid = 0` (lines 14, 24, 31) | `TODO: Extract fromUid from auth context (session/JWT)` |
| `src/messages/use-cases/notifications.use-case.ts` | `const auth = { mode: NodebbAuthMode.NONE }` (lines 21, 46) | `TODO: Build NodebbAuth from request context` |

---

## 4. Guard gaps

### 4.1 No guards implemented

No NestJS guards exist for any NodeBB-consuming endpoint. All routes are publicly accessible without authentication.

**Expected guards (per architecture docs):**

| Guard | Status | Source doc |
|-------|--------|------------|
| `JwtAuthGuard` | Not implemented | `docs/architecture/auth-module-contract.md` |
| `NodebbSessionGuard` | Not implemented | `docs/architecture/nodebb-auth-mode-boundary.md` (Slice 4) |
| `RolesGuard` | Not implemented | `docs/architecture/auth-module-contract.md` |
| `@Public()` decorator | Not implemented | `docs/architecture/auth-module-contract.md` |

### 4.2 No `@UseGuards()` decorators on any controller

No controller in `src/feed/`, `src/messages/`, or `src/profile/` applies a guard decorator. All endpoints are open.

### 4.3 Silent auth gap with default config

The default env config sets `NODEBB_AUTH_MODE=api_token` with an empty `NODEBB_API_TOKEN`. Because `buildAuthHeaders()` returns `{}` when `token` is falsy, requests go out with **no auth header** despite the mode being `API_TOKEN`. This is a silent degradation — no error is thrown.

---

## 5. Module registration inconsistencies

Three separate `NodebbModule.register()` calls exist. Because the module is `@Global()`, the last registration wins.

| Registration site | Auth source | Cast method | Credential fields |
|-------------------|------------|-------------|-------------------|
| `AppModule` (`src/app.module.ts`) | `ConfigService` via `registerAsync` | `toNodebbAuthMode()` (validated) | `apiToken`, `sessionCookie` |
| `ProfileModule` (`src/profile/profile.module.ts`) | `process.env` directly | Implicit string match | `apiToken`, `sessionCookie` |
| `MessagesModule` (`src/messages/messages.module.ts`) | `process.env` directly | `as NodebbAuthMode` (unsafe cast) | **Omitted** — no `apiToken` or `sessionCookie` |

The `MessagesModule` registration bypasses `toNodebbAuthMode()` and omits credential fields, meaning it always uses `NONE` mode with no credentials regardless of env config.

---

## 6. Route auth requirements vs. current protection

Cross-referencing `docs/contracts/route-inventory.md` "Requires auth" annotations against actual guard coverage:

| Route family | Routes requiring auth | Guard protecting them | Gap? |
|-------------|----------------------|----------------------|------|
| AUTH (login/register/logout) | me, password | None | **Yes** |
| USERS (update, posts, topics) | Owner/admin operations | None | **Yes** |
| CATEGORIES (create topic) | POST create | None | **Yes** |
| TOPICS (follow, vote, update, delete) | All write ops | None | **Yes** |
| POSTS (edit, delete, vote, reply) | All write ops | None | **Yes** |
| MESSAGING | All routes | None | **Yes** |
| NOTIFICATIONS | All routes | None | **Yes** |
| GROUPS (join, leave) | Join, leave | None | **Yes** |

**Every route marked "Requires auth" in the route inventory is currently unprotected.**

---

## 7. Resolution tracking

| Gap | Blocking issue | Status |
|-----|---------------|--------|
| No JwtAuthGuard | Auth module not implemented | Blocked on auth module work |
| No NodebbSessionGuard | Session guard not implemented | Blocked on Slice 4 of auth-mode boundary plan |
| uid=0 placeholder in all controllers | Depends on JwtAuthGuard | Blocked on guard implementation |
| NotificationsUseCase hardcodes NONE auth | Depends on auth context extraction | Blocked on guard implementation |
| Silent auth gap (empty API_TOKEN) | Config validation allows empty token in api_token mode | Can fix independently |
| MessagesModule unsafe cast | Bypasses toNodebbAuthMode() | Can fix independently |
| Multiple NodebbModule registrations | @Global module registered 3x | Can consolidate independently |

---

## 8. Adapter boundary guard

A CLI guard script (`scripts/guards/check-nodebb-adapter-boundary.js`) enforces
that business modules consume NodeBB **only** through the provider barrel
(`src/nodebb/index.ts`).  It scans all `.ts` files under `src/` (excluding
`src/nodebb/**` and test files) for boundary violations.

### 8.1 Rules enforced

| Rule | What it catches | Rationale |
|------|----------------|-----------|
| `no-http-import` | Imports of `http`, `https`, `node-fetch`, `axios`, `got` | Business code must not make direct HTTP calls to NodeBB |
| `no-direct-adapter-import` | Imports of `nodebb-client` internals | The client is an adapter-private abstraction |
| `no-direct-token-import` | Direct imports of `NODEBB_CLIENT` token | Providers must be injected via the barrel, not the raw token |
| `no-direct-fetch` | `fetch()` calls targeting `/api/v3/` paths | No URL construction outside the adapter |

### 8.2 Running the guard

```bash
# Human-readable output (default)
node scripts/guards/check-nodebb-adapter-boundary.js

# Machine-readable JSON
node scripts/guards/check-nodebb-adapter-boundary.js --json

# Warning-only mode (exit 0 even on violations)
node scripts/guards/check-nodebb-adapter-boundary.js --warn-only

# Custom src root
node scripts/guards/check-nodebb-adapter-boundary.js --src-root ./dist/src
```

Exit codes: `0` = clean, `1` = violations found, `2` = usage error.

### 8.3 Enforcement mode

The guard currently runs in **warning-only** mode because the existing codebase
has known violations (direct `NODEBB_CLIENT` imports in some modules).  Once
all violations are resolved, remove `--warn-only` to enforce at CI level.

### 8.4 Relationship to Jest boundary spec

The existing `src/nodebb/nodebb-boundary.spec.ts` covers HTTP-library imports
only (runtime Jest test).  The CLI guard extends coverage to adapter-internal
symbols, injection tokens, and direct fetch patterns.  Both should pass for a
healthy codebase.

---

## References

- [NodeBB auth-mode boundary](../architecture/nodebb-auth-mode-boundary.md) — ownership rules, handler prohibitions, implementation slices
- [NodeBB integration](../architecture/nodebb-integration.md) — module structure, env vars, boundary enforcement
- [Auth module contract](../architecture/auth-module-contract.md) — JWT strategy, guards, identity bridge
- [Route inventory](route-inventory.md) — legacy route definitions and auth annotations
