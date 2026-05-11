# Read-Only Route Parity Fixtures

Defines the fixture format and expected response contracts for the first
read-only endpoint slice. These fixtures drive future parity tests that
compare Nest responses against legacy backend responses.

> **Scope:** Docs/contract only. No runtime, test, or script changes.

## Fixture Format

Each fixture is a JSON object with this shape:

```jsonc
{
  "id": "string",            // unique fixture id, e.g. "health-basic"
  "endpoint": "GET /api/health",
  "description": "string",   // human-readable purpose
  "request": {
    "method": "GET",
    "path": "/api/health",
    "query": {},              // optional query params
    "params": {},             // optional path params
    "headers": {}             // optional extra headers
  },
  "expected": {
    "status": 200,
    "contentType": "application/json",
    "body": { /* shape contract, see below */ },
    "bodySchema": { /* JSON Schema for structural validation */ }
  },
  "notes": "string"           // optional caveats or dependencies
}
```

### Body Shape Conventions

- Fixture `body` values use placeholder tokens for dynamic fields:
  - `<ISO8601>` -- any valid ISO 8601 timestamp
  - `<UUID>` -- any valid UUID string
  - `<POSITIVE_INT>` -- any positive integer
  - `<NON_NEG_INT>` -- any non-negative integer (includes 0)
  - `<STRING>` -- any non-empty string
  - `<NULLABLE_STRING>` -- string or null
  - `<ARRAY>` -- any array
- Literal values (e.g. `true`, `"healthy"`) are matched exactly.
- `bodySchema` uses JSON Schema to validate types and required fields
  regardless of placeholder values.

### File Naming

```
fixtures/
  health-basic.json
  feed-list-default.json
  feed-list-pagination.json
  feed-item-basic.json
  profile-public-basic.json
```

One file per fixture. Prefix by module, suffix by scenario.

---

## Endpoint Contracts

### 1. GET /api/health

**Source:** `src/health/health.controller.ts`
**Auth:** None (public)
**Query params:** None

#### Fixture: `health-basic`

```jsonc
{
  "id": "health-basic",
  "endpoint": "GET /api/health",
  "description": "Health check returns ok status with timestamp and uptime",
  "request": {
    "method": "GET",
    "path": "/api/health"
  },
  "expected": {
    "status": 200,
    "contentType": "application/json",
    "body": {
      "ok": true,
      "status": "healthy",
      "timestamp": "<ISO8601>",
      "uptime": "<POSITIVE_INT>"
    },
    "bodySchema": {
      "type": "object",
      "required": ["ok", "status", "timestamp", "uptime"],
      "properties": {
        "ok": { "type": "boolean", "const": true },
        "status": { "type": "string" },
        "timestamp": { "type": "string", "format": "date-time" },
        "uptime": { "type": "number", "minimum": 0 }
      },
      "additionalProperties": false
    }
  }
}
```

---

### 2. GET /api/feed

**Source:** `src/feed/feed.controller.ts`
**Auth:** None (currently hardcoded userId=0, pending auth merge)
**Query params:** `page` (int, min 1, default 1), `perPage` (int, 1-50, default 20)

#### Fixture: `feed-list-default`

```jsonc
{
  "id": "feed-list-default",
  "endpoint": "GET /api/feed",
  "description": "Feed list with default pagination returns first page",
  "request": {
    "method": "GET",
    "path": "/api/feed"
  },
  "expected": {
    "status": 200,
    "contentType": "application/json",
    "body": {
      "items": "<ARRAY>",
      "totalCount": "<NON_NEG_INT>",
      "page": 1,
      "perPage": 20
    },
    "bodySchema": {
      "type": "object",
      "required": ["items", "totalCount", "page", "perPage"],
      "properties": {
        "items": {
          "type": "array",
          "items": { "$ref": "#/$defs/FeedItemDto" }
        },
        "totalCount": { "type": "integer", "minimum": 0 },
        "page": { "type": "integer", "minimum": 1 },
        "perPage": { "type": "integer", "minimum": 1, "maximum": 50 }
      },
      "additionalProperties": false
    }
  }
}
```

#### Fixture: `feed-list-pagination`

```jsonc
{
  "id": "feed-list-pagination",
  "endpoint": "GET /api/feed",
  "description": "Feed list with explicit page=2, perPage=5",
  "request": {
    "method": "GET",
    "path": "/api/feed",
    "query": { "page": 2, "perPage": 5 }
  },
  "expected": {
    "status": 200,
    "contentType": "application/json",
    "body": {
      "items": "<ARRAY>",
      "totalCount": "<NON_NEG_INT>",
      "page": 2,
      "perPage": 5
    },
    "bodySchema": {
      "type": "object",
      "required": ["items", "totalCount", "page", "perPage"],
      "properties": {
        "items": {
          "type": "array",
          "items": { "$ref": "#/$defs/FeedItemDto" }
        },
        "totalCount": { "type": "integer", "minimum": 0 },
        "page": { "type": "integer", "const": 2 },
        "perPage": { "type": "integer", "const": 5 }
      },
      "additionalProperties": false
    }
  }
}
```

---

### 3. GET /api/feed/:feedItemId

**Source:** `src/feed/feed.controller.ts`
**Auth:** None (currently hardcoded userId=0)
**Path params:** `feedItemId` (string)

#### Fixture: `feed-item-basic`

