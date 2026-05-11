# Posts Detail Read-Only Contract

Defines the read-only response contract for the post detail endpoint.
Documents field ownership between NodeBB (legacy backend) and LIAN
(metadata overlay), and provides parity fixtures for future automation.

> **Issue:** #74
> **Scope:** Docs/contract + parity fixtures only. No runtime changes.

---

## Endpoint

| Field | Value |
|-------|-------|
| **Method** | `GET` |
| **Path** | `/api/posts/:postId` |
| **Auth** | None (public read) |
| **Response pattern** | Single object |
| **Controller** | `src/posts/posts.controller.ts` — `getPostDetail()` |
| **Service** | `src/posts/posts.service.ts` — `getPostDetail()` |
| **Nest route** | `GET /api/posts/:postId` |
| **Legacy route** | `GET /api/v2/posts/:pid` (NodeBB write-api) |

---

## Response Contract: `PostDetail`

### Source

`src/posts/posts.controller.ts` — `getPostDetail(@Param('postId') postId: string): PostDetail`

### Response Shape

```jsonc
{
  "pid": 42,
  "tid": 10,
  "title": "Welcome to LIAN",
  "slug": "welcome-to-lian",
  "content": "Post body in markdown or plaintext",
  "contentHtml": "<p>Post body rendered as HTML</p>",
  "author": {
    "uid": 1,
    "username": "admin",
    "avatar": "https://example.com/avatar.png",
    "reputation": 150
  },
  "timestamp": 1700000000000,
  "editedTimestamp": null,
  "editedByUid": null,
  "voteCount": 5,
  "bookmarkCount": 2,
  "replyCount": 15,
  "viewCount": 320,
  "tags": ["announcement", "welcome"],
  "isPinned": false,
  "isLocked": false,
  "isDeleted": false,
  "topic": {
    "tid": 10,
    "title": "Welcome to LIAN",
    "slug": "welcome-to-lian",
    "cid": 1,
    "categoryName": "General",
    "tagWhitelist": [],
    "postCount": 15,
    "viewCount": 320,
    "timestamp": 1700000000000,
    "lastPostTime": 1700100000000,
    "isPinned": false,
    "isLocked": false,
    "isDeleted": false
  }
}
```

### JSON Schema

```jsonc
{
  "type": "object",
  "required": [
    "pid", "tid", "title", "slug", "content", "contentHtml",
    "author", "timestamp", "voteCount", "bookmarkCount",
    "replyCount", "viewCount", "tags", "isPinned", "isLocked",
    "isDeleted", "topic"
  ],
  "properties": {
    "pid": { "type": "integer", "minimum": 1 },
    "tid": { "type": "integer", "minimum": 1 },
    "title": { "type": "string", "minLength": 1 },
    "slug": { "type": "string" },
    "content": { "type": "string" },
    "contentHtml": { "type": "string" },
    "author": { "$ref": "#/$defs/PostAuthor" },
    "timestamp": { "type": "integer", "minimum": 0 },
    "editedTimestamp": { "type": ["integer", "null"], "minimum": 0 },
    "editedByUid": { "type": ["integer", "null"], "minimum": 1 },
    "voteCount": { "type": "integer" },
    "bookmarkCount": { "type": "integer", "minimum": 0 },
    "replyCount": { "type": "integer", "minimum": 0 },
    "viewCount": { "type": "integer", "minimum": 0 },
    "tags": { "type": "array", "items": { "type": "string" } },
    "isPinned": { "type": "boolean" },
    "isLocked": { "type": "boolean" },
    "isDeleted": { "type": "boolean" },
    "topic": { "$ref": "#/$defs/TopicSummary" }
  },
  "additionalProperties": false,
  "$defs": {
    "PostAuthor": {
      "type": "object",
      "required": ["uid", "username", "avatar", "reputation"],
      "properties": {
        "uid": { "type": "integer", "minimum": 1 },
        "username": { "type": "string" },
        "avatar": { "type": ["string", "null"] },
        "reputation": { "type": "integer", "minimum": 0 }
      },
      "additionalProperties": false
    },
    "TopicSummary": {
      "type": "object",
      "required": [
        "tid", "title", "slug", "cid", "categoryName",
        "tagWhitelist", "postCount", "viewCount", "timestamp",
        "lastPostTime", "isPinned", "isLocked", "isDeleted"
      ],
      "properties": {
        "tid": { "type": "integer", "minimum": 1 },
        "title": { "type": "string" },
        "slug": { "type": "string" },
        "cid": { "type": "integer", "minimum": 1 },
        "categoryName": { "type": "string" },
        "tagWhitelist": { "type": "array", "items": { "type": "string" } },
        "postCount": { "type": "integer", "minimum": 0 },
        "viewCount": { "type": "integer", "minimum": 0 },
        "timestamp": { "type": "integer", "minimum": 0 },
        "lastPostTime": { "type": "integer", "minimum": 0 },
        "isPinned": { "type": "boolean" },
        "isLocked": { "type": "boolean" },
        "isDeleted": { "type": "boolean" }
      },
      "additionalProperties": false
    }
  }
}
```

