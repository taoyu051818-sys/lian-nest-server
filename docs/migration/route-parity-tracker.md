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
| AUTH         | IN_PROGRESS  | AuthModule / AuthController | #243, #272 | 1 of 5 endpoints implemented (me) |
| USERS        | IN_PROGRESS  | UsersModule / UsersController | #248, #265 | 2 of 5 endpoints implemented (detail, posts) |
| CATEGORIES   | IN_PROGRESS  | CategoriesModule / CategoriesController | #232, #247 | 2 of 4 endpoints implemented (list, detail) |
| TOPICS       | IN_PROGRESS  | TopicsModule / TopicsController | #273 | 1 of 6 endpoints implemented (detail) |
| POSTS        | IN_PROGRESS  | PostsModule / PostsController | #128, #185, #209, #233 | 4 of 7 endpoints implemented (list, detail, reactions, replies) |
| MESSAGING    | IN_PROGRESS  | MessagesModule / MessagesController | #180, #263 | 2 of 4 endpoints implemented (list, markRead) |
| NOTIFICATIONS| IN_PROGRESS  | NotificationsController (under MessagesModule) | #127, #152 | 3 of 4 endpoints implemented (list, unread-count, mark-read) |
| TAGS         | IN_PROGRESS  | TagsModule / TagsController | #208, #250 | 2 of 2 endpoints implemented (list, tag topics) |
| SEARCH       | UNMIGRATED   |                          |       |       |
| GROUPS       | UNMIGRATED   |                          |       |       |
| FEED         | IN_PROGRESS  | FeedModule / FeedController | #143 | 1 of 2 endpoints implemented (list); not in legacy inventory |
| PROFILE      | IN_PROGRESS  | ProfileModule / ProfileController | #126, #231 | 3 of 4 endpoints implemented (public, saved, liked); not in legacy inventory |

## Route-Level Detail

When a family moves to IN_PROGRESS or MIGRATED, add per-route detail below.

### AUTH

| Method | Path                  | Status       | Controller / Handler        |
|--------|-----------------------|--------------|-----------------------------|
| POST   | /api/auth/login       | UNMIGRATED   |                             |
| POST   | /api/auth/register    | UNMIGRATED   |                             |
| POST   | /api/auth/logout      | UNMIGRATED   |                             |
| GET    | /api/auth/me          | IMPLEMENTED  | AuthController.getCurrentUser (#272) |
| POST   | /api/auth/password    | UNMIGRATED   |                             |

### USERS

| Method | Path                  | Status       | Controller / Handler        |
|--------|-----------------------|--------------|-----------------------------|
| GET    | /api/users/:uid       | IMPLEMENTED  | UsersController.getByUid (#248) |
| GET    | /api/users/:uid/profile | UNMIGRATED   |                             |
| PUT    | /api/users/:uid       | UNMIGRATED   |                             |
| GET    | /api/users/:uid/posts | IMPLEMENTED  | UsersController.getPosts (#265) |
| GET    | /api/users/:uid/topics | UNMIGRATED   |                             |

### TOPICS

| Method | Path                  | Status       | Controller / Handler        |
|--------|-----------------------|--------------|-----------------------------|
| GET    | /api/topic/:tid       | IMPLEMENTED  | TopicsController.getByTid (#273) |
| PUT    | /api/topic/:tid       | UNMIGRATED   |                             |
| DELETE | /api/topic/:tid       | UNMIGRATED   |                             |
| POST   | /api/topic/:tid/follow | UNMIGRATED   |                             |
| DELETE | /api/topic/:tid/follow | UNMIGRATED   |                             |
| POST   | /api/topic/:tid/vote  | UNMIGRATED   |                             |

### POSTS

| Method | Path                        | Status       | Controller / Handler        |
|--------|-----------------------------|--------------|-----------------------------|
| GET    | /api/posts                  | IMPLEMENTED  | PostsController.listPosts (#209) |
| GET    | /api/posts/:postId          | IMPLEMENTED  | PostsController.getPostDetail (#128) |
| GET    | /api/posts/:postId/reactions | IMPLEMENTED | PostsController.listReactions (#233) |
| GET    | /api/posts/:postId/replies  | IMPLEMENTED  | PostsController.listReplies (#185) |
| PUT    | /api/posts/:postId          | UNMIGRATED   |                             |
| DELETE | /api/posts/:postId          | UNMIGRATED   |                             |
| POST   | /api/posts/:postId/vote     | UNMIGRATED   |                             |

### MESSAGING

| Method | Path                  | Status       | Controller / Handler        |
|--------|-----------------------|--------------|-----------------------------|
| GET    | /api/messages         | IMPLEMENTED  | MessagesController.listMessages (#180) |
| GET    | /api/messages/:mid    | UNMIGRATED   |                             |
| POST   | /api/messages         | UNMIGRATED   |                             |
| POST   | /api/messages/:mid/read | IMPLEMENTED  | MessagesController.markRead (#263) |

### NOTIFICATIONS

| Method | Path                         | Status       | Controller / Handler        |
|--------|------------------------------|--------------|-----------------------------|
| GET    | /api/notifications           | IMPLEMENTED  | NotificationsController.listNotifications (#127) |
| GET    | /api/notifications/unread-count | IMPLEMENTED | NotificationsController.getUnreadCount (#152) |
| PUT    | /api/notifications/:nid      | UNMIGRATED   |                             |
| POST   | /api/notifications/mark-all  | UNMIGRATED   |                             |

### CATEGORIES

| Method | Path                         | Status       | Controller / Handler        |
|--------|------------------------------|--------------|-----------------------------|
| GET    | /api/categories              | IMPLEMENTED  | CategoriesController.list (#232) |
| GET    | /api/categories/:cid         | IMPLEMENTED  | CategoriesController.getById (#247) |
| GET    | /api/categories/:cid/topics  | UNMIGRATED   |                             |
| POST   | /api/categories/:cid/topics  | UNMIGRATED   |                             |

### TAGS

| Method | Path                         | Status       | Controller / Handler        |
|--------|------------------------------|--------------|-----------------------------|
| GET    | /api/tags                    | IMPLEMENTED  | TagsController.list (#208)  |
| GET    | /api/tags/:tag/topics        | IMPLEMENTED  | TagsController.listTopics (#250) |

### FEED (not in legacy inventory)

| Method | Path                         | Status       | Controller / Handler        |
|--------|------------------------------|--------------|-----------------------------|
| GET    | /api/feed                    | IMPLEMENTED  | FeedController.getFeed (#143) |
| GET    | /api/feed/:feedItemId        | STUB         | FeedController.getFeedItem (usecase throws) |

### PROFILE (not in legacy inventory)

| Method | Path                         | Status       | Controller / Handler        |
|--------|------------------------------|--------------|-----------------------------|
| GET    | /api/profile/:uid            | IMPLEMENTED  | ProfileController.getPublicProfile (#126) |
| GET    | /api/profile/:uid/saved      | IMPLEMENTED  | ProfileController.getSaved  |
| GET    | /api/profile/:uid/liked      | IMPLEMENTED  | ProfileController.getLiked (#231) |
| GET    | /api/profile/:uid/history    | STUB         | ProfileController.getHistory (usecase throws) |

## Progress Summary

- **Total families:** 12
- **MIGRATED:** 0
- **IN_PROGRESS:** 11
- **UNMIGRATED:** 1

## How to Update

1. When starting a family, change status to IN_PROGRESS and fill in the Nest module.
2. Reference the implementing issue in the Issue column.
3. When acceptance criteria are met, change to MIGRATED.
4. After contract test verification, change to VERIFIED.
5. Keep the Progress Summary counts in sync.
