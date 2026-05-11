# Repository Interfaces

## Domain Repositories

### Auth Repository

Manages authentication credentials and OAuth/SSO linkages.

**Methods**:
- `findByUserId(userId)` - Get all credentials for a user
- `findByProvider(provider, providerId)` - Find by OAuth provider
- `create(credential)` - Create new credential
- `updatePasswordHash(userId, hash)` - Update password
- `deleteByUserId(userId)` - Remove all credentials

**Storage**: Postgres (primary)

---

### Session Repository

Manages user sessions and refresh tokens.

**Methods**:
- `findById(id)` - Get session by ID
- `findByRefreshToken(token)` - Validate refresh token
- `findByUserId(userId)` - Get all user sessions
- `create(session)` - Create new session
- `updateLastAccessed(id)` - Touch session
- `deleteById(id)` - Revoke session
- `deleteByUserId(userId)` - Revoke all sessions
- `deleteExpired()` - Cleanup expired sessions

**Storage**: Redis (active), Postgres (audit)

---

### Post Metadata Repository

Stores post metadata for quick lookups.

**Methods**:
- `findById(id)` - Get by internal ID
- `findByNodebbPid(pid)` - Get by NodeBB post ID
- `findByAuthorId(authorId, limit?)` - Get user's posts
- `findByTags(tags, limit?)` - Tag-based search
- `upsert(metadata)` - Create or update
- `deleteByNodebbPid(pid)` - Remove metadata

**Storage**: Postgres (primary)

---

### User Cache Repository

Caches frequently accessed user profiles.

**Methods**:
- `findById(id)` - Get cached user
- `findByNodebbUid(uid)` - Get by NodeBB UID
- `findByUsername(username)` - Get by username
- `set(user)` - Cache user data
- `invalidate(id)` - Remove from cache
- `invalidateByNodebbUid(uid)` - Remove by NodeBB UID
- `refreshTTL(id, ttlSeconds)` - Extend cache TTL

**Storage**: Redis (primary, TTL-based)

---

### Channel Read Repository

Tracks user read positions for unread indicators.

**Methods**:
- `findByUserAndChannel(userId, type, id)` - Get read position
- `findByUserId(userId)` - Get all read positions
- `upsert(read)` - Update read position
- `deleteByUserId(userId)` - Clear user positions
- `deleteByChannel(type, id)` - Clear channel positions

**Storage**: Redis (primary), Postgres (persistence)

---

### AI Record Repository

Stores AI interaction records for audit and billing.

**Methods**:
- `findById(id)` - Get record by ID
- `findByUserId(userId, limit?)` - Get user's AI usage
- `query(filter)` - Flexible query
- `create(record)` - Record AI interaction
- `aggregateUsage(userId, from, to)` - Usage statistics

**Storage**: Postgres (primary)

---

### Audit Event Repository

Records security-relevant events.

**Methods**:
- `findById(id)` - Get event by ID
- `query(filter)` - Flexible query
- `create(event)` - Record event
- `countByAction(action, from, to)` - Action statistics
- `deleteOlderThan(date)` - Retention cleanup

**Storage**: Postgres (primary, immutable)

---

## Implementation Status

| Repository | Interface | Skeleton | Real Implementation |
|------------|-----------|----------|---------------------|
| Auth | ✅ | ✅ | Pending (issue #9) |
| Session | ✅ | ✅ | Pending (issue #9) |
| Post Metadata | ✅ | ✅ | Pending (issue #9) |
| User Cache | ✅ | ✅ | Pending (issue #9) |
| Channel Read | ✅ | ✅ | Pending (issue #9) |
| AI Record | ✅ | ✅ | Pending (issue #9) |
| Audit Event | ✅ | ✅ | Pending (issue #9) |
