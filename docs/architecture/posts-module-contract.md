# PostsModule Contract

> Skeleton contract for `src/posts/**`. All endpoints throw `NotImplementedException`.

## Endpoints

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| `GET` | `/api/posts` | `listPosts` | Paginated post list |
| `GET` | `/api/posts/:postId` | `getPostDetail` | Single post with reactions + reply count |
| `POST` | `/api/posts` | `createPost` | Create a new post |
| `PUT` | `/api/posts/:postId` | `updatePost` | Edit post content |
| `DELETE` | `/api/posts/:postId` | `deletePost` | Soft-delete a post |
| `GET` | `/api/posts/:postId/reactions` | `listReactions` | Aggregated reaction counts |
| `POST` | `/api/posts/:postId/reactions` | `addReaction` | Add or toggle a reaction |
| `DELETE` | `/api/posts/:postId/reactions/:reactionType` | `removeReaction` | Remove a specific reaction |
| `GET` | `/api/posts/:postId/replies` | `listReplies` | Paginated replies for a post |
| `POST` | `/api/posts/:postId/replies` | `createReply` | Add a reply to a post |
| `DELETE` | `/api/posts/:postId/replies/:replyId` | `deleteReply` | Delete a reply |

## DTOs (types.ts)

- **PostAuthor** — `{ id, username, avatarUrl? }`
- **PostReactionSummary** — `{ type: PostReactionType, count, reactedByMe }`
- **PostReply** — `{ id, postId, author, content, createdAt, updatedAt? }`
- **PostDetail** — `{ id, author, content, createdAt, updatedAt?, reactionCounts, replyCount }`
- **PostListItem** — `{ id, author, content, createdAt, replyCount }`
- **PostPaginatedList** — `{ items: PostListItem[], totalCount, page, perPage }`

### Request DTOs

- **CreatePostBody** — `{ content }`
- **UpdatePostBody** — `{ content }`
- **CreateReactionBody** — `{ type: PostReactionType }`
- **CreateReplyBody** — `{ content }`
- **ListPostsQuery** — `{ page?, perPage? }`
- **ListRepliesQuery** — `{ page?, perPage? }`

## Architecture Notes

- `PostsController` delegates to `PostsService` (use-case layer).
- `PostsService` will eventually inject repository and NodeBB client dependencies.
- Module exports `PostsService` so other modules can call post use-cases directly.
- No NodeBB calls, database access, or Redis usage in this skeleton.

## Follow-ups

1. **Post detail** — Wire `PostsService.getPostDetail` to `NodebbPostsProvider` + `PostMetadataRepository`.
2. **Create post** — Implement content validation, NodeBB topic creation, metadata persistence.
3. **Reactions** — Implement reaction storage (NodeBB or local DB) and aggregation logic.
4. **Replies** — Wire reply CRUD to NodeBB post endpoints with local caching.
5. **Auth guards** — Add `@UseGuards` once `AuthModule` is integrated.
6. **Pagination** — Validate and normalize `page`/`perPage` with defaults.
