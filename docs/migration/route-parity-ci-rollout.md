# Route Parity CI Rollout and Migration Queue

Defines when the route parity harness runs, how failures are handled, how workers
register expectations, and the prioritized endpoint migration queue.

> **Dependency:** This plan assumes PR #8 (route parity harness) has landed.
> PR #8 introduces `docs/contracts/route-inventory.md`, `docs/migration/route-parity-tracker.md`,
> `docs/migration/acceptance-criteria.md`, `scripts/check-route-parity.js`, and
> `test/route-parity.test.js`. All phases below are conditional on those files existing.
> If PR #8 has not merged, gate Phase 1 on its merge and defer Phase 2/3 accordingly.

---

## 1. Parity Check Phases

### Phase 1 -- Local Developer Checks (immediate after PR #8 merge)

**When:** Before every commit that touches a route family or its Nest controller.

**Commands:**

```bash
# Verify tracker integrity and report coverage
node scripts/check-route-parity.js

# Run parity structure tests
node test/route-parity.test.js

# Standard project checks (always run)
npm run check
npm run test
npm run build
```

**Who runs it:** Every worker (backend-programmer, nodebb-owner) before committing.
The migration-auditor runs it during review.

**What it catches:**
- Malformed tracker markdown
- Missing acceptance criteria entries
- Stale IN_PROGRESS entries with no corresponding controller files

### Phase 2 -- PR Validation (after CI infrastructure exists)

**When:** On every PR that modifies route-related files.

**Trigger paths:**
- `src/**/` (any controller, service, or module change)
- `docs/migration/route-parity-tracker.md`
- `docs/contracts/route-inventory.md`
- `docs/migration/acceptance-criteria.md`
- `scripts/check-route-parity.js`

**Validation steps in PR:**

1. `node scripts/check-route-parity.js` -- must exit 0.
2. `node test/route-parity.test.js` -- all structure tests pass.
3. `npm run check` -- TypeScript compiles.
4. `npm run test` -- all unit tests pass.
5. `npm run build` -- production build succeeds.

**Worker contract requirement:** Every PR that migrates endpoints must include
validation evidence in the PR body per `docs/ai-native/validation-evidence.md`.

### Phase 3 -- CI Automation (future, after `.github/workflows/` is created)

**When:** Automated on push and PR events.

**Workflow definition (not implemented here -- future PR):**

```yaml
# .github/workflows/route-parity.yml (future)
name: Route Parity
on:
  push:
    paths: ['src/**', 'docs/migration/**', 'docs/contracts/**', 'scripts/check-route-parity.js']
  pull_request:
    paths: ['src/**', 'docs/migration/**', 'docs/contracts/**', 'scripts/check-route-parity.js']
jobs:
  parity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: node scripts/check-route-parity.js
      - run: node test/route-parity.test.js
      - run: npm run check
      - run: npm run test
      - run: npm run build
```

**CI is additive:** Until this workflow exists, Phase 1 and Phase 2 remain the
enforcement mechanism. Do not block PRs on missing CI -- block on missing local
validation evidence instead.

---

## 2. Failure Policy

### 2.1 Missing Fixtures

**Scenario:** A worker migrates an endpoint but has not defined a parity fixture
(request/response snapshot) for it.

**Policy:**

| Severity | Condition | Action |
|----------|-----------|--------|
| BLOCK | No fixture exists for a route marked MIGRATED | PR cannot merge. Worker must add fixture. |
| WARN | Fixture exists but does not cover error paths | Reviewer flags; worker adds error fixtures in same PR. |
| INFO | Fixture covers happy path only, error paths deferred | Acceptable for IN_PROGRESS status. |

**Fixture format:** Workers define fixtures as part of the acceptance criteria
update. At minimum, each migrated route needs:
- Happy-path request/response pair
- Auth-required response (401/403) if the route is protected
- Validation error response (400) if the route accepts input

### 2.2 Behavior Drift

