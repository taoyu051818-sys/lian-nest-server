# NodeBB Integration Architecture

## Overview

`NodebbModule` is the single gateway for all outbound calls to the NodeBB
forum API. No other module may import `http`, `https`, `node-fetch`, `axios`,
or `got` to reach NodeBB directly — the boundary test in
`src/nodebb/nodebb-boundary.spec.ts` enforces this rule.

## Module structure

```
src/nodebb/
  index.ts                       barrel — re-exports everything public
  types.ts                       DTOs, enums, normalization helpers
  nodebb-client.ts               abstract NodebbClient + injection token
  nodebb.module.ts               @Global module + register() factory
  nodebb-boundary.spec.ts        architectural guard test
  providers/
    nodebb-topics.provider.ts
    nodebb-posts.provider.ts
    nodebb-users.provider.ts
    nodebb-notifications.provider.ts
    nodebb-tags.provider.ts
```

## Auth modes

| Mode          | Header sent                         | Use case                     |
|---------------|-------------------------------------|------------------------------|
| `api_token`   | `Authorization: Bearer <token>`     | Server-to-server background  |
| `session`     | `Cookie: <session cookie>`          | User-context proxy           |
| `none`        | (none)                              | Public endpoints             |

Auth mode is configured at module registration time via
`NodebbModule.register({ authMode, ... })`. Individual call-sites can
override the auth by passing a `NodebbAuth` object to any provider method.

## Response normalization

Every response from `NodebbClient` returns a `NodebbNormalizedResponse<T>`:

```typescript
{
  status: BodyStatus.OK | BodyStatus.ERROR | BodyStatus.NOT_FOUND,
  statusCode: number,   // HTTP status
  data: T | null,       // payload on success
  error: string | null, // message on failure
}
```

This lets upstream controllers map directly to the existing `ErrorEnvelope`
format or to custom success shapes without ad-hoc try/catch.

## Using in another module

```typescript
import { NodebbModule, NodebbTopicsProvider, NodebbAuthMode } from '../nodebb';

// In the aggregator (issue #4) or a feature module:
@Module({
  imports: [
    NodebbModule.register({
      baseUrl: process.env.NODEBB_URL!,
      authMode: NodebbAuthMode.API_TOKEN,
      apiToken: process.env.NODEBB_API_TOKEN,
    }),
  ],
})
export class AggregatorModule {}
```

Because `NodebbModule` is `@Global()`, importing it once makes all providers
available to every module in the application.

## Environment variables

| Variable             | Default      | Description                        |
|----------------------|--------------|------------------------------------|
| `NODEBB_URL`         | `''`         | Base URL of the NodeBB instance    |
| `NODEBB_AUTH_MODE`   | `api_token`  | `api_token`, `session`, or `none`  |
| `NODEBB_API_TOKEN`   | `''`         | API token for server-to-server     |
| `NODEBB_SESSION_COOKIE` | `''`      | Session cookie for user-context    |

## Boundary enforcement

`nodebb-boundary.spec.ts` walks every `.ts` file under `src/` (excluding
`src/nodebb/**` and test files) and asserts that none of them import
`http`, `https`, `node-fetch`, `axios`, or `got`. This prevents accidental
direct calls to the NodeBB API from service or controller code.
