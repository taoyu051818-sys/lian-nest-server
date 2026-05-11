import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard, JwtPayload } from './jwt-auth.guard';
import { extractCurrentUser } from '../decorators/current-user.decorator';

/**
 * Session boundary regression tests.
 *
 * Validates the guard → decorator pipeline at session entry/exit
 * boundaries: token issuance, per-request identity extraction,
 * session termination semantics, and fail-closed invariants.
 *
 * Contract: docs/contracts/auth-session.md
 * Parity fixtures: test/parity/auth/*.json
 */

function makeContext(authHeader?: string) {
  const req: Record<string, unknown> = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
    getReq: () => req,
  };
}

function encodeJwtPayload(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('Session boundary regression (guard + decorator pipeline)', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  describe('session entry: login token → guard acceptance', () => {
    it('accepts a freshly-issued token with minimal payload (sub only)', () => {
      const token = encodeJwtPayload({ sub: 1 });
      const ctx = makeContext(`Bearer ${token}`);
      const req = (ctx as any).getReq();

      const result = guard.canActivate(ctx as unknown as ExecutionContext);

      expect(result).toBe(true);
      expect((req as any).user).toEqual({ sub: 1 });
    });

    it('accepts a token with session-relevant extra fields', () => {
      const token = encodeJwtPayload({ sub: 42, sessionId: 'sess-abc', role: 'USER' });
      const ctx = makeContext(`Bearer ${token}`);
      const req = (ctx as any).getReq();

      guard.canActivate(ctx as unknown as ExecutionContext);

      expect((req as any).user).toEqual({ sub: 42, sessionId: 'sess-abc', role: 'USER' });
    });

    it('accepts a token with maximum-integer sub (boundary)', () => {
      const token = encodeJwtPayload({ sub: Number.MAX_SAFE_INTEGER });
      const ctx = makeContext(`Bearer ${token}`);

      expect(guard.canActivate(ctx as unknown as ExecutionContext)).toBe(true);
    });
  });

  describe('per-request identity extraction', () => {
    it('decorator extracts sub from guard-set user', () => {
      const token = encodeJwtPayload({ sub: 99, email: 'user@test.com' });
      const ctx = makeContext(`Bearer ${token}`);

      guard.canActivate(ctx as unknown as ExecutionContext);

      expect(extractCurrentUser('sub', ctx as unknown as ExecutionContext)).toBe(99);
    });

    it('decorator extracts full payload after guard sets user', () => {
      const token = encodeJwtPayload({ sub: 7, role: 'ADMIN', sessionId: 's1' });
      const ctx = makeContext(`Bearer ${token}`);

      guard.canActivate(ctx as unknown as ExecutionContext);

      const user = extractCurrentUser(undefined, ctx as unknown as ExecutionContext) as JwtPayload;
      expect(user.sub).toBe(7);
      expect((user as any).role).toBe('ADMIN');
      expect((user as any).sessionId).toBe('s1');
    });

    it('decorator returns undefined when guard was not applied (no user on request)', () => {
      const ctx = makeContext();

      const result = extractCurrentUser(undefined, ctx as unknown as ExecutionContext);

      expect(result).toBeUndefined();
    });

    it('decorator returns undefined for absent field on valid user', () => {
      const token = encodeJwtPayload({ sub: 1 });
      const ctx = makeContext(`Bearer ${token}`);

      guard.canActivate(ctx as unknown as ExecutionContext);

      expect(extractCurrentUser('email', ctx as unknown as ExecutionContext)).toBeUndefined();
    });
  });

  describe('session exit: guard remains valid until token expires', () => {
    it('guard does not invalidate a token after logout (structural validator only)', () => {
      const token = encodeJwtPayload({ sub: 42 });
      const ctx = makeContext(`Bearer ${token}`);

      expect(guard.canActivate(ctx as unknown as ExecutionContext)).toBe(true);
    });

    it('guard re-validates on each request (stateless)', () => {
      const token1 = encodeJwtPayload({ sub: 1 });
      const token2 = encodeJwtPayload({ sub: 2 });

      const ctx1 = makeContext(`Bearer ${token1}`);
      const ctx2 = makeContext(`Bearer ${token2}`);

      guard.canActivate(ctx1 as unknown as ExecutionContext);
      guard.canActivate(ctx2 as unknown as ExecutionContext);

      const req1 = (ctx1 as any).getReq();
      const req2 = (ctx2 as any).getReq();

      expect((req1 as any).user.sub).toBe(1);
      expect((req2 as any).user.sub).toBe(2);
    });
  });

  describe('fail-closed invariants at session boundaries', () => {
    it('rejects token with string sub (not a number)', () => {
      const token = encodeJwtPayload({ sub: '42' });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`) as unknown as ExecutionContext))
        .toThrow(UnauthorizedException);
    });

    it('rejects token with null sub', () => {
      const token = encodeJwtPayload({ sub: null });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`) as unknown as ExecutionContext))
        .toThrow(UnauthorizedException);
    });

    it('rejects token with undefined sub', () => {
      const token = encodeJwtPayload({ sub: undefined });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`) as unknown as ExecutionContext))
        .toThrow(UnauthorizedException);
    });

    it('rejects token with NaN sub', () => {
      const token = encodeJwtPayload({ sub: NaN });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`) as unknown as ExecutionContext))
        .toThrow(UnauthorizedException);
    });

    it('rejects Infinity sub (JSON round-trips to null)', () => {
      const token = encodeJwtPayload({ sub: Infinity });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`) as unknown as ExecutionContext))
        .toThrow(UnauthorizedException);
    });

    it('rejects empty payload object (no sub field)', () => {
      const token = encodeJwtPayload({});
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`) as unknown as ExecutionContext))
        .toThrow(UnauthorizedException);
    });

    it('rejects token with sub = 0 (boundary: zero is not positive)', () => {
      const token = encodeJwtPayload({ sub: 0 });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`) as unknown as ExecutionContext))
        .toThrow(UnauthorizedException);
    });

    it('accepts sub = 1 (boundary: smallest valid positive integer)', () => {
      const token = encodeJwtPayload({ sub: 1 });
      expect(guard.canActivate(makeContext(`Bearer ${token}`) as unknown as ExecutionContext)).toBe(true);
    });

    it('rejects negative fractional sub', () => {
      const token = encodeJwtPayload({ sub: -0.5 });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`) as unknown as ExecutionContext))
        .toThrow(UnauthorizedException);
    });

    it('accepts positive fractional sub (guard checks > 0, not integer)', () => {
      const token = encodeJwtPayload({ sub: 0.5 });
      expect(guard.canActivate(makeContext(`Bearer ${token}`) as unknown as ExecutionContext)).toBe(true);
    });
  });

  describe('request isolation', () => {
    it('guard does not leak user across requests', () => {
      const token = encodeJwtPayload({ sub: 1 });
      const ctx1 = makeContext(`Bearer ${token}`);
      const ctx2 = makeContext();

      guard.canActivate(ctx1 as unknown as ExecutionContext);

      expect(() => guard.canActivate(ctx2 as unknown as ExecutionContext))
        .toThrow(UnauthorizedException);

      expect(((ctx1 as any).getReq() as any).user.sub).toBe(1);
    });

    it('guard overwrites pre-existing user on request', () => {
      const req: Record<string, unknown> = {
        headers: { authorization: `Bearer ${encodeJwtPayload({ sub: 2 })}` },
        user: { sub: 999, stale: true },
      };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as ExecutionContext;

      guard.canActivate(ctx);

      expect((req as any).user).toEqual({ sub: 2 });
      expect((req as any).user.stale).toBeUndefined();
    });
  });
});
