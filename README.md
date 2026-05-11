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

## Architecture

- **ConfigModule** (`src/config/`) — Global module; validates `process.env` with Joi at startup and exposes `ConfigService`.
- **HealthModule** (`src/health/`) — `GET /api/health` liveness probe.
- **NodebbModule** (`src/nodebb/`) — Single gateway for all outbound NodeBB API calls. Provides typed providers for topics, posts, users, notifications, and tags. See [docs/architecture/nodebb-integration.md](docs/architecture/nodebb-integration.md).
- **GlobalExceptionFilter** (`src/common/filters/`) — Uniform `{ ok, error }` envelope for all error responses.

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
