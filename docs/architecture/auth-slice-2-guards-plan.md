# Auth Slice 2: Guards, Decorators, and Request Typing Plan

> Architecture plan for implementing JWT authentication guards, role-based
> access control, and typed request interfaces. This is a docs-only plan;
> no runtime source is modified.

## 1. Context

AuthModule Slice 1 (config + skeleton) is merged (PR #43). The module
exports five usecase stubs and a controller, but has no authentication
enforcement. All feature modules (Feed, Posts, Messages, Profile) are
blocked on guards from this slice.

**Current state:**
- No `@nestjs/passport`, `@nestjs/jwt`, `passport`, or `passport-jwt` installed
- No guards, strategies, or decorators exist in `src/`
- `AuthController` uses `req: any` with optional chaining (`req.user?.id`)
- Feed controller has `TODO(#33)` comments referencing `JwtAuthGuard`

**Goal:** Define the guard/decorator/request-typing architecture for
implementation in a single PR (Slice A2 from the endpoint migration queue).

## 2. Scope

### In scope

- JWT authentication strategy (`JwtStrategy`)
- Authentication guard (`JwtAuthGuard`)
- Role-based access control (`RolesGuard` + `@Roles()`)
- Public route bypass (`@Public()`)
- Current-user extraction (`@CurrentUser()`)
- Typed request interface (`AuthenticatedRequest`)
- Unit test strategy

### Out of scope

- Token refresh flow (Slice A3+)
- Session persistence (Slice A3+)
- OAuth/SSO providers (future)
- Rate limiting / brute-force protection (cross-cutting middleware)
- Cookie-based auth (future, configurable via env var)

## 3. Dependency Installation

```jsonc
// package.json additions (production)
"@nestjs/passport": "^10.0.0",
"@nestjs/jwt": "^10.0.0",
"passport": "^0.7.0",
"passport-jwt": "^4.0.1"

// package.json additions (dev)
"@types/passport-jwt": "^4.0.1"
```

All four runtime packages are required. `passport-jwt` provides the
`Strategy` base class; `@nestjs/passport` and `@nestjs/jwt` provide
NestJS integration wrappers.

## 4. AuthenticatedRequest Interface

### 4.1 Design

```typescript
// src/auth/types/authenticated-request.ts

import { Request } from 'express';

export interface JwtPayload {
  sub: number;    // User.id
  role: string;   // 'USER' | 'MODERATOR' | 'ADMIN'
  iat: number;    // issued-at timestamp
  exp: number;    // expiration timestamp
}

export interface AuthenticatedUser {
  id: number;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
```

### 4.2 Rationale

- Extends `express.Request` (the project uses `@types/express` v5.0.0).
- `user` is non-optional on `AuthenticatedRequest` — guards guarantee
  presence. Controllers that apply `JwtAuthGuard` can safely access
  `req.user.id` without optional chaining.
- `JwtPayload` mirrors the JWT claims structure. `AuthenticatedUser`
  is the post-validation shape attached to `req.user`.
- Separating `JwtPayload` from `AuthenticatedUser` allows the strategy
  to map claims to a richer user object in the future (e.g., adding
  `email`, `status`) without changing the guard contract.

### 4.3 Usage pattern

```typescript
// Before (current, untyped):
@Req() req: any
const userId = req.user?.id;

// After (typed):
@Req() req: AuthenticatedRequest
const userId = req.user.id; // no optional chaining needed
```

## 5. JwtStrategy

### 5.1 Design

```typescript
// src/auth/strategies/jwt.strategy.ts

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload, AuthenticatedUser } from '../types/authenticated-request';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    return { id: payload.sub, role: payload.role };
  }
}
```

### 5.2 Key decisions

- **No database lookup in `validate()`** — The strategy trusts the JWT
  payload for `id` and `role`. A database check on every request adds
  latency and creates a coupling to `IAuthRepository`. User existence
  and status checks happen at the usecase layer (e.g., `CurrentUserUsecase`
  verifies the user is ACTIVE). This is consistent with the contract
  in `auth-module-contract.md` Section 7.2 which says "optionally verifies
  user still exists" — we defer that to usecases.
- **`ExtractJwt.fromAuthHeaderAsBearerToken()`** — Standard Bearer token
  extraction. Cookie extraction is deferred to a future configurable
  strategy (see Section 11, Open Question 6 in the contract).
- **HS256 signing** — Matches `@nestjs/jwt` defaults and the contract
  (Section 2.4). `JWT_SECRET` is required in production (validated by
  `env.validation.ts`).

### 5.3 JwtPayload shape

| Field  | Type   | Source        | Description            |
|--------|--------|---------------|------------------------|
| `sub`  | number | `User.id`     | Subject (user ID)      |
| `role` | string | `User.role`   | Authorization role     |
| `iat`  | number | JWT library   | Issued-at timestamp    |
| `exp`  | number | JWT library   | Expiration timestamp   |

The `sub` claim follows RFC 7519 convention. Role is included in the
token payload to avoid a database lookup on every request.

## 6. JwtAuthGuard

### 6.1 Design

```typescript
// src/auth/guards/jwt-auth.guard.ts

import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
```

### 6.2 Key decisions

- **Extends `AuthGuard('jwt')`** — Delegates to passport-jwt for token
  validation. Only overrides `canActivate` to check the `@Public()` metadata.
- **Reflector-based `@Public()` check** — Reads metadata from both method
  and class level. Method-level takes precedence (NestJS `getAllAndOverride`
  behavior).
- **Applied globally** — Registered as a global guard in `AuthModule`
  via `APP_GUARD` token. Individual routes opt out with `@Public()`.
  This follows the NestJS recommended pattern and avoids requiring
  `@UseGuards(JwtAuthGuard)` on every controller.

### 6.3 Error responses

| Scenario | HTTP Status | Error Code | Source |
|----------|-------------|------------|--------|
| Missing Authorization header | 401 | `UNAUTHORIZED` | passport-jwt default |
| Malformed token | 401 | `UNAUTHORIZED` | passport-jwt default |
| Expired token | 401 | `UNAUTHORIZED` | passport-jwt (`ignoreExpiration: false`) |
| Invalid signature | 401 | `UNAUTHORIZED` | passport-jwt default |

All 401 errors flow through `GlobalExceptionFilter` and produce the
`ErrorEnvelope` format (see `src/common/filters/http-exception.filter.ts`).

## 7. RolesGuard

### 7.1 Design

```typescript
// src/auth/guards/roles.guard.ts

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedRequest } from '../types/authenticated-request';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // no roles required → allow
    }
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return requiredRoles.includes(user.role);
  }
}
```

### 7.2 Key decisions

- **Custom `CanActivate`** — Does not extend `AuthGuard`. Reads role
  requirements from `@Roles()` decorator metadata.
- **No roles = allow** — If no `@Roles()` decorator is present, the
  guard passes. This means most routes only need `JwtAuthGuard`
  (authentication), not `RolesGuard` (authorization).
- **Runs after JwtAuthGuard** — Guard execution order follows the
  array order in `@UseGuards(JwtAuthGuard, RolesGuard)`. Since
  `JwtAuthGuard` is global via `APP_GUARD`, it runs first. `RolesGuard`
  is also registered globally but only activates when `@Roles()`
  metadata is present.
- **String-based role comparison** — Uses `string[]` to match
  `user.role`. This is intentionally simple. The `User.role` field
  is an enum (`'USER' | 'MODERATOR' | 'ADMIN'`), but the guard
  does not import the Prisma enum to avoid coupling to the database
  layer.

### 7.3 Error responses

| Scenario | HTTP Status | Error Code | Source |
|----------|-------------|------------|--------|
| Insufficient role | 403 | `FORBIDDEN` | `RolesGuard` throws `ForbiddenException` |

### 7.4 Role hierarchy

```
ADMIN > MODERATOR > USER
```

The guard currently does a flat `includes()` check. If hierarchical
inheritance is needed (ADMIN can access MODERATOR routes), the guard
should be extended with a role-rank map. This is deferred — the initial
migration only uses `@Roles('ADMIN')` for admin-only routes (none exist
in the current endpoint queue).

## 8. Decorators

### 8.1 @Public()

```typescript
// src/auth/decorators/public.decorator.ts

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

**Usage:** Applied to routes that skip authentication.
- `POST /api/auth/login` — user is not yet authenticated
- `POST /api/auth/register` — user does not exist yet
- Health check endpoints (if exposed)

### 8.2 @Roles()

```typescript
// src/auth/decorators/roles.decorator.ts

import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

**Usage:** Applied to routes that require specific roles.
- `DELETE /api/posts/:postId` — moderator only (Slice P2)
- Future admin-only endpoints

### 8.3 @CurrentUser()

```typescript
// src/auth/decorators/current-user.decorator.ts

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest, AuthenticatedUser } from '../types/authenticated-request';

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return data ? request.user?.[data] : request.user;
  },
);
```

**Usage:** Extracts the authenticated user in controller method parameters.
```typescript
@Get('me')
getMe(@CurrentUser() user: AuthenticatedUser) { ... }

@Get('me/id')
getMyId(@CurrentUser('id') id: number) { ... }
```

### 8.4 Decorator summary

| Decorator | Metadata Key | Guard Interaction | Applies To |
|-----------|-------------|-------------------|------------|
| `@Public()` | `isPublic` | `JwtAuthGuard` skips | Method / Class |
| `@Roles()` | `roles` | `RolesGuard` checks | Method / Class |
| `@CurrentUser()` | N/A | Param decorator | Method parameter |

## 9. Module Registration

### 9.1 AuthModule changes

```typescript
// src/auth/auth.module.ts (updated)

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
// ... existing usecase imports

@Module({
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // ... existing usecases
  ],
  exports: [
    // ... existing usecase exports
  ],
})
export class AuthModule {}
```

### 9.2 Global guard order

NestJS executes `APP_GUARD` providers in registration order:

1. `JwtAuthGuard` — authenticates (sets `req.user`)
2. `RolesGuard` — authorizes (checks `req.user.role`)

This order is critical. `RolesGuard` assumes `req.user` is set by
`JwtAuthGuard`. If `@Public()` is applied, `JwtAuthGuard` returns
`true` early, and `RolesGuard` also passes (no roles metadata → allow).

### 9.3 AppModule impact

AuthModule is already imported in `AppModule` (from Slice 1). The
guard registration via `APP_GUARD` makes them global without requiring
changes to `AppModule` or other feature modules. Feature modules
(Feed, Posts, Messages, Profile) automatically get auth enforcement.

## 10. File Manifest

All files are under `src/auth/`:

| File | Type | Description |
|------|------|-------------|
| `types/authenticated-request.ts` | Interface | `AuthenticatedRequest`, `JwtPayload`, `AuthenticatedUser` |
| `strategies/jwt.strategy.ts` | Strategy | Passport JWT strategy |
| `guards/jwt-auth.guard.ts` | Guard | Extends `AuthGuard('jwt')` with `@Public()` bypass |
| `guards/roles.guard.ts` | Guard | Role-based access control |
| `decorators/public.decorator.ts` | Decorator | `@Public()` metadata setter |
| `decorators/roles.decorator.ts` | Decorator | `@Roles()` metadata setter |
| `decorators/current-user.decorator.ts` | Decorator | `@CurrentUser()` param decorator |
| `auth.module.ts` | Module | Updated with strategy + global guards |
| `index.ts` | Barrel | Updated exports |

## 11. Test Strategy

### 11.1 Unit tests (no persistence required)

| Test File | Coverage |
|-----------|----------|
| `strategies/jwt.strategy.spec.ts` | `validate()` maps payload to `AuthenticatedUser` |
| `guards/jwt-auth.guard.spec.ts` | `canActivate` passes for `@Public()` routes, delegates to passport for non-public |
| `guards/roles.guard.spec.ts` | Passes when no roles required, passes when role matches, rejects when role insufficient |
| `decorators/current-user.decorator.spec.ts` | Extracts full user or specific property |

### 11.2 Test patterns

- **JwtStrategy:** Mock `ConfigService` to provide `JWT_SECRET`.
  Call `validate()` with a known payload. Assert returned shape.
- **JwtAuthGuard:** Mock `Reflector` to return `true`/`false` for
  `IS_PUBLIC_KEY`. Mock `ExecutionContext`. Verify early return
  vs. delegation to `super.canActivate()`.
- **RolesGuard:** Mock `Reflector` to return role arrays. Mock
  `ExecutionContext` with a request containing `user.role`. Assert
  boolean return and `ForbiddenException` throw.
- **@CurrentUser():** Mock `ExecutionContext` with a request
  containing `user`. Test with and without property key.

### 11.3 Integration test prerequisites

Integration tests (verifying actual JWT validation end-to-end) require:
- `LoginUsecase` implementation (Slice A3) to generate real tokens
- `IAuthRepository` / `ISessionRepository` real implementations
- These are **not** part of Slice A2

Slice A2 unit tests mock passport internals. Full integration coverage
comes with Slice A3.

## 12. Non-Goals

- **No persistence changes** — This slice does not create sessions,
  store refresh tokens, or write audit events.
- **No usecase changes** — Usecase stubs remain unchanged. Guards
  are orthogonal to business logic.
- **No controller changes** — The controller does not gain new routes
  or modify existing handlers. Request typing updates are deferred
  to the slice that implements each usecase.
- **No package.json changes in this plan** — The dependency list
  in Section 3 is informational. The implementation PR adds the
  packages.

## 13. Assumptions

1. **PR #43 (AuthModule skeleton) is the canonical base.** PR #42 was
   closed; PR #43 was kept. All references to "Slice 1" mean the
   code from PR #43.
2. **`JWT_SECRET` is available at runtime.** `env.validation.ts`
   already validates this (from Slice 1). If not, the implementation
   PR must add it.
3. **Express v5 request types.** The project uses `@types/express`
   v5.0.0. `AuthenticatedRequest` extends `express.Request` from
   that version.
4. **Global guard scope.** `APP_GUARD` applies to all controllers
   in the application, including HealthModule. Health endpoints
   must be marked `@Public()` if they should skip auth.
5. **No role hierarchy initially.** The guard uses flat `includes()`
   comparison. Role rank inheritance is a future enhancement.
