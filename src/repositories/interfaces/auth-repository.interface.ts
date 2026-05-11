/**
 * Auth repository interface.
 *
 * Manages authentication credentials, password hashes,
 * and OAuth/SSO provider linkages.
 */

export interface AuthCredential {
  id: string;
  userId: string;
  provider: 'local' | 'google' | 'github' | 'apple';
  providerId: string | null;
  passwordHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAuthRepository {
  findByUserId(userId: string): Promise<AuthCredential[]>;
  findByProvider(provider: string, providerId: string): Promise<AuthCredential | null>;
  create(credential: Omit<AuthCredential, 'id' | 'createdAt' | 'updatedAt'>): Promise<AuthCredential>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
}
