# Route Parity Tracker

Tracks which legacy route families have been migrated to Nest controllers.

**Legend:**
- **UNMIGRATED** -- No Nest implementation exists.
- **IN_PROGRESS** -- Nest controller exists but does not reach parity.
- **MIGRATED** -- Nest implementation matches legacy behavior (per acceptance criteria).
- **VERIFIED** -- Parity confirmed by contract tests or manual review.

## Status by Family

| Family       | Status       | Nest Module / Controller | Issue | Notes |
|--------------|--------------|--------------------------|-------|-------|
| AUTH         | UNMIGRATED   |                          |       |       |
| USERS        | UNMIGRATED   |                          |       |       |
| CATEGORIES   | UNMIGRATED   |                          |       |       |
| TOPICS       | UNMIGRATED   |                          |       |       |
| POSTS        | IN_PROGRESS  | PostsModule / PostsController | #128, #185 | 2 of 5 endpoints implemented (detail, replies) |
| MESSAGING    | IN_PROGRESS  | MessagesModule / MessagesController | #180 | 1 of 4 endpoints implemented (list) |
| NOTIFICATIONS| IN_PROGRESS  | NotificationsController (under MessagesModule) | #152 | 1 of 4 endpoints implemented (unread-count) |
| TAGS         | UNMIGRATED   |                          |       |       |
| SEARCH       | UNMIGRATED   |                          |       |       |
| GROUPS       | UNMIGRATED   |                          |       |       |

## Route-Level Detail

When a family moves to IN_PROGRESS or MIGRATED, add per-route detail below.

### AUTH (example format)

| Method | Path                  | Status       | Controller / Handler        |
|--------|-----------------------|--------------|-----------------------------|
| POST   | /api/auth/login       | UNMIGRATED   |                             |
| POST   | /api/auth/register    | UNMIGRATED   |                             |
| POST   | /api/auth/logout      | UNMIGRATED   |                             |
| GET    | /api/auth/me          | UNMIGRATED   |                             |
| POST   | /api/auth/password    | UNMIGRATED   |                             |

> Expand this section for each family as migration begins.

### POSTS

| Method | Path                  | Status       | Controller / Handler        |
|--------|-----------------------|--------------|-----------------------------|
| GET    | /api/posts/:pid       | IMPLEMENTED  | PostsController.getPostDetail (#128) |
| PUT    | /api/posts/:pid       | UNMIGRATED   |                             |
| DELETE | /api/posts/:pid       | UNMIGRATED   |                             |
| POST   | /api/posts/:pid/vote  | UNMIGRATED   |                             |
| POST   | /api/topic/:tid       | IMPLEMENTED  | PostsController.listReplies (#185) |

### MESSAGING

| Method | Path                  | Status       | Controller / Handler        |
|--------|-----------------------|--------------|-----------------------------|
| GET    | /api/messages         | IMPLEMENTED  | MessagesController.listMessages (#180) |
| GET    | /api/messages/:mid    | UNMIGRATED   |                             |
| POST   | /api/messages         | UNMIGRATED   |                             |
| POST   | /api/messages/:mid    | UNMIGRATED   |                             |

### NOTIFICATIONS

| Method | Path                         | Status       | Controller / Handler        |
|--------|------------------------------|--------------|-----------------------------|
| GET    | /api/notifications           | UNMIGRATED   |                             |
| GET    | /api/notifications/unread-count | IMPLEMENTED | NotificationsController.getUnreadCount (#152) |
| PUT    | /api/notifications/:nid      | UNMIGRATED   |                             |
| POST   | /api/notifications/mark-all  | UNMIGRATED   |                             |

## Progress Summary

- **Total families:** 10
- **MIGRATED:** 0
- **IN_PROGRESS:** 3
- **UNMIGRATED:** 7

## How to Update

1. When starting a family, change status to IN_PROGRESS and fill in the Nest module.
2. Reference the implementing issue in the Issue column.
3. When acceptance criteria are met, change to MIGRATED.
4. After contract test verification, change to VERIFIED.
5. Keep the Progress Summary counts in sync.
