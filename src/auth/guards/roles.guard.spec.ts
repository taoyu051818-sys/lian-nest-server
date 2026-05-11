import { RolesGuard } from './roles.guard';
import { ForbiddenException } from '@nestjs/common';
import type { AppRole } from './roles.guard';

function createMockContext(user?: { role?: AppRole }) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as any;
}

function createMockReflector(roles?: AppRole[]) {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(roles),
  } as any;
}

describe('RolesGuard', () => {
  it('should allow access when no roles are required', () => {
    const guard = new RolesGuard(createMockReflector(undefined));
    expect(guard.canActivate(createMockContext({ role: 'USER' }))).toBe(true);
  });

  it('should allow access when user has a required role', () => {
    const guard = new RolesGuard(createMockReflector(['ADMIN']));
    expect(guard.canActivate(createMockContext({ role: 'ADMIN' }))).toBe(true);
  });

  it('should allow access when user role is in the required list', () => {
    const guard = new RolesGuard(createMockReflector(['USER', 'ADMIN']));
    expect(guard.canActivate(createMockContext({ role: 'USER' }))).toBe(true);
  });

  it('should deny access when user role is not in the required list', () => {
    const guard = new RolesGuard(createMockReflector(['ADMIN']));
    expect(() => guard.canActivate(createMockContext({ role: 'USER' }))).toThrow(ForbiddenException);
  });

  it('should deny access when user has no role', () => {
    const guard = new RolesGuard(createMockReflector(['ADMIN']));
    expect(() => guard.canActivate(createMockContext({}))).toThrow(ForbiddenException);
  });
});
