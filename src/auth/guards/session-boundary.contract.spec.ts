import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtPayload } from '../strategies/jwt.strategy';
import { extractCurrentUser } from '../decorators/current-user.decorator';

function makeContext(authHeader?: string, user?: unknown) {
  const req: Record<string, unknown> = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  if (user !== undefined) {
    req.user = user;
  }
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
    getHandler: () => () => {},
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('Session boundary regression (guard + decorator pipeline)', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  describe('public route bypass', () => {
    it('allows request without token when route is @Public()', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      expect(await guard.canActivate(makeContext())).toBe(true);
    });

    it('allows request with invalid token when route is @Public()', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      expect(await guard.canActivate(makeContext('Bearer garbage'))).toBe(true);
    });
  });

  describe('protected route rejection', () => {
    beforeEach(() => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    });

    it('delegates to passport for missing Authorization header', async () => {
      await expect(guard.canActivate(makeContext())).rejects.toThrow();
    });

    it('delegates to passport for empty Authorization header', async () => {
      await expect(guard.canActivate(makeContext(''))).rejects.toThrow();
    });

    it('delegates to passport for non-Bearer scheme', async () => {
      await expect(guard.canActivate(makeContext('Basic abc123'))).rejects.toThrow();
    });

    it('delegates to passport for malformed JWT', async () => {
      await expect(guard.canActivate(makeContext('Bearer abc.def'))).rejects.toThrow();
    });
  });

  describe('per-request identity extraction (decorator)', () => {
    it('decorator extracts sub from guard-set user', () => {
      const mockUser: JwtPayload = {
        sub: 99,
        email: 'user@test.com',
        role: 'USER',
      };
      const ctx = makeContext(undefined, mockUser);

      expect(extractCurrentUser('sub', ctx)).toBe(99);
    });

    it('decorator extracts full payload', () => {
      const mockUser: JwtPayload = {
        sub: 7,
        email: 'admin@test.com',
        role: 'ADMIN',
      };
      const ctx = makeContext(undefined, mockUser);

      const user = extractCurrentUser(undefined, ctx) as JwtPayload;
      expect(user.sub).toBe(7);
      expect(user.role).toBe('ADMIN');
    });

    it('decorator returns undefined when no user on request', () => {
      const ctx = makeContext();

      const result = extractCurrentUser(undefined, ctx);

      expect(result).toBeUndefined();
    });

    it('decorator returns undefined for absent field on valid user', () => {
      const mockUser: JwtPayload = {
        sub: 1,
        email: 'user@test.com',
        role: 'USER',
      };
      const ctx = makeContext(undefined, mockUser);

      expect(extractCurrentUser('iat', ctx)).toBeUndefined();
    });
  });
});
