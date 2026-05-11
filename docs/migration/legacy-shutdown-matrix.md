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

1. **Nest controller live** — endpoint registered and responding.
2. **Parity tests green** — integration tests cover acceptance criteria from
   `acceptance-criteria.md` and pass against legacy reference.
3. **No legacy callers** — no frontend or service routes through legacy.
4. **Rollback plan** — documented way to re-enable legacy route on regression.
5. **Tracker updated** — `route-parity-tracker.md` shows `VERIFIED`.

---

## Matrix by Family

### AUTH — Authentication

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| POST | /api/auth/login | A3 | `CONTRACTED` | Slice A3 not implemented |
| POST | /api/auth/register | A4 | `CONTRACTED` | Slice A4 not implemented |
| POST | /api/auth/logout | A5 | `CONTRACTED` | Slice A5 not implemented |
| GET | /api/auth/me | A5 | `IMPLEMENTED` | Parity tests not yet passing |
| POST | /api/auth/password | A5 | `CONTRACTED` | Slice A5 not implemented |

### USERS — User Management

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/users/:uid | U1 | `IMPLEMENTED` | Parity tests not yet passing |
| GET | /api/users/:uid/profile | — | `NOT_STARTED` | No slice defined |
| PUT | /api/users/:uid | — | `NOT_STARTED` | No slice defined |
| GET | /api/users/:uid/posts | U2 | `IMPLEMENTED` | Parity tests not yet passing |
| GET | /api/users/:uid/topics | — | `NOT_STARTED` | No slice defined |

### CATEGORIES — Category/Forum Structure

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/categories | C1 | `IMPLEMENTED` | Parity tests not yet passing |
| GET | /api/categories/:cid | C1 | `IMPLEMENTED` | Parity tests not yet passing |
| GET | /api/categories/:cid/topics | — | `NOT_STARTED` | No slice defined |
| POST | /api/categories/:cid/topics | — | `NOT_STARTED` | No slice defined |

### TOPICS — Topic/Thread Management

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/topic/:tid | T2 | `IMPLEMENTED` | Parity tests not yet passing |
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
| GET | /api/messages | M1 | `IMPLEMENTED` | Parity tests not yet passing |
| GET | /api/messages/:mid | M1 | `CONTRACTED` | Slice M1 not implemented |
| POST | /api/messages | M1 | `CONTRACTED` | Slice M1 not implemented |
| POST | /api/messages/:mid | M1 | `CONTRACTED` | Slice M1 not implemented |
| POST | /api/messages/:mid/read | M1 | `IMPLEMENTED` | Parity tests not yet passing |

### NOTIFICATIONS — User Notifications

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/notifications | N1 | `IMPLEMENTED` | Parity tests not yet passing |
| PUT | /api/notifications/:nid | N1 | `CONTRACTED` | Slice N1 not implemented |
| POST | /api/notifications/mark-all | N1 | `CONTRACTED` | Slice N1 not implemented |

### TAGS — Tag System

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/tags | T1 | `IMPLEMENTED` | Parity tests not yet passing |
| GET | /api/tags/:tag/topics | T1 | `IMPLEMENTED` | Parity tests not yet passing |

### SEARCH — Search

| Method | Path | Slice | Status | Shutdown Blocker |
|--------|------|-------|--------|-----------------|
| GET | /api/search | S1 | `IMPLEMENTED` | Parity tests not yet passing |

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
| `NOT_STARTED` | 9 |
| `CONTRACTED` | 16 |
| `IMPLEMENTED` | 14 |
| `PARITY_TESTED` | 0 |
| `LEGACY_DISABLED` | 0 |
| **Total** | **40** |

---

## How to Update This Matrix

1. Worker begins slice → update endpoints from `CONTRACTED` to `IMPLEMENTED`.
2. Integration tests pass → advance to `PARITY_TESTED`.
3. All family endpoints at `PARITY_TESTED` + shutdown criteria met → advance to
   `LEGACY_DISABLED`. Record in the Shutdown Log below.

---

## Shutdown Log

| Date | Family | Endpoints | Issue | PR | Notes |
|------|--------|-----------|-------|----|-------|
| — | — | — | — | — | No shutdowns yet |

---

> **Note:** Users, Categories, Topics, Tags, Search, Groups are not yet in the
> migration queue — conservatively marked `NOT_STARTED`. Feed endpoints (`/api/feed`)
> are in slice F1 but absent from the legacy route inventory; excluded until confirmed.
> Shutdown is per-endpoint, not per-family.
