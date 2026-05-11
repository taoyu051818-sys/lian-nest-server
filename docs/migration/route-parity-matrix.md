# Route Parity Matrix

Machine-readable endpoint matrix that tracks legacy-to-Nest migration progress.
Each row maps one legacy endpoint to its migration slice, contracts, fixtures,
and shutdown readiness. Use this as the planner source for task generation.

> **Source of truth:** [route-inventory.md](../contracts/route-inventory.md) for
> endpoint definitions, [endpoint-migration-queue.md](endpoint-migration-queue.md)
> for slice definitions, [legacy-shutdown-matrix.md](legacy-shutdown-matrix.md)
> for shutdown gating.

---

## Column Definitions

| Column | Description |
|--------|-------------|
| `endpoint` | HTTP method and path from the legacy route inventory |
| `family` | Route family grouping (AUTH, POSTS, etc.) |
| `slice` | Migration slice ID from the endpoint migration queue (`—` if unqueued) |
| `status` | Migration status: `NOT_STARTED`, `CONTRACTED`, `IMPLEMENTED`, `PARITY_TESTED`, `LEGACY_DISABLED` |
| `contract` | Link to the endpoint contract doc (if defined) |
| `fixture` | Link to the parity fixture file (if defined) |
| `impl_pr` | PR that implemented the Nest controller handler (empty if not started) |
| `test_status` | Parity test result: `—`, `PENDING`, `PASS`, `FAIL` |
| `shutdown_ready` | Whether legacy shutdown criteria are met: `—`, `NO`, `YES` |

Status progression: `NOT_STARTED` -> `CONTRACTED` -> `IMPLEMENTED` -> `PARITY_TESTED` -> `LEGACY_DISABLED`

---

## Matrix

