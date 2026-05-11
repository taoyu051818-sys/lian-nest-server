import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../guards/jwt-auth.guard';

export function extractCurrentUser(
  data: keyof JwtPayload | undefined,
  ctx: ExecutionContext,
): JwtPayload | JwtPayload[keyof JwtPayload] | undefined {
  const request = ctx.switchToHttp().getRequest();
  const user = request.user as JwtPayload | undefined;

  if (!user) {
    return undefined;
  }

  return data ? user[data] : user;
}

export const CurrentUser = createParamDecorator(extractCurrentUser);
