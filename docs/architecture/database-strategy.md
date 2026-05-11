# Database Strategy

## Ownership Boundaries

### PostgreSQL — LIAN Source of Truth

PostgreSQL holds all durable product state for the LIAN platform. Every entity the Nest server creates, reads, updates, or deletes as part of its business logic lives in Postgres. This includes user accounts, session metadata, post records, recommendation preferences, AI interaction logs, and audit events.

Postgres is the only system of record. If a piece of data must survive a cold restart or be queryable across services, it belongs in Postgres.

### Redis — Cache, Queue, and Session Acceleration

Redis provides three capabilities, none of which are durable product truth:

| Role | Examples | Durability |
|---|---|---|
| Cache | Hot query results, computed recommendations, rate-limit counters | Ephemeral — can be rebuilt from Postgres |
| Queue | Background job dispatch (email, AI processing, analytics) | At-most-once or at-least-once depending on queue config |
| Session acceleration | JWT deny-lists, active session tokens, OTP codes | Short-lived TTL entries |

Redis data must be reconstructable from Postgres or is inherently transient. No business entity is created in Redis first. If Redis is unavailable, the system degrades gracefully (slower reads, delayed jobs) but does not lose data.

### NodeBB — Separate Database Boundary

NodeBB operates its own database (typically its own Redis or MongoDB instance) and owns forum-specific state: topics, posts, categories, user preferences within the forum, and plugin data.

LIAN does **not** replicate or proxy NodeBB database content. Instead, LIAN stores lightweight reference fields that link LIAN entities to their NodeBB counterparts. The NodeBB integration module is the only component that communicates with the NodeBB data layer.

## Separation Rules

1. **No cross-database joins.** LIAN Postgres queries never reach into NodeBB's database. When LIAN needs NodeBB data, it calls the NodeBB module, which uses NodeBB's API or direct access as appropriate.
2. **No dual-write.** A LIAN entity and its NodeBB counterpart are updated independently. Consistency is eventual, managed by the integration module.
3. **Redis is not a database.** Application code does not treat Redis as a queryable store for business logic. Repository pattern accesses Postgres; cache/queue abstractions access Redis.
4. **Reference fields only.** LIAN stores `nodebbUid`, `tid` (topic ID), `pid` (post ID), and `slug` as opaque identifiers. These are foreign keys to an external system, not Postgres foreign keys.

## NodeBB Reference Fields

The following reference fields appear across LIAN schema slices. They are plain columns (not Postgres FK constraints) that point into NodeBB's data:

| Field | Type | Meaning |
|---|---|---|
| `nodebb_uid` | `integer` | NodeBB user ID, stored on LIAN user record |
| `nodebb_tid` | `integer` | NodeBB topic ID, stored on LIAN post/topic metadata |
| `nodebb_pid` | `integer` | NodeBB post ID, stored on LIAN comment/reply metadata |
| `nodebb_slug` | `text` | NodeBB slug for SEO-friendly URL bridging |

These fields are nullable — a LIAN entity may exist before its NodeBB counterpart is created (e.g., user registers on LIAN before interacting with the forum).

## Environment Separation

| Environment | PostgreSQL | Redis | NodeBB DB |
|---|---|---|---|
| Development | Local Docker Compose Postgres | Local Docker Compose Redis | Local NodeBB dev instance |
| CI | Testcontainers or ephemeral Postgres | Testcontainers or ephemeral Redis | Mocked NodeBB module |
| Staging | Managed Postgres (cloud) | Managed Redis (cloud) | Staging NodeBB instance |
| Production | Managed Postgres (cloud, HA) | Managed Redis (cloud, HA) | Production NodeBB instance |

Connection strings are never committed. They live in environment variables managed per deployment target.
