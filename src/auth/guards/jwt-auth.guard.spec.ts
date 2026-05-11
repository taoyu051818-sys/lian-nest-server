import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { UnauthorizedException } from '@nestjs/common';

function createMockContext(headers: Record<string, string> = {}, metadata?: boolean) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as any;
}

function createMockReflector(isPublic = false) {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as any;
}

describe('JwtAuthGuard', () => {
  it('should allow public routes without a token', () => {
    const guard = new JwtAuthGuard(createMockReflector(true));
    expect(guard.canActivate(createMockContext({}))).toBe(true);
  });

  it('should allow requests with a valid Bearer token', () => {
    const guard = new JwtAuthGuard(createMockReflector(false));
    const ctx = createMockContext({ authorization: 'Bearer some-token' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should reject requests without an authorization header', () => {
    const guard = new JwtAuthGuard(createMockReflector(false));
    expect(() => guard.canActivate(createMockContext({}))).toThrow(UnauthorizedException);
  });

  it('should reject requests with a non-Bearer authorization header', () => {
    const guard = new JwtAuthGuard(createMockReflector(false));
    const ctx = createMockContext({ authorization: 'Basic abc123' });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
