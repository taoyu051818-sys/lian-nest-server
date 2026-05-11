import { Module } from '@nestjs/common';
import { REPOSITORY_TOKENS } from './tokens';
import {
  AuthRepository,
  SessionRepository,
  PostMetadataRepository,
  UserCacheRepository,
  ChannelReadRepository,
  AIRecordRepository,
  AuditEventRepository,
} from './providers';

/**
 * Repository module providing storage boundary abstractions.
 *
 * This module exposes domain-specific repository interfaces
 * via injection tokens. Business modules inject these tokens
 * to access storage without coupling to the underlying adapter.
 *
 * Storage boundary:
 * - Postgres: Primary store for auth, sessions, posts, AI records, audit
 * - Redis: Cache acceleration for sessions, user cache, channel reads
 * - File adapter: Optional for dev/test environments
 *
 * No direct storage access from business modules.
 *
 * TODO: Replace skeleton providers with Prisma/Redis implementations (issue #9).
 */
@Module({
  providers: [
    {
      provide: REPOSITORY_TOKENS.AUTH_REPOSITORY,
      useClass: AuthRepository,
    },
    {
      provide: REPOSITORY_TOKENS.SESSION_REPOSITORY,
      useClass: SessionRepository,
    },
    {
      provide: REPOSITORY_TOKENS.POST_METADATA_REPOSITORY,
      useClass: PostMetadataRepository,
    },
    {
      provide: REPOSITORY_TOKENS.USER_CACHE_REPOSITORY,
      useClass: UserCacheRepository,
    },
    {
      provide: REPOSITORY_TOKENS.CHANNEL_READ_REPOSITORY,
      useClass: ChannelReadRepository,
    },
    {
      provide: REPOSITORY_TOKENS.AI_RECORD_REPOSITORY,
      useClass: AIRecordRepository,
    },
    {
      provide: REPOSITORY_TOKENS.AUDIT_EVENT_REPOSITORY,
      useClass: AuditEventRepository,
    },
  ],
  exports: [
    REPOSITORY_TOKENS.AUTH_REPOSITORY,
    REPOSITORY_TOKENS.SESSION_REPOSITORY,
    REPOSITORY_TOKENS.POST_METADATA_REPOSITORY,
    REPOSITORY_TOKENS.USER_CACHE_REPOSITORY,
    REPOSITORY_TOKENS.CHANNEL_READ_REPOSITORY,
    REPOSITORY_TOKENS.AI_RECORD_REPOSITORY,
    REPOSITORY_TOKENS.AUDIT_EVENT_REPOSITORY,
  ],
})
export class RepositoryModule {}