**Scenario:** A migrated endpoint's behavior diverges from the legacy backend
after initial parity was established.

**Policy:**

| Severity | Condition | Action |
|----------|-----------|--------|
| BLOCK | Response shape differs from legacy (field names, types, nesting) | Fix before merge. Regression test required. |
| BLOCK | Auth enforcement differs (protected route exposed, or public route locked) | Fix before merge. Security review required. |
| WARN | Pagination contract differs (different default limit, different page count format) | Flag in review. Fix in same PR or create follow-up issue. |
| INFO | Minor cosmetic difference (timestamp format, additional metadata field) | Document as intentional deviation in tracker notes. |

**Detection:** The migration-auditor role checks behavior parity during review.
When CI exists, snapshot tests will automate this check.

### 2.3 Intentionally Changed Behavior

**Scenario:** The new Nest backend intentionally deviates from legacy behavior
(e.g., stricter validation, improved error messages, different pagination defaults).

**Policy:**

1. Worker documents the deviation in `docs/migration/route-parity-tracker.md`
   Notes column.
2. Worker adds a `INTENTIONAL_DIFF:` entry in the PR body explaining:
   - What differs
   - Why it differs
   - Whether it is backward-compatible
3. migration-auditor reviews and approves the deviation.
4. If backward-incompatible, the deviation must be gated behind a feature flag
   or versioned endpoint (`/api/v2/...`).

**Examples of acceptable intentional changes:**
- Stricter input validation (rejects previously accepted malformed input)
- Consistent error envelope format (uses `ErrorEnvelope` from global filter)
- Additional metadata fields in responses (backward-compatible)
- Standardized pagination parameters

**Examples of unacceptable intentional changes without gating:**
- Removing fields from responses
- Changing authentication mechanism
- Altering data ownership/authorization rules

---

## 3. Worker Registration Protocol

Before migrating any endpoint family, workers must register parity expectations.

### Step 1: Update the Route Parity Tracker

In `docs/migration/route-parity-tracker.md`:

1. Change family status from `UNMIGRATED` to `IN_PROGRESS`.
2. Fill in the `Nest Module / Controller` column with the target module name.
3. Fill in the `Issue` column with the GitHub issue number.
4. Add route-level detail rows for each endpoint in the family.

### Step 2: Define Acceptance Criteria (if not already present)

In `docs/migration/acceptance-criteria.md`:

1. Verify the family has a section with per-route criteria.
2. If criteria are missing, add them before writing controller code.
3. Criteria must cover: path parity, method parity, auth enforcement,
   response shape, error responses, pagination, and validation.

### Step 3: Create the Worker Task Contract

Follow `docs/ai-native/worker-task-contract.md` with:

- `taskType`: `"migration"`
- `conflictGroup`: `"migration-{family}"` (e.g., `migration-auth`)
- `allowedFiles`: Module files, controller, service, spec, tracker update
- `forbiddenFiles`: Files outside the target module
- `requiredReviewRoles`: `["migration-auditor", "qa-contract-reviewer"]`
- `validationCommands`: Must include parity script and structure tests

### Step 4: Implement and Verify

1. Implement the Nest controller and service.
2. Run local parity checks (Phase 1 commands).
3. Update tracker to `MIGRATED` when acceptance criteria are met.
4. Include validation evidence in PR body.

### Step 5: Review Gate

The PR must pass:
- migration-auditor: Legacy behavior parity check
- qa-contract-reviewer: Validation evidence and contract correctness
- All automated checks from Phase 2

After merge, the tracker status can be updated to `VERIFIED` in a follow-up
commit if contract tests confirm parity.

---

## 4. Endpoint Migration Queue

Prioritized by: user-facing impact, dependency order, and blocking relationships.

### Tier 1 -- Foundation (no dependencies, enables all other work)

#### 4.1 AUTH Module

**Priority:** P0 -- All protected routes depend on auth.

**Endpoints:**

