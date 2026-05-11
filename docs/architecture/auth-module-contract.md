# AuthModule Migration Contract

> Contract note for implementing the AuthModule in the LIAN Nest rewrite.
> This document defines boundaries, DTOs, usecase contracts, repository
> interactions, and implementation slices. It does NOT contain runtime code.

## 1. Responsibilities

### AuthModule owns

- HTTP layer for the five AUTH routes (`/api/auth/*`).
- Credential verification (password hashing, comparison).
- Session lifecycle (create, validate, revoke, expire).
- JWT access-token issuance and validation (stateless).
- Refresh-token rotation and storage.
- Current-user resolution from bearer token or session cookie.
- Password change flow (verify current, then update).
- User registration orchestration (credential + user record creation).
- Audit logging for security events (`user.login`, `user.register`, `user.logout`, `user.password_change`).
- First-run detection (is this the first user? grant admin role).

### AuthModule does NOT own

- **User profile storage** — owned by the Users Prisma slice (schema-slices Slice 1). AuthModule reads/writes `User` rows via Prisma, but the User model and its migrations belong to the database strategy (issue #9).
- **NodeBB API calls** — owned exclusively by `NodebbModule`. AuthModule delegates any NodeBB user lookup or creation through `NodebbUsersProvider`.
- **Repository implementations** — AuthModule consumes `IAuthRepository`, `ISessionRepository`, and `IAuditEventRepository` via `REPOSITORY_TOKENS`. The storage adapters (Postgres, Redis) are owned by `RepositoryModule` (issue #4).
- **User cache** — owned by `IUserCacheRepository` / Redis. AuthModule may warm the cache after login but does not manage TTLs or invalidation policy.
- **OAuth/SSO providers** — out of scope for the initial migration. The `IAuthRepository` interface supports `google`, `github`, `apple` providers, but the first PR series handles only `local` credentials.
- **Rate limiting / brute-force protection** — a cross-cutting concern for a future middleware layer, not embedded in AuthModule.

## 2. Architectural Boundaries

```
┌─────────────────────────────────────────────────────────┐
│                      HTTP Layer                         │
│  AuthController  ──  Guards  ──  Pipes (validation)     │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
┌──────────────▼──────────┐  ┌────────────▼──────────────┐
│      Usecase Layer      │  │    Guard / Strategy Layer  │
│  LoginUsecase           │  │  JwtAuthGuard              │
│  RegisterUsecase        │  │  JwtStrategy               │
│  LogoutUsecase          │  │  LocalStrategy (passport)  │
│  CurrentUserUsecase     │  │  RolesGuard                │
│  ChangePasswordUsecase  │  └────────────────────────────┘
└──────┬──────┬──────┬────┘
       │      │      │
┌──────▼──┐ ┌─▼────┐ ┌▼──────────────────────────────┐
│ Repos   │ │NodeBB│ │  Config / Crypto               │
│ (tokens)│ │Module │ │  ConfigService (JWT secret,    │
│         │ │      │ │    bcrypt rounds, session TTL)  │
│ IAuth   │ │Users  │ │  bcrypt (hash/compare)         │
│ ISession│ │Provid.│ │  @nestjs/jwt (sign/verify)     │
│ IAudit  │ │      │ │                                 │
└─────────┘ └──────┘ └─────────────────────────────────┘
```

### 2.1 Controller → Usecase

- Controller handles HTTP concerns only: route decorators, DTO validation
  (via `class-validator`), extracting request metadata (IP, user-agent),
  and shaping the response.
- Controller never calls repositories directly. Every action delegates
  to a usecase class.
- Controller applies guards (`JwtAuthGuard`, `RolesGuard`) declaratively
  via `@UseGuards()`.

### 2.2 Usecase → Repository

- Usecases inject repository interfaces via `REPOSITORY_TOKENS`:
  - `IAuthRepository` — credential CRUD
  - `ISessionRepository` — session CRUD
  - `IAuditEventRepository` — audit log writes
- Usecases are plain NestJS `@Injectable()` classes, not tied to HTTP.
  They can be called from CLI scripts, cron jobs, or event handlers.
- Each usecase is a single public `execute()` method with a typed input
  DTO and typed output DTO.

### 2.3 Usecase → NodeBB

- `RegisterUsecase` may optionally create a NodeBB user via
  `NodebbUsersProvider` if the NodeBB bridge is enabled.
  This is a best-effort call; failure does not block registration.
  The resulting `nodebbUid` is stored on the `User` record.
- `LoginUsecase` and `CurrentUserUsecase` may enrich the response
  with NodeBB profile data (reputation, postcount) via
  `IUserCacheRepository` or `NodebbUsersProvider.getByUid()`.
- AuthModule NEVER imports `http`, `https`, `node-fetch`, `axios`,
  or `got`. The NodeBB boundary test enforces this.

### 2.4 Config / Crypto

- `ConfigService` provides typed getters for auth env vars
  (see Section 6).
- Password hashing uses `bcrypt` (configurable rounds).
- Token signing uses `@nestjs/jwt` with HS256.
- Session tokens are opaque `crypto.randomUUID()` strings stored
  in the sessions table.

## 3. DTO Contracts

### 3.1 Request DTOs

```typescript
// POST /api/auth/login
class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

// POST /api/auth/register
class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(3)
  @MaxLength(32)
  username: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  displayName?: string;
}

// POST /api/auth/password
class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}
```

### 3.2 Response DTOs

```typescript
// Login / Register success
class AuthTokensDto {
  accessToken: string;   // JWT, short-lived (15m)
  refreshToken: string;  // opaque, long-lived (7d)
  expiresIn: number;     // seconds until access token expires
}

// GET /api/auth/me
class CurrentUserDto {
  id: number;
  uuid: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: 'USER' | 'MODERATOR' | 'ADMIN';
  nodebbUid: number | null;
  createdAt: string; // ISO 8601
}

// Logout success
class LogoutDto {
  ok: true;
}
```

### 3.3 Internal DTOs (usecase boundaries)

```typescript
// Input to LoginUsecase
interface LoginInput {
  email: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
}

// Output from LoginUsecase
interface LoginOutput {
  user: CurrentUserDto;
  tokens: AuthTokensDto;
}

// Input to RegisterUsecase
interface RegisterInput {
  email: string;
  username: string;
  password: string;
  displayName?: string;
  ip: string | null;
  userAgent: string | null;
}

// Input to ChangePasswordUsecase
interface ChangePasswordInput {
  userId: number;
  currentPassword: string;
  newPassword: string;
}

// Input to CurrentUserUsecase
interface CurrentUserInput {
  userId: number;
}
```

## 4. Usecase Contracts

### 4.1 LoginUsecase

```
execute(input: LoginInput): Promise<LoginOutput>

Steps:
  1. Find user by email (Prisma User lookup).
  2. If not found or user.status !== ACTIVE → throw UnauthorizedException.
  3. Find local credential from IAuthRepository.findByProvider('local', email).
  4. If no credential or passwordHash is null → throw UnauthorizedException.
  5. bcrypt.compare(input.password, credential.passwordHash).
  6. If mismatch → throw UnauthorizedException, audit log user.login_failed.
  7. Generate JWT access token (sub: user.id, role: user.role).
  8. Generate opaque refresh token (crypto.randomUUID()).
  9. Create session via ISessionRepository.create().
  10. Audit log user.login.
  11. Return { user, tokens }.
```

### 4.2 RegisterUsecase

```
execute(input: RegisterInput): Promise<LoginOutput>

Steps:
  1. Check email uniqueness (Prisma).
  2. Check username uniqueness (Prisma).
  3. If either taken → throw ConflictException (409).
  4. Hash password with bcrypt.
  5. Determine role:
     - If no users exist (count === 0) → ADMIN (first-run).
     - Otherwise → USER.
  6. Create User row via Prisma.
  7. Create AuthCredential via IAuthRepository.create({ provider: 'local', ... }).
  8. Optionally create NodeBB user via NodebbUsersProvider.
     - On success: update User.nodebbUid.
     - On failure: log warning, continue (non-blocking).
  9. Generate tokens + session (same as login flow).
  10. Audit log user.register.
  11. Return { user, tokens }.
```

### 4.3 LogoutUsecase

```
execute(sessionId: string): Promise<void>

Steps:
  1. Find session by ID via ISessionRepository.findById().
  2. If not found → no-op (idempotent).
  3. Delete session via ISessionRepository.deleteById().
  4. Audit log user.logout.
```

### 4.4 CurrentUserUsecase

```
execute(input: CurrentUserInput): Promise<CurrentUserDto>

Steps:
  1. Find user by ID (Prisma).
  2. If not found or status !== ACTIVE → throw NotFoundException.
  3. Optionally enrich with NodeBB data from IUserCacheRepository.
  4. Return CurrentUserDto.
```

### 4.5 ChangePasswordUsecase

```
execute(input: ChangePasswordInput): Promise<void>

Steps:
  1. Find credential from IAuthRepository.findByUserId(userId).
  2. Find local credential.
  3. bcrypt.compare(currentPassword, credential.passwordHash).
  4. If mismatch → throw UnauthorizedException.
  5. Hash new password with bcrypt.
  6. Update via IAuthRepository.updatePasswordHash(userId, newHash).
  7. Revoke all other sessions except current (optional, security best practice).
  8. Audit log user.password_change.
```

## 5. Repository Interaction Map

| Usecase             | IAuthRepository          | ISessionRepository         | IAuditEventRepository      | Prisma (User) | NodebbUsersProvider | IUserCacheRepository |
|---------------------|--------------------------|----------------------------|----------------------------|---------------|---------------------|----------------------|
| Login               | findByProvider           | create                     | create (login)             | findUnique    | —                   | —                    |
| Register            | create                   | create                     | create (register)          | create        | getByUid (optional) | —                    |
| Logout              | —                        | findById, deleteById       | create (logout)            | —             | —                   | —                    |
| CurrentUser         | —                        | —                          | —                          | findUnique    | —                   | findById (optional)  |
| ChangePassword      | findByUserId, updateHash | deleteByUserId (others)    | create (password_change)   | —             | —                   | —                    |

## 6. Config / Environment

AuthModule depends on these environment variables, to be added to
`env.validation.ts` and `config.service.ts`:

| Variable              | Type    | Default | Description                                |
|-----------------------|---------|---------|--------------------------------------------|
| `JWT_SECRET`          | string  | —       | HS256 signing secret (required)            |
| `JWT_EXPIRES_IN`      | string  | `15m`   | Access token TTL                           |
| `REFRESH_TOKEN_TTL`   | number  | `604800`| Refresh token TTL in seconds (7 days)      |
| `BCRYPT_ROUNDS`       | number  | `12`    | bcrypt cost factor                         |
| `SESSION_COOKIE_NAME` | string  | `sid`   | Cookie name for session-based auth (future)|

All secrets (JWT_SECRET) must come from environment variables, never
hardcoded. The Joi validation schema must mark `JWT_SECRET` as required
in production.

## 7. Guard / Strategy Contracts

### 7.1 JwtAuthGuard

- Extends `AuthGuard('jwt')` from `@nestjs/passport`.
- Applied to all routes that require authentication.
- Extracts JWT from `Authorization: Bearer <token>` header.
- On valid token: attaches `req.user = { id, role }`.
- On invalid/expired token: throws `UnauthorizedException` (401).

### 7.2 JwtStrategy

- Extends `PassportStrategy(Strategy)` from `@nestjs/passport`.
- Validates JWT signature and expiration.
- Payload shape: `{ sub: number, role: string, iat: number, exp: number }`.
- Optionally verifies user still exists and is ACTIVE (database check).

### 7.3 RolesGuard

- Custom guard using `@nestjs/common` `CanActivate`.
- Reads required roles from `@Roles()` decorator metadata.
- Compares `req.user.role` against required roles.
- Throws `ForbiddenException` (403) if role insufficient.

### 7.4 Public decorator

- `@Public()` marks a route as skipping `JwtAuthGuard`.
- Used for `/api/auth/login` and `/api/auth/register`.
- Implemented via `SetMetadata('isPublic', true)` + custom guard check.

## 8. NodeBB Identity Bridge

### 8.1 Registration flow

```
RegisterUsecase
  ├─ Create LIAN User (Prisma)
  ├─ Create AuthCredential (IAuthRepository)
  └─ NodebbUsersProvider.create({ username, email })  [optional, best-effort]
       ├─ Success → store nodebbUid on User
       └─ Failure → log warning, User.nodebbUid remains null
```

### 8.2 Login enrichment flow

```
LoginUsecase
  ├─ Authenticate (local credential)
  └─ If user.nodebbUid is set:
       └─ IUserCacheRepository.findById() or NodebbUsersProvider.getByUid()
            └─ Enrich response with reputation, postcount, etc.
```

### 8.3 First-run user

```
RegisterUsecase (first user ever)
  ├─ User.count() === 0
  ├─ role = ADMIN
  └─ Optionally call NodebbAdminProvider to grant admin in NodeBB
       (deferred to implementation — contract only notes the intent)
```

### 8.4 NodeBB uid linking

The `User.nodebbUid` field is the sole reference to a NodeBB user.
AuthModule is responsible for:
- Setting it during registration (if NodeBB bridge succeeds).
- Reading it during login/profile enrichment.

AuthModule is NOT responsible for:
- Syncing NodeBB profile changes back to LIAN (that's a background job).
- Handling NodeBB user deletion (soft-delete propagation is a future concern).
- Managing NodeBB admin operations (owned by NodebbModule admin provider).

## 9. Legacy Behavior Parity Checklist

Each item maps to a legacy endpoint behavior that must be verified
against the new implementation before marking the AUTH family as MIGRATED.

### 9.1 Login (`POST /api/auth/login`)

- [ ] Returns `accessToken`, `refreshToken`, `expiresIn` on success.
- [ ] Returns 401 with `UNAUTHORIZED` code for invalid credentials.
- [ ] Returns 401 for suspended/deleted users.
- [ ] Creates a session record with `userAgent` and `ipAddress`.
- [ ] Audit logs `user.login` with IP and user-agent.
- [ ] Password comparison uses constant-time comparison (bcrypt).

### 9.2 Registration (`POST /api/auth/register`)

- [ ] Returns same shape as login (tokens + user).
- [ ] Returns 409 with `CONFLICT` code for duplicate email.
- [ ] Returns 409 for duplicate username.
- [ ] Creates user with default role `USER`.
- [ ] First user gets role `ADMIN` (first-run detection).
- [ ] Password is hashed before storage (never stored plaintext).
- [ ] Creates `AuthCredential` with provider `local`.
- [ ] Audit logs `user.register`.
- [ ] Input validation: email format, username length (3-32), password length (>=8).

### 9.3 Logout (`POST /api/auth/logout`)

- [ ] Deletes the session record (refresh token invalidated).
- [ ] Returns `{ ok: true }` on success.
- [ ] Idempotent — deleting a non-existent session returns success (no 404).
- [ ] Audit logs `user.logout`.
- [ ] Requires authentication (401 if no valid token).

### 9.4 Current User (`GET /api/auth/me`)

- [ ] Returns full user profile matching `CurrentUserDto` shape.
- [ ] Returns 401 if not authenticated.
- [ ] Returns 404 if user no longer exists or is deleted.
- [ ] Includes `nodebbUid` if linked.
- [ ] Response does NOT include `passwordHash` or sensitive fields.

### 9.5 Password Change (`POST /api/auth/password`)

- [ ] Requires current password verification.
- [ ] Returns 401 if current password is wrong.
- [ ] Updates password hash in `IAuthRepository`.
- [ ] New password must meet minimum length (>=8).
- [ ] Audit logs `user.password_change`.
- [ ] Requires authentication.

### 9.6 Cross-cutting parity

- [ ] All auth errors use the `ErrorEnvelope` format from `GlobalExceptionFilter`.
- [ ] Error codes match: `UNAUTHORIZED` (401), `FORBIDDEN` (403), `CONFLICT` (409).
- [ ] No plaintext passwords in any response or log.
- [ ] No credentials in error messages (never "password incorrect", just "invalid credentials").
- [ ] Refresh tokens are opaque strings, not JWTs.

## 10. Implementation Slices

Each slice is sized for a separate PR. Dependencies are noted.

### Slice 1: Auth Config + Module Skeleton

**PR scope:**
- Add auth env vars to `env.validation.ts` and `config.service.ts`.
- Create `src/auth/` module skeleton: `auth.module.ts`, `index.ts`.
- Register `AuthModule` in `AppModule` imports.

**Dependencies:** ConfigModule (merged).

**Blocked by:** None.

---

### Slice 2: JWT Strategy + Guards

**PR scope:**
- Install `@nestjs/passport`, `@nestjs/jwt`, `passport`, `passport-jwt`.
- Implement `JwtStrategy` (passport strategy).
- Implement `JwtAuthGuard` (extends `AuthGuard('jwt')`).
- Implement `@Public()` decorator.
- Implement `RolesGuard` + `@Roles()` decorator.
- Unit tests for strategy and guards.

**Dependencies:** Slice 1 (auth config).

**Blocked by:** None.

---

### Slice 3: Login Usecase + Controller

**PR scope:**
- Install `bcrypt`.
- Implement `LoginUsecase`.
- Implement `LoginDto` (class-validator).
- Implement `AuthTokensDto`, `CurrentUserDto`.
- Add `POST /api/auth/login` handler to `AuthController`.
- Integration test: login returns tokens, rejects bad credentials.
- Audit logging for `user.login`.

**Dependencies:** Slice 1, Slice 2, `IAuthRepository` (interface exists, skeleton OK), `ISessionRepository` (interface exists, skeleton OK).

**Blocked by:** Repository real implementations (issue #9) for integration tests. Unit tests can mock repositories.

---

### Slice 4: Register Usecase + First-Run

**PR scope:**
- Implement `RegisterUsecase`.
- Implement `RegisterDto`.
- Add `POST /api/auth/register` handler to `AuthController`.
- First-run detection logic (User count === 0 → ADMIN).
- Integration test: registration creates user, first user is admin.
- Audit logging for `user.register`.

**Dependencies:** Slice 3 (shared DTOs, token generation).

**Blocked by:** Repository real implementations for integration tests.

---

### Slice 5: Logout + CurrentUser + ChangePassword

**PR scope:**
- Implement `LogoutUsecase`, `CurrentUserUsecase`, `ChangePasswordUsecase`.
- Implement `ChangePasswordDto`.
- Add `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/password` to `AuthController`.
- Integration tests for all three endpoints.
- Audit logging for `user.logout`, `user.password_change`.

**Dependencies:** Slice 3 (login flow, guards).

**Blocked by:** Repository real implementations for integration tests.

---

### Slice 6: NodeBB Identity Bridge

**PR scope:**
- Wire `NodebbUsersProvider` into `RegisterUsecase` for optional NodeBB user creation.
- Wire `IUserCacheRepository` into `CurrentUserUsecase` for profile enrichment.
- Store `nodebbUid` on User after successful NodeBB registration.
- Integration tests with mocked NodebbModule.

**Dependencies:** Slice 4, NodebbModule (merged, issue #3), `IUserCacheRepository` (interface exists).

**Blocked by:** NodebbModule must be importable. Repository real implementations for end-to-end tests.

---

### Dependency Graph

```
Slice 1 (Config + Skeleton)
  └─► Slice 2 (JWT + Guards)
        └─► Slice 3 (Login)
              ├─► Slice 4 (Register + First-Run)
              │     └─► Slice 6 (NodeBB Bridge)
              └─► Slice 5 (Logout / Me / Password)
```

Slices 4 and 5 can be developed in parallel after Slice 3.
Slice 6 depends on both Slice 4 and NodebbModule.

## 11. Open Questions

These items need resolution before or during implementation:

1. **Refresh token rotation** — Should login with a valid refresh token
   issue a new refresh token (rotation) or reuse the existing one?
   Rotation is more secure but adds complexity. Recommendation: rotate.

2. **Session limit per user** — Should there be a max concurrent sessions
   per user? If so, evict oldest or reject newest? Recommendation:
   no hard limit initially, add a cleanup cron for expired sessions.

3. **NodeBB uid linking failure** — If NodeBB user creation fails during
   registration, should the user be able to retry linking later?
   Recommendation: yes, via a separate "link NodeBB account" endpoint
   (out of scope for initial slices).

4. **Access token invalidation** — JWTs are stateless and valid until
   expiry. Should logout also add the token to a Redis deny-list?
   Recommendation: yes, for security-sensitive deployments. Deferred
   to a future hardening slice.

5. **Rate limiting** — Login endpoint should have brute-force protection.
   Recommendation: express-rate-limit middleware, applied globally.
   Out of scope for AuthModule itself.

6. **CORS / cookie auth** — The legacy system may use cookie-based auth
   for browser clients. Should AuthModule support both header and cookie
   token extraction? Recommendation: yes, configurable via env var.
