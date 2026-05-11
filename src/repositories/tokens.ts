/**
 * Injection tokens for repository providers.
 *
 * Each token maps to a domain-specific repository interface.
 * Business modules inject these tokens to access storage
 * without coupling to the underlying storage adapter.
 */

export const REPOSITORY_TOKENS = {
  AUTH_REPOSITORY: 'AUTH_REPOSITORY',
  SESSION_REPOSITORY: 'SESSION_REPOSITORY',
  POST_METADATA_REPOSITORY: 'POST_METADATA_REPOSITORY',
  USER_CACHE_REPOSITORY: 'USER_CACHE_REPOSITORY',
  CHANNEL_READ_REPOSITORY: 'CHANNEL_READ_REPOSITORY',
  AI_RECORD_REPOSITORY: 'AI_RECORD_REPOSITORY',
  AUDIT_EVENT_REPOSITORY: 'AUDIT_EVENT_REPOSITORY',
} as const;

export type RepositoryToken = keyof typeof REPOSITORY_TOKENS;
