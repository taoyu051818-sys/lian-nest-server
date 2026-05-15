import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

function makeContext(authHeader?: string) {
  const req: Record<string, unknown> = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
    getHandler: () => () => {},
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('AuthModule token extraction edge coverage', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  describe('public route bypass', () => {
    it('allows request without Authorization header when route is @Public()', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      expect(await guard.canActivate(makeContext())).toBe(true);
    });

    it('allows request with empty Authorization header when route is @Public()', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      expect(await guard.canActivate(makeContext(''))).toBe(true);
    });

    it('allows request with invalid token format when route is @Public()', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      expect(await guard.canActivate(makeContext('Bearer bad'))).toBe(true);
    });

    it('allows request with non-Bearer scheme when route is @Public()', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      expect(await guard.canActivate(makeContext('Basic abc'))).toBe(true);
    });
  });

  describe('protected route delegation', () => {
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

    it('delegates to passport for invalid base64 payload', async () => {
      await expect(guard.canActivate(makeContext('Bearer a.!!!.c'))).rejects.toThrow();
    });
  });
});
