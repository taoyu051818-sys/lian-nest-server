# Route Migration Acceptance Criteria

Defines what "done" means when migrating a legacy route family to Nest.

## Global Criteria (all families)

Every route MUST satisfy ALL of these before marking as MIGRATED:

1. **Path parity** -- Nest route path matches the legacy path (or is explicitly aliased).
2. **Method parity** -- HTTP methods (GET/POST/PUT/DELETE) match.
3. **Auth enforcement** -- Protected routes require authentication; public routes do not.
4. **Response shape** -- Response JSON structure matches legacy (field names, nesting, types).
5. **Error responses** -- Error codes and messages match legacy for known error paths (400, 401, 403, 404).
6. **Pagination** -- Paginated endpoints use the same pagination contract (limit, start, page count).
7. **Validation** -- Input validation rules match (required fields, field types, length constraints).

## Per-Family Criteria

### AUTH

- Login returns a valid session/token on success.
- Registration creates a user with the expected default fields.
- Logout invalidates the session.
- `/me` returns the authenticated user's profile.
- Password change requires current password verification.

### USERS

- User lookup by UID returns the same profile shape.
- Profile includes custom fields and joined date.
- Update respects owner-or-admin authorization.
- User posts/topics are paginated with correct sort order.

### CATEGORIES

- Category list returns the full hierarchy.
- Single category includes metadata (description, icon, topic count).
- Topics within a category are paginated.
- Creating a topic in a category applies correct permissions.

### TOPICS

- Topic view returns title, posts (paginated), and metadata.
- Topic update only allowed for owner or moderator.
- Soft-delete marks topic as deleted without removing data.
- Follow/unfollow changes the user's notification subscription.
- Voting updates the topic's vote count correctly.

### POSTS

- Single post returns body, author, timestamp, and edit history.
- Edit only allowed for the post owner.
- Soft-delete only allowed for moderators.
- Voting is idempotent (double-vote does not double-count).
- Reply creation appends to the topic's post list.

### MESSAGING

- Message list returns thread summaries with last message preview.
- Single thread returns full message history.
- Sending creates a new thread or appends to existing.
- Only thread participants can view messages.

### NOTIFICATIONS

- Notification list returns user's notifications, newest first.
- Mark-as-read updates the notification state.
- Mark-all-as-read updates all unread notifications.

### TAGS

- Tag list returns all tags with usage counts.
- Topics filtered by tag are paginated and sorted by activity.

### SEARCH

- Search returns results across topics and posts.
- Results are ranked by relevance.
- Search supports at minimum the `term` query parameter.

### GROUPS

- Group list shows public and user-joined groups.
- Single group shows members and metadata.
- Join/leave updates group membership.

## Sign-Off Checklist

For each family, before marking MIGRATED:

- [ ] All routes in the family have a Nest controller handler.
- [ ] Response shapes verified against legacy (manual or snapshot).
- [ ] Auth guards applied correctly.
- [ ] Error responses match legacy behavior.
- [ ] Pagination contract matches.
- [ ] Input validation matches.
- [ ] Route parity tracker updated to MIGRATED.
