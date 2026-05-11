# NodeBB Adapter Error Taxonomy

> Architecture contract for [#77](https://github.com/taoyu051818-sys/lian-nest-server/issues/77).
> Defines a reusable error classification for all NodeBB adapter implementations.
> Companion types live in `src/nodebb/contracts/error-types.ts`.

---

## 1. Design goals

- Every error surfaced by a NodeBB adapter must be classifiable into exactly one
  **error category**.
- Categories must be stable across adapter rewrites (HTTP client library swap,
  retry policy change, etc.).
- The taxonomy is **observability-first**: each category maps to a distinct
  recovery strategy or alerting path.

---

## 2. Error categories

| Category | Code | Typical cause | Recovery |
|---|---|---|---|
| `HTTP_CLIENT` | 4xx/5xx from NodeBB | Bad request, not found, server error | Map to NestJS `HttpException`, retry on 5xx |
| `BODY_STATUS` | HTTP 200 but `status: "error"` in body | NodeBB business-logic rejection | Extract body message, surface to caller |
| `AUTH` | 401/403, token expired, invalid session | Missing/invalid credentials | Re-authenticate or prompt user re-login |
| `TIMEOUT` | Socket timeout, connection timeout | Slow NodeBB, network partition | Retry with backoff, circuit-break |
| `NETWORK` | DNS failure, ECONNRESET, ECONNREFUSED | NodeBB unreachable | Circuit-break, alert ops |
| `UNKNOWN` | Anything unclassified | Unexpected shape | Log raw error, alert, do not retry blindly |

---

## 3. Category detection rules

Detection happens inside the adapter. The rules are ordered — first match wins:

```
1. Is the error a network-level failure (no HTTP response received)?
   → NETWORK (DNS, ECONNRESET, ECONNREFUSED)

2. Did the request timeout before a response arrived?
   → TIMEOUT (ETIMEDOUT, socket hangup, AbortSignal)

3. Is HTTP status 401 or 403?
   → AUTH

4. Is HTTP status 4xx or 5xx?
   → HTTP_CLIENT

5. Did HTTP succeed (2xx) but the body contains { status: "error" }?
   → BODY_STATUS

6. None of the above?
   → UNKNOWN
```

---

## 4. Relationship to `NodebbNormalizedResponse`

The existing `NodebbNormalizedResponse<T>` carries `status`, `statusCode`,
`data`, and `error`. The taxonomy adds a **classification layer** on top:

```
NodebbNormalizedResponse<T>
  → NodebbClassifiedError  (when status !== BodyStatus.OK)
```

`NodebbClassifiedError` (defined in `src/nodebb/contracts/error-types.ts`)
wraps the original response metadata with the resolved category and a
machine-readable error code.

Adapters return `NodebbNormalizedResponse<T>` as before. Callers that need
structured error handling use the contract types to classify responses.

---

## 5. Error codes

Each category carries specific codes for log aggregation and metrics:

### HTTP_CLIENT

| Code | HTTP status | Description |
|---|---|---|
| `HTTP_BAD_REQUEST` | 400 | Malformed request payload |
| `HTTP_NOT_FOUND` | 404 | Resource does not exist on NodeBB |
| `HTTP_METHOD_NOT_ALLOWED` | 405 | Endpoint exists but wrong HTTP method |
| `HTTP_CONFLICT` | 409 | Duplicate or conflicting resource |
| `HTTP_UNPROCESSABLE` | 422 | Validation failed on NodeBB side |
| `HTTP_TOO_MANY_REQUESTS` | 429 | Rate limited by NodeBB |
| `HTTP_BAD_GATEWAY` | 502 | Upstream proxy error |
| `HTTP_SERVICE_UNAVAILABLE` | 503 | NodeBB is down or deploying |
| `HTTP_GATEWAY_TIMEOUT` | 504 | Proxy timeout to NodeBB |
| `HTTP_OTHER` | other | Any other 4xx/5xx |

### AUTH

| Code | Description |
|---|---|
| `AUTH_UNAUTHORIZED` | No credentials or invalid token |
| `AUTH_FORBIDDEN` | Valid credentials, insufficient permissions |
| `AUTH_TOKEN_EXPIRED` | Token was valid but has expired |
| `AUTH_SESSION_INVALID` | Session cookie is invalid or expired |

### TIMEOUT

| Code | Description |
|---|---|
| `TIMEOUT_REQUEST` | Request-level timeout (configurable) |
| `TIMEOUT_SOCKET` | Socket hangup after partial response |
| `TIMEOUT_CONNECT` | TCP connect timeout |

### NETWORK

| Code | Description |
|---|---|
| `NETWORK_DNS` | DNS resolution failed |
| `NETWORK_CONNECTION_REFUSED` | TCP connection refused |
| `NETWORK_CONNECTION_RESET` | TCP connection reset mid-stream |
| `NETWORK_OTHER` | Other network-level failure |

### BODY_STATUS

| Code | Description |
|---|---|
| `BODY_ERROR` | NodeBB returned `{ status: "error" }` |
| `BODY_NOT_FOUND` | NodeBB returned `{ status: "not_found" }` |

### UNKNOWN

| Code | Description |
|---|---|
| `UNKNOWN` | Unclassified error |

---

## 6. Usage in adapters

Adapters classify errors at the boundary. The classification is pure — no
side effects, no logging, no retry logic. Those concerns live in interceptors
or service-layer retry wrappers.

```typescript
// Inside a concrete NodebbHttpClient implementation:
try {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) {
    return {
      ...normalizeError(res.status, body.message ?? res.statusText),
      classification: classifyHttpError(res.status),
    };
  }
  if (body.status === 'error') {
    return {
      ...normalizeError(200, body.message ?? 'NodeBB body error'),
      classification: { category: NodebbErrorCategory.BODY_STATUS, code: NodebbErrorCode.BODY_ERROR },
    };
  }
  return normalizeOk(body);
} catch (err) {
  return {
    ...normalizeError(0, (err as Error).message),
    classification: classifyNetworkError(err),
  };
}
```

---

## 7. Mapping to NestJS HTTP exceptions

Controllers and guards map classified errors to NestJS exceptions:

| Category | NestJS exception |
|---|---|
| `AUTH` | `UnauthorizedException` or `ForbiddenException` |
| `HTTP_CLIENT` (404) | `NotFoundException` |
| `HTTP_CLIENT` (429) | `HttpException(429)` |
| `HTTP_CLIENT` (5xx) | `BadGatewayException` or `ServiceUnavailableException` |
| `BODY_STATUS` | `UnprocessableEntityException` or domain-specific |
| `TIMEOUT` | `GatewayTimeoutException` |
| `NETWORK` | `ServiceUnavailableException` |
| `UNKNOWN` | `InternalServerErrorException` |

This mapping is a **guideline**, not enforced by the contract. Adapters and
services may choose different NestJS exceptions based on context.

---

## 8. Health log integration

Health check endpoints should report NodeBB error rates by category:

```json
{
  "nodebb": {
    "status": "degraded",
    "errors": {
      "AUTH": 0,
      "HTTP_CLIENT": 2,
      "BODY_STATUS": 0,
      "TIMEOUT": 5,
      "NETWORK": 0,
      "UNKNOWN": 0
    }
  }
}
```

A spike in `TIMEOWN` or `NETWORK` indicates NodeBB is unreachable.
A spike in `AUTH` indicates credential rotation is needed.

---

## 9. Contract stability

- The `NodebbErrorCategory` enum is additive-only. New categories may be
  added; existing ones must not be removed or renamed.
- Error codes within a category may be added freely.
- The classification rules (section 3) are normative. Adapters must follow
  the ordering to ensure consistent categorization.
- The `NodebbClassifiedError` interface is the primary contract consumed by
  service-layer code. Its shape is stable.
