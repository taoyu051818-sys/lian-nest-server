# lian-nest-server

Nest-first backend rewrite for LIAN.

This repository is the AI-native development home for the new LIAN backend. The legacy backend remains the behavior reference during migration; new backend work should be planned through GitHub issues and implemented by bounded worker tasks.

## AI-Native Development

- [SOP](docs/ai-native/SOP.md) - Complete standard operating procedure
- [Roles](docs/ai-native/roles.md) - Role definitions and responsibilities
- [Worker Task Contract](docs/ai-native/worker-task-contract.md) - JSON contract schema for worker tasks
- [Issue Lifecycle](docs/ai-native/issue-lifecycle.md) - Issue states, labels, and transitions
- [PR Review Gate](docs/ai-native/pr-review-gate.md) - Review checklist and merge criteria
- [Validation Evidence](docs/ai-native/validation-evidence.md) - Evidence format requirements

### Agent Prompts

Role prompts for AI workers and reviewers live in [ops/agent-prompts/](ops/agent-prompts/).

### Automation Policy

- [Next-Wave Policy](ops/agent-prompts/next-wave-policy.md) - How to continue after a worker wave completes (manual orchestrator, router-driven, serial aggregator).
- [Writeback Checklist](ops/agent-prompts/writeback-checklist.md) - Verify worker PR comments and label updates actually landed.

## Architecture

### Modules

- **ConfigModule** (`src/config/`) — Global module; validates `process.env` with Joi at startup and exposes `ConfigService`.
- **HealthModule** (`src/health/`) — `GET /api/health` liveness probe.
- **NodebbModule** (`src/nodebb/`) — Single gateway for all outbound NodeBB API calls. Provides typed providers for topics, posts, users, notifications, and tags. See [docs/architecture/nodebb-integration.md](docs/architecture/nodebb-integration.md).
- **RepositoryModule** (`src/repositories/`) — Provider interfaces and skeletons for persistence layer. See [docs/architecture/repositories.md](docs/architecture/repositories.md).
- **GlobalExceptionFilter** (`src/common/filters/`) — Uniform `{ ok, error }` envelope for all error responses.

### Database & Schema

- [Database Strategy](docs/architecture/database-strategy.md) — PostgreSQL, Redis, and NodeBB ownership boundaries
- [ORM Recommendation](docs/architecture/orm-recommendation.md) — Prisma vs Drizzle vs TypeORM evaluation
- [Schema Slices](docs/architecture/schema-slices.md) — Initial Prisma schema for users, sessions, posts, recommendations, AI records, and audit
- [Implementation Sequence](docs/architecture/implementation-sequence.md) — Phased rollout plan after bootstrap

## Quick start

```bash
npm install
npm run start:dev
```

## Scripts

| Command            | Description                     |
|--------------------|---------------------------------|
| `npm run check`    | TypeScript type-check (no emit) |
| `npm run build`    | Production build                |
| `npm test`         | Run all tests                   |
| `npm run start`    | Start the server                |
| `npm run start:dev`| Start with file watching        |

## Migration & Route Parity

- **Route inventory:** `docs/contracts/route-inventory.md` -- all legacy route families.
- **Parity tracker:** `docs/migration/route-parity-tracker.md` -- migrated vs unmigrated status.
- **Acceptance criteria:** `docs/migration/acceptance-criteria.md` -- what "done" means per family.
- **Legacy freeze rules:** `docs/migration/legacy-freeze-rules.md` -- constraints on legacy code usage.

### Check Parity

```sh
node scripts/check-route-parity.js
```

### Run Contract Tests

```sh
node test/route-parity.test.js
```
