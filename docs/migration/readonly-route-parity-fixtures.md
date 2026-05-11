# Read-Only Route Parity Fixtures -- Index

Index of all implemented read-only (GET) endpoints and their parity fixture
status. Companion to `docs/contracts/readonly-route-parity-fixtures.md`
(fixture format and first-slice contracts).

> **Issue:** #242
> **Scope:** Documentation only. No runtime, test, or script changes.

---

## Fixture Index

### Implemented Read-Only Endpoints (14)

All endpoints below have working Nest implementations (not stubs).

| # | Endpoint                                | Module        | Auth     | Pattern        | Fixture Status | Fixture File(s)                              | Impl PR |
|---|-----------------------------------------|---------------|----------|----------------|----------------|----------------------------------------------|---------|
| 1 | `GET /api/health`                       | Health        | Public   | Single object  | DEFINED        | `health-basic.json`                          | —       |
| 2 | `GET /api/feed`                         | Feed          | Public   | Paginated list | DEFINED        | `feed-list-default.json`, `feed-list-pagination.json` | #143 |
| 3 | `GET /api/profile/:uid`                 | Profile       | Public   | Single object  | DEFINED        | `profile-public-basic.json`                  | #126    |
| 4 | `GET /api/profile/:uid/saved`           | Profile       | Public   | Paginated list | MISSING        | —                                            | —       |
| 5 | `GET /api/profile/:uid/liked`           | Profile       | Public   | Paginated list | MISSING        | —                                            | #231    |
| 6 | `GET /api/posts`                        | Posts         | Public   | Paginated list | MISSING        | —                                            | #209    |
| 7 | `GET /api/posts/:postId`                | Posts         | Public   | Single by ID   | MISSING        | —                                            | #128    |
| 8 | `GET /api/posts/:postId/reactions`      | Posts         | Public   | Single object  | MISSING        | —                                            | #233    |
| 9 | `GET /api/posts/:postId/replies`        | Posts         | Public   | Paginated list | MISSING        | —                                            | #185    |
| 10| `GET /api/messages`                     | Messages      | Auth     | Paginated list | MISSING        | —                                            | #180    |
| 11| `GET /api/notifications`                | Notifications | Auth     | Paginated list | MISSING        | —                                            | #127    |
| 12| `GET /api/notifications/unread-count`   | Notifications | Auth     | Single object  | MISSING        | —                                            | #152    |
| 13| `GET /api/categories`                   | Categories    | Public   | List           | MISSING        | —                                            | #232    |
| 14| `GET /api/tags`                         | Tags          | Public   | List           | MISSING        | —                                            | #208    |

### Stub Endpoints (3 -- not yet eligible for fixtures)

These have controller handlers but the underlying usecase throws or returns
empty. Fixtures would only verify error/empty shapes, adding no parity value.

| Endpoint                          | Module  | Stub Reason                                      |
|-----------------------------------|---------|--------------------------------------------------|
| `GET /api/feed/:feedItemId`       | Feed    | `GetFeedItemUsecase` throws Error                |
| `GET /api/profile/:uid/history`   | Profile | `ProfileUsecase.getHistory` throws Error          |
| `GET /api/auth/me`                | Auth    | `CurrentUserUsecase` throws Error                 |

---

## Fixture Coverage Summary

| Metric                       | Count |
|------------------------------|-------|
| Implemented read-only GETs   | 14    |
| Fixtures defined             | 4     |
| Fixtures missing             | 11    |
| Stub endpoints (deferred)    | 3     |
| **Fixture coverage**         | **29%** (4 / 14) |

### Missing Fixtures by Priority

**Public endpoints (no auth dependency):**

| Endpoint                                | Module     | Notes |
|-----------------------------------------|------------|-------|
| `GET /api/posts`                        | Posts      | Paginated list, same shape as feed |
| `GET /api/posts/:postId`                | Posts      | Single object with nested topic |
| `GET /api/posts/:postId/reactions`      | Posts      | Starter shape with zero counts |
| `GET /api/posts/:postId/replies`        | Posts      | Paginated list, filtered from topic |
| `GET /api/profile/:uid/saved`           | Profile    | `ProfileCollection<T>` pattern |
| `GET /api/profile/:uid/liked`           | Profile    | `ProfileCollection<T>` pattern |
| `GET /api/categories`                   | Categories | Flat list of category items |
| `GET /api/tags`                         | Tags       | Flat list of tag items |

**Auth-gated endpoints (require AuthModule):**

| Endpoint                                | Module        | Notes |
|-----------------------------------------|---------------|-------|
| `GET /api/messages`                     | Messages      | Returns empty fallback currently |
| `GET /api/notifications`                | Notifications | Provider-backed list |
| `GET /api/notifications/unread-count`   | Notifications | Single count value |

---

## Fixture Format Summary

Fixtures follow the format defined in `docs/contracts/readonly-route-parity-fixtures.md`:

```jsonc
{
  "id": "string",
  "endpoint": "METHOD /path",
  "description": "string",
  "request": { "method", "path", "query?", "params?", "headers?" },
  "expected": { "status", "contentType", "body", "bodySchema" },
  "notes": "string (optional)"
}
```

Key design decisions:

- **Placeholder tokens** (`<ISO8601>`, `<STRING>`, etc.) for dynamic fields.
  Literal values matched exactly.
