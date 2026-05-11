# Endpoint Migration Contracts

Parity fixture expectations for each migration slice. Each section defines the
expected response shape, error codes, and validation rules that integration
tests must verify against the legacy backend.

> **Companion document:** `docs/migration/endpoint-migration-queue.md` defines
> the slice ordering, dependencies, and file-level scope.

---

## Auth Contracts (A3–A6)

### A3 — Login

**Endpoint:** `POST /api/auth/login`

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securepass"
}
```

**Success (200):**
```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<opaque-uuid>",
  "expiresIn": 900,
  "user": {
    "id": 1,
    "uuid": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "username": "testuser",
    "displayName": "Test User",
    "avatarUrl": null,
    "role": "USER",
    "nodebbUid": null,
    "createdAt": "2026-01-15T10:30:00.000Z"
  }
}
```

**Error (401):**
```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "message": "Invalid credentials",
  "code": "UNAUTHORIZED"
}
```

**Validation rules:**
- `email`: required, valid email format
- `password`: required, string, min 8 chars

**Parity checks:**
- [ ] Response includes all `AuthTokensDto` fields
- [ ] Response includes all `CurrentUserDto` fields
- [ ] No `passwordHash` in response
- [ ] Session record created in `ISessionRepository` with IP and user-agent
- [ ] Audit event `user.login` created in `IAuditEventRepository`
- [ ] bcrypt used for password comparison (constant-time)

---

### A4 — Register

**Endpoint:** `POST /api/auth/register`

**Request:**
```json
{
  "email": "newuser@example.com",
  "username": "newuser",
  "password": "securepass",
  "displayName": "New User"
}
```

**Success (201):**
```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<opaque-uuid>",
  "expiresIn": 900,
  "user": {
    "id": 2,
    "uuid": "<new-uuid>",
    "email": "newuser@example.com",
    "username": "newuser",
    "displayName": "New User",
    "avatarUrl": null,
    "role": "USER",
    "nodebbUid": null,
    "createdAt": "<iso8601>"
  }
}
```

**Error — duplicate email (409):**
```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Email already registered",
  "code": "CONFLICT"
}
```

**Error — duplicate username (409):**
```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Username already taken",
  "code": "CONFLICT"
}
```

**Validation rules:**
- `email`: required, valid email format
- `username`: required, string, 3–32 chars
- `password`: required, string, min 8 chars
- `displayName`: optional, string, max 64 chars

**Parity checks:**
- [ ] Response shape matches login
- [ ] Password hashed before storage (never plaintext)
- [ ] `AuthCredential` created with provider `local`
- [ ] First user ever gets `role: "ADMIN"` (first-run detection)
- [ ] Subsequent users get `role: "USER"`
- [ ] Audit event `user.register` created
- [ ] Input validation rejects invalid email, short username, short password

---

### A5 — Logout

**Endpoint:** `POST /api/auth/logout`

**Request:** (empty body, requires `Authorization: Bearer <token>`)

**Success (200):**
```json
{
  "ok": true
}
```

**Parity checks:**
- [ ] Session deleted from `ISessionRepository`
- [ ] Idempotent: deleting non-existent session returns 200 (no 404)
- [ ] Audit event `user.logout` created
- [ ] Requires authentication (401 without token)

---

### A5 — Current User

**Endpoint:** `GET /api/auth/me`

**Request:** (empty, requires `Authorization: Bearer <token>`)

**Success (200):**
```json
{
  "id": 1,
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com",
  "username": "testuser",
  "displayName": "Test User",
  "avatarUrl": null,
  "role": "USER",
  "nodebbUid": null,
  "createdAt": "2026-01-15T10:30:00.000Z"
}
```

**Error (401):** (no token)
```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "code": "UNAUTHORIZED"
}
```

**Error (404):** (user deleted)
```json
{
  "statusCode": 404,
  "error": "Not Found",
  "code": "NOT_FOUND"
}
```

**Parity checks:**
- [ ] Returns full `CurrentUserDto` shape
- [ ] No `passwordHash` or sensitive fields in response
- [ ] Includes `nodebbUid` when linked
- [ ] 401 if not authenticated
- [ ] 404 if user deleted/deactivated

---

### A5 — Change Password

**Endpoint:** `POST /api/auth/password`

**Request:**
```json
{
  "currentPassword": "oldpass",
  "newPassword": "newsecurepass"
}
```

**Success (200):**
```json
{
  "ok": true
}
```

**Error (401):** (wrong current password)
```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "message": "Invalid credentials",
  "code": "UNAUTHORIZED"
}
```

**Validation rules:**
- `currentPassword`: required, string
- `newPassword`: required, string, min 8 chars

**Parity checks:**
- [ ] Current password verified with bcrypt
- [ ] New password hash stored in `IAuthRepository`
- [ ] Audit event `user.password_change` created
- [ ] Requires authentication
- [ ] Never reveals whether current password was wrong in error message

---

## Feed Contracts (F1)

### F1 — Get Feed

**Endpoint:** `GET /api/feed?page=1&perPage=10`

**Success (200):**
```json
{
  "items": [
    {
      "id": "feed-001",
      "postId": 42,
      "topicId": 10,
      "title": "Welcome to LIAN",
      "snippet": "This is the first post...",
      "authorUid": 1,
      "authorUsername": "admin",
      "createdAt": "2026-01-15T10:30:00.000Z"
    }
  ],
  "totalCount": 100,
  "page": 1,
  "perPage": 10
}
```

**Validation rules:**
- `page`: optional, integer, min 1, default 1
- `perPage`: optional, integer, 1–50, default 20

**Parity checks:**
- [ ] Response is `FeedResponseDto` shape
- [ ] Each item is `FeedItemDto` shape
- [ ] Pagination fields present and correct
- [ ] Requires authentication

---

### F1 — Get Feed Item

**Endpoint:** `GET /api/feed/:feedItemId`

**Success (200):**
```json
{
  "id": "feed-001",
  "postId": 42,
  "topicId": 10,
  "title": "Welcome to LIAN",
  "snippet": "This is the first post...",
  "authorUid": 1,
  "authorUsername": "admin",
  "createdAt": "2026-01-15T10:30:00.000Z"
}
```

**Error (404):**
```json
{
  "statusCode": 404,
  "error": "Not Found",
  "code": "NOT_FOUND"
}
```

**Parity checks:**
- [ ] Returns single `FeedItemDto`
- [ ] 404 for invalid `feedItemId`
- [ ] Requires authentication

---

## Posts Contracts (P1–P4)

### P1 — List Posts

**Endpoint:** `GET /api/posts?page=1&perPage=10`

**Success (200):**
```json
{
  "posts": [
    {
      "pid": 42,
      "title": "First Post",
      "author": {
        "uid": 1,
        "username": "admin",
        "avatar": null
      },
      "timestamp": "2026-01-15T10:30:00.000Z",
      "voteCount": 5,
      "replyCount": 3
    }
  ],
  "totalCount": 50,
  "page": 1,
  "perPage": 10
}
```

**Parity checks:**
- [ ] Response matches `PostPaginatedList` shape
- [ ] Each item matches `PostListItem` shape
- [ ] Pagination fields present

---

### P1 — Get Post Detail

**Endpoint:** `GET /api/posts/:postId`

**Success (200):**
```json
{
  "pid": 42,
  "title": "First Post",
  "content": "<html or markdown body>",
  "author": {
    "uid": 1,
    "username": "admin",
    "avatar": null,
    "reputation": 100
  },
  "timestamp": "2026-01-15T10:30:00.000Z",
  "voteCount": 5,
  "reactions": {
    "LIKE": 3,
    "LOVE": 2
  },
  "replies": {
    "items": [],
    "totalCount": 0,
    "page": 1,
    "perPage": 10
  },
  "editHistory": []
}
```

**Error (404):**
```json
{
  "statusCode": 404,
  "error": "Not Found",
  "code": "NOT_FOUND"
}
```

**Parity checks:**
- [ ] Response matches `PostDetail` shape
- [ ] Includes `PostAuthor` with `reputation`
- [ ] Includes `PostReactionSummary` with counts per type
- [ ] Replies are paginated
- [ ] 404 for invalid `postId`

---

### P2 — Create Post

**Endpoint:** `POST /api/posts`

**Request:**
```json
{
  "title": "New Post",
  "content": "Post body content",
  "tags": ["intro", "hello"]
}
```

**Success (201):**
```json
{
  "pid": 43,
  "title": "New Post",
  "content": "Post body content",
  "author": { "uid": 1, "username": "admin", "avatar": null, "reputation": 100 },
  "timestamp": "<iso8601>",
  "voteCount": 0,
  "reactions": {},
  "replies": { "items": [], "totalCount": 0, "page": 1, "perPage": 10 },
  "editHistory": []
}
```

**Validation rules:**
- `title`: required, string
- `content`: required, string
- `tags`: optional, string array

**Parity checks:**
- [ ] Returns `PostDetail` shape
- [ ] Requires authentication
- [ ] Audit logging (if applicable)

---

### P2 — Update Post

**Endpoint:** `PUT /api/posts/:postId`

**Request:**
```json
{
  "title": "Updated Title",
  "content": "Updated content"
}
```

**Success (200):** Returns updated `PostDetail`.

**Error (403):**
```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "code": "FORBIDDEN"
}
```

**Parity checks:**
- [ ] Only post owner can update
- [ ] Non-owner gets 403
- [ ] Requires authentication

---

### P2 — Delete Post

**Endpoint:** `DELETE /api/posts/:postId`

**Success (200):**
```json
{
  "ok": true
}
```

**Parity checks:**
- [ ] Soft-delete (sets status, does not remove data)
- [ ] Only moderator can delete
- [ ] Non-moderator gets 403
- [ ] Requires authentication

---

### P3 — List Reactions

**Endpoint:** `GET /api/posts/:postId/reactions`

**Success (200):**
```json
{
  "LIKE": 5,
  "LOVE": 3,
  "HAHA": 1,
  "WOW": 0,
  "SAD": 0,
  "ANGRY": 0
}
```

**Parity checks:**
- [ ] Response matches `PostReactionSummary`
- [ ] All `PostReactionType` enum values present (even if 0)
- [ ] 404 for invalid `postId`

---

### P3 — Add Reaction

**Endpoint:** `POST /api/posts/:postId/reactions`

**Request:**
```json
{
  "type": "LIKE"
}
```

**Success (200):** Returns updated `PostReactionSummary`.

**Validation rules:**
- `type`: required, one of `PostReactionType` enum values

**Parity checks:**
- [ ] Idempotent: double-add does not double-count
- [ ] Requires authentication
- [ ] Invalid `type` → 400

---

### P3 — Remove Reaction

**Endpoint:** `DELETE /api/posts/:postId/reactions/:reactionType`

**Success (200):** Returns updated `PostReactionSummary`.

**Parity checks:**
- [ ] Idempotent: removing non-existent reaction is OK
- [ ] Requires authentication
- [ ] Invalid `reactionType` → 400

---

### P4 — List Replies

**Endpoint:** `GET /api/posts/:postId/replies?page=1&perPage=10`

**Success (200):**
```json
{
  "items": [
    {
      "rid": 101,
      "content": "Great post!",
      "author": { "uid": 2, "username": "user1", "avatar": null },
      "timestamp": "2026-01-16T08:00:00.000Z",
      "voteCount": 2
    }
  ],
  "totalCount": 15,
  "page": 1,
  "perPage": 10
}
```

**Parity checks:**
- [ ] Response is paginated `PostReply[]`
- [ ] Each reply matches `PostReply` shape
- [ ] 404 for invalid `postId`

---

### P4 — Create Reply

**Endpoint:** `POST /api/posts/:postId/replies`

**Request:**
```json
{
  "content": "This is my reply"
}
```

**Success (201):** Returns `PostReply` shape.

**Parity checks:**
- [ ] Requires authentication
- [ ] 404 for invalid `postId`
- [ ] `content` is required

---

### P4 — Delete Reply

**Endpoint:** `DELETE /api/posts/:postId/replies/:replyId`

**Success (200):**
```json
{
  "ok": true
}
```

**Parity checks:**
- [ ] Owner or moderator can delete
- [ ] Non-owner/non-mod gets 403
- [ ] Requires authentication

---

## Messages Contracts (M1)

### M1 — Send Message

**Endpoint:** `POST /api/messages`

**Request:**
```json
{
  "toUid": 2,
  "content": "Hello!",
  "roomId": 5
}
```

**Success (201):**
```json
{
  "messageId": "msg-001",
  "fromUid": 1,
  "toUid": 2,
  "content": "Hello!",
  "timestamp": "2026-01-15T10:30:00.000Z",
  "read": false
}
```

**Validation rules:**
- `toUid`: required, number
- `content`: required, string
- `roomId`: optional, number

**Parity checks:**
- [ ] Response matches `MessageResponseDto`
- [ ] Requires authentication
- [ ] `fromUid` extracted from auth context (not request body)

---

### M1 — List Messages

**Endpoint:** `GET /api/messages?page=1&perPage=20`

**Success (200):**
```json
{
  "messages": [
    {
      "messageId": "msg-001",
      "fromUid": 1,
      "toUid": 2,
      "content": "Hello!",
      "timestamp": "2026-01-15T10:30:00.000Z",
      "read": false
    }
  ],
  "totalCount": 50,
  "page": 1,
  "perPage": 20
}
```

**Parity checks:**
- [ ] Response matches `MessageListResponseDto`
- [ ] Only returns messages for authenticated user
- [ ] Requires authentication

---

### M1 — Mark Message Read

**Endpoint:** `POST /api/messages/:messageId/read`

**Success (200):**
```json
{
  "ok": true
}
```

**Parity checks:**
- [ ] Requires authentication
- [ ] Idempotent
- [ ] 404 for invalid `messageId`

---

## Notifications Contracts (N1)

### N1 — List Notifications

**Endpoint:** `GET /api/notifications?page=1&perPage=20`

**Success (200):**
```json
{
  "notifications": [
    {
      "nid": 1,
      "type": "mention",
      "bodyShort": "admin mentioned you",
      "bodyLong": "admin mentioned you in 'Welcome'",
      "fromUid": 1,
      "datetime": "2026-01-15T10:30:00.000Z",
      "read": false
    }
  ],
  "totalCount": 25
}
```

**Parity checks:**
- [ ] Response matches `NotificationListResponseDto`
- [ ] Newest first
- [ ] Only returns notifications for authenticated user
- [ ] Requires authentication

---

### N1 — Unread Count

**Endpoint:** `GET /api/notifications/unread-count`

**Success (200):**
```json
{
  "count": 5
}
```

**Parity checks:**
- [ ] Returns `{ count: number }`
- [ ] Only counts for authenticated user
- [ ] Requires authentication

---

### N1 — Mark Notification Read

**Endpoint:** `POST /api/notifications/:nid/read`

**Success (200):**
```json
{
  "ok": true
}
```

**Parity checks:**
- [ ] Requires authentication
- [ ] Idempotent
- [ ] 404 for invalid `nid`

---

## Profile Contracts (PR1)

### PR1 — Public Profile

**Endpoint:** `GET /api/profile/:uid`

**Success (200):**
```json
{
  "uid": 1,
  "username": "admin",
  "displayName": "Admin User",
  "avatar": "https://example.com/avatar.jpg",
  "bio": "Community admin",
  "postCount": 42,
  "reputation": 150,
  "joinedAt": "2025-06-01T00:00:00.000Z"
}
```

**Error (404):**
```json
{
  "statusCode": 404,
  "error": "Not Found",
  "code": "NOT_FOUND"
}
```

**Parity checks:**
- [ ] Response matches `PublicProfile` shape
- [ ] All fields present (nullable fields as `null`)
- [ ] 404 for non-existent `uid`

---

### PR1 — Saved Items

**Endpoint:** `GET /api/profile/:uid/saved?page=1&pageSize=10`

**Success (200):**
```json
{
  "items": [
    {
      "id": "saved-001",
      "type": "topic",
      "targetId": 10,
      "savedAt": "2026-01-15T10:30:00.000Z"
    }
  ],
  "total": 5,
  "page": 1,
  "pageSize": 10
}
```

**Parity checks:**
- [ ] Response matches `ProfileCollection<SavedItem>`
- [ ] `type` is `"topic"` or `"post"`
- [ ] Paginated with `page`, `pageSize`

---

### PR1 — Liked Items

**Endpoint:** `GET /api/profile/:uid/liked?page=1&pageSize=10`

**Success (200):**
```json
{
  "items": [
    {
      "id": "liked-001",
      "type": "post",
      "targetId": 42,
      "likedAt": "2026-01-15T10:30:00.000Z"
    }
  ],
  "total": 12,
  "page": 1,
  "pageSize": 10
}
```

**Parity checks:**
- [ ] Response matches `ProfileCollection<LikedItem>`
- [ ] `type` is `"topic"` or `"post"`
- [ ] Paginated

---

### PR1 — View History

**Endpoint:** `GET /api/profile/:uid/history?page=1&pageSize=10`

**Success (200):**
```json
{
  "items": [
    {
      "id": "history-001",
      "type": "topic",
      "targetId": 10,
      "viewedAt": "2026-01-15T10:30:00.000Z"
    }
  ],
  "total": 30,
  "page": 1,
  "pageSize": 10
}
```

**Parity checks:**
- [ ] Response matches `ProfileCollection<HistoryItem>`
- [ ] `type` is `"topic"` or `"post"`
- [ ] Paginated

---

## Cross-Cutting Parity Rules

All endpoints must satisfy these regardless of module:

1. **Error envelope** — All errors use `ErrorEnvelope` from `GlobalExceptionFilter`: `{ statusCode, error, message?, code }`
2. **Auth extraction** — Authenticated endpoints extract `uid` from JWT `sub` claim, never from request body
3. **No sensitive data** — No `passwordHash`, raw tokens, or internal IDs in public responses
4. **Idempotency** — Mark-read, reaction add/remove, delete operations are idempotent (no 404 on re-operation)
5. **Pagination consistency** — All list endpoints use `page`/`perPage` (or `page`/`pageSize` for profile collections)
6. **Timestamp format** — All timestamps are ISO 8601 strings
