# Storage Boundary Architecture

## Overview

The storage boundary defines how the application accesses persistent and cached data. Business modules **never** access storage directly—they inject repository interfaces via NestJS dependency injection.

## Storage Adapters

### Postgres (Future Primary)

Postgres will be the primary store for:

| Domain | Reason |
|--------|--------|
| Auth credentials | Security-critical, requires transactions |
| Sessions (long-term) | Audit trail, compliance |
| Post metadata | Relational queries, indexing |
| AI records | Billing, analytics, retention |
| Audit events | Compliance, immutable log |

**Status**: Pending Prisma implementation (issue #9)

### Redis (Cache Acceleration)

Redis provides low-latency access for:

| Domain | Reason |
|--------|--------|
| Sessions (active) | Fast token validation |
| User cache | Profile hot-path, TTL-based |
| Channel reads | Real-time read position sync |

**Status**: Pending ioredis implementation (issue #9)

### File Adapter (Optional Dev/Test)

For development and testing only:

- In-memory stores for unit tests
- JSON file stores for local development
- No production use

## Architecture Principles

1. **Interface-first**: All storage access through TypeScript interfaces
2. **Token-based injection**: `REPOSITORY_TOKENS` map interfaces to implementations
3. **No direct access**: Business modules import interfaces, not implementations
4. **Adapter-swappable**: Switch Postgres/Redis/file without changing business logic
5. **Boundary enforced**: Repository module owns all storage concerns

## Module Structure

```
src/repositories/
├── index.ts                    # Public API
├── repository.module.ts        # NestJS module with providers
├── tokens.ts                   # Injection tokens
├── interfaces/                 # Contract definitions
│   ├── auth-repository.interface.ts
│   ├── session-repository.interface.ts
│   ├── post-metadata-repository.interface.ts
│   ├── user-cache-repository.interface.ts
│   ├── channel-read-repository.interface.ts
│   ├── ai-record-repository.interface.ts
│   └── audit-event-repository.interface.ts
└── providers/                  # Implementations (skeleton → Prisma/Redis)
    ├── auth.repository.ts
    ├── session.repository.ts
    ├── post-metadata.repository.ts
    ├── user-cache.repository.ts
    ├── channel-read.repository.ts
    ├── ai-record.repository.ts
    └── audit-event.repository.ts
```

## Usage Example

```typescript
// In a business module
import { Inject } from '@nestjs/common';
import { REPOSITORY_TOKENS, IAuthRepository } from '../repositories';

@Injectable()
export class AuthService {
  constructor(
    @Inject(REPOSITORY_TOKENS.AUTH_REPOSITORY)
    private readonly authRepo: IAuthRepository,
  ) {}

  async validateUser(userId: string) {
    const credentials = await this.authRepo.findByUserId(userId);
    // ...
  }
}
```

## Redis Infrastructure Module

The Redis client abstraction lives in `src/redis/`, separate from the repository
layer. This module owns connection lifecycle only — it does **not** implement
repository interfaces or serve as durable truth.

| Component | File | Role |
|---|---|---|
| `RedisModule` | `src/redis/redis.module.ts` | Global NestJS module, exports service + client token |
| `RedisService` | `src/redis/redis.service.ts` | Creates `ioredis` client from `REDIS_URL`, manages lifecycle |
| `REDIS_CLIENT` | `src/redis/redis.constants.ts` | Symbol-based injection token for the raw `ioredis` instance |

**Boundary rule**: `src/redis/` is infrastructure plumbing. Repository providers in
`src/repositories/providers/` import `RedisService` or inject `REDIS_CLIENT` to
access the connection. Business modules must continue to use repository interfaces
— they must not import from `src/redis/` directly.

## Migration Path

1. **Phase 1** (current): Skeleton implementations with `throw new Error()`
2. **Phase 2** (issue #9): Prisma schema and Redis client integration
3. **Phase 3** (issue #10): Real implementations replacing skeletons

## References

- [Repository Module Source](../../src/repositories/)
- [Issue #4: Repository Module Contracts](https://github.com/taoyu051818-sys/lian-nest-server/issues/4)
- [Issue #9: Postgres/Redis Plan](https://github.com/taoyu051818-sys/lian-nest-server/issues/9)