| Method | Path | Purpose | Depends On |
|--------|------|---------|------------|
| POST | /api/auth/login | Email/password login | PR #8 (tracker) |
| POST | /api/auth/register | User registration | PR #8 |
| POST | /api/auth/logout | Invalidate session | login |
| GET | /api/auth/me | Current user profile | login |
| POST | /api/auth/password | Password change | login |

**Nest module:** `src/auth/` (AuthModule, AuthController, AuthService)

**PR-sized unit:** One PR for the full AUTH family.
Includes: module scaffold, controller with all 5 endpoints, service with
NodeBB API integration, auth guard, tracker update to IN_PROGRESS.

**Acceptance:** Session token returned on login, `/me` returns user shape,
logout invalidates session, password change requires current password.

**Follow-up PR (if needed):** Auth guard extraction to shared module
for reuse by USERS, MESSAGING, NOTIFICATIONS.

---

#### 4.2 OPS/STATUS Routes

**Priority:** P0 -- Operational visibility, no auth dependency.

**Endpoints:**

| Method | Path | Purpose | Depends On |
|--------|------|---------|------------|
| GET | /api/health | Health check | Already exists |
| GET | /api/status | System status (DB, NodeBB connectivity) | PR #8 |

**Nest module:** `src/health/` (already exists), extend with status endpoint.

**PR-sized unit:** One small PR adding `/api/status` to existing HealthModule.
Includes: status controller method, NodeBB connectivity check, tracker update.

**Acceptance:** `/api/health` unchanged, `/api/status` returns dependency health.

---

### Tier 2 -- Core Content (depends on AUTH)

#### 4.3 NodeBB Feed / Categories

**Priority:** P1 -- Primary content browsing surface.

**Endpoints:**

| Method | Path | Purpose | Depends On |
|--------|------|---------|------------|
| GET | /api/categories | List all categories | None (public) |
| GET | /api/categories/:cid | Single category | None |
| GET | /api/categories/:cid/topics | Topics in category | None (paginated) |
| POST | /api/categories/:cid/topics | Create topic | AUTH guard |

**Nest module:** `src/categories/` (CategoriesModule, CategoriesController)

**PR-sized unit:** One PR for read-only endpoints (GET), one PR for write
endpoints (POST) if scope is large. Start with GET-only PR.

**Acceptance:** Category hierarchy returned, topics paginated, topic creation
requires auth.

---

#### 4.4 NodeBB Posts / Topics

**Priority:** P1 -- Core content interaction.

**Endpoints:**

| Method | Path | Purpose | Depends On |
|--------|------|---------|------------|
| GET | /api/topic/:tid | Single topic with posts | None |
| PUT | /api/topic/:tid | Update topic | AUTH guard |
| DELETE | /api/topic/:tid | Soft-delete topic | AUTH guard |
| POST | /api/topic/:tid/follow | Follow topic | AUTH guard |
| DELETE | /api/topic/:tid/follow | Unfollow topic | AUTH guard |
| POST | /api/topic/:tid/vote | Vote on topic | AUTH guard |
| GET | /api/posts/:pid | Single post | None |
| PUT | /api/posts/:pid | Edit post | AUTH guard |
| DELETE | /api/posts/:pid | Soft-delete post | AUTH guard |
| POST | /api/posts/:pid/vote | Vote on post | AUTH guard |
| POST | /api/topic/:tid | Create reply | AUTH guard |

**Nest module:** `src/topics/` and `src/posts/` (split into two modules)

**PR-sized unit:** Split into 3 PRs:
1. Topics read (GET topic, list posts) -- no auth dependency
2. Topics write (update, delete, follow, vote) -- requires AUTH
3. Posts CRUD (get, edit, delete, vote, reply) -- requires AUTH

**Acceptance:** Post pagination, vote idempotency, soft-delete semantics,
owner-or-moderator authorization.

---

### Tier 3 -- User and Social (depends on AUTH)

#### 4.5 Profile / Users

