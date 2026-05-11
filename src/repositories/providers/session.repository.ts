import { Injectable } from '@nestjs/common';
import { ISessionRepository, Session } from '../interfaces';

/**
 * Skeleton session repository.
 *
 * TODO: Replace with Redis implementation (issue #9).
 * Storage boundary: Redis (primary), Postgres (long-term audit).
 */
@Injectable()
export class SessionRepository implements ISessionRepository {
  async findById(_id: string): Promise<Session | null> {
    throw new Error('SessionRepository.findById not implemented');
  }

  async findByRefreshToken(_refreshToken: string): Promise<Session | null> {
    throw new Error('SessionRepository.findByRefreshToken not implemented');
  }

  async findByUserId(_userId: string): Promise<Session[]> {
    throw new Error('SessionRepository.findByUserId not implemented');
  }

  async create(
    _session: Omit<Session, 'id' | 'createdAt' | 'lastAccessedAt'>,
  ): Promise<Session> {
    throw new Error('SessionRepository.create not implemented');
  }

  async updateLastAccessed(_id: string): Promise<void> {
    throw new Error('SessionRepository.updateLastAccessed not implemented');
  }

  async deleteById(_id: string): Promise<void> {
    throw new Error('SessionRepository.deleteById not implemented');
  }

  async deleteByUserId(_userId: string): Promise<void> {
    throw new Error('SessionRepository.deleteByUserId not implemented');
  }

  async deleteExpired(): Promise<number> {
    throw new Error('SessionRepository.deleteExpired not implemented');
  }
}
