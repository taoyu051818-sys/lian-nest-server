import { Injectable } from '@nestjs/common';
import { IUserCacheRepository, CachedUser } from '../interfaces';

/**
 * Skeleton user cache repository.
 *
 * TODO: Replace with Redis implementation (issue #9).
 * Storage boundary: Redis (primary), with TTL-based expiration.
 */
@Injectable()
export class UserCacheRepository implements IUserCacheRepository {
  async findById(_id: string): Promise<CachedUser | null> {
    throw new Error('UserCacheRepository.findById not implemented');
  }

  async findByNodebbUid(_nodebbUid: number): Promise<CachedUser | null> {
    throw new Error('UserCacheRepository.findByNodebbUid not implemented');
  }

  async findByUsername(_username: string): Promise<CachedUser | null> {
    throw new Error('UserCacheRepository.findByUsername not implemented');
  }

  async set(_user: Omit<CachedUser, 'cachedAt'>): Promise<void> {
    throw new Error('UserCacheRepository.set not implemented');
  }

  async invalidate(_id: string): Promise<void> {
    throw new Error('UserCacheRepository.invalidate not implemented');
  }

  async invalidateByNodebbUid(_nodebbUid: number): Promise<void> {
    throw new Error('UserCacheRepository.invalidateByNodebbUid not implemented');
  }

  async refreshTTL(_id: string, _ttlSeconds: number): Promise<void> {
    throw new Error('UserCacheRepository.refreshTTL not implemented');
  }
}