**Priority:** P2 -- User-facing profile management.

**Endpoints:**

| Method | Path | Purpose | Depends On |
|--------|------|---------|------------|
| GET | /api/users/:uid | Get user by ID | None |
| GET | /api/users/:uid/profile | Full profile | None |
| PUT | /api/users/:uid | Update user | AUTH guard |
| GET | /api/users/:uid/posts | User's posts | AUTH (paginated) |
| GET | /api/users/:uid/topics | User's topics | AUTH (paginated) |

**Nest module:** `src/users/` (UsersModule, UsersController)

**PR-sized unit:** One PR for the full USERS family.
Includes: controller, service, profile field mapping, pagination, tracker update.

**Acceptance:** Profile shape matches legacy, update requires owner-or-admin,
user posts/topics paginated with correct sort.

---

#### 4.6 Messages

**Priority:** P2 -- Private messaging, all endpoints require auth.

**Endpoints:**

| Method | Path | Purpose | Depends On |
|--------|------|---------|------------|
| GET | /api/messages | List message threads | AUTH guard |
| GET | /api/messages/:mid | Single thread | AUTH guard |
| POST | /api/messages | Send new message | AUTH guard |
| POST | /api/messages/:mid | Reply to thread | AUTH guard |

**Nest module:** `src/messages/` (MessagesModule, MessagesController)

**PR-sized unit:** One PR for the full MESSAGING family.
Includes: controller, service, thread participant authorization, tracker update.

**Acceptance:** Thread list with last message preview, full history on detail,
participant-only access.

---

### Tier 4 -- Extended Features (lower priority, fewer dependencies)

#### 4.7 Notifications

**Priority:** P3 -- User notifications.

**Endpoints:**

| Method | Path | Purpose | Depends On |
|--------|------|---------|------------|
| GET | /api/notifications | List notifications | AUTH guard |
| PUT | /api/notifications/:nid | Mark as read | AUTH guard |
| POST | /api/notifications/mark-all | Mark all as read | AUTH guard |

**Nest module:** `src/notifications/` (NotificationsModule)

**PR-sized unit:** One PR for the full NOTIFICATIONS family.

---

#### 4.8 Tags

**Priority:** P3 -- Tag browsing, public endpoints.

**Endpoints:**

| Method | Path | Purpose | Depends On |
|--------|------|---------|------------|
| GET | /api/tags | List all tags | None |
| GET | /api/tags/:tag/topics | Topics with tag | None (paginated) |

**Nest module:** `src/tags/` (TagsModule)

**PR-sized unit:** One small PR.

---

#### 4.9 Search

**Priority:** P3 -- Full-text search.

**Endpoints:**

| Method | Path | Purpose | Depends On |
|--------|------|---------|------------|
| GET | /api/search | Full-text search | None |

**Nest module:** `src/search/` (SearchModule)

**PR-sized unit:** One small PR.

---

#### 4.10 Groups

**Priority:** P3 -- Group management.

**Endpoints:**

| Method | Path | Purpose | Depends On |
|--------|------|---------|------------|
| GET | /api/groups | List groups | None |
| GET | /api/groups/:slug | Single group | None |
| POST | /api/groups/:slug/join | Join group | AUTH guard |
| DELETE | /api/groups/:slug/leave | Leave group | AUTH guard |

**Nest module:** `src/groups/` (GroupsModule)

**PR-sized unit:** One PR for the full GROUPS family.

---

## 5. Follow-Up PR Plan

Each row is one PR-sized unit. Dependencies flow top to bottom.

