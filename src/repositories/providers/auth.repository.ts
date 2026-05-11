import { Injectable } from '@nestjs/common';
import { IAuthRepository, AuthCredential } from '../interfaces';

/**
 * Skeleton auth repository.
 *
 * TODO: Replace with Prisma implementation (issue #9).
 * Storage boundary: Postgres (primary), Redis (session cache).
 */
@Injectable()
export class AuthRepository implements IAuthRepository {
  async findByUserId(_userId: string): Promise<AuthCredential[]> {
    throw new Error('AuthRepository.findByUserId not implemented');
  }

  async findByProvider(
    _provider: string,
    _providerId: string,
  ): Promise<AuthCredential | null> {
    throw new Error('AuthRepository.findByProvider not implemented');
  }

  async create(
    _credential: Omit<AuthCredential, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<AuthCredential> {
    throw new Error('AuthRepository.create not implemented');
  }

  async updatePasswordHash(
    _userId: string,
    _passwordHash: string,
  ): Promise<void> {
    throw new Error('AuthRepository.updatePasswordHash not implemented');
  }

  async deleteByUserId(_userId: string): Promise<void> {
    throw new Error('AuthRepository.deleteByUserId not implemented');
  }
}
