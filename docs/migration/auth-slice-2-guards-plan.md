# Auth Slice 2: Migration Plan — Guards, Decorators, and Request Typing

> Implementation plan for Slice A2 from the endpoint migration queue.
> Defines file scopes, validation criteria, and step-by-step implementation
> order. This is a docs-only plan; no runtime source is modified.

## 1. Slice Identity

| Field | Value |
|-------|-------|
| **Slice** | A2 — JWT Strategy + Guards |
| **Issue** | #56 |
| **Depends on** | A1 (Auth Config + Module Skeleton, PR #43) |
| **Blocks** | A3 (Login), F1 (Feed), P1–P4 (Posts), M1 (Messages), N1 (Notifications), PR1 (Profile) |
| **PR type** | Single implementation PR |

## 2. Files to Create

### 2.1 New files (7)

| File | Lines (est.) | Description |
|------|-------------|-------------|
| `src/auth/types/authenticated-request.ts` | 20 | `AuthenticatedRequest`, `JwtPayload`, `AuthenticatedUser` interfaces |
| `src/auth/strategies/jwt.strategy.ts` | 25 | Passport JWT strategy — validates token, maps payload to user |
| `src/auth/guards/jwt-auth.guard.ts` | 25 | Extends `AuthGuard('jwt')`, checks `@Public()` metadata |
| `src/auth/guards/roles.guard.ts` | 25 | Reads `@Roles()` metadata, compares against `req.user.role` |
| `src/auth/decorators/public.decorator.ts` | 5 | `@Public()` — sets `isPublic` metadata |
| `src/auth/decorators/roles.decorator.ts` | 5 | `@Roles()` — sets `roles` metadata |
| `src/auth/decorators/current-user.decorator.ts` | 15 | `@CurrentUser()` — param decorator extracting `req.user` |

### 2.2 Files to modify (2)

| File | Change |
|------|--------|
| `src/auth/auth.module.ts` | Add `JwtStrategy`, `JwtAuthGuard` (APP_GUARD), `RolesGuard` (APP_GUARD) to providers |
| `src/auth/index.ts` | Add barrel exports for new types, guards, decorators, strategy |

### 2.3 Test files to create (4)

| File | Lines (est.) | Tests |
|------|-------------|-------|
| `src/auth/strategies/jwt.strategy.spec.ts` | 30 | `validate()` maps `{ sub, role }` → `{ id, role }` |
| `src/auth/guards/jwt-auth.guard.spec.ts` | 40 | `@Public()` bypass, passport delegation |
| `src/auth/guards/roles.guard.spec.ts` | 50 | No roles → pass, matching role → pass, missing role → 403 |
| `src/auth/decorators/current-user.decorator.spec.ts` | 25 | Extracts full user, extracts specific property |

### 2.4 Package changes (1)

| File | Change |
|------|--------|
| `package.json` | Add `@nestjs/passport`, `@nestjs/jwt`, `passport`, `passport-jwt` to dependencies; `@types/passport-jwt` to devDependencies |

### 2.5 Files NOT touched

- `src/auth/auth.controller.ts` — no route changes
- `src/auth/usecases/*` — usecase stubs unchanged
- `src/auth/dto/*` — DTOs unchanged
- `src/app.module.ts` — AuthModule already imported
- `src/config/*` — JWT_SECRET already validated (Slice 1)
- `prisma/*` — no schema changes

## 3. Implementation Order

### Step 1: Install dependencies

```bash
npm install @nestjs/passport @nestjs/jwt passport passport-jwt
npm install -D @types/passport-jwt
```

### Step 2: Create type definitions

Create `src/auth/types/authenticated-request.ts` with:
- `JwtPayload` interface (`sub`, `role`, `iat`, `exp`)
- `AuthenticatedUser` interface (`id`, `role`)
- `AuthenticatedRequest` extending `express.Request` with non-optional `user`

### Step 3: Create decorators

Create in order (no inter-dependencies):
1. `src/auth/decorators/public.decorator.ts` — `IS_PUBLIC_KEY` + `@Public()`
2. `src/auth/decorators/roles.decorator.ts` — `ROLES_KEY` + `@Roles()`
3. `src/auth/decorators/current-user.decorator.ts` — `@CurrentUser()`

### Step 4: Create JwtStrategy

Create `src/auth/strategies/jwt.strategy.ts`:
- Extends `PassportStrategy(Strategy)`
- Injects `ConfigService` for `JWT_SECRET`
- `validate()` maps `JwtPayload` → `AuthenticatedUser`

### Step 5: Create guards

Create in order (JwtAuthGuard depends on `IS_PUBLIC_KEY`):
1. `src/auth/guards/jwt-auth.guard.ts` — extends `AuthGuard('jwt')`, checks `@Public()`
2. `src/auth/guards/roles.guard.ts` — implements `CanActivate`, reads `@Roles()`

### Step 6: Update AuthModule

Modify `src/auth/auth.module.ts`:
- Import `JwtStrategy`, `JwtAuthGuard`, `RolesGuard`
- Add `JwtStrategy` to `providers`
- Add `JwtAuthGuard` as `APP_GUARD` provider
- Add `RolesGuard` as `APP_GUARD` provider

### Step 7: Update barrel exports

Modify `src/auth/index.ts`:
- Export `AuthenticatedRequest`, `JwtPayload`, `AuthenticatedUser` from types
- Export `JwtStrategy` from strategies
- Export `JwtAuthGuard` from guards
- Export `RolesGuard` from guards
- Export `Public`, `Roles`, `CurrentUser` from decorators

### Step 8: Write unit tests

Create test files in order:
1. `src/auth/strategies/jwt.strategy.spec.ts`
2. `src/auth/guards/jwt-auth.guard.spec.ts`
3. `src/auth/guards/roles.guard.spec.ts`
4. `src/auth/decorators/current-user.decorator.spec.ts`

### Step 9: Validate

```bash
npm run check        # lint + typecheck
npm run build        # compilation
npm run test         # unit tests
```

## 4. Validation Criteria

### 4.1 Build validation

| Check | Command | Expected |
|-------|---------|----------|
| Type check | `npm run check` | Pass (zero errors) |
| Build | `npm run build` | Pass (dist/ produced) |
| Unit tests | `npm run test` | Pass (all new tests green) |
| Lint | `npm run lint` | Pass (no new warnings) |

### 4.2 Functional validation (unit tests)

| Test | Assertion |
|------|-----------|
| JwtStrategy with valid payload | Returns `{ id: payload.sub, role: payload.role }` |
| JwtAuthGuard on `@Public()` route | Returns `true` without calling passport |
| JwtAuthGuard on protected route | Delegates to `super.canActivate()` |
| RolesGuard with no `@Roles()` | Returns `true` |
| RolesGuard with matching role | Returns `true` |
| RolesGuard with missing role | Throws `ForbiddenException` (403) |
| `@CurrentUser()` decorator | Returns full `user` object |
| `@CurrentUser('id')` decorator | Returns `user.id` only |

### 4.3 Integration validation (deferred to Slice A3)

These require a working `LoginUsecase` and are NOT part of Slice A2:

| Test | Assertion |
|------|-----------|
| Valid JWT → `req.user = { id, role }` | 200 response with user data |
| Expired JWT → 401 | `UNAUTHORIZED` error envelope |
| Missing header → 401 | `UNAUTHORIZED` error envelope |
| `@Public()` route → no auth | 200 without token |

## 5. Guard Registration Matrix

After Slice A2, the guard behavior for each route family:

| Route | `@Public()` | `@Roles()` | Effect |
|-------|-------------|------------|--------|
| `POST /api/auth/login` | Yes | — | Skips auth (login does not require token) |
| `POST /api/auth/register` | Yes | — | Skips auth (register does not require token) |
| `POST /api/auth/logout` | No | — | Requires valid JWT |
| `GET /api/auth/me` | No | — | Requires valid JWT |
| `POST /api/auth/password` | No | — | Requires valid JWT |
| `GET /api/feed` | No | — | Requires valid JWT |
| `GET /api/feed/:id` | No | — | Requires valid JWT |
| `GET /api/posts` | No | — | Requires valid JWT |
| `GET /api/posts/:id` | No | — | Requires valid JWT |
| `DELETE /api/posts/:id` | No | `MODERATOR` | Requires JWT + moderator role |
| `GET /api/profile/:uid` | No | — | Requires valid JWT |

**Note:** The `@Public()` and `@Roles()` decorators are applied in
subsequent slices (A3, P2, etc.) as each route is implemented. Slice A2
only provides the infrastructure.

## 6. Dependency Graph Impact

```
Slice A1 (Config + Skeleton) ─── DONE (PR #43)
  └─► Slice A2 (JWT + Guards) ─── THIS PLAN
        ├─► Slice A3 (Login) ─── next
        ├─► Slice F1 (Feed)
        ├─► Slice P1 (Posts: list + detail)
        ├─► Slice M1 (Messages)
        ├─► Slice N1 (Notifications)
        └─► Slice PR1 (Profile)
```

Landing A2 unblocks 7 downstream slices. Slices A3–A6 remain serial
(auth family). Feature slices (F1, P1–P4, M1, N1, PR1) can proceed
in parallel after A2.

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `passport-jwt` version incompatibility with NestJS 10 | Low | Medium | Pin `@nestjs/passport@^10.0.0`, `passport-jwt@^4.0.1` |
| Global guard breaks HealthModule | Medium | Low | Add `@Public()` to health controller in same PR |
| `APP_GUARD` order not guaranteed | Low | Medium | Register `JwtAuthGuard` before `RolesGuard` in providers array |
| `JWT_SECRET` not available at strategy init | Low | High | Verify `ConfigService` is available in `JwtStrategy` constructor |

## 8. Rollback Plan

Slice A2 is additive — it introduces new files and modifies only
`auth.module.ts` and `index.ts`. Rollback is:

1. Remove new files (`types/`, `strategies/`, `guards/`, `decorators/`)
2. Revert `auth.module.ts` to pre-A2 state
3. Revert `index.ts` to pre-A2 state
4. Remove added dependencies from `package.json`

No database migrations or config changes are involved.

## 9. Non-Goals (Explicit Exclusions)

- **No controller modifications** — Controllers are updated in their
  respective implementation slices (A3, A4, A5).
- **No usecase modifications** — Usecase stubs remain as-is.
- **No persistence wiring** — Session creation, refresh token storage,
  and audit logging happen in A3+.
- **No integration tests** — Full HTTP-level tests require a working
  login endpoint (Slice A3).
- **No request typing migration** — Existing `req: any` stays until
  each controller handler is implemented.

## 10. Assumptions

1. **PR #43 is merged.** The AuthModule skeleton with 5 usecase stubs
   and the controller exists on `main`.
2. **`JWT_SECRET` is validated.** `env.validation.ts` requires
   `JWT_SECRET` in production (from Slice 1). If this is missing,
   the implementation PR must add it.
3. **Express v5 types.** `@types/express` v5.0.0 provides `Request`
   type compatible with `AuthenticatedRequest` extension.
4. **HealthModule needs `@Public()`.** The health controller is
   already imported in `AppModule`. If it does not have `@Public()`,
   the global `JwtAuthGuard` will block health checks. The
   implementation PR must verify and add `@Public()` if needed.
5. **No Prisma enum import.** `RolesGuard` uses `string[]` for role
   comparison, not the Prisma `Role` enum. This avoids coupling
   the guard layer to the database schema.