| PR | Title | Depends On | Issue | Est. Scope |
|----|-------|------------|-------|------------|
| 1 | feat: AUTH module -- login, register, logout, me, password | PR #8 | New | ~5 files, ~200 LOC |
| 2 | feat: extend HealthModule with /api/status endpoint | PR #8 | New | ~2 files, ~50 LOC |
| 3 | feat: CATEGORIES module -- read-only endpoints | PR #8 | New | ~4 files, ~150 LOC |
| 4 | feat: TOPICS module -- read endpoints | PR #8 | New | ~4 files, ~150 LOC |
| 5 | feat: POSTS module -- CRUD and voting | AUTH PR | New | ~5 files, ~200 LOC |
| 6 | feat: CATEGORIES write -- create topic in category | AUTH PR | New | ~2 files, ~80 LOC |
| 7 | feat: TOPICS write -- update, delete, follow, vote | AUTH PR | New | ~3 files, ~120 LOC |
| 8 | feat: USERS module -- profile and user management | AUTH PR | New | ~4 files, ~150 LOC |
| 9 | feat: MESSAGING module -- threads and messages | AUTH PR | New | ~4 files, ~150 LOC |
| 10 | feat: NOTIFICATIONS module | AUTH PR | New | ~3 files, ~100 LOC |
| 11 | feat: TAGS module -- list and filter | None | New | ~3 files, ~80 LOC |
| 12 | feat: SEARCH module -- full-text search | None | New | ~3 files, ~80 LOC |
| 13 | feat: GROUPS module -- list, join, leave | AUTH PR | New | ~4 files, ~100 LOC |

**Total:** 13 PRs across ~4 waves. Each PR is independently reviewable and mergeable.

### Wave Sequence

```
Wave 1: PR #1 (AUTH) + PR #2 (STATUS) + PR #11 (TAGS) + PR #12 (SEARCH)
         [no interdependencies, can run in parallel]

Wave 2: PR #3 (CATEGORIES read) + PR #4 (TOPICS read)
         [depends on PR #8 only, can run in parallel with Wave 1]

Wave 3: PR #5 (POSTS) + PR #6 (CATEGORIES write) + PR #7 (TOPICS write)
        + PR #8 (USERS) + PR #9 (MESSAGING) + PR #10 (NOTIFICATIONS) + PR #13 (GROUPS)
         [all depend on AUTH PR #1]

Wave 4: Tracker updates -- bulk update all families to MIGRATED/VERIFIED
         [depends on all previous PRs]
```

---

## 6. Validation Commands Reference

Every migration PR must include evidence for these commands:

```bash
# Parity harness integrity
node scripts/check-route-parity.js
# Expected: PASS (tracker parses, coverage report prints)

# Parity structure tests
node test/route-parity.test.js
# Expected: PASS (all structure tests)

# TypeScript compilation
npm run check
# Expected: PASS (no type errors)

# Unit tests
npm run test
# Expected: PASS (all tests)

# Production build
npm run build
# Expected: PASS (build succeeds)
```

---

## 7. Checklist for Orchestrator

Before launching a migration worker:

- [ ] PR #8 has merged into main
- [ ] `docs/contracts/route-inventory.md` exists on main
- [ ] `docs/migration/route-parity-tracker.md` exists on main
- [ ] `docs/migration/acceptance-criteria.md` exists on main
- [ ] `scripts/check-route-parity.js` exists on main
- [ ] `test/route-parity.test.js` exists on main
- [ ] Worker task contract created per `docs/ai-native/worker-task-contract.md`
- [ ] Conflict group assigned (one per route family)
- [ ] Required review roles include `migration-auditor` and `qa-contract-reviewer`

---

## 8. References

- [Legacy Route Inventory](../contracts/route-inventory.md) -- Source of truth for route families
- [Route Parity Tracker](route-parity-tracker.md) -- Migration status per family
- [Acceptance Criteria](acceptance-criteria.md) -- Per-family done definition
- [Legacy Freeze Rules](legacy-freeze-rules.md) -- Rules for legacy backend interaction
- [Worker Task Contract](../ai-native/worker-task-contract.md) -- Contract schema
- [PR Review Gate](../ai-native/pr-review-gate.md) -- Review checklist
- [Validation Evidence](../ai-native/validation-evidence.md) -- Evidence format
- PR #8 -- Route parity harness (pending dependency)
