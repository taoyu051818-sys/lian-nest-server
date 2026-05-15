import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtPayload } from '../strategies/jwt.strategy';
import { extractCurrentUser } from '../decorators/current-user.decorator';

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
      getResponse: () => ({}),
    }),
    getHandler: () => () => {},
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('Auth current-user contract (guard + decorator)', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  describe('JwtAuthGuard public route bypass', () => {
    it('allows request without Authorization header when route is @Public()', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      expect(await guard.canActivate(makeContext())).toBe(true);
    });

    it('allows request with invalid token when route is @Public()', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      expect(await guard.canActivate(makeContext('Bearer garbage'))).toBe(true);
    });
  });

  describe('JwtAuthGuard protected route delegation', () => {
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

  describe('extractCurrentUser (decorator logic)', () => {
    it('returns full user object when no key specified', () => {
      const mockUser: JwtPayload = {
        sub: 42,
        email: 'user@example.com',
        role: 'USER',
      };
      const ctx = makeContext(undefined, mockUser);

      const result = extractCurrentUser(undefined, ctx);

      expect(result).toEqual({
        sub: 42,
        email: 'user@example.com',
        role: 'USER',
      });
    });

    it('returns specific field when key specified', () => {
      const mockUser: JwtPayload = {
        sub: 42,
        email: 'user@example.com',
        role: 'USER',
      };
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
      const mockUser: JwtPayload = {
        sub: 42,
        email: 'user@example.com',
        role: 'USER',
      };
      const ctx = makeContext(undefined, mockUser);

      const result = extractCurrentUser('iat', ctx);

      expect(result).toBeUndefined();
    });
  });
});
