import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/**
 * Token extraction edge-case regression coverage.
 *
 * Supplements guard-boundary-edges.spec.ts and jwt-auth.guard.spec.ts
 * with focused tests on numeric sub boundaries, payload decode edge
 * cases, request mutation isolation, and slice(7) extraction mechanics.
 *
 * Contract: docs/contracts/auth-session.md
 */

function makeContext(authHeader?: string) {
  const req: Record<string, unknown> = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function encodeJwtPayload(payload: unknown): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('AuthModule token extraction edge coverage', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  describe('numeric sub boundary values', () => {
    it('rejects sub: 0 (zero boundary)', () => {
      const token = encodeJwtPayload({ sub: 0 });
      expect(() =>
        guard.canActivate(makeContext(`Bearer ${token}`)),
      ).toThrow(UnauthorizedException);
    });

    it('rejects sub: -1 (negative integer)', () => {
      const token = encodeJwtPayload({ sub: -1 });
      expect(() =>
        guard.canActivate(makeContext(`Bearer ${token}`)),
      ).toThrow(UnauthorizedException);
    });

    it('accepts sub: 0.5 (fractional positive)', () => {
      const token = encodeJwtPayload({ sub: 0.5 });
      const ctx = makeContext(`Bearer ${token}`);
      expect(guard.canActivate(ctx)).toBe(true);
      const req = (ctx as any).switchToHttp().getRequest();
      expect(req.user.sub).toBe(0.5);
    });

    it('accepts sub: Number.MAX_SAFE_INTEGER', () => {
      const token = encodeJwtPayload({ sub: Number.MAX_SAFE_INTEGER });
      const ctx = makeContext(`Bearer ${token}`);
      expect(guard.canActivate(ctx)).toBe(true);
      const req = (ctx as any).switchToHttp().getRequest();
      expect(req.user.sub).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('rejects sub: NaN', () => {
      const token = encodeJwtPayload({ sub: NaN });
      expect(() =>
        guard.canActivate(makeContext(`Bearer ${token}`)),
      ).toThrow(UnauthorizedException);
    });

    it('rejects sub: Infinity', () => {
      const token = encodeJwtPayload({ sub: Infinity });
      expect(() =>
        guard.canActivate(makeContext(`Bearer ${token}`)),
      ).toThrow(UnauthorizedException);
    });

    it('rejects sub: -Infinity', () => {
      const token = encodeJwtPayload({ sub: -Infinity });
      expect(() =>
        guard.canActivate(makeContext(`Bearer ${token}`)),
      ).toThrow(UnauthorizedException);
    });

    it('rejects sub: null', () => {
      const token = encodeJwtPayload({ sub: null });
      expect(() =>
        guard.canActivate(makeContext(`Bearer ${token}`)),
      ).toThrow(UnauthorizedException);
    });

    it('rejects payload with no sub key at all', () => {
      const token = encodeJwtPayload({ role: 'admin' });
      expect(() =>
        guard.canActivate(makeContext(`Bearer ${token}`)),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('payload decode edge cases', () => {
    it('rejects payload that decodes to JSON null literal', () => {
      const nullPayload = Buffer.from('null').toString('base64url');
      expect(() =>
        guard.canActivate(makeContext(`Bearer hdr.${nullPayload}.sig`)),
      ).toThrow(UnauthorizedException);
    });

    it('rejects payload that decodes to a bare number', () => {
      const numPayload = Buffer.from('42').toString('base64url');
      expect(() =>
        guard.canActivate(makeContext(`Bearer hdr.${numPayload}.sig`)),
      ).toThrow(UnauthorizedException);
    });

    it('rejects payload that decodes to a bare string', () => {
      const strPayload = Buffer.from('"hello"').toString('base64url');
      expect(() =>
        guard.canActivate(makeContext(`Bearer hdr.${strPayload}.sig`)),
      ).toThrow(UnauthorizedException);
    });

    it('rejects payload with only whitespace', () => {
      const wsPayload = Buffer.from('   ').toString('base64url');
      expect(() =>
        guard.canActivate(makeContext(`Bearer hdr.${wsPayload}.sig`)),
      ).toThrow(UnauthorizedException);
    });

    it('rejects payload with empty body after Bearer (slice(7) yields empty)', () => {
      expect(() => guard.canActivate(makeContext('Bearer '))).toThrow(
        UnauthorizedException,
      );
    });

    it('accepts double space after Bearer (slice(7) still extracts valid token)', () => {
      const token = encodeJwtPayload({ sub: 1 });
      const ctx = makeContext(`Bearer  ${token}`);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('rejects tab character instead of space after Bearer', () => {
      const token = encodeJwtPayload({ sub: 1 });
      expect(() =>
        guard.canActivate(makeContext(`Bearer\t${token}`)),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('request mutation isolation', () => {
    it('sets request.user to the full decoded payload on success', () => {
      const payload = { sub: 7, role: 'admin', org: 'test' };
      const token = encodeJwtPayload(payload);
      const ctx = makeContext(`Bearer ${token}`);
      guard.canActivate(ctx);
      const req = (ctx as any).switchToHttp().getRequest();
      expect(req.user).toEqual(payload);
    });

    it('does not mutate request.user on rejection', () => {
      const token = encodeJwtPayload({ sub: 0 });
      const ctx = makeContext(`Bearer ${token}`);
      try {
        guard.canActivate(ctx);
      } catch {
        // expected
      }
      const req = (ctx as any).switchToHttp().getRequest();
      expect(req.user).toBeUndefined();
    });

    it('preserves extra payload fields alongside sub', () => {
      const payload = { sub: 1, email: 'a@b.c', roles: ['user'], meta: { k: 'v' } };
      const token = encodeJwtPayload(payload);
      const ctx = makeContext(`Bearer ${token}`);
      guard.canActivate(ctx);
      const req = (ctx as any).switchToHttp().getRequest();
      expect(req.user.email).toBe('a@b.c');
      expect(req.user.roles).toEqual(['user']);
      expect(req.user.meta).toEqual({ k: 'v' });
    });
  });

  describe('guard instance reuse across requests', () => {
    it('handles independent requests with the same guard instance', () => {
      const token1 = encodeJwtPayload({ sub: 1 });
      const token2 = encodeJwtPayload({ sub: 99 });

      const ctx1 = makeContext(`Bearer ${token1}`);
      const ctx2 = makeContext(`Bearer ${token2}`);

      expect(guard.canActivate(ctx1)).toBe(true);
      expect(guard.canActivate(ctx2)).toBe(true);

      const req1 = (ctx1 as any).switchToHttp().getRequest();
      const req2 = (ctx2 as any).switchToHttp().getRequest();
      expect(req1.user.sub).toBe(1);
      expect(req2.user.sub).toBe(99);
    });

    it('rejects second request independently when first fails', () => {
      const badToken = encodeJwtPayload({ sub: 0 });
      const goodToken = encodeJwtPayload({ sub: 5 });

      const ctx1 = makeContext(`Bearer ${badToken}`);
      const ctx2 = makeContext(`Bearer ${goodToken}`);

      expect(() => guard.canActivate(ctx1)).toThrow(UnauthorizedException);
      expect(guard.canActivate(ctx2)).toBe(true);
      const req2 = (ctx2 as any).switchToHttp().getRequest();
      expect(req2.user.sub).toBe(5);
    });
  });
});
