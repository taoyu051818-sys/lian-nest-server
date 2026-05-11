# First Read-Only Endpoint Implementation Slice — Migration Plan

Plans the first endpoint implementation slice for fixture-based parity
verification. This is the migration companion to
`docs/contracts/first-readonly-endpoint-slice.md`.

> **Issue:** #58
> **Scope:** Planning doc only. No runtime, test, or script changes in this PR.

---

## Decision: `GET /api/health` as Primary Endpoint

After auditing all read-only endpoints across the Nest codebase,
`GET /api/health` is the only viable candidate for the first slice.

### Audit Results

| Endpoint | Controller | Usecase | AppModule | Verdict |
|----------|-----------|---------|-----------|---------|
| `GET /api/health` | Implemented | Inline (no separate class) | Wired | **Ready** |
| `GET /api/feed` | Scaffolded | Stub (throws) | Not wired | Blocked |
| `GET /api/feed/:feedItemId` | Scaffolded | Stub (throws) | Not wired | Blocked |
| `GET /api/profile/:uid` | Scaffolded | Stub (throws) | Not wired | Blocked |

### Why Not Feed or Profile?

Both Feed and Profile modules share the same blocker chain:

1. **AppModule composition not done.** Only `ConfigModule` and
   `HealthModule` are imported in `AppModule`. FeedModule and
   ProfileModule exist in the source tree but are not registered.
   Wiring them requires completing AppModule Stages 1–4
   (`docs/migration/app-module-composition-plan.md`).

2. **Usecases are stubs.** `GetFeedUsecase.execute()` and
   `ProfileUsecase.getPublicProfile()` unconditionally throw
   `"not implemented"`. Even if wired into AppModule, the endpoints
   would return 500 errors, not valid parity data.

3. **Data source dependency.** Both modules need either NodeBB API
   access (via NodebbModule providers) or seeded database records
   to return meaningful responses. Neither is available today.

4. **Seed data required.** Fixtures reference `<FEED_ITEM_ID>` and
   `<USER_UID>` placeholders that need seeded test data. No seed
   strategy exists yet.

### Why `GET /api/health` Is Lowest Risk

| Risk Factor | Assessment |
|-------------|-----------|
| External dependencies | None — pure in-process computation |
| Database required | No |
| Redis required | No |
| NodeBB required | No |
| Auth required | No |
| Stub usecases | None — controller logic is inline |
| AppModule wiring | Already done — HealthModule is imported |
| Error paths | None under normal operation |
| Seed data | Not needed — no dynamic IDs |

---

## Implementation Steps

This slice has two parts: the fixture file (this docs-only PR) and the
fixture runner integration (follow-up Issue A).

### Step 1: Create Fixture File (This PR)

**File:** `docs/contracts/fixtures/health-basic.json`

Create the fixture JSON file matching the contract in
`docs/contracts/first-readonly-endpoint-slice.md`. No source changes.

### Step 2: Verify Fixture Validity (Manual)

Before the fixture runner exists, manually verify the contract:

```bash
# Start the Nest app
npm run start:dev

# In another terminal, hit the endpoint
curl -s http://localhost:3000/api/health | jq .
```

Expected output:

```json
{
  "ok": true,
  "status": "healthy",
  "timestamp": "2026-05-11T...",
  "uptime": 1.234
}
```

Verify all 4 fields are present and match the fixture contract types.

### Step 3: Integrate with Fixture Runner (Issue A — Follow-Up)

Once the fixture runner is implemented (see Follow-Up Issues below),
run:

```bash
npm run test:parity -- --fixtures=docs/contracts/fixtures/health-basic.json
```

This validates the full fixture contract programmatically.

---

## Prerequisites

### Is AppModule Composition a Prerequisite?

**No.** HealthModule is already wired in AppModule. The current
`app.module.ts` imports `[ConfigModule, HealthModule]`, which is
sufficient for the health endpoint.

AppModule composition stages (1–5) are prerequisites for the *next*
endpoints (Feed, Profile), not for this one.

### Dependency Map

```
docs/contracts/readonly-route-parity-fixtures.md (fixture format spec)
  └─► docs/contracts/first-readonly-endpoint-slice.md (this contract)
        └─► docs/contracts/fixtures/health-basic.json (fixture file — this PR)
              └─► Issue A: Parity fixture runner (follow-up)
                    └─► npm run test:parity (automated validation)
```

