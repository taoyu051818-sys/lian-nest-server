/**
 * Session repository interface.
 *
 * Manages user sessions, refresh tokens,
 * and session metadata for auth flows.
 */

export interface Session {
  id: string;
  userId: string;
  refreshToken: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  createdAt: Date;
  lastAccessedAt: Date;
}

export interface ISessionRepository {
  findById(id: string): Promise<Session | null>;
  findByRefreshToken(refreshToken: string): Promise<Session | null>;
  findByUserId(userId: string): Promise<Session[]>;
  create(session: Omit<Session, 'id' | 'createdAt' | 'lastAccessedAt'>): Promise<Session>;
  updateLastAccessed(id: string): Promise<void>;
  deleteById(id: string): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
  deleteExpired(): Promise<number>;
}
