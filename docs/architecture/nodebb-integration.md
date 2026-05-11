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

## Graceful fallback observability

When NodeBB is unreachable or returns an error, feature modules SHOULD degrade
gracefully rather than propagating 5xx to the client. However, **silent
fallback hides integration failures**. Every fallback path must be observable.

The detailed contract lives in
[`nodebb-error-taxonomy.md` §9](./nodebb-error-taxonomy.md#9-observability-contract).
Summarised:

### Fallback strategies

| Strategy | When to use | Example |
|---|---|---|
| `cached_stale` | Data changes infrequently; stale data is acceptable | Topic list, tag cloud |
| `default_value` | Business logic requires a value; safe default exists | Empty notification count |
| `empty_result` | Absence of data is a valid UI state | Search results, "no topics" |
| `degraded_response` | Partial data is better than none | Topic without avatar URL |
| `skip` | Aggregation from multiple sources; one source is down | Dashboard widget list |

### Required observability on every fallback

1. **Structured log** at `warn` level (see taxonomy §9.1 for required fields).
2. **Counter increment** (`nodebb.fallback.total`, `nodebb.fallback.by_reason.*`).
3. **Metadata on response** (`NodebbFallbackMeta`) so upstream consumers know
   a fallback was applied.

### Example: service-layer fallback with observability

```typescript
@Injectable()
export class TopicsService {
  constructor(
    private readonly nodebbTopics: NodebbTopicsProvider,
    private readonly cache: CacheService,
    private readonly logger: Logger,
  ) {}

  async getTopicList(uid: number): Promise<TopicListResponse> {
    const result = await this.nodebbTopics.getTopics(uid);

    if (result.status === BodyStatus.OK) {
      return { topics: result.data, fallback: null };
    }

    // Graceful fallback
    const cached = await this.cache.get<Topic[]>('topics:latest');
    if (cached) {
      this.logger.warn('NodeBB fallback applied', {
        'nodebb.fallback.triggered': true,
        'nodebb.error.category': result.classification.category,
        'nodebb.error.code': result.classification.code,
        'nodebb.fallback.strategy': 'cached_stale',
        'nodebb.fallback.endpoint': '/api/topic',
      });
      return { topics: cached, fallback: { applied: true, strategy: 'cached_stale' } };
    }

    // No cache available — return empty
    this.logger.warn('NodeBB fallback applied', {
      'nodebb.fallback.triggered': true,
      'nodebb.error.category': result.classification.category,
      'nodebb.error.code': result.classification.code,
      'nodebb.fallback.strategy': 'empty_result',
      'nodebb.fallback.endpoint': '/api/topic',
    });
    return { topics: [], fallback: { applied: true, strategy: 'empty_result' } };
  }
}
```

### Anti-patterns

- **`catch` with no log** — silently swallows the error; operator never learns
  NodeBB is down.
- **`debug`-level log for fallbacks** — production log levels hide the event;
  operators see degraded UX with no corresponding error signal.
- **Returning success without fallback metadata** — caller cannot distinguish
  "NodeBB returned data" from "we served stale cache because NodeBB is down".

## Boundary enforcement

`nodebb-boundary.spec.ts` walks every `.ts` file under `src/` (excluding
`src/nodebb/**` and test files) and asserts that none of them import
`http`, `https`, `node-fetch`, `axios`, or `got`. This prevents accidental
direct calls to the NodeBB API from service or controller code.