### AUTH — Authentication

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| POST /api/auth/login | AUTH | A3 | CONTRACTED | [A3 contract](../contracts/endpoint-migration-queue.md#a3--login) | — | — | — | NO |
| POST /api/auth/register | AUTH | A4 | CONTRACTED | [A4 contract](../contracts/endpoint-migration-queue.md#a4--register) | — | — | — | NO |
| POST /api/auth/logout | AUTH | A5 | CONTRACTED | [A5 contract](../contracts/endpoint-migration-queue.md#a5--logout) | — | — | — | NO |
| GET /api/auth/me | AUTH | A5 | IMPLEMENTED | [A5 contract](../contracts/endpoint-migration-queue.md#a5--current-user) | — | [#272](https://github.com/taoyu051818-sys/lian-nest-server/pull/272) | — | NO |
| POST /api/auth/password | AUTH | A5 | CONTRACTED | [A5 contract](../contracts/endpoint-migration-queue.md#a5--change-password) | — | — | — | NO |

### USERS — User Management

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/users/:uid | USERS | U1 | IMPLEMENTED | — | — | [#248](https://github.com/taoyu051818-sys/lian-nest-server/pull/248) | — | NO |
| GET /api/users/:uid/profile | USERS | — | NOT_STARTED | — | — | — | — | — |
| PUT /api/users/:uid | USERS | — | NOT_STARTED | — | — | — | — | — |
| GET /api/users/:uid/posts | USERS | U2 | IMPLEMENTED | — | — | [#265](https://github.com/taoyu051818-sys/lian-nest-server/pull/265) | — | NO |
| GET /api/users/:uid/topics | USERS | — | NOT_STARTED | — | — | — | — | — |

### CATEGORIES — Category/Forum Structure

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/categories | CATEGORIES | C1 | IMPLEMENTED | — | — | [#232](https://github.com/taoyu051818-sys/lian-nest-server/pull/232) | — | NO |
| GET /api/categories/:cid | CATEGORIES | C1 | IMPLEMENTED | — | — | [#247](https://github.com/taoyu051818-sys/lian-nest-server/pull/247) | — | NO |
| GET /api/categories/:cid/topics | CATEGORIES | — | NOT_STARTED | — | — | — | — | — |
| POST /api/categories/:cid/topics | CATEGORIES | — | NOT_STARTED | — | — | — | — | — |

### TOPICS — Topic/Thread Management

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/topic/:tid | TOPICS | T2 | IMPLEMENTED | — | [topic-detail-basic.json](../../test/parity/topics/topic-detail-basic.json) | [#273](https://github.com/taoyu051818-sys/lian-nest-server/pull/273) | — | NO |
| PUT /api/topic/:tid | TOPICS | — | NOT_STARTED | — | — | — | — | — |
| DELETE /api/topic/:tid | TOPICS | — | NOT_STARTED | — | — | — | — | — |
| POST /api/topic/:tid/follow | TOPICS | — | NOT_STARTED | — | — | — | — | — |
| DELETE /api/topic/:tid/follow | TOPICS | — | NOT_STARTED | — | — | — | — | — |
| POST /api/topic/:tid/vote | TOPICS | — | NOT_STARTED | — | — | — | — | — |

### POSTS — Post/Reply Management

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/posts/:pid | POSTS | P1 | IMPLEMENTED | [P1 contract](../contracts/endpoint-migration-queue.md#p1--posts-list--detail) | — | [#128](https://github.com/taoyu051818-sys/lian-nest-server/pull/128) | — | NO |
| PUT /api/posts/:pid | POSTS | P2 | CONTRACTED | [P2 contract](../contracts/endpoint-migration-queue.md#p2--posts--create--updatedelete) | — | — | — | NO |
| DELETE /api/posts/:pid | POSTS | P2 | CONTRACTED | [P2 contract](../contracts/endpoint-migration-queue.md#p2--posts--create--updatedelete) | — | — | — | NO |
| POST /api/posts/:pid/vote | POSTS | P3 | CONTRACTED | [P3 contract](../contracts/endpoint-migration-queue.md#p3--posts--reactions) | — | — | — | NO |
| POST /api/topic/:tid | POSTS | P4 | IMPLEMENTED | [P4 contract](../contracts/endpoint-migration-queue.md#p4--posts--replies) | — | [#185](https://github.com/taoyu051818-sys/lian-nest-server/pull/185) | — | NO |

### MESSAGING — Direct Messages

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/messages | MESSAGING | M1 | IMPLEMENTED | [M1 contract](../contracts/endpoint-migration-queue.md#m1--messages-send--list--markread) | — | [#180](https://github.com/taoyu051818-sys/lian-nest-server/pull/180) | — | NO |
| GET /api/messages/:mid | MESSAGING | M1 | CONTRACTED | [M1 contract](../contracts/endpoint-migration-queue.md#m1--messages-send--list--markread) | — | — | — | NO |
| POST /api/messages | MESSAGING | M1 | CONTRACTED | [M1 contract](../contracts/endpoint-migration-queue.md#m1--messages-send--list--markread) | — | — | — | NO |
| POST /api/messages/:mid | MESSAGING | M1 | CONTRACTED | [M1 contract](../contracts/endpoint-migration-queue.md#m1--messages-send--list--markread) | — | — | — | NO |
| POST /api/messages/:mid/read | MESSAGING | M1 | IMPLEMENTED | [M1 contract](../contracts/endpoint-migration-queue.md#m1--messages-send--list--markread) | — | [#263](https://github.com/taoyu051818-sys/lian-nest-server/pull/263) | — | NO |

### NOTIFICATIONS — User Notifications

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/notifications | NOTIFICATIONS | N1 | IMPLEMENTED | [N1 contract](../contracts/endpoint-migration-queue.md#n1--notifications-list--unreadcount--markread) | — | [#127](https://github.com/taoyu051818-sys/lian-nest-server/pull/127) | — | NO |
| GET /api/notifications/unread-count | NOTIFICATIONS | N1 | IMPLEMENTED | [N1 contract](../contracts/endpoint-migration-queue.md#n1--unread-count) | — | [#152](https://github.com/taoyu051818-sys/lian-nest-server/pull/152) | — | NO |
| PUT /api/notifications/:nid | NOTIFICATIONS | N1 | CONTRACTED | [N1 contract](../contracts/endpoint-migration-queue.md#n1--notifications-list--unreadcount--markread) | — | — | — | NO |
| POST /api/notifications/mark-all | NOTIFICATIONS | N1 | CONTRACTED | [N1 contract](../contracts/endpoint-migration-queue.md#n1--notifications-list--unreadcount--markread) | — | — | — | NO |

### TAGS — Tag System

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/tags | TAGS | T1 | IMPLEMENTED | — | — | [#208](https://github.com/taoyu051818-sys/lian-nest-server/pull/208) | — | NO |
| GET /api/tags/:tag/topics | TAGS | T1 | IMPLEMENTED | — | — | [#250](https://github.com/taoyu051818-sys/lian-nest-server/pull/250) | — | NO |

### SEARCH — Search

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/search | SEARCH | S1 | IMPLEMENTED | — | — | [#304](https://github.com/taoyu051818-sys/lian-nest-server/pull/304) | — | NO |

### GROUPS — Group Management

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/groups | GROUPS | — | NOT_STARTED | — | — | — | — | — |
| GET /api/groups/:slug | GROUPS | — | NOT_STARTED | — | — | — | — | — |
| POST /api/groups/:slug/join | GROUPS | — | NOT_STARTED | — | — | — | — | — |
| DELETE /api/groups/:slug/leave | GROUPS | — | NOT_STARTED | — | — | — | — | — |

---

## Progress Summary

| Status | Count | Percentage |
|--------|-------|------------|
| `NOT_STARTED` | 10 | 24% |
| `CONTRACTED` | 14 | 34% |
| `IMPLEMENTED` | 17 | 41% |
| `PARITY_TESTED` | 0 | 0% |
| `LEGACY_DISABLED` | 0 | 0% |
| **Total** | **41** | 100% |

| Test Status | Count |
|-------------|-------|
| `—` (no fixture) | 41 |
| `PENDING` | 0 |
| `PASS` | 0 |
| `FAIL` | 0 |

---

## Fixture Coverage

Full index: [readonly-route-parity-fixtures.md](readonly-route-parity-fixtures.md)

### Fixtures Defined (4)

| Endpoint | Fixture File | Slice | Notes |
|----------|-------------|-------|-------|
| GET /api/health | `health-basic.json` | — | Health check, not in legacy inventory |
| GET /api/feed | `feed-list-default.json`, `feed-list-pagination.json` | F1 | Feed not in legacy route inventory |
| GET /api/feed/:feedItemId | `feed-item-basic.json` | F1 | Feed not in legacy route inventory (stub, fixture deferred) |
| GET /api/profile/:uid | `profile-public-basic.json` | PR1 | Profile not in legacy route inventory |

### Implemented Endpoints Missing Fixtures (11)

| Endpoint | Module | Auth | Notes |
|----------|--------|------|-------|
| GET /api/profile/:uid/saved | Profile | Public | `ProfileCollection<T>` pattern |
| GET /api/profile/:uid/liked | Profile | Public | `ProfileCollection<T>` pattern |
| GET /api/posts | Posts | Public | Paginated list (#209) |
| GET /api/posts/:postId | Posts | Public | Single object (#128) |
| GET /api/posts/:postId/reactions | Posts | Public | Starter shape (#233) |
| GET /api/posts/:postId/replies | Posts | Public | Paginated list (#185) |
| GET /api/messages | Messages | Auth | Empty fallback (#180) |
| GET /api/notifications | Notifications | Auth | Provider-backed (#127) |
| GET /api/notifications/unread-count | Notifications | Auth | Count value (#152) |
| GET /api/categories | Categories | Public | Flat list (#232) |
| GET /api/tags | Tags | Public | Flat list (#208) |

### Coverage Summary

| Metric | Count |
|--------|-------|
| Implemented read-only GETs | 15 |
| Fixtures defined | 4 |
| Fixtures missing | 12 |
| **Coverage** | **29%** |

> **Note:** Feed (`/api/feed`) and Profile (`/api/profile`) endpoints exist in the
> Nest codebase but are absent from the legacy route inventory. They are tracked
> in the migration queue (slices F1, PR1) but excluded from the main matrix above
> until confirmed as legacy equivalents.

---

## Gaps and Known Missing Data

| Gap | Impact | Resolution |
|-----|--------|------------|
| USERS family has no slice | 3 endpoints stuck at NOT_STARTED | Queue slice after A2 lands |
| CATEGORIES family has no slice | 4 endpoints stuck at NOT_STARTED | Queue slice after A2 lands |
| TOPICS family has no slice | 5 endpoints stuck at NOT_STARTED | Queue slice after A2 lands |
| TAGS family has no slice | 2 endpoints stuck at NOT_STARTED | Queue slice after A2 lands |
| GROUPS family has no slice | 4 endpoints stuck at NOT_STARTED | Queue slice after A2 lands |
| No parity fixtures for contracted slices | Cannot verify parity until fixtures exist | Create fixtures per slice during implementation |
| Feed/Profile not in legacy inventory | Unclear if these are new or legacy equivalents | Confirm with legacy backend route dump |

---

## How to Update This Matrix

1. **New slice defined** — Update `slice` column from `—` to the slice ID, set `status` to `CONTRACTED`.
2. **Implementation PR merged** — Set `impl_pr` to the PR number/link, advance `status` to `IMPLEMENTED`.
3. **Fixture created** — Add fixture file link to `fixture` column.
4. **Parity test passes** — Set `test_status` to `PASS`, advance `status` to `PARITY_TESTED`.
5. **Legacy shutdown approved** — Set `shutdown_ready` to `YES`, advance `status` to `LEGACY_DISABLED`.
6. **Keep Progress Summary counts in sync** after any status change.

---

## Relationship to Other Documents

| Document | Relationship |
|----------|-------------|
| [route-inventory.md](../contracts/route-inventory.md) | Endpoint definitions (source of truth for paths) |
| [legacy-shutdown-matrix.md](legacy-shutdown-matrix.md) | Shutdown gating criteria and blocker tracking |
| [endpoint-migration-queue.md](endpoint-migration-queue.md) | Slice definitions and execution order |
| [route-parity-tracker.md](route-parity-tracker.md) | Family-level migration status |
| [acceptance-criteria.md](acceptance-criteria.md) | Per-family parity requirements |
| [readonly-route-parity-fixtures.md](../contracts/readonly-route-parity-fixtures.md) | Fixture format and first-slice contracts |
| [migration-matrix.md](migration-matrix.md) | High-level slice dependency and execution overview |
