import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

export interface JwtPayload {
  sub: number;
  [key: string]: unknown;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    const payload = this.decodePayload(token);

    if (!payload || typeof payload.sub !== 'number' || payload.sub <= 0) {
      throw new UnauthorizedException('Invalid token payload');
    }

    (request as Request & { user: JwtPayload }).user = payload;
    return true;
  }

  private decodePayload(token: string): JwtPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    try {
      const decoded = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );
      return decoded as JwtPayload;
    } catch {
      return null;
    }
  }
}
