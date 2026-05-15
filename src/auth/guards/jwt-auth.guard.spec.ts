import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader ? { authorization: authHeader } : {},
      }),
      getResponse: () => ({}),
    }),
    getHandler: () => () => {},
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  describe('public route bypass', () => {
    it('allows request without token when route is @Public()', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const result = await guard.canActivate(makeContext());
      expect(result).toBe(true);
    });

    it('allows request with invalid token when route is @Public()', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const result = await guard.canActivate(makeContext('Bearer garbage'));
      expect(result).toBe(true);
    });

    it('allows request with empty header when route is @Public()', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const result = await guard.canActivate(makeContext(''));
      expect(result).toBe(true);
    });
  });

  describe('reflector integration', () => {
    it('checks IS_PUBLIC_KEY on handler and class', async () => {
      const spy = jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      await guard.canActivate(makeContext());
      expect(spy).toHaveBeenCalledWith('isPublic', [expect.any(Function), expect.any(Function)]);
    });

    it('delegates to passport when route is not public', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      // Passport strategy not registered in unit test — rejects
      await expect(guard.canActivate(makeContext('Bearer token'))).rejects.toThrow();
    });
  });
});