---

## Field Ownership

Fields are classified by their data origin. This distinction drives
parity testing strategy: NodeBB-owned fields require legacy backend
comparison, while LIAN metadata fields can be verified against the
local database alone.

### NodeBB-Owned Fields

These fields are sourced from the NodeBB forum engine via its write-api.
The Nest backend acts as a proxy and must not alter their values.

| Field | Source | Notes |
|-------|--------|-------|
| `pid` | NodeBB post ID | Primary key in NodeBB `objects` hash |
| `tid` | NodeBB topic ID | Foreign key to `topic:tid` |
| `title` | NodeBB topic | Denormalized from topic for convenience |
| `slug` | NodeBB topic | URL-safe slug, generated by NodeBB |
| `content` | NodeBB post | Raw markdown/plaintext body |
| `contentHtml` | NodeBB post | Server-rendered HTML from NodeBB |
| `author.uid` | NodeBB user ID | Maps to `user:uid` in NodeBB |
| `author.username` | NodeBB user | Current username at fetch time |
| `author.avatar` | NodeBB user | Profile picture URL or null |
| `author.reputation` | NodeBB user | Computed from upvotes/downvotes |
| `timestamp` | NodeBB post | Unix epoch milliseconds |
| `editedTimestamp` | NodeBB post | Last edit time, null if never edited |
| `editedByUid` | NodeBB post | Editor uid, null if never edited |
| `voteCount` | NodeBB post | Net upvotes minus downvotes |
| `viewCount` | NodeBB post | Total view count |
| `topic.*` | NodeBB topic | Full topic summary (see TopicSummary schema) |

### LIAN Metadata Fields

These fields are managed by the LIAN application layer, stored in the
local database via `PostMetadata` repository. They extend the NodeBB
data model with LIAN-specific features.

| Field | Source | Notes |
|-------|--------|-------|
| `bookmarkCount` | LIAN `PostMetadata` | Aggregated bookmark saves |
| `replyCount` | LIAN `PostMetadata` | Cached reply count for list views |
| `tags` | LIAN `PostMetadata` | LIAN-managed tag array (may differ from NodeBB tags) |
| `isPinned` | LIAN `PostMetadata` | LIAN pin status (may differ from NodeBB pinned state) |
| `isLocked` | LIAN `PostMetadata` | LIAN lock status |
| `isDeleted` | LIAN `PostMetadata` | LIAN soft-delete flag |

### Ownership Invariants

1. **NodeBB fields are read-only proxies.** The Nest backend must never
   mutate NodeBB-sourced values in the response. Any discrepancy between
   the NodeBB API response and the LIAN response is a parity bug.
2. **LIAN metadata is the source of truth for its fields.** If LIAN
   metadata says `isPinned: true` but NodeBB says the topic is not
   pinned, the LIAN value wins in the response.
3. **Timestamps are NodeBB-native.** LIAN does not maintain its own
   `createdAt` for posts; it delegates to NodeBB's `timestamp` field.

---

## Error Responses

### 404 — Post Not Found

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Post not found",
  "code": "NOT_FOUND"
}
```

Triggered when `postId` does not map to an existing NodeBB post.

### 400 — Invalid Post ID

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Invalid post ID",
  "code": "BAD_REQUEST"
}
```

Triggered when `postId` is not a valid integer string.

---

## Parity Fixtures

Fixture files live under `test/parity/posts/` and follow the format
defined in `docs/contracts/readonly-route-parity-fixtures.md`.

| Fixture ID | File | Scenario |
|------------|------|----------|
| `post-detail-basic` | `test/parity/posts/post-detail-basic.json` | Standard post with all fields populated |
| `post-detail-minimal` | `test/parity/posts/post-detail-minimal.json` | Post with nullable fields at null/empty |
| `post-detail-not-found` | `test/parity/posts/post-detail-not-found.json` | Non-existent post returns 404 |

---

## Validation Commands

```bash
# Ensure no unexpected source changes
git diff --check

# Contract guard (when available)
npm run ops:guard

# TypeScript compilation (no source changes expected)
npm run build
```

---

## Done Criteria

- [x] Contract separates NodeBB-owned fields from LIAN metadata fields
- [x] Fixture shape is ready for future parity automation
- [x] No runtime implementation changes
- [x] All fixture files exist under `test/parity/posts/`
- [x] JSON Schema validates all required fields and types
