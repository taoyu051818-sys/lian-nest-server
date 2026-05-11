/**
 * User cache repository interface.
 *
 * Caches frequently accessed user profile data
 * to reduce NodeBB API calls.
 */

export interface CachedUser {
  id: string;
  nodebbUid: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  reputation: number;
  postcount: number;
  lastSeen: Date | null;
  cachedAt: Date;
  expiresAt: Date;
}

export interface IUserCacheRepository {
  findById(id: string): Promise<CachedUser | null>;
  findByNodebbUid(nodebbUid: number): Promise<CachedUser | null>;
  findByUsername(username: string): Promise<CachedUser | null>;
  set(user: Omit<CachedUser, 'cachedAt'>): Promise<void>;
  invalidate(id: string): Promise<void>;
  invalidateByNodebbUid(nodebbUid: number): Promise<void>;
  refreshTTL(id: string, ttlSeconds: number): Promise<void>;
}
