import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard, JwtPayload } from './jwt-auth.guard';
import { extractCurrentUser } from '../decorators/current-user.decorator';

/**
 * Contract tests for the guard + decorator pipeline.
 *
 * Validates fail-closed behavior and current-user extraction
 * without touching any route or module wiring.
 *
 * Parity fixtures: test/parity/auth/*.json
 * Contract doc:    docs/contracts/auth-session.md
 */

function makeContext(authHeader?: string, existingUser?: unknown) {
  const req: Record<string, unknown> = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  if (existingUser !== undefined) {
    req.user = existingUser;
  }
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function encodeJwtPayload(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('Auth current-user contract (guard + decorator)', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  describe('JwtAuthGuard fail-closed behavior', () => {
    it('rejects missing Authorization header with 401', () => {
      expect(() => guard.canActivate(makeContext())).toThrow(UnauthorizedException);
    });

    it('rejects empty Authorization header with 401', () => {
      expect(() => guard.canActivate(makeContext(''))).toThrow(UnauthorizedException);
    });

    it('rejects non-Bearer scheme with 401', () => {
      expect(() => guard.canActivate(makeContext('Basic abc123'))).toThrow(UnauthorizedException);
    });

    it('rejects malformed JWT (not 3 parts) with 401', () => {
      expect(() => guard.canActivate(makeContext('Bearer abc.def'))).toThrow(UnauthorizedException);
    });

    it('rejects JWT with invalid base64 payload with 401', () => {
      expect(() => guard.canActivate(makeContext('Bearer a.!!!.c'))).toThrow(UnauthorizedException);
    });

    it('rejects JWT without sub claim with 401', () => {
      const token = encodeJwtPayload({ email: 'test@example.com' });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`))).toThrow(UnauthorizedException);
    });

    it('rejects JWT with sub = 0 with 401', () => {
      const token = encodeJwtPayload({ sub: 0 });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`))).toThrow(UnauthorizedException);
    });

    it('rejects JWT with negative sub with 401', () => {
      const token = encodeJwtPayload({ sub: -1 });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`))).toThrow(UnauthorizedException);
    });
  });

  describe('JwtAuthGuard request mutation', () => {
    it('sets request.user to decoded payload on valid token', () => {
      const token = encodeJwtPayload({ sub: 42, email: 'user@example.com' });
      const req = { headers: { authorization: `Bearer ${token}` } };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;

      const result = guard.canActivate(ctx);

      expect(result).toBe(true);
      expect((req as any).user).toEqual({ sub: 42, email: 'user@example.com' });
    });

    it('preserves extra payload fields on request.user', () => {
      const token = encodeJwtPayload({ sub: 7, role: 'ADMIN', custom: 'data' });
      const req = { headers: { authorization: `Bearer ${token}` } };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;

      guard.canActivate(ctx);

      expect((req as any).user).toEqual({ sub: 7, role: 'ADMIN', custom: 'data' });
    });

    it('accepts sub = 1 (boundary: smallest valid positive integer)', () => {
      const token = encodeJwtPayload({ sub: 1 });
      const req = { headers: { authorization: `Bearer ${token}` } };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(ctx)).toBe(true);
      expect((req as any).user.sub).toBe(1);
    });
  });

  describe('extractCurrentUser (decorator logic)', () => {
    it('returns full user object when no key specified', () => {
      const mockUser: JwtPayload = { sub: 42, email: 'user@example.com' };
      const ctx = makeContext(undefined, mockUser);

      const result = extractCurrentUser(undefined, ctx);

      expect(result).toEqual({ sub: 42, email: 'user@example.com' });
    });

    it('returns specific field when key specified', () => {
      const mockUser: JwtPayload = { sub: 42, email: 'user@example.com' };
      const ctx = makeContext(undefined, mockUser);

      const result = extractCurrentUser('sub', ctx);

      expect(result).toBe(42);
    });

    it('returns undefined when request.user is not set', () => {
      const ctx = makeContext(undefined, undefined);

      const result = extractCurrentUser(undefined, ctx);

      expect(result).toBeUndefined();
    });

    it('returns undefined for missing field on user object', () => {
      const mockUser: JwtPayload = { sub: 42 };
      const ctx = makeContext(undefined, mockUser);

      const result = extractCurrentUser('email', ctx);

      expect(result).toBeUndefined();
    });
  });

  describe('guard + decorator pipeline', () => {
    it('decorator reads user set by guard in the same request', () => {
      const token = encodeJwtPayload({ sub: 99 });
      const req = { headers: { authorization: `Bearer ${token}` } };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;

      guard.canActivate(ctx);

      const sub = extractCurrentUser('sub', ctx);
      expect(sub).toBe(99);

      const full = extractCurrentUser(undefined, ctx);
      expect(full).toEqual({ sub: 99 });
    });
  });
});