- **JSON Schema** in `bodySchema` for structural/type validation independent
  of placeholder resolution.
- **One file per fixture** for granular test execution and clear failures.

---

## Failure Policy

When a parity check fails, the following policy applies:

### 1. Status Code Mismatch

- **Severity:** BLOCKER
- **Action:** Fail the test immediately. Do not diff the body.
- **Example:** Expected 200, got 500.

### 2. Missing Required Field

- **Severity:** BLOCKER
- **Action:** Fail with diff showing which required fields are absent.
- **Example:** `PublicProfile` response missing `joinedAt`.

### 3. Type Mismatch

- **Severity:** BLOCKER
- **Action:** Fail with diff showing expected vs actual types.
- **Example:** `postCount` is a string instead of number.

### 4. Extra Unexpected Fields

- **Severity:** WARNING (not a blocker in first slice)
- **Action:** Log the extra fields. Do not fail.
- **Rationale:** Legacy backends often include undocumented fields. Strict
  rejection comes later once the full contract is frozen.

### 5. Dynamic Value Range Violation

- **Severity:** BLOCKER
- **Action:** Fail if a placeholder constraint is violated.
- **Example:** `uptime` is negative, `page` is 0 when minimum is 1.

### 6. Fixture Load / Request Error

- **Severity:** BLOCKER
- **Action:** Fail with the request error. Do not attempt body comparison.
- **Example:** Connection refused, timeout, malformed fixture JSON.

### Policy Summary

| Failure Type              | Severity | Behavior           |
|---------------------------|----------|--------------------|
| Status code mismatch      | BLOCKER  | Fail immediately   |
| Missing required field    | BLOCKER  | Fail with diff     |
| Type mismatch             | BLOCKER  | Fail with diff     |
| Extra unexpected fields   | WARNING  | Log only           |
| Value range violation     | BLOCKER  | Fail with diff     |
| Request/connection error  | BLOCKER  | Fail with error    |

---

## Seeded Data Requirements

Fixtures that reference specific IDs (`feedItemId`, `uid`) require seeded
test data. The parity test harness must:

1. Seed a known dataset before test runs (via DB migration or seed script).
2. Map placeholder tokens to seeded values at runtime:
   - `<FEED_ITEM_ID>` --> first seeded feed item ID
   - `<USER_UID>` --> first seeded user UID
3. Fail fast if seed data is missing or stale.

The seed strategy is out of scope for this planning PR. It will be defined
in the implementation issue (see Follow-Up Issues below).

---

## Validation Commands

After the implementation PR lands, run:

```bash
# 1. TypeScript compiles
npm run build

# 2. Contract guard passes (if wired)
npm run ops:guard

# 3. Parity fixture runner (to be created)
npm run test:parity -- --fixtures=docs/contracts/fixtures/

# 4. No unexpected source changes
git diff --check
```

---

## Follow-Up Issues

The following issues should be created to track implementation work that
is out of scope for this planning PR:

### Issue A: Implement parity fixture runner

- **Scope:** Create a test harness that loads fixture JSON files, makes HTTP
  requests to the running Nest app, and validates responses against the
  fixture's `expected` block.
- **Dependencies:** This planning doc (fixture format must be finalized).
- **Acceptance:** Runner loads all 6 fixture files, executes requests, and
  reports pass/fail per fixture.

### Issue B: Create seed data for fixture endpoints

- **Scope:** Define seed data (DB migration or script) that populates the
  database with known records so that `<FEED_ITEM_ID>` and `<USER_UID>`
  placeholders can resolve to real values.
- **Dependencies:** Fixture format (this doc), database schema stability.
- **Acceptance:** Seed script creates at least 1 user, 1 feed item, and
  1 health-checkable server state.

### Issue C: Add profile collection fixtures (saved/liked/history)

- **Scope:** Extend fixtures to cover `GET /api/profile/:uid/saved`,
  `/liked`, and `/history` using the `ProfileCollection<T>` pattern.
- **Dependencies:** Issue B (seed data must include collection items).
- **Acceptance:** 3 additional fixture files, all passing.

### Issue D: Add error response fixtures

- **Scope:** Add fixtures for 404 (missing resource) and 400 (invalid params)
  cases for each endpoint. Verify legacy error response shape.
- **Dependencies:** Legacy backend error behavior confirmation.
- **Acceptance:** Error fixtures pass, failure policy enforced.

### Issue E: PostsModule parity fixtures (post-implementation)

- **Scope:** Add parity fixtures for PostsModule endpoints after they are
  implemented (currently stubs throwing `NotImplementedException`).
- **Dependencies:** PostsModule implementation, Issue B (seed data).
- **Acceptance:** Fixture files for all 4 PostsModule GET endpoints.

---

## Relationship to Existing Docs

| Document                                        | Relationship                                    |
|-------------------------------------------------|-------------------------------------------------|
| `docs/contracts/route-inventory.md`             | This plan selects endpoints from that inventory |
| `docs/migration/route-parity-tracker.md`        | Tracker should be updated when fixtures pass    |
| `docs/migration/acceptance-criteria.md`         | Failure policy extends per-family criteria      |
| `docs/migration/route-parity-ci-rollout.md`     | CI rollout can consume fixture runner output    |
| `docs/contracts/readonly-route-parity-fixtures.md` | Companion contract doc (fixture format)      |