```jsonc
{
  "id": "feed-item-basic",
  "endpoint": "GET /api/feed/:feedItemId",
  "description": "Single feed item by ID returns full FeedItemDto",
  "request": {
    "method": "GET",
    "path": "/api/feed/<FEED_ITEM_ID>",
    "params": { "feedItemId": "<FEED_ITEM_ID>" }
  },
  "expected": {
    "status": 200,
    "contentType": "application/json",
    "body": {
      "id": "<FEED_ITEM_ID>",
      "postId": "<POSITIVE_INT>",
      "topicId": "<POSITIVE_INT>",
      "title": "<STRING>",
      "snippet": "<STRING>",
      "authorUid": "<POSITIVE_INT>",
      "authorUsername": "<STRING>",
      "createdAt": "<ISO8601>"
    },
    "bodySchema": {
      "type": "object",
      "required": [
        "id", "postId", "topicId", "title",
        "snippet", "authorUid", "authorUsername", "createdAt"
      ],
      "properties": {
        "id": { "type": "string" },
        "postId": { "type": "integer", "minimum": 1 },
        "topicId": { "type": "integer", "minimum": 1 },
        "title": { "type": "string" },
        "snippet": { "type": "string" },
        "authorUid": { "type": "integer", "minimum": 1 },
        "authorUsername": { "type": "string" },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "additionalProperties": false
    }
  },
  "notes": "FEED_ITEM_ID must reference a valid seeded item during test runs."
}
```

---

### 4. GET /api/profile/:uid

**Source:** `src/profile/profile.controller.ts`
**Auth:** None (public)
**Path params:** `uid` (string)

#### Fixture: `profile-public-basic`

```jsonc
{
  "id": "profile-public-basic",
  "endpoint": "GET /api/profile/:uid",
  "description": "Public profile returns user metadata without sensitive fields",
  "request": {
    "method": "GET",
    "path": "/api/profile/<USER_UID>",
    "params": { "uid": "<USER_UID>" }
  },
  "expected": {
    "status": 200,
    "contentType": "application/json",
    "body": {
      "uid": "<USER_UID>",
      "username": "<STRING>",
      "displayName": "<STRING>",
      "avatar": "<NULLABLE_STRING>",
      "bio": "<NULLABLE_STRING>",
      "postCount": "<NON_NEG_INT>",
      "reputation": "<NON_NEG_INT>",
      "joinedAt": "<ISO8601>"
    },
    "bodySchema": {
      "type": "object",
      "required": [
        "uid", "username", "displayName", "avatar",
        "bio", "postCount", "reputation", "joinedAt"
      ],
      "properties": {
        "uid": { "type": "string" },
        "username": { "type": "string" },
        "displayName": { "type": "string" },
        "avatar": { "type": ["string", "null"] },
        "bio": { "type": ["string", "null"] },
        "postCount": { "type": "integer", "minimum": 0 },
        "reputation": { "type": "integer", "minimum": 0 },
        "joinedAt": { "type": "string", "format": "date-time" }
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
    "FeedItemDto": {
      "type": "object",
      "required": [
        "id", "postId", "topicId", "title",
        "snippet", "authorUid", "authorUsername", "createdAt"
      ],
      "properties": {
        "id": { "type": "string" },
        "postId": { "type": "integer", "minimum": 1 },
        "topicId": { "type": "integer", "minimum": 1 },
        "title": { "type": "string" },
        "snippet": { "type": "string" },
        "authorUid": { "type": "integer", "minimum": 1 },
        "authorUsername": { "type": "string" },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "additionalProperties": false
    }
  }
}
```

---

## Error Response Contracts

When endpoints encounter invalid input or missing resources, fixtures should
also cover error cases:

| Scenario             | Status | Body shape                                       |
|----------------------|--------|--------------------------------------------------|
| Resource not found   | 404    | `{ "statusCode": 404, "message": "Not Found" }` |
| Invalid query params | 400    | `{ "statusCode": 400, "message": [<errors>] }`  |
| Invalid path param   | 400    | `{ "statusCode": 400, "message": "Bad Request" }`|

Error fixtures will be added in the follow-up implementation issue once
legacy error behavior is confirmed.

---

## Missing-Fixture Regression Guard

The `check-route-parity.js` script (`npm run guard:route-parity`) includes a
fixture-file existence check. When the route parity matrix
(`docs/migration/route-parity-matrix.md`) references a fixture file in its
`fixture` column, the guard verifies that the file actually exists on disk.

### Behavior

- **Matrix rows with `—` in the fixture column** are skipped (no fixture claimed).
- **Matrix rows with a fixture link** (e.g. `[topic-detail-basic.json](…)`)
  trigger a file-existence check. The guard resolves the filename under
  `test/parity/` and fails if the file is not found.
- **Exit code 1** if any referenced fixture file is missing.
- **Exit code 0** if all referenced fixtures exist or no fixtures are referenced.

### What counts as a fixture reference

Any non-empty, non-dash value in the `fixture` column of a matrix endpoint row.
Markdown links (`[label](path)`) are parsed to extract the display label as the
filename to search for.

### Why this guard exists

A matrix row that claims `CONTRACTED` or higher status with a fixture link
creates an implicit contract: the fixture file must exist. If a file is deleted
or never created, the matrix row is stale and the parity claim is invalid. This
guard catches that regression early in CI.

### Recovering from a failure

1. If the fixture file was intentionally removed, clear the `fixture` column
   in the matrix row (set to `—`).
2. If the fixture file should exist, create it under `test/parity/<module>/`
   following the format conventions above.
