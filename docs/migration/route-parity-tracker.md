# Route Parity Tracker

Tracks which legacy route families have been migrated to Nest controllers.

**Legend:**
- **UNMIGRATED** -- No Nest implementation exists.
- **IN_PROGRESS** -- Nest controller exists but does not reach parity.
- **MIGRATED** -- Nest implementation matches legacy behavior (per acceptance criteria).
- **VERIFIED** -- Parity confirmed by contract tests or manual review.

## Status by Family

| Family       | Status       | Nest Module / Controller | Issue | Notes |
|--------------|--------------|--------------------------|-------|-------|
| AUTH         | UNMIGRATED   |                          |       |       |
| USERS        | UNMIGRATED   |                          |       |       |
| CATEGORIES   | UNMIGRATED   |                          |       |       |
| TOPICS       | UNMIGRATED   |                          |       |       |
| POSTS        | UNMIGRATED   |                          |       |       |
| MESSAGING    | UNMIGRATED   |                          |       |       |
| NOTIFICATIONS| UNMIGRATED   |                          |       |       |
| TAGS         | UNMIGRATED   |                          |       |       |
| SEARCH       | UNMIGRATED   |                          |       |       |
| GROUPS       | UNMIGRATED   |                          |       |       |

## Route-Level Detail

When a family moves to IN_PROGRESS or MIGRATED, add per-route detail below.

### AUTH (example format)

| Method | Path                  | Status       | Controller / Handler        |
|--------|-----------------------|--------------|-----------------------------|
| POST   | /api/auth/login       | UNMIGRATED   |                             |
| POST   | /api/auth/register    | UNMIGRATED   |                             |
| POST   | /api/auth/logout      | UNMIGRATED   |                             |
| GET    | /api/auth/me          | UNMIGRATED   |                             |
| POST   | /api/auth/password    | UNMIGRATED   |                             |

> Expand this section for each family as migration begins.

## Progress Summary

- **Total families:** 10
- **MIGRATED:** 0
- **IN_PROGRESS:** 0
- **UNMIGRATED:** 10

## How to Update

1. When starting a family, change status to IN_PROGRESS and fill in the Nest module.
2. Reference the implementing issue in the Issue column.
3. When acceptance criteria are met, change to MIGRATED.
4. After contract test verification, change to VERIFIED.
5. Keep the Progress Summary counts in sync.
