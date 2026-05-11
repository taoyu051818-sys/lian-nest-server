import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader ? { authorization: authHeader } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

function encodeJwtPayload(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  it('should reject requests without Authorization header', () => {
    expect(() => guard.canActivate(makeContext())).toThrow(UnauthorizedException);
  });

  it('should reject requests with empty Authorization header', () => {
    expect(() => guard.canActivate(makeContext(''))).toThrow(UnauthorizedException);
  });

  it('should reject non-Bearer tokens', () => {
    expect(() => guard.canActivate(makeContext('Basic abc123'))).toThrow(UnauthorizedException);
  });

  it('should reject Bearer token without sub claim', () => {
    const token = encodeJwtPayload({ email: 'test@example.com' });
    expect(() => guard.canActivate(makeContext(`Bearer ${token}`))).toThrow(UnauthorizedException);
  });

  it('should reject Bearer token with sub <= 0', () => {
    const token = encodeJwtPayload({ sub: 0 });
    expect(() => guard.canActivate(makeContext(`Bearer ${token}`))).toThrow(UnauthorizedException);
  });

  it('should reject malformed JWT (not 3 parts)', () => {
    expect(() => guard.canActivate(makeContext('Bearer abc.def'))).toThrow(UnauthorizedException);
  });

  it('should reject JWT with invalid base64 payload', () => {
    expect(() => guard.canActivate(makeContext('Bearer a.!!!.c'))).toThrow(UnauthorizedException);
  });

  it('should accept valid JWT with numeric sub and set req.user', () => {
    const token = encodeJwtPayload({ sub: 42, email: 'user@example.com' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(ctx)).toBe(true);
    expect((req as any).user).toEqual({ sub: 42, email: 'user@example.com' });
  });

  it('should accept JWT with sub as positive integer', () => {
    const token = encodeJwtPayload({ sub: 1 });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(ctx)).toBe(true);
    expect((req as any).user.sub).toBe(1);
  });
});
