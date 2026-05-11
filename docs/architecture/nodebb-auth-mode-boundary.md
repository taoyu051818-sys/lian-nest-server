# NodeBB Auth-Mode Ownership and Adapter Boundary

> Architecture note for [#18](https://github.com/taoyu051818-sys/lian-nest-server/issues/18).
> Supplements `nodebb-integration.md` (PR #16) with concrete ownership rules
> for auth header selection, handler prohibitions, and config cast boundaries.

---

## 1. Auth-mode ownership: the adapter decides

The `NodebbHttpClient` (private to `nodebb.module.ts`) is the **sole owner**
of HTTP auth header construction. No handler, use-case, controller, or
service outside `src/nodebb/` may influence which header is sent or what
token value is used.

### 1.1 Auth-mode resolution order

```
1. Per-call NodebbAuth override  (if caller passes one)
2. Module-level config defaults  (from NodebbModule.register())
3. No auth                       (fallback for NONE mode)
```

The per-call override exists for the SESSION mode proxy pattern (forwarding
the browser cookie). Handlers that run in server-to-server context must
**never** pass a `NodebbAuth` override — they rely on the module default.

### 1.2 Internal header selection

The adapter maps `NodebbAuthMode` to HTTP headers internally:

| NodebbAuthMode  | Header produced                   | Token source              |
|-----------------|-----------------------------------|---------------------------|
| `API_TOKEN`     | `Authorization: Bearer <token>`   | `config.apiToken` (env)   |
| `SESSION`       | `Cookie: <cookie>`                | `config.sessionCookie` or per-call `NodebbAuth.sessionCookie` |
| `NONE`          | *(no auth header)*                | —                         |

**Why Bearer, not x-api-token?** NodeBB v3's `/api/v3/` endpoints accept
`Authorization: Bearer <token>` for server-to-server calls. The legacy
`x-api-token` header is a v1/v2 convention. The adapter uses Bearer
exclusively for API_TOKEN mode. If a future NodeBB version requires
`x-api-token` for specific endpoints, the change is confined to
`NodebbHttpClient.buildAuthHeaders()` — no handler changes needed.

**If dual-header support becomes necessary** (e.g., a middleware endpoint
requires `x-api-token` while the main API uses Bearer), add a new
`NodebbAuthMode` variant (e.g., `API_TOKEN_V2`) rather than leaking header
choice into handler code. The adapter owns the mapping; the enum owns the
semantics.

---

## 2. Handler and use-case prohibitions

Handlers, use-cases, controllers, and services that consume NodeBB providers
**must not**:

| Forbidden pattern | Why | Correct approach |
|---|---|---|
| Pass raw `Authorization` or `Cookie` header strings | Leaks HTTP concern into business logic | Rely on module-level auth or pass `NodebbAuth` with enum mode |
| Construct NodeBB endpoint URLs (`/api/v3/topics/...`) | Duplicates provider logic, breaks if paths change | Call the semantic provider method (`topicsProvider.get()`) |
| Pass token strings from `req.headers` directly | Bypasses adapter auth resolution, security risk | For SESSION mode, pass `NodebbAuth { mode: SESSION, sessionCookie }` extracted by a guard |
| Import `fetch`, `axios`, `got`, `http`, `https` | Violates boundary spec enforced by `nodebb-boundary.spec.ts` | Inject `NodebbClient` or a typed provider |
| Switch on `NodebbAuthMode` in handler code | Duplicates adapter logic, creates coupling | Use the provider; adapter handles mode-specific behavior |

### 2.1 Allowed handler patterns

```typescript
// GOOD — rely on module defaults (server-to-server)
@Injectable()
export class NotificationService {
  constructor(
    private readonly notifications: NodebbNotificationsProvider,
  ) {}

  async getUnread(uid: number) {
    return this.notifications.list({ uid, read: false });
  }
}

// GOOD — forward session cookie via auth override (user proxy)
@Injectable()
export class ProfileProxyService {
  constructor(private readonly users: NodebbUsersProvider) {}

  async getMyProfile(sessionCookie: string) {
    return this.users.getByUid('me', {
      mode: NodebbAuthMode.SESSION,
      sessionCookie,
    });
  }
}
```

---

## 3. Env-config string-to-enum cast boundary

### 3.1 Problem

`NODEBB_AUTH_MODE` is a string env var (`'api_token'`, `'session'`, `'none'`).
The `NodebbAuthMode` enum has matching string values, so TypeScript does not
catch a mismatch at runtime if the env var contains an unexpected value after
Joi validation is bypassed or changed.

### 3.2 Cast boundary location

The cast from `string → NodebbAuthMode` must happen **exactly once**, at the
config layer, before the value reaches `NodebbModule.register()`:

```
env var (string)
  → Joi validation (validates allowed strings)
    → ConfigService.nodebbConfig getter (casts to NodebbAuthMode enum)
      → NodebbModule.register({ authMode: NodebbAuthMode })
        → NodebbHttpClient (consumes enum, never string)
```

### 3.3 Implementation contract

```typescript
// In ConfigService (src/config/config.service.ts):
get nodebbConfig(): NodebbModuleConfig {
  const raw = this.get<string>('NODEBB_AUTH_MODE'); // already Joi-validated

  // Explicit cast boundary — fails fast on unexpected value
  const authMode = toNodebbAuthMode(raw);

  return {
    baseUrl: this.get<string>('NODEBB_URL'),
    authMode,
    apiToken: this.get<string>('NODEBB_API_TOKEN'),
    sessionCookie: this.get<string>('NODEBB_SESSION_COOKIE'),
  };
}
```

```typescript
// In src/nodebb/types.ts (add):
const AUTH_MODE_MAP: Record<string, NodebbAuthMode> = {
  api_token: NodebbAuthMode.API_TOKEN,
  session: NodebbAuthMode.SESSION,
  none: NodebbAuthMode.NONE,
};

export function toNodebbAuthMode(raw: string): NodebbAuthMode {
  const mode = AUTH_MODE_MAP[raw];
  if (!mode) {
    throw new Error(
      `Invalid NODEBB_AUTH_MODE: "${raw}". Expected one of: ${Object.keys(AUTH_MODE_MAP).join(', ')}`,
    );
  }
  return mode;
}
```

**Rules:**
- `toNodebbAuthMode()` is the **only** place a raw string becomes a `NodebbAuthMode`.
- `NodebbModule.register()` accepts `NodebbAuthMode` enum only — never `string`.
- If Joi validation and `toNodebbAuthMode()` disagree, the explicit cast throws
  at startup (fail-fast, not silent degradation).

---

## 4. Concrete examples by operation class

### 4.1 Notifications (server-to-server, API_TOKEN mode)

```typescript
// Handler — no auth concerns
@Injectable()
export class NotificationService {
  constructor(private readonly notifications: NodebbNotificationsProvider) {}

  /** List unread notifications for a user. Module default auth applies. */
  async getUnread(uid: number) {
    const res = await this.notifications.list({ uid, read: false });
    if (res.status !== BodyStatus.OK) throw new NodebbError(res);
    return res.data;
  }

  /** Mark a notification as read. */
  async markRead(nid: string) {
    return this.notifications.markRead(nid);
  }
}
```

### 4.2 Saved, liked, and profile collections (SESSION mode, user proxy)

```typescript
// Handler — forwards session cookie, never constructs URLs
@Injectable()
export class UserCollectionService {
  constructor(private readonly users: NodebbUsersProvider) {}

  async getSavedTopics(sessionCookie: string) {
    // Adapter resolves SESSION auth internally
    return this.users.getByUid('me', {
      mode: NodebbAuthMode.SESSION,
      sessionCookie,
    });
  }

  async getLikedPosts(sessionCookie: string) {
    // Semantic provider method — no raw endpoint
    return this.users.getLiked('me', {
      mode: NodebbAuthMode.SESSION,
      sessionCookie,
    });
  }
}
```

### 4.3 Create, reply, and write operations (API_TOKEN with uid context)

```typescript
// Handler — uses module default auth, passes semantic DTOs
@Injectable()
export class PostingService {
  constructor(
    private readonly topics: NodebbTopicsProvider,
    private readonly posts: NodebbPostsProvider,
  ) {}

  async createTopic(uid: number, cid: number, title: string, content: string) {
    return this.topics.create({ uid, cid, title, content });
    // Adapter sends: POST /api/v3/topics with Bearer token
    // Handler never sees the URL or the header
  }

  async reply(tid: number, uid: number, content: string) {
    return this.posts.create({ tid, uid, content });
  }
}
```

### 4.4 Public reads (NONE mode)

```typescript
// Handler — no auth needed, module default is NONE for public routes
@Injectable()
export class PublicBrowseService {
  constructor(
    private readonly topics: NodebbTopicsProvider,
    private readonly tags: NodebbTagsProvider,
  ) {}

  async getTopicDetail(tid: number) {
    return this.topics.get(tid);
    // Adapter sends: GET /api/v3/topics/{tid} with no auth header
  }

  async listTags() {
    return this.tags.list();
  }
}
```

---

## 5. Implementation slices

### Slice 1: Add `toNodebbAuthMode()` cast helper and explicit config boundary

**Issue title:** `feat(nodebb): add explicit string-to-enum cast for NODEBB_AUTH_MODE`

**File scope:**
- `src/nodebb/types.ts` — add `AUTH_MODE_MAP` and `toNodebbAuthMode()` export
- `src/nodebb/index.ts` — re-export `toNodebbAuthMode`
- `src/config/config.service.ts` — use `toNodebbAuthMode()` in `nodebbConfig` getter

**Dependencies:** PR #16 (NodeBB module) must be merged first.

**Validation:**
- `npm run build` passes
- Unit test: `toNodebbAuthMode('api_token')` returns `NodebbAuthMode.API_TOKEN`
- Unit test: `toNodebbAuthMode('invalid')` throws with descriptive message
- `nodebb-boundary.spec.ts` still passes (no new HTTP imports)

**Acceptance:**
- `NodebbModule.register()` receives enum, never raw string
- Startup fails fast if env var contains an invalid auth mode
- No handler or service imports `toNodebbAuthMode` (only ConfigService uses it)

---

### Slice 2: Document and enforce handler prohibition rules via lint/spec

**Issue title:** `test(nodebb): add boundary spec for forbidden handler patterns`

**File scope:**
- `src/nodebb/nodebb-boundary.spec.ts` — extend to detect:
  - Raw `/api/v3/` path strings outside `src/nodebb/`
  - Direct `Authorization` header construction outside `src/nodebb/`
- `docs/architecture/nodebb-auth-mode-boundary.md` (this file) — already done

**Dependencies:** Slice 1 (cast helper exists for reference).

**Validation:**
- `npm run test` passes with expanded spec
- Spec correctly flags a test file that constructs `/api/v3/` paths
- Spec does not flag legitimate provider usage inside `src/nodebb/`

**Acceptance:**
- CI catches handler code that constructs NodeBB URLs directly
- CI catches handler code that builds raw auth headers
- Violation messages reference this architecture doc

---

### Slice 3: Wire NodebbModule into AppModule with ConfigService integration

**Issue title:** `feat(config): wire NodebbModule.register via ConfigService.nodebbConfig`

**File scope:**
- `src/app.module.ts` — import `NodebbModule.register(configService.nodebbConfig)`
- `src/config/config.module.ts` — ensure ConfigService is available for useFactory

**Dependencies:** Slice 1 (cast boundary must exist first).

**Validation:**
- `npm run build` passes
- `npm run start:dev` boots without errors (even with empty NODEBB_URL)
- Health check still passes

**Acceptance:**
- NodebbModule is registered exactly once in the app
- Auth mode comes from env via ConfigService, not hardcoded
- App fails to start if NODEBB_AUTH_MODE is invalid (fail-fast from Slice 1)

---

### Slice 4: Add SESSION-mode proxy guard for user-context routes

**Issue title:** `feat(auth): add NodebbSessionGuard for user-context proxy routes`

**File scope:**
- `src/nodebb/guards/nodebb-session.guard.ts` — new NestJS guard that extracts session cookie from request and attaches `NodebbAuth` to request context
- `src/nodebb/index.ts` — re-export guard

**Dependencies:** Slice 3 (module must be wired).

**Validation:**
- Guard extracts `Cookie` header from incoming request
- Guard attaches `NodebbAuth { mode: SESSION, sessionCookie }` to request
- Handler accesses auth via `@Req()` decorator, passes to provider
- Guard rejects requests with no session cookie (401)

**Acceptance:**
- User-context routes use SESSION mode without handlers constructing auth objects manually
- No handler imports or references raw `Cookie` header strings
- Guard test covers: valid session, missing session, expired session
