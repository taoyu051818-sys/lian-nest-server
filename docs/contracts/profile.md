# Profile Collections Contract

Defines the response DTO contracts and parity fixture expectations for
profile collection endpoints: saved, liked, and history.

> **Issue:** #75
> **Scope:** Docs/contract and parity fixtures only. No runtime changes.

---

## Endpoint Overview

| Endpoint | Auth | Response Pattern | NodeBB Source |
|----------|------|-----------------|---------------|
| `GET /api/profile/:uid/saved` | Public | Paginated collection | `uid:<uid>:saved` sorted set |
| `GET /api/profile/:uid/liked` | Public | Paginated collection | `uid:<uid>:upvote` sorted set |
| `GET /api/profile/:uid/history` | Public | Paginated collection | `uid:<uid>:history` sorted set |

---

## NodeBB Collection Ownership

Each collection endpoint reads from a NodeBB sorted set. Ownership
is explicit here to anchor future provider implementations.

| Collection | NodeBB Key Pattern | Score Field | Owner Module |
|------------|--------------------|-------------|--------------|
| Saved | `uid:<uid>:saved` | Unix timestamp (ms) | `ProfileUsecase` via `NodebbCollectionProvider` |
| Liked | `uid:<uid>:upvote` | Unix timestamp (ms) | `ProfileUsecase` via `NodebbCollectionProvider` |
| History | `uid:<uid>:history` | Unix timestamp (ms) | `ProfileUsecase` via `NodebbCollectionProvider` |

When the NodeBB key is missing or empty, the endpoint returns an empty
`items` array with `total: 0` rather than an error. This is the expected
fallback for users with no activity.

---

## Fallback Observability

When a collection query falls back to an empty result, the response
includes a `source` field indicating the data origin:

| `source` Value | Meaning |
|----------------|---------|
| `"nodebb"` | Data read successfully from NodeBB sorted set |
| `"fallback"` | NodeBB unavailable or key missing; returning empty collection |

The `source` field is for observability only. Parity tests must accept
both values. Production consumers must not branch on `source`.

---

## Query Parameters

All collection endpoints accept optional pagination params:

| Param | Type | Default | Min | Max |
|-------|------|---------|-----|-----|
| `page` | integer | 1 | 1 | - |
| `pageSize` | integer | 10 | 1 | 50 |

---

## Response DTOs

### SavedItem

```jsonc
{
  "id": "<STRING>",
  "type": "topic" | "post",
  "targetId": "<STRING>",
  "savedAt": "<ISO8601>"
}
```

### LikedItem

```jsonc
{
  "id": "<STRING>",
  "type": "topic" | "post",
  "targetId": "<STRING>",
  "likedAt": "<ISO8601>"
}
```

### HistoryItem

```jsonc
{
  "id": "<STRING>",
  "type": "topic" | "post",
  "targetId": "<STRING>",
  "viewedAt": "<ISO8601>"
}
```

### ProfileCollection\<T\>

```jsonc
{
  "items": [ /* T[] */ ],
  "total": "<NON_NEG_INT>",
  "page": "<POSITIVE_INT>",
  "pageSize": "<POSITIVE_INT>",
  "source": "nodebb" | "fallback"
}
```

---

## Endpoints

### 1. GET /api/profile/:uid/saved

**Source:** `src/profile/profile.controller.ts` — `ProfileController.getSaved()`
**Auth:** None (public)
**Path params:** `uid` (string)
**Query params:** `page` (int, default 1), `pageSize` (int, default 10)

#### Fixture: `saved-basic`

```jsonc
{
  "id": "saved-basic",
  "endpoint": "GET /api/profile/:uid/saved",
  "description": "Saved items default pagination returns first page",
  "request": {
    "method": "GET",
    "path": "/api/profile/<USER_UID>/saved",
    "params": { "uid": "<USER_UID>" }
  },
  "expected": {
    "status": 200,
    "contentType": "application/json",
    "body": {
      "items": "<ARRAY>",
      "total": "<NON_NEG_INT>",
      "page": 1,
      "pageSize": 10,
      "source": "nodebb"
    },
    "bodySchema": {
      "type": "object",
      "required": ["items", "total", "page", "pageSize", "source"],
      "properties": {
        "items": {
          "type": "array",
          "items": { "$ref": "#/$defs/SavedItem" }
        },
        "total": { "type": "integer", "minimum": 0 },
        "page": { "type": "integer", "minimum": 1 },
        "pageSize": { "type": "integer", "minimum": 1, "maximum": 50 },
        "source": { "type": "string", "enum": ["nodebb", "fallback"] }
      },
      "additionalProperties": false
    }
  },
  "notes": "USER_UID must reference a valid seeded user during test runs."
}
```

#### Fixture: `saved-pagination`

```jsonc
{
  "id": "saved-pagination",
  "endpoint": "GET /api/profile/:uid/saved",
  "description": "Saved items with explicit page=2, pageSize=5",
  "request": {
    "method": "GET",
    "path": "/api/profile/<USER_UID>/saved",
    "params": { "uid": "<USER_UID>" },
    "query": { "page": 2, "pageSize": 5 }
  },
  "expected": {
    "status": 200,
    "contentType": "application/json",
    "body": {
      "items": "<ARRAY>",
      "total": "<NON_NEG_INT>",
      "page": 2,
      "pageSize": 5,
      "source": "nodebb"
    },
    "bodySchema": {
      "type": "object",
      "required": ["items", "total", "page", "pageSize", "source"],
      "properties": {
        "items": {
          "type": "array",
          "items": { "$ref": "#/$defs/SavedItem" }
        },
        "total": { "type": "integer", "minimum": 0 },
        "page": { "type": "integer", "const": 2 },
        "pageSize": { "type": "integer", "const": 5 },
        "source": { "type": "string", "enum": ["nodebb", "fallback"] }
      },
      "additionalProperties": false
    }
  }
}
```

