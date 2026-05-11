# Messages & Notifications Contract

DTO shapes, auth expectations, empty-state behavior, and fallback
observability for Messages and Notifications.

> **Issue:** #76 | **Scope:** Docs/contract + parity fixtures only.
> **NodeBB ownership:** Notifications are NodeBB-owned. Nest proxies
> reads via the NodeBB API; it does not originate notifications.

## Auth Mode

All endpoints require authentication (JWT in `Authorization` header).

| Scenario | Behavior |
|----------|----------|
| Valid JWT | Normal processing |
| Missing/expired JWT | 401 `{ statusCode: 401, error: "Unauthorized", code: "UNAUTHORIZED" }` |
| JWT valid, user lacks NodeBB linkage | 200 with empty payload (graceful degradation) |

Auth user ID is always extracted from JWT `sub` claim, never from
request body or query params.

## Messages

### DTOs

**MessageDto:**

| Field | Type | Notes |
|-------|------|-------|
| `messageId` | string | |
| `fromUid` | positive int | Set from JWT `sub`, never request body |
| `toUid` | positive int | |
| `content` | string | |
| `timestamp` | ISO 8601 | |
| `read` | boolean | |

**MessageListResponseDto:** `{ messages, totalCount, page, perPage }`

### Endpoints

| Method | Path | Request | Response | Notes |
|--------|------|---------|----------|-------|
| `GET` | `/api/messages` | `?page=1&perPage=20` | `MessageListResponseDto` | Only threads where from/to matches JWT sub |
| `GET` | `/api/messages/:mid` | — | `MessageDto` | 404 if not found or not owned |
| `POST` | `/api/messages` | `{ toUid, content, roomId? }` | 201 `MessageDto` | `toUid` and `content` required |
| `POST` | `/api/messages/:mid` | `{ content }` | 201 `MessageDto` | Reply to thread |

**Pagination:** `page` (int, min 1, default 1), `perPage` (int, 1-50, default 20).

## Notifications

> Notifications are generated and stored by NodeBB. Nest reads them
> via the NodeBB API and does not create/mutate/delete records.

### DTOs

**NotificationDto:**

| Field | Type | Notes |
|-------|------|-------|
| `nid` | positive int | NodeBB notification ID |
| `type` | string | e.g. `"mention"`, `"reply"`, `"follow"` |
| `bodyShort` | string | |
| `bodyLong` | string | |
| `fromUid` | positive int | |
| `datetime` | ISO 8601 | |
| `read` | boolean | |

**NotificationListResponseDto:** `{ notifications, totalCount }`
**NotificationUnreadCountDto:** `{ count }`

### Endpoints

| Method | Path | Response | Notes |
|--------|------|----------|-------|
| `GET` | `/api/notifications` | `NotificationListResponseDto` | Newest first. `?page=1&perPage=20` |
| `GET` | `/api/notifications/unread-count` | `NotificationUnreadCountDto` | |
| `PUT` | `/api/notifications/:nid` | `{ ok: true }` | Idempotent |
| `POST` | `/api/notifications/mark-all` | `{ ok: true }` | |

## Empty State

Endpoints return 200 with empty collections, never 404.

| Endpoint | Empty Response |
|----------|---------------|
| `GET /api/messages` | `{ "messages": [], "totalCount": 0, "page": 1, "perPage": 20 }` |
| `GET /api/notifications` | `{ "notifications": [], "totalCount": 0 }` |
| `GET /api/notifications/unread-count` | `{ "count": 0 }` |

## Fallback Observability

When Nest cannot reach the NodeBB notification service:

1. Log a warning with correlation ID and upstream error.
2. Return 200 with empty collection (not 502/503).
3. Include `X-Fallback: true` response header so the client can show
   a "data may be stale" indicator.

## Error Envelope

All errors use `ErrorEnvelope` from `GlobalExceptionFilter`:
`{ statusCode, error, message?, code }`

## Parity Fixtures

Located in `test/parity/messages/`, following the format from
`docs/contracts/readonly-route-parity-fixtures.md`.

| File | Endpoint | Scenario |
|------|----------|----------|
| `message-list-empty.json` | `GET /api/messages` | No messages |
| `message-list-basic.json` | `GET /api/messages` | Paginated list |
| `notification-list-empty.json` | `GET /api/notifications` | No notifications |
| `notification-list-basic.json` | `GET /api/notifications` | Paginated list |
| `notification-unread-count.json` | `GET /api/notifications/unread-count` | Unread count |

## Cross-Cutting Rules

- **Ownership:** Messages — only threads where `fromUid`/`toUid` matches JWT `sub`. Notifications — only for the NodeBB UID linked to JWT `sub`.
- **Idempotency:** Mark-read operations return 200 on re-operation.
- **Timestamps:** All ISO 8601 strings.
- **No sensitive data:** No NodeBB internal UIDs or API tokens in responses.
