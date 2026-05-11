# Auth Session Contract

Current-user extraction and fail-closed behavior for the auth module.
Covers `JwtAuthGuard` and `@CurrentUser()` decorator semantics.

> **Issue:** #238 | **Scope:** Docs/contract + parity fixtures only. No runtime changes.

---

## Guard: JwtAuthGuard

**Source:** `src/auth/guards/jwt-auth.guard.ts`
**Pattern:** Standalone `CanActivate` (no Passport dependency)

### Token Extraction

1. Read `Authorization` header from the request.
2. Reject if header is missing, empty, or does not start with `Bearer `.
3. Extract the token string after `Bearer ` (7 characters).
4. Split token by `.` — must be exactly 3 parts (header.payload.signature).
5. Base64url-decode the second segment (payload).
6. Parse as JSON — must produce a valid object.

### Payload Validation

| Rule | Behavior |
|------|----------|
| `payload.sub` is missing | Reject (401) |
| `payload.sub` is not a number | Reject (401) |
| `payload.sub <= 0` | Reject (401) |
| `payload.sub` is a positive integer | Accept |

No signature verification is performed. The guard is a structural
validator, not a cryptographic one.

### Request Mutation

On success, the guard attaches the decoded payload to `request.user`:

```typescript
request.user = payload as JwtPayload;
```

### Fail-Closed Behavior

The guard is fail-closed: any validation failure throws
`UnauthorizedException` immediately. There is no fallback, no default
user, and no partial-identity path.

| Scenario | Status | Error message |
|----------|--------|---------------|
| No `Authorization` header | 401 | `Missing or invalid Authorization header` |
| Non-Bearer scheme (e.g. `Basic`) | 401 | `Missing or invalid Authorization header` |
| Token with fewer/more than 3 parts | 401 | `Invalid token payload` |
| Token with invalid base64 payload | 401 | `Invalid token payload` |
| Payload without `sub` | 401 | `Invalid token payload` |
| Payload with `sub <= 0` | 401 | `Invalid token payload` |

---

## Decorator: @CurrentUser()

**Source:** `src/auth/decorators/current-user.decorator.ts`

NestJS param decorator that reads `request.user` (set by JwtAuthGuard).

| Usage | Returns |
|-------|---------|
| `@CurrentUser()` | Full `JwtPayload` object (`{ sub, ...rest }`) |
| `@CurrentUser('sub')` | Just the `sub` field (number) |
| No user on request | `undefined` |

### JwtPayload Interface

```typescript
export interface JwtPayload {
  sub: number;
  [key: string]: unknown;
}
```

Only `sub` is guaranteed. All other fields are pass-through from the
token payload and may be absent.

---

## CurrentUserDto (Response Shape)

**Source:** `src/auth/dto/current-user.dto.ts`

Returned by `GET /api/auth/me` once the usecase is implemented.

| Field | Type | Required |
|-------|------|----------|
| `id` | number | yes |
| `uuid` | string | yes |
| `email` | string | yes |
| `username` | string | yes |
| `displayName` | string \| null | yes |
| `avatarUrl` | string \| null | yes |
| `role` | `'USER' \| 'MODERATOR' \| 'ADMIN'` | yes |
| `nodebbUid` | number \| null | yes |
| `createdAt` | string (ISO 8601) | yes |

---

## Integration Contract

### Guard + Decorator Pipeline

1. `JwtAuthGuard` runs before the route handler (via `@UseGuards()`).
2. Guard validates the token and sets `request.user`.
3. `@CurrentUser()` reads `request.user` inside the route handler.
4. If the guard throws, the handler never executes.

### Consumers (Current)

- `src/messages/controllers/messages.controller.ts` — `@UseGuards(JwtAuthGuard)` at controller level, `@CurrentUser('sub')` on methods.
- `src/messages/controllers/notifications.controller.ts` — same pattern.

### Known Gap

`auth.controller.ts` `me()` and `changePassword()` endpoints read
`req.user?.id` directly without `JwtAuthGuard`. These endpoints have
no guard protection — the user identity is never established. This is
out of scope for this contract (tracked separately).

---

## Parity Fixtures

Located in `test/parity/auth/`. Format follows
`docs/contracts/readonly-route-parity-fixtures.md`.

| File | Scenario | Expected Status |
|------|----------|-----------------|
| `jwt-guard-valid.json` | Valid JWT with `sub: 42` | Guard passes, `request.user.sub === 42` |
| `jwt-guard-missing-header.json` | No Authorization header | 401 |
| `jwt-guard-invalid-bearer.json` | `Basic abc123` scheme | 401 |
| `jwt-guard-malformed-token.json` | `Bearer abc.def` (2 parts) | 401 |
| `jwt-guard-invalid-payload.json` | JWT with `sub: 0` | 401 |

---

## Non-Goals

- **No Passport integration.** The guard is standalone.
- **No cryptographic verification.** Signature is not checked.
- **No route changes.** This contract documents existing behavior only.
- **No messages route changes.** Messages/notifications are owned by #216.