---

### 2. GET /api/profile/:uid/liked

**Source:** `src/profile/profile.controller.ts` — `ProfileController.getLiked()`
**Auth:** None (public)
**Path params:** `uid` (string)
**Query params:** `page` (int, default 1), `pageSize` (int, default 10)

#### Fixture: `liked-basic`

```jsonc
{
  "id": "liked-basic",
  "endpoint": "GET /api/profile/:uid/liked",
  "description": "Liked items default pagination returns first page",
  "request": {
    "method": "GET",
    "path": "/api/profile/<USER_UID>/liked",
    "params": { "uid": "<USER_UID>" }
  },
  "expected": {
    "status": 200,
    "contentType": "application/json",
    "body": {
      "items": "<ARRAY>",
      "total": "<NON_NEG_INT>",
      "page": 1,
      "pageSize": 10,
      "source": "nodebb"
    },
    "bodySchema": {
      "type": "object",
      "required": ["items", "total", "page", "pageSize", "source"],
      "properties": {
        "items": {
          "type": "array",
          "items": { "$ref": "#/$defs/LikedItem" }
        },
        "total": { "type": "integer", "minimum": 0 },
        "page": { "type": "integer", "minimum": 1 },
        "pageSize": { "type": "integer", "minimum": 1, "maximum": 50 },
        "source": { "type": "string", "enum": ["nodebb", "fallback"] }
      },
      "additionalProperties": false
    }
  },
  "notes": "USER_UID must reference a valid seeded user during test runs."
}
```

---

### 3. GET /api/profile/:uid/history

**Source:** `src/profile/profile.controller.ts` — `ProfileController.getHistory()`
**Auth:** None (public)
**Path params:** `uid` (string)
**Query params:** `page` (int, default 1), `pageSize` (int, default 10)

#### Fixture: `history-basic`

```jsonc
{
  "id": "history-basic",
  "endpoint": "GET /api/profile/:uid/history",
  "description": "History items default pagination returns first page",
  "request": {
    "method": "GET",
    "path": "/api/profile/<USER_UID>/history",
    "params": { "uid": "<USER_UID>" }
  },
  "expected": {
    "status": 200,
    "contentType": "application/json",
    "body": {
      "items": "<ARRAY>",
      "total": "<NON_NEG_INT>",
      "page": 1,
      "pageSize": 10,
      "source": "nodebb"
    },
    "bodySchema": {
      "type": "object",
      "required": ["items", "total", "page", "pageSize", "source"],
      "properties": {
        "items": {
          "type": "array",
          "items": { "$ref": "#/$defs/HistoryItem" }
        },
        "total": { "type": "integer", "minimum": 0 },
        "page": { "type": "integer", "minimum": 1 },
        "pageSize": { "type": "integer", "minimum": 1, "maximum": 50 },
        "source": { "type": "string", "enum": ["nodebb", "fallback"] }
      },
      "additionalProperties": false
    }
  },
  "notes": "USER_UID must reference a valid seeded user during test runs."
}
```

---

## Shared Schema Definitions

When using JSON Schema validation, include these `$defs`:

```jsonc
{
  "$defs": {
    "SavedItem": {
      "type": "object",
      "required": ["id", "type", "targetId", "savedAt"],
      "properties": {
        "id": { "type": "string" },
        "type": { "type": "string", "enum": ["topic", "post"] },
        "targetId": { "type": "string" },
        "savedAt": { "type": "string", "format": "date-time" }
      },
      "additionalProperties": false
    },
    "LikedItem": {
      "type": "object",
      "required": ["id", "type", "targetId", "likedAt"],
      "properties": {
        "id": { "type": "string" },
        "type": { "type": "string", "enum": ["topic", "post"] },
        "targetId": { "type": "string" },
        "likedAt": { "type": "string", "format": "date-time" }
      },
      "additionalProperties": false
    },
    "HistoryItem": {
      "type": "object",
      "required": ["id", "type", "targetId", "viewedAt"],
      "properties": {
        "id": { "type": "string" },
        "type": { "type": "string", "enum": ["topic", "post"] },
        "targetId": { "type": "string" },
        "viewedAt": { "type": "string", "format": "date-time" }
      },
      "additionalProperties": false
    }
  }
}
```

---

## Error Response Contracts

| Scenario | Status | Body shape |
|----------|--------|------------|
| User not found | 404 | `{ "statusCode": 404, "message": "Not Found" }` |
| Invalid page/pageSize | 400 | `{ "statusCode": 400, "message": [<errors>] }` |

Error fixtures will be added once legacy error behavior is confirmed
for collection endpoints.

---

## Cross-Cutting Parity Rules

Inherits from `docs/contracts/endpoint-migration-queue.md`:

1. **No sensitive data** — No `passwordHash`, raw tokens, or internal IDs.
2. **Pagination consistency** — All collection endpoints use `page`/`pageSize`.
3. **Timestamp format** — All timestamps are ISO 8601 strings.
4. **Empty collections** — Return `{ items: [], total: 0, ... }`, not 404.
5. **`source` field** — Always present; parity tests accept `"nodebb"` or `"fallback"`.
