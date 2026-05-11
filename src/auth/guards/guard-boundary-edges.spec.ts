import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Guard edge-case regression tests.
 *
 * Covers boundary conditions for JwtAuthGuard token parsing
 * that are not addressed by the existing guard spec or contract spec.
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

function encodeJwtPayload(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('JwtAuthGuard boundary edge cases', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  describe('Authorization header format boundaries', () => {
    it('rejects "bearer" (lowercase) scheme', () => {
      const token = encodeJwtPayload({ sub: 1 });
      expect(() => guard.canActivate(makeContext(`bearer ${token}`)))
        .toThrow(UnauthorizedException);
    });

    it('rejects "BEARER" (uppercase) scheme', () => {
      const token = encodeJwtPayload({ sub: 1 });
      expect(() => guard.canActivate(makeContext(`BEARER ${token}`)))
        .toThrow(UnauthorizedException);
    });

    it('rejects "Bearer" with no space before token', () => {
      const token = encodeJwtPayload({ sub: 1 });
      expect(() => guard.canActivate(makeContext(`Bearer${token}`)))
        .toThrow(UnauthorizedException);
    });

    it('rejects "Bearer " followed by empty string', () => {
      expect(() => guard.canActivate(makeContext('Bearer ')))
        .toThrow(UnauthorizedException);
    });

    it('rejects header with only whitespace', () => {
      expect(() => guard.canActivate(makeContext('   ')))
        .toThrow(UnauthorizedException);
    });

    it('rejects "Bearer" with extra leading spaces', () => {
      const token = encodeJwtPayload({ sub: 1 });
      expect(() => guard.canActivate(makeContext(`  Bearer ${token}`)))
        .toThrow(UnauthorizedException);
    });
  });

  describe('token structure boundaries', () => {
    it('rejects token with only one part (no dots)', () => {
      expect(() => guard.canActivate(makeContext('Bearer abc123')))
        .toThrow(UnauthorizedException);
    });

    it('rejects token with four parts', () => {
      expect(() => guard.canActivate(makeContext('Bearer a.b.c.d')))
        .toThrow(UnauthorizedException);
    });

    it('rejects token with empty segments (..sig)', () => {
      expect(() => guard.canActivate(makeContext('Bearer ..sig')))
        .toThrow(UnauthorizedException);
    });

    it('accepts token with empty header segment (guard only validates payload)', () => {
      const body = Buffer.from(JSON.stringify({ sub: 1 })).toString('base64url');
      expect(guard.canActivate(makeContext(`Bearer .${body}.sig`))).toBe(true);
    });

    it('rejects token where payload is valid base64 but not valid JSON', () => {
      const notJson = Buffer.from('not-json').toString('base64url');
      expect(() => guard.canActivate(makeContext(`Bearer hdr.${notJson}.sig`)))
        .toThrow(UnauthorizedException);
    });

    it('rejects token where payload decodes to an array, not object', () => {
      const arrayPayload = Buffer.from(JSON.stringify([1, 2, 3])).toString('base64url');
      expect(() => guard.canActivate(makeContext(`Bearer hdr.${arrayPayload}.sig`)))
        .toThrow(UnauthorizedException);
    });
  });

  describe('payload field type boundaries', () => {
    it('rejects sub as boolean true', () => {
      const token = encodeJwtPayload({ sub: true });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`)))
        .toThrow(UnauthorizedException);
    });

    it('rejects sub as boolean false', () => {
      const token = encodeJwtPayload({ sub: false });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`)))
        .toThrow(UnauthorizedException);
    });

    it('rejects sub as empty string', () => {
      const token = encodeJwtPayload({ sub: '' });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`)))
        .toThrow(UnauthorizedException);
    });

    it('rejects sub as numeric string "42"', () => {
      const token = encodeJwtPayload({ sub: '42' });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`)))
        .toThrow(UnauthorizedException);
    });

    it('rejects sub as object', () => {
      const token = encodeJwtPayload({ sub: { id: 1 } });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`)))
        .toThrow(UnauthorizedException);
    });

    it('rejects sub as array', () => {
      const token = encodeJwtPayload({ sub: [1] });
      expect(() => guard.canActivate(makeContext(`Bearer ${token}`)))
        .toThrow(UnauthorizedException);
    });
  });

  describe('payload content boundaries', () => {
    it('accepts token with deeply nested extra fields', () => {
      const token = encodeJwtPayload({
        sub: 1,
        nested: { deep: { value: true } },
        arr: [1, 2, 3],
      });
      expect(guard.canActivate(makeContext(`Bearer ${token}`))).toBe(true);
    });

    it('accepts token with unicode in extra fields', () => {
      const token = encodeJwtPayload({ sub: 1, name: '用户' });
      const ctx = makeContext(`Bearer ${token}`);
      guard.canActivate(ctx);
      const req = (ctx as any).switchToHttp().getRequest();
      expect(req.user.name).toBe('用户');
    });

    it('preserves null-valued extra fields', () => {
      const token = encodeJwtPayload({ sub: 1, email: null });
      const ctx = makeContext(`Bearer ${token}`);
      guard.canActivate(ctx);
      const req = (ctx as any).switchToHttp().getRequest();
      expect(req.user.email).toBeNull();
    });
  });
});
