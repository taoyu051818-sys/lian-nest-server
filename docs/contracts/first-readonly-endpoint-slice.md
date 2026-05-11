# First Read-Only Endpoint Implementation Slice — Contract

Selects and defines the contract for the first endpoint to receive
fixture-based parity verification. This is the contract companion to
`docs/migration/first-readonly-endpoint-slice.md`.

> **Issue:** #58
> **Scope:** Docs/contract only. No runtime, test, or script changes.

---

## Endpoint Selection

### Primary: `GET /api/health`

| Field | Value |
|-------|-------|
| **Module** | HealthModule (`src/health/`) |
| **Auth** | None (public) |
| **Response pattern** | Single object |
| **External deps** | None |
| **AppModule wiring** | Already wired (Stage 0 — no migration needed) |
| **Usecase** | Inline in controller (no separate usecase class) |
| **Controller** | `src/health/health.controller.ts` — fully implemented |
| **Risk** | Lowest possible — no stubs, no NodeBB, no DB, no Redis |

**Why this endpoint first:**

1. It is the only endpoint that is fully implemented AND registered in
   AppModule today. All other candidates (Feed, Profile) have stub
   usecases that throw and are not imported into AppModule.
2. Zero external dependencies — no database, no Redis, no NodeBB.
3. Validates the entire fixture-parity toolchain end-to-end on the
   simplest possible case before tackling endpoints with real data
   dependencies.
4. Covers the "single object" response pattern, which is the most
   common pattern across the route inventory.

### Backup Candidates

These endpoints are not ready for the first slice but should be the
next targets once their blockers are resolved:

| # | Endpoint | Module | Blocker |
|---|----------|--------|---------|
| 1 | `GET /api/feed` | Feed | Usecase is a stub (throws). Not wired in AppModule. Requires AppModule Stage 4 + usecase implementation (needs NodeBB topic provider or seed data). |
| 2 | `GET /api/feed/:feedItemId` | Feed | Same as above. Additionally requires seed data for `<FEED_ITEM_ID>` placeholder. |
| 3 | `GET /api/profile/:uid` | Profile | Usecase is a stub (throws). Not wired in AppModule. Requires AppModule Stage 4 + usecase implementation (needs NodeBB user provider). |

All three backup candidates share the same prerequisite chain:

```
AppModule Stage 4 (wire feature modules)
  └─► Usecase implementation (replace stubs with real data fetching)
        └─► Seed data for placeholder resolution
```

See `docs/migration/app-module-composition-plan.md` for Stage 4 details.

---

## Response Contract: `GET /api/health`

### Source

`src/health/health.controller.ts` — `HealthController.check()`

### Response Shape

```jsonc
{
  "ok": true,
  "status": "healthy",
  "timestamp": "<ISO8601>",   // new Date().toISOString()
  "uptime": "<POSITIVE_INT>"  // process.uptime()
}
```

### Fixture: `health-basic`

```jsonc
{
  "id": "health-basic",
  "endpoint": "GET /api/health",
  "description": "Health check returns ok status with timestamp and uptime",
  "request": {
    "method": "GET",
    "path": "/api/health"
  },
  "expected": {
    "status": 200,
    "contentType": "application/json",
    "body": {
      "ok": true,
      "status": "healthy",
      "timestamp": "<ISO8601>",
      "uptime": "<POSITIVE_INT>"
    },
    "bodySchema": {
      "type": "object",
      "required": ["ok", "status", "timestamp", "uptime"],
      "properties": {
        "ok": { "type": "boolean", "const": true },
        "status": { "type": "string" },
        "timestamp": { "type": "string", "format": "date-time" },
        "uptime": { "type": "number", "minimum": 0 }
      },
      "additionalProperties": false
    }
  }
}
```

### Fixture File Location

```
docs/contracts/fixtures/health-basic.json
```

### Field-Level Parity Rules

| Field | Type | Constraint | Notes |
|-------|------|------------|-------|
| `ok` | boolean | must be `true` | Literal match |
| `status` | string | must be `"healthy"` | Literal match |
| `timestamp` | string | ISO 8601 date-time | Placeholder `<ISO8601>` — validated by JSON Schema `format: date-time` |
| `uptime` | number | `>= 0` | Placeholder `<POSITIVE_INT>` — validated by JSON Schema `minimum: 0` |

### Error Response Contract

This endpoint does not produce error responses under normal operation.
It has no path params, no query params, and no request body. Error
fixtures (e.g., method not allowed) are deferred to the follow-up
error response issue (Issue D from the parity fixture plan).

---

## Failure Policy

Inherits the failure policy from `docs/migration/readonly-route-parity-fixtures.md`:

| Failure Type | Severity | Behavior |
|-------------|----------|----------|
| Status code mismatch | BLOCKER | Fail immediately |
| Missing required field | BLOCKER | Fail with diff |
| Type mismatch | BLOCKER | Fail with diff |
| Extra unexpected fields | WARNING | Log only |
| Value range violation | BLOCKER | Fail with diff |
| Request/connection error | BLOCKER | Fail with error |

---

## Validation Commands

After the implementation PR lands:

```bash
# 1. TypeScript compiles
npm run build

# 2. Contract guard passes
npm run ops:guard

# 3. Parity fixture runner (to be created — Issue A from parity plan)
npm run test:parity -- --fixtures=docs/contracts/fixtures/health-basic.json

# 4. No unexpected source changes in this docs-only PR
git diff --check
```

---

## Done Criteria

This contract slice is complete when:

- [ ] Fixture file `docs/contracts/fixtures/health-basic.json` exists and
      matches the contract defined above
- [ ] Fixture runner (Issue A) can load and execute this fixture against
      a running Nest app
- [ ] `GET /api/health` returns 200 with all 4 required fields
- [ ] Response body passes JSON Schema validation
- [ ] `npm run build` succeeds (no source changes expected in this PR)
- [ ] No regressions in existing tests (`npm run test`)

---

## Relationship to Existing Docs

| Document | Relationship |
|----------|-------------|
| `docs/contracts/readonly-route-parity-fixtures.md` | Parent fixture format spec — this contract is a subset |
| `docs/migration/readonly-route-parity-fixtures.md` | Parent migration plan — this slice is the first concrete execution |
| `docs/migration/endpoint-migration-queue.md` | Health endpoint not in queue (pre-queue, foundational) |
| `docs/migration/app-module-composition-plan.md` | HealthModule is already wired (no stage needed) |
| `docs/migration/route-parity-tracker.md` | Tracker should be updated when fixture passes |
