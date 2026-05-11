# Migration Matrix

High-level slice-to-endpoint mapping and dependency overview for the legacy-to-Nest
migration. This document defines the execution order and drives planner task
generation from [route-parity-matrix.md](route-parity-matrix.md).

> **Companion document:** [route-parity-matrix.md](route-parity-matrix.md) contains
> per-endpoint status, contract links, fixture links, and test status.

---

## Slice Dependency Graph

```
A1 (Auth Config + Skeleton)
 └─► A2 (JWT + Guards)
       ├─► A3 (Login)
       │     ├─► A4 (Register + First-Run)
       │     │     └─► A6 (NodeBB Identity Bridge)
       │     └─► A5 (Logout / Me / Password)
       ├─► F1  (Feed: list + item)
       ├─► P1  (Posts: list + detail)
       │     ├─► P2 (Posts: create/update/delete)
       │     ├─► P3 (Posts: reactions)
       │     └─► P4 (Posts: replies)
       ├─► M1  (Messages: send + list + markRead)
       ├─► N1  (Notifications: list + unread + mark)
       └─► PR1 (Profile: public + saved/liked/history)
```

A1 through A6 are serial. All feature slices (F1, P1-P4, M1, N1, PR1) can
proceed in parallel once A2 lands.

---

## Slice-to-Module Matrix

| Slice | Module | Endpoints | Depends On | Parallel OK |
|-------|--------|-----------|------------|-------------|
| A1 | Auth | 0 (skeleton) | — | No |
| A2 | Auth | 0 (guards) | A1 | No |
| A3 | Auth | 1 (login) | A1, A2 | No |
| A4 | Auth | 1 (register) | A3 | Yes (with A5) |
| A5 | Auth | 3 (logout, me, password) | A3 | Yes (with A4) |
| A6 | Auth | 0 (NodeBB bridge) | A4, NodebbModule | No |
| F1 | Feed | 2 | A2 | Yes |
| P1 | Posts | 2 (list, detail) | A2 | Yes |
| P2 | Posts | 3 (create, update, delete) | P1 | Yes (with P3, P4) |
| P3 | Posts | 3 (reactions) | P1 | Yes (with P2, P4) |
| P4 | Posts | 3 (replies) | P1 | Yes (with P2, P3) |
| M1 | Messages | 3 (send, list, markRead) | A2 | Yes |
| N1 | Notifications | 3 (list, unread, mark) | A2 | Yes |
| PR1 | Profile | 4 (public, saved, liked, history) | A2 | Yes |

**Total queued endpoints:** 28 (across 14 slices)
**Unqueued families:** USERS (5), CATEGORIES (4), TOPICS (6), TAGS (2), SEARCH (1), GROUPS (4) = 22 endpoints

---

## Execution Phases

### Phase 1: Auth Foundation (Serial)

| Order | Slice | Endpoints | Status | Blocker |
|-------|-------|-----------|--------|---------|
| 1 | A1 | 0 | CONTRACTED | — |
| 2 | A2 | 0 | CONTRACTED | A1 |
| 3 | A3 | 1 | CONTRACTED | A1, A2 |
| 4 | A4 | 1 | CONTRACTED | A3 |
| 5 | A5 | 3 | CONTRACTED | A3 |
| 6 | A6 | 0 | CONTRACTED | A4, NodebbModule |

**Gate:** A2 must land before any feature slice begins.

### Phase 2: Feature Slices (Parallel)

| Order | Slice | Module | Endpoints | Status |
|-------|-------|--------|-----------|--------|
| 7 | F1 | Feed | 2 | CONTRACTED |
| 8 | P1 | Posts | 2 | CONTRACTED |
| 9 | M1 | Messages | 3 | CONTRACTED |
| 10 | N1 | Notifications | 3 | CONTRACTED |
| 11 | PR1 | Profile | 4 | CONTRACTED |

### Phase 3: Posts Mutation (After P1)

| Order | Slice | Endpoints | Status |
|-------|-------|-----------|--------|
| 12 | P2 | 3 | CONTRACTED |
| 13 | P3 | 3 | CONTRACTED |
| 14 | P4 | 3 | CONTRACTED |

### Phase 4: Unqueued Families (Future)

| Family | Endpoints | Blocked By |
|--------|-----------|------------|
| USERS | 5 | Slice definition |
| CATEGORIES | 4 | Slice definition |
| TOPICS | 6 | Slice definition |
| TAGS | 2 | Slice definition |
| SEARCH | 1 | Slice definition |
| GROUPS | 4 | Slice definition |

---

## Planner Task Generation Rules

Use these rules to derive planner tasks from the route-parity-matrix:

1. **Slice definition task** — For any family with all endpoints at `NOT_STARTED`,
   create a task to define the migration slice (assign slice ID, specify files,
   define parity expectations).

2. **Implementation task** — For any endpoint at `CONTRACTED` whose dependency
   slices are all at `PARITY_TESTED` or higher, create an implementation task.

3. **Fixture creation task** — For any endpoint at `IMPLEMENTED` with no fixture
   defined, create a task to add a parity fixture.

4. **Parity test task** — For any endpoint at `IMPLEMENTED` with a fixture but
   `test_status` of `—` or `FAIL`, create a parity verification task.

5. **Shutdown task** — For any family where all endpoints are at `PARITY_TESTED`
   and shutdown criteria (from legacy-shutdown-matrix.md) are met, create a
   legacy shutdown task.

### Priority Order

1. Auth slices (A1-A6) — gates all feature work
2. Feature slices with fixtures already defined (F1, PR1) — fastest to verify
3. Feature slices without fixtures (P1, M1, N1) — need fixture creation first
4. Posts mutation slices (P2-P4) — depend on P1
5. Unqueued families — need slice definition first

---

## Endpoint Count by Status

| Family | NOT_STARTED | CONTRACTED | IMPLEMENTED | PARITY_TESTED | LEGACY_DISABLED | Total |
|--------|-------------|------------|-------------|---------------|-----------------|-------|
| AUTH | 0 | 5 | 0 | 0 | 0 | 5 |
| USERS | 5 | 0 | 0 | 0 | 0 | 5 |
| CATEGORIES | 4 | 0 | 0 | 0 | 0 | 4 |
| TOPICS | 6 | 0 | 0 | 0 | 0 | 6 |
| POSTS | 0 | 5 | 0 | 0 | 0 | 5 |
| MESSAGING | 0 | 4 | 0 | 0 | 0 | 4 |
| NOTIFICATIONS | 0 | 3 | 0 | 0 | 0 | 3 |
| TAGS | 2 | 0 | 0 | 0 | 0 | 2 |
| SEARCH | 1 | 0 | 0 | 0 | 0 | 1 |
| GROUPS | 4 | 0 | 0 | 0 | 0 | 4 |
| **Total** | **22** | **17** | **0** | **0** | **0** | **39** |

---

## Relationship to Other Documents

| Document | Relationship |
|----------|-------------|
| [route-parity-matrix.md](route-parity-matrix.md) | Per-endpoint detail (this doc is the summary) |
| [endpoint-migration-queue.md](endpoint-migration-queue.md) | Slice definitions and file-level scope |
| [legacy-shutdown-matrix.md](legacy-shutdown-matrix.md) | Shutdown gating criteria |
| [route-parity-tracker.md](route-parity-tracker.md) | Family-level migration status |
| [acceptance-criteria.md](acceptance-criteria.md) | Per-family parity requirements |
