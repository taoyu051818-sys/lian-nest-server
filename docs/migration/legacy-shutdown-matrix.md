# Legacy Shutdown Matrix

Maps every legacy endpoint to its Nest migration status and defines the criteria
required before the legacy backend route can be disabled. Use this as the
authoritative gate for legacy shutdown decisions.

> **Source of truth:** [route-inventory.md](../contracts/route-inventory.md) for
> endpoint definitions, [endpoint-migration-queue.md](endpoint-migration-queue.md)
> for slice assignments, [acceptance-criteria.md](acceptance-criteria.md) for
> per-family parity requirements.

---

## Status Definitions

| Status | Meaning |
|--------|---------|
| `NOT_STARTED` | No Nest slice exists for this endpoint. |
| `CONTRACTED` | Slice defined in the migration queue; work not yet begun. |
| `IMPLEMENTED` | Nest controller handles the endpoint; integration tests not yet passing. |
| `PARITY_TESTED` | Integration tests confirm parity with legacy behavior. |
| `LEGACY_DISABLED` | Legacy route removed or proxy disabled; Nest is the sole handler. |

Progression is linear: `NOT_STARTED` → `CONTRACTED` → `IMPLEMENTED` → `PARITY_TESTED` → `LEGACY_DISABLED`.

---

## Shutdown Criteria

An endpoint may only advance to `LEGACY_DISABLED` when **all** of the following
are true:

1. **Nest controller live** — The endpoint is registered and responding in the
   Nest application.
2. **Parity tests green** — Integration tests cover all acceptance criteria from
   `acceptance-criteria.md` and pass against the legacy backend as reference.
3. **No legacy callers** — No frontend or internal service still routes through
   the legacy backend for this path.
4. **Rollback plan** — A documented way to re-enable the legacy route within
   the same deployment if regression is detected.
5. **Tracker updated** — `route-parity-tracker.md` reflects `VERIFIED` status
   for the endpoint.

---

## Matrix by Family

### AUTH — Authentication

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| POST | /api/auth/login | A3 | `CONTRACTED` | Slice A3 not implemented |
| POST | /api/auth/register | A4 | `CONTRACTED` | Slice A4 not implemented |
| POST | /api/auth/logout | A5 | `CONTRACTED` | Slice A5 not implemented |
| GET | /api/auth/me | A5 | `CONTRACTED` | Slice A5 not implemented |
| POST | /api/auth/password | A5 | `CONTRACTED` | Slice A5 not implemented |

### USERS — User Management

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/users/:uid | — | `NOT_STARTED` | No slice defined |
| GET | /api/users/:uid/profile | — | `NOT_STARTED` | No slice defined |
| PUT | /api/users/:uid | — | `NOT_STARTED` | No slice defined |
| GET | /api/users/:uid/posts | — | `NOT_STARTED` | No slice defined |
| GET | /api/users/:uid/topics | — | `NOT_STARTED` | No slice defined |

### CATEGORIES — Category/Forum Structure

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/categories | — | `NOT_STARTED` | No slice defined |
| GET | /api/categories/:cid | — | `NOT_STARTED` | No slice defined |
| GET | /api/categories/:cid/topics | — | `NOT_STARTED` | No slice defined |
| POST | /api/categories/:cid/topics | — | `NOT_STARTED` | No slice defined |

### TOPICS — Topic/Thread Management

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/topic/:tid | — | `NOT_STARTED` | No slice defined |
| PUT | /api/topic/:tid | — | `NOT_STARTED` | No slice defined |
| DELETE | /api/topic/:tid | — | `NOT_STARTED` | No slice defined |
| POST | /api/topic/:tid/follow | — | `NOT_STARTED` | No slice defined |
| DELETE | /api/topic/:tid/follow | — | `NOT_STARTED` | No slice defined |
| POST | /api/topic/:tid/vote | — | `NOT_STARTED` | No slice defined |

### POSTS — Post/Reply Management

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/posts/:pid | P1 | `CONTRACTED` | Slice P1 not implemented |
| PUT | /api/posts/:pid | P2 | `CONTRACTED` | Slice P2 not implemented |
| DELETE | /api/posts/:pid | P2 | `CONTRACTED` | Slice P2 not implemented |
| POST | /api/posts/:pid/vote | P3 | `CONTRACTED` | Slice P3 not implemented |
| POST | /api/topic/:tid | P4 | `CONTRACTED` | Slice P4 not implemented |

### MESSAGING — Direct Messages

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/messages | M1 | `CONTRACTED` | Slice M1 not implemented |
| GET | /api/messages/:mid | M1 | `CONTRACTED` | Slice M1 not implemented |
| POST | /api/messages | M1 | `CONTRACTED` | Slice M1 not implemented |
| POST | /api/messages/:mid | M1 | `CONTRACTED` | Slice M1 not implemented |

### NOTIFICATIONS — User Notifications

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/notifications | N1 | `CONTRACTED` | Slice N1 not implemented |
| PUT | /api/notifications/:nid | N1 | `CONTRACTED` | Slice N1 not implemented |
| POST | /api/notifications/mark-all | N1 | `CONTRACTED` | Slice N1 not implemented |

### TAGS — Tag System

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/tags | — | `NOT_STARTED` | No slice defined |
| GET | /api/tags/:tag/topics | — | `NOT_STARTED` | No slice defined |

### SEARCH — Search

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/search | — | `NOT_STARTED` | No slice defined |

### GROUPS — Group Management

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/groups | — | `NOT_STARTED` | No slice defined |
| GET | /api/groups/:slug | — | `NOT_STARTED` | No slice defined |
| POST | /api/groups/:slug/join | — | `NOT_STARTED` | No slice defined |
| DELETE | /api/groups/:slug/leave | — | `NOT_STARTED` | No slice defined |

---

## Progress Summary

| Status | Count |
|--------|-------|
| `NOT_STARTED` | 18 |
| `CONTRACTED` | 21 |
| `IMPLEMENTED` | 0 |
| `PARITY_TESTED` | 0 |
| `LEGACY_DISABLED` | 0 |
| **Total** | **39** |

---

## How to Update This Matrix

1. When a worker begins a slice, update affected endpoints from `CONTRACTED` to
   `IMPLEMENTED`.
2. When integration tests pass against legacy reference, advance to
   `PARITY_TESTED`.
3. When all endpoints in a family reach `PARITY_TESTED` and the five shutdown
   criteria above are met, advance to `LEGACY_DISABLED`.
4. Record the date and issue/PR number in the **Shutdown Log** below.

---

## Shutdown Log

| Date | Family | Endpoints | Issue | PR | Notes |
|------|--------|-----------|-------|----|-------|
| — | — | — | — | — | No shutdowns yet |

---

## Assumptions

1. **Users, Categories, Topics, Tags, Search, Groups** are not yet in the
   migration queue. Their endpoints are conservatively marked `NOT_STARTED`.
   When slices are defined for these families, update this matrix accordingly.
2. **Feed endpoints** (`/api/feed`, `/api/feed/:feedItemId`) are tracked in
   slice F1 but not present in the legacy route inventory. They are excluded
   from this matrix until confirmed in the legacy backend.
3. Legacy shutdown is per-endpoint, not per-family. Individual endpoints within
   a family may be disabled independently once their criteria are met.
