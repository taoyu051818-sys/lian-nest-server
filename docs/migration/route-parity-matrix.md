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
| GET /api/auth/me | AUTH | A5 | CONTRACTED | [A5 contract](../contracts/endpoint-migration-queue.md#a5--current-user) | — | — | — | NO |
| POST /api/auth/password | AUTH | A5 | CONTRACTED | [A5 contract](../contracts/endpoint-migration-queue.md#a5--change-password) | — | — | — | NO |

### USERS — User Management

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/users/:uid | USERS | — | NOT_STARTED | — | — | — | — | — |
| GET /api/users/:uid/profile | USERS | — | NOT_STARTED | — | — | — | — | — |
| PUT /api/users/:uid | USERS | — | NOT_STARTED | — | — | — | — | — |
| GET /api/users/:uid/posts | USERS | — | NOT_STARTED | — | — | — | — | — |
| GET /api/users/:uid/topics | USERS | — | NOT_STARTED | — | — | — | — | — |

### CATEGORIES — Category/Forum Structure

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/categories | CATEGORIES | — | NOT_STARTED | — | — | — | — | — |
| GET /api/categories/:cid | CATEGORIES | — | NOT_STARTED | — | — | — | — | — |
| GET /api/categories/:cid/topics | CATEGORIES | — | NOT_STARTED | — | — | — | — | — |
| POST /api/categories/:cid/topics | CATEGORIES | — | NOT_STARTED | — | — | — | — | — |

### TOPICS — Topic/Thread Management

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/topic/:tid | TOPICS | — | NOT_STARTED | — | — | — | — | — |
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

### NOTIFICATIONS — User Notifications

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/notifications | NOTIFICATIONS | N1 | CONTRACTED | [N1 contract](../contracts/endpoint-migration-queue.md#n1--notifications-list--unreadcount--markread) | — | — | — | NO |
| GET /api/notifications/unread-count | NOTIFICATIONS | N1 | IMPLEMENTED | [N1 contract](../contracts/endpoint-migration-queue.md#n1--unread-count) | — | [#152](https://github.com/taoyu051818-sys/lian-nest-server/pull/152) | — | NO |
| PUT /api/notifications/:nid | NOTIFICATIONS | N1 | CONTRACTED | [N1 contract](../contracts/endpoint-migration-queue.md#n1--notifications-list--unreadcount--markread) | — | — | — | NO |
| POST /api/notifications/mark-all | NOTIFICATIONS | N1 | CONTRACTED | [N1 contract](../contracts/endpoint-migration-queue.md#n1--notifications-list--unreadcount--markread) | — | — | — | NO |

### TAGS — Tag System

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/tags | TAGS | — | NOT_STARTED | — | — | — | — | — |
| GET /api/tags/:tag/topics | TAGS | — | NOT_STARTED | — | — | — | — | — |

### SEARCH — Search

| endpoint | family | slice | status | contract | fixture | impl_pr | test_status | shutdown_ready |
|----------|--------|-------|--------|----------|---------|---------|-------------|----------------|
| GET /api/search | SEARCH | — | NOT_STARTED | — | — | — | — | — |

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
| `NOT_STARTED` | 22 | 55% |
| `CONTRACTED` | 14 | 35% |
| `IMPLEMENTED` | 4 | 10% |
| `PARITY_TESTED` | 0 | 0% |
| `LEGACY_DISABLED` | 0 | 0% |
| **Total** | **40** | 100% |

| Test Status | Count |
|-------------|-------|
| `—` (no fixture) | 40 |
| `PENDING` | 0 |
| `PASS` | 0 |
| `FAIL` | 0 |

---

## Fixture Coverage

Endpoints with parity fixtures defined (from readonly-route-parity-fixtures.md):

| Endpoint | Fixture File | Slice | Notes |
|----------|-------------|-------|-------|
| GET /api/health | `health-basic.json` | — | Health check, not in legacy inventory |
| GET /api/feed | `feed-list-default.json`, `feed-list-pagination.json` | F1 | Feed not in legacy route inventory |
| GET /api/feed/:feedItemId | `feed-item-basic.json` | F1 | Feed not in legacy route inventory |
| GET /api/profile/:uid | `profile-public-basic.json` | PR1 | Profile not in legacy route inventory |

> **Note:** Feed (`/api/feed`) and Profile (`/api/profile`) endpoints exist in the
> Nest codebase but are absent from the legacy route inventory. They are tracked
> in the migration queue (slices F1, PR1) but excluded from the main matrix above
> until confirmed as legacy equivalents.

---

## Gaps and Known Missing Data

| Gap | Impact | Resolution |
|-----|--------|------------|
| USERS family has no slice | 5 endpoints stuck at NOT_STARTED | Queue slice after A2 lands |
| CATEGORIES family has no slice | 4 endpoints stuck at NOT_STARTED | Queue slice after A2 lands |
| TOPICS family has no slice | 6 endpoints stuck at NOT_STARTED | Queue slice after A2 lands |
| TAGS family has no slice | 2 endpoints stuck at NOT_STARTED | Queue slice after A2 lands |
| SEARCH family has no slice | 1 endpoint stuck at NOT_STARTED | Queue slice after A2 lands |
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
