# ProfileModule Contract

Issue: #36

## Endpoints

| Method | Path                  | Description              |
|--------|-----------------------|--------------------------|
| GET    | `/api/profile/:uid`   | Public profile shape     |
| GET    | `/api/profile/:uid/saved`  | Saved items collection  |
| GET    | `/api/profile/:uid/liked`  | Liked items collection  |
| GET    | `/api/profile/:uid/history`| View history collection |

## DTOs

### PublicProfile
Returned by `GET /api/profile/:uid`.

```typescript
interface PublicProfile {
  uid: string;
  username: string;
  displayName: string;
  avatar: string | null;
  bio: string | null;
  postCount: number;
  reputation: number;
  joinedAt: string;
}
```

### Collection Items
All collection endpoints return `ProfileCollection<T>`:

```typescript
interface ProfileCollection<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
```

- **SavedItem** `{ id, type: 'topic'|'post', targetId, savedAt }`
- **LikedItem** `{ id, type: 'topic'|'post', targetId, likedAt }`
- **HistoryItem** `{ id, type: 'topic'|'post', targetId, viewedAt }`

## Architecture

- `ProfileController` delegates to `ProfileUsecase`.
- `ProfileUsecase` contains all business logic; currently stubbed with `throw new Error('not implemented')`.
- No repository or NodeBB provider wiring yet — all methods are placeholders.

## Follow-ups

1. **NodeBB collection wiring** — Inject `NodebbClient` or specific providers to hydrate saved/liked/history from NodeBB user collections.
2. **Fallback removal** — Once real data flows, remove the `throw new Error('not implemented')` stubs and replace with actual collection queries.
3. **Pagination** — Accept `page`/`pageSize` query params once collection sources are wired.
4. **Authorization** — History/saved/liked should require authentication; public profile is open.
