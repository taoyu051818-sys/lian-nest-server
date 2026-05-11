# Feed Read-Only Contract

Defines the response DTO contract and parity fixtures for the Feed
module's read-only endpoints. This is the contract companion to the
FeedModule architecture in `docs/architecture/feed-module-contract.md`.

> **Issue:** #73
> **Scope:** Docs/contract and parity fixtures only. No runtime changes.

---

## Endpoints

### 1. `GET /api/feed`

| Field | Value |
|-------|-------|
| **Module** | FeedModule (`src/feed/`) |
| **Auth** | Required (currently hardcoded userId=0, pending JWT merge) |
| **Response pattern** | Paginated list |
| **External deps** | NodeBB topic/post/user providers (via usecases) |
| **AppModule wiring** | Not yet wired (pending Stage 4) |
| **Controller** | `src/feed/feed.controller.ts` — routes defined, usecases are stubs |

**Query params:**

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `page` | integer | 1 | minimum 1 |
| `perPage` | integer | 20 | minimum 1, maximum 50 |

### 2. `GET /api/feed/:feedItemId`

| Field | Value |
|-------|-------|
| **Module** | FeedModule (`src/feed/`) |
| **Auth** | Required (currently hardcoded userId=0) |
| **Response pattern** | Single object |
| **Path params** | `feedItemId` (string) |

---

## Response DTO Contracts

### FeedItemDto

All fields are required. No additional properties allowed.

| Field | Type | Constraints | Source |
|-------|------|-------------|--------|
| `id` | string | — | Feed-specific string identifier |
| `postId` | integer | minimum 1 | NodeBB post ID (`nodebbPid`) |
| `topicId` | integer | minimum 1 | NodeBB topic ID (`nodebbTid`) |
| `title` | string | — | Post title (from PostMeta or NodeBB) |
| `snippet` | string | — | Post content excerpt (from NodeBB) |
| `authorUid` | integer | minimum 1 | NodeBB user ID (from `User.nodebbUid`) |
| `authorUsername` | string | — | Username (from User or NodeBB) |
| `createdAt` | string | format: date-time | ISO 8601 timestamp |

**TypeScript source:** `src/feed/dto/feed-item.dto.ts`

```typescript
export class FeedItemDto {
  id: string;
  postId: number;
  topicId: number;
  title: string;
  snippet: string;
  authorUid: number;
  authorUsername: string;
  createdAt: string;
}
```

### FeedResponseDto

Wraps a paginated list of feed items. All fields are required.

| Field | Type | Constraints |
|-------|------|-------------|
| `items` | FeedItemDto[] | — |
| `totalCount` | integer | minimum 0 |
| `page` | integer | minimum 1 |
| `perPage` | integer | minimum 1, maximum 50 |

**TypeScript source:** `src/feed/dto/feed-item.dto.ts`

```typescript
export class FeedResponseDto {
  items: FeedItemDto[];
  totalCount: number;
  page: number;
  perPage: number;
}
```

### JSON Schema Definitions

Shared `$defs` for use in fixture `bodySchema` validation:

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
    },
    "FeedResponseDto": {
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

---

## Parity Fixtures

Fixture files live in `test/parity/feed/`. Format follows the convention
defined in `docs/contracts/readonly-route-parity-fixtures.md`.

### Fixture Inventory

| Fixture ID | Endpoint | File | Description |
|------------|----------|------|-------------|
| `feed-list-default` | `GET /api/feed` | `feed-list-default.json` | Default pagination (page 1, perPage 20) |
| `feed-list-pagination` | `GET /api/feed` | `feed-list-pagination.json` | Explicit page=2, perPage=5 |
| `feed-item-basic` | `GET /api/feed/:feedItemId` | `feed-item-basic.json` | Single item by ID |

### Shared Schema File

`test/parity/feed/schema.json` contains the `$defs` block above, suitable
for `$ref` resolution by the fixture runner.

---

## Mobile Frontend Required Fields

The LIAN mobile frontend depends on every field in `FeedItemDto`. Missing
any of these breaks the feed card render:

- `id` — used as React key and navigation target
- `postId` / `topicId` — used for deep-link routing to NodeBB
- `title` — displayed as card heading
- `snippet` — displayed as card preview text
- `authorUid` / `authorUsername` — displayed as author attribution
- `createdAt` — displayed as relative time ("2h ago")

The `FeedResponseDto` pagination fields (`totalCount`, `page`, `perPage`)
are required by the infinite-scroll loader.

---

## Error Response Contracts

| Scenario | Status | Body shape |
|----------|--------|------------|
| Feed item not found | 404 | `{ "statusCode": 404, "message": "Not Found" }` |
| Invalid query params | 400 | `{ "statusCode": 400, "message": [<errors>] }` |
| Invalid path param | 400 | `{ "statusCode": 400, "message": "Bad Request" }` |

Error fixtures will be added once legacy error behavior is confirmed and
the usecases are implemented.

---

## Non-Goals

- **No runtime implementation.** This contract does not change any source
  files. The usecases remain stubs.
- **No Prisma changes.** The feed is assembled from PostMeta + NodeBB
  providers at runtime; there is no Feed model in the schema.
- **No AppModule wiring.** FeedModule is not imported into AppModule yet.
  That is a prerequisite tracked separately (AppModule Stage 4).

---

## Failure Policy

Inherits from `docs/contracts/readonly-route-parity-fixtures.md`:

| Failure Type | Severity | Behavior |
|-------------|----------|----------|
| Status code mismatch | BLOCKER | Fail immediately |
| Missing required field | BLOCKER | Fail with diff |
| Type mismatch | BLOCKER | Fail with diff |
| Extra unexpected fields | WARNING | Log only |
| Value range violation | BLOCKER | Fail with diff |
| Request/connection error | BLOCKER | Fail with error |

---

## Validation Commands

```bash
# No unexpected source changes
git diff --check
```

---

## Relationship to Existing Docs

| Document | Relationship |
|----------|-------------|
| `docs/contracts/readonly-route-parity-fixtures.md` | Parent fixture format spec |
| `docs/contracts/endpoint-migration-queue.md` | F1 Feed Contracts section references same DTOs |
| `docs/architecture/feed-module-contract.md` | Full architectural contract for FeedModule |
| `docs/contracts/first-readonly-endpoint-slice.md` | Feed is a backup candidate after health |

---

## Assumptions and TODOs

- **Auth:** The controller currently hardcodes `userId=0`. When JWT auth
  merges (issue #33), fixtures should add auth headers. Tracked as
  `TODO(#33)` in `src/feed/feed.controller.ts`.
- **Seed data:** `feed-item-basic` uses `<FEED_ITEM_ID>` placeholder.
  A seed script is required before this fixture can run against a live app.
- **Snippet length:** The contract does not enforce a max length on
  `snippet`. If the legacy backend truncates at a specific length, that
  constraint should be added here and in the JSON Schema.