---

## Validation Commands

For this docs-only PR:

```bash
# No source changes — only docs
git diff --check
```

For the follow-up implementation:

```bash
# 1. TypeScript compiles
npm run build

# 2. Existing tests pass
npm run test

# 3. Contract guard passes
npm run ops:guard

# 4. Parity fixture runner (Issue A)
npm run test:parity -- --fixtures=docs/contracts/fixtures/health-basic.json
```

---

## Done Criteria

### This PR (Docs-Only)

- [x] Primary endpoint selected: `GET /api/health`
- [x] Backup candidates identified with blockers documented
- [x] Response contract defined with fixture JSON
- [x] Validation commands specified
- [x] Prerequisite assessment (AppModule: not needed for health)
- [ ] Contract doc merged: `docs/contracts/first-readonly-endpoint-slice.md`
- [ ] Migration doc merged: `docs/migration/first-readonly-endpoint-slice.md`

### Follow-Up (Implementation)

- [ ] Fixture file created: `docs/contracts/fixtures/health-basic.json`
- [ ] Fixture runner (Issue A) can execute health fixture
- [ ] `npm run test:parity` passes for health endpoint
- [ ] `npm run build` succeeds
- [ ] `npm run test` passes

---

## Follow-Up Issues

These issues should be created to unblock the next endpoints:

### Issue A: Implement Parity Fixture Runner

- **Scope:** Test harness that loads fixture JSON, makes HTTP requests
  to the running Nest app, validates responses against `expected` block.
- **Blocks:** All fixture-based parity testing.
- **Blocked by:** This planning doc (fixture format finalized).

### Issue B: Create Seed Data for Fixture Endpoints

- **Scope:** Seed script or DB migration that populates test data so
  `<FEED_ITEM_ID>` and `<USER_UID>` placeholders resolve to real values.
- **Blocks:** Feed and Profile fixture execution.
- **Blocked by:** Database schema stability.

### Issue C: AppModule Stage 4 — Wire Feature Modules

- **Scope:** Import FeedModule, PostsModule, ProfileModule,
  MessagesModule into AppModule.
- **Blocks:** Feed and Profile endpoint testing.
- **Blocked by:** `docs/migration/app-module-composition-plan.md`
  Stages 1–3.

### Issue D: Implement Feed Usecases

- **Scope:** Replace stub `throw` in `GetFeedUsecase` and
  `GetFeedItemUsecase` with real data fetching (NodeBB or seed data).
- **Blocks:** Feed parity fixtures.
- **Blocked by:** Issue C (AppModule wiring), Issue B (seed data).

### Issue E: Implement Profile Usecase

- **Scope:** Replace stub `throw` in `ProfileUsecase.getPublicProfile()`
  with real data fetching.
- **Blocks:** Profile parity fixtures.
- **Blocked by:** Issue C (AppModule wiring), Issue B (seed data).

---

## Next Endpoint Sequence

After `GET /api/health` parity is verified, the recommended order for
subsequent endpoints:

| Order | Endpoint | Prerequisites | Estimated Effort |
|-------|----------|--------------|-----------------|
| 1 | `GET /api/health` | None (this slice) | Done |
| 2 | `GET /api/feed` | AppModule Stage 4, Feed usecase impl, seed data | Medium |
| 3 | `GET /api/feed/:feedItemId` | Same as #2 | Low (same module) |
| 4 | `GET /api/profile/:uid` | AppModule Stage 4, Profile usecase impl, seed data | Medium |

Feed and Profile can proceed in parallel once their shared prerequisites
(AppModule Stage 4, seed data) are resolved.

---

## Relationship to Existing Docs

| Document | Relationship |
|----------|-------------|
| `docs/contracts/first-readonly-endpoint-slice.md` | Companion contract doc (response shape, fixture) |
| `docs/contracts/readonly-route-parity-fixtures.md` | Parent fixture format spec |
| `docs/migration/readonly-route-parity-fixtures.md` | Parent migration plan (4 endpoints) — this doc narrows to 1 |
| `docs/migration/app-module-composition-plan.md` | Health needs no stages; Feed/Profile need Stage 4 |
| `docs/migration/endpoint-migration-queue.md` | Health is pre-queue (foundational) |
| `docs/migration/route-parity-tracker.md` | Update when health fixture passes |
