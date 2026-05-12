# External Intake WebUI API Sketch

Read-only JSON API endpoints for the external intake WebUI. Surfaces
external facts, opportunity signals, risk signals, and idea gate results
to browser dashboards and operator tooling.

> **Closes:** [#982](https://github.com/taoyu051818-sys/lian-nest-server/issues/982)
>
> **Status:** Sketch. No implementation exists yet.
>
> **Cross-references:**
> [external-intake-webui-concept.md](external-intake-webui-concept.md) for
> WebUI view definitions,
> [external-intake-executable-loop.md](external-intake-executable-loop.md) for
> the intake pipeline stages,
> [external-facts-schema.md](external-facts-schema.md) for external fact
> entry fields,
> [opportunity-signal-schema.md](opportunity-signal-schema.md) for
> opportunity signal fields,
> [risk-signal-schema.md](risk-signal-schema.md) for risk signal fields,
> [agent-idea-review-gate.md](agent-idea-review-gate.md) for idea gate
> criteria,
> [gate-result-schema.md](gate-result-schema.md) for gate result fields.

---

## Purpose

The external intake WebUI needs API endpoints to display four categories
of data:

1. **External facts** — discrete observations ingested from outside the
   control plane (manual entries, webhooks, feeds).
2. **Opportunity signals** — improvement hypotheses derived from external
   evidence or internal analysis.
3. **Risk signals** — external risk overlays (CVEs, compliance findings,
   incidents) combined with internal meta-signals.
4. **Idea gate results** — promotion/rejection decisions from the agent
   idea review gate.

All endpoints are read-only. No POST/PUT/DELETE endpoints are defined in
this sketch. Write operations follow the executable loop protocol
(see [external-intake-executable-loop.md](external-intake-executable-loop.md)).

---

## Design Principles

| Principle | Meaning |
|-----------|---------|
| **Read-only** | Endpoints expose data for display. Mutations go through the executable loop scripts. |
| **Evidence, not commands** | API responses are observations. No response triggers a direct action in the control plane. |
| **No secrets** | All responses are pre-sanitized. Credentials, tokens, and raw payloads are never served. |
| **Local-only** | Server binds to `127.0.0.1`. Not accessible from the network. |
| **NDJSON-backed** | Endpoints read from `.github/ai-state/` files. No separate database. |

---

## Base URL

```
http://127.0.0.1:<port>/api/intake
```

Default port is defined by the WebUI server implementation. All paths
below are relative to this base.

---

## Endpoints

### 1. List External Facts

Retrieve paginated external facts from the fact event ledger.

```
GET /api/intake/facts
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sourceClass` | string | — | Filter by source class (`github-issue`, `web-scan`, `user-paste`, etc.) |
| `reliabilityTier` | string | — | Filter by reliability tier (`authoritative`, `high`, `medium`, `low`, `untrusted`) |
| `category` | string | — | Filter by domain category (`market`, `regulatory`, `dependency`, `competitor`, `customer`, `internal`) |
| `severity` | string | — | Filter by severity (`low`, `medium`, `high`, `critical`) |
| `since` | ISO-8601 | — | Return facts captured after this timestamp |
| `limit` | integer | `50` | Max results (1–200) |
| `cursor` | string | — | Pagination cursor from previous response |

**Response `200 OK`:**

```json
{
  "items": [
    {
      "eventVersion": 1,
      "eventType": "external.intake",
      "subject": "New regulation affects auth flow",
      "facts": {
        "sourceClass": "external-doc",
        "reliabilityTier": "medium",
        "category": "regulatory",
        "severity": "high",
        "evidenceUrl": "https://example.com/reg-123",
        "tags": ["compliance", "auth"]
      },
      "capturedAt": "2026-05-12T10:00:00Z",
      "actor": "webui-intake-form"
    }
  ],
  "nextCursor": "eyJjYXB0dXJlZEF0IjoiMjAyNi0wNS0xMlQxMDowMDowMFoifQ==",
  "totalEstimate": 42
}
```

**Data source:** `.github/ai-state/fact-events.ndjson` filtered to
`evidence.intake` and `external.intake` event types.

---

### 2. Get External Fact Detail

Retrieve a single external fact by its event index or subject hash.

```
GET /api/intake/facts/:id
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Fact identifier (event index or subject hash) |

**Response `200 OK`:**

```json
{
  "eventVersion": 1,
  "eventType": "external.intake",
  "subject": "CVE-2026-12345",
  "facts": {
    "sourceClass": "web-scan",
    "reliabilityTier": "medium",
    "category": "dependency",
    "severity": "critical",
    "evidenceUrl": "https://nvd.nist.gov/vuln/detail/CVE-2026-12345",
    "tags": ["security", "auth"]
  },
  "capturedAt": "2026-05-12T11:30:00Z",
  "actor": "web-scan",
  "relatedOpportunities": [],
  "triageStatus": "pending"
}
```

**Response `404 Not Found`:**

```json
{
  "error": "NOT_FOUND",
  "message": "Fact not found"
}
```

---

### 3. List Opportunity Signals

Retrieve opportunity signals with lifecycle filtering.

```
GET /api/intake/opportunities
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | — | Filter by status (`draft`, `validated`, `accepted`, `scheduled`, `rejected`) |
| `impactEstimate` | string | — | Filter by impact (`low`, `medium`, `high`) |
| `since` | ISO-8601 | — | Return signals created after this timestamp |
| `limit` | integer | `50` | Max results (1–200) |
| `cursor` | string | — | Pagination cursor |

**Response `200 OK`:**

```json
{
  "items": [
    {
      "id": "opp-a1b2c3d4",
      "title": "Adopt OAuth2 PKCE for mobile clients",
      "status": "validated",
      "hypothesis": "Switching to PKCE will eliminate the client secret requirement for mobile apps, reducing secret management overhead.",
      "impactEstimate": "high",
      "effortEstimate": "medium",
      "relatedModules": ["src/auth", "src/mobile"],
      "sourceFacts": ["fact-e5f6g7h8"],
      "experiment": {
        "description": "Migrate one OAuth client to PKCE and verify token flow end-to-end.",
        "durationDays": 5
      },
      "acceptanceGate": {
        "criteria": [
          "Token exchange succeeds without client secret",
          "Existing desktop OAuth flow unaffected"
        ]
      },
      "createdAt": "2026-05-10T08:00:00Z",
      "updatedAt": "2026-05-11T14:00:00Z"
    }
  ],
  "nextCursor": null,
  "totalEstimate": 7
}
```

**Data source:** `.github/ai-state/opportunity-signals/opp-*.json`

---

### 4. Get Opportunity Signal Detail

```
GET /api/intake/opportunities/:id
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Opportunity signal ID (e.g. `opp-a1b2c3d4`) |

**Response `200 OK`:** Same shape as a single item in the list response,
plus full `sourceFacts` detail.

```json
{
  "id": "opp-a1b2c3d4",
  "title": "Adopt OAuth2 PKCE for mobile clients",
  "status": "validated",
  "hypothesis": "Switching to PKCE will eliminate the client secret requirement for mobile apps.",
  "impactEstimate": "high",
  "effortEstimate": "medium",
  "relatedModules": ["src/auth", "src/mobile"],
  "sourceFacts": [
    {
      "factId": "fact-e5f6g7h8",
      "subject": "Mobile team OAuth feedback",
      "claim": "Client secret rotation is the #1 pain point for mobile releases.",
      "sourceReliability": "reported",
      "capturedAt": "2026-05-09T16:00:00Z"
    }
  ],
  "experiment": {
    "description": "Migrate one OAuth client to PKCE and verify token flow end-to-end.",
    "durationDays": 5
  },
  "acceptanceGate": {
    "criteria": [
      "Token exchange succeeds without client secret",
      "Existing desktop OAuth flow unaffected"
    ]
  },
  "createdAt": "2026-05-10T08:00:00Z",
  "updatedAt": "2026-05-11T14:00:00Z"
}
```

**Response `404 Not Found`:**

```json
{
  "error": "NOT_FOUND",
  "message": "Opportunity signal not found"
}
```

---

### 5. List Risk Signals

Retrieve combined internal and external risk signals.

```
GET /api/intake/risks
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `domain` | string | — | Filter by domain (`compliance`, `security`, `product`, `runtime`, `market`) |
| `severity` | string | — | Filter by severity (`info`, `low`, `medium`, `high`, `critical`) |
| `status` | string | — | Filter by status (`open`, `acknowledged`, `mitigated`, `accepted`) |
| `source` | string | — | Filter by origin (`internal`, `external`) |
| `since` | ISO-8601 | — | Return signals active after this timestamp |
| `limit` | integer | `50` | Max results (1–200) |
| `cursor` | string | — | Pagination cursor |

**Response `200 OK`:**

```json
{
  "items": [
    {
      "id": "CVE-2026-12345",
      "domain": "security",
      "severity": "critical",
      "status": "open",
      "source": "external",
      "title": "NestJS middleware ordering vulnerability",
      "affectedAreas": ["src/auth/**"],
      "scoreWeight": 40,
      "sourceFact": "fact-x1y2z3",
      "capturedAt": "2026-05-12T11:30:00Z",
      "updatedAt": "2026-05-12T11:30:00Z"
    },
    {
      "id": "internal-tsc-failure",
      "domain": "runtime",
      "severity": "high",
      "status": "open",
      "source": "internal",
      "title": "tsc check failing on main branch",
      "affectedAreas": ["src/**"],
      "scoreWeight": 25,
      "sourceFact": null,
      "capturedAt": "2026-05-12T09:00:00Z",
      "updatedAt": "2026-05-12T09:00:00Z"
    }
  ],
  "nextCursor": null,
  "totalEstimate": 5,
  "combinedRiskScore": 65
}
```

**Data sources:**

| Source | File |
|--------|------|
| External risks | `.github/ai-state/risk-signals.json` |
| Internal meta-signals | `.github/ai-state/meta-signals.json` |
| Gap ledger entries | `.github/ai-state/gap-ledger.ndjson` |

The `combinedRiskScore` is computed as:

```
combinedRiskScore = internalRiskScore + (untriagedHighSeverityCount * 5)
```

This matches the formula in
[external-intake-webui-concept.md](external-intake-webui-concept.md) §
Risk Signal Dashboard.

---

### 6. Get Risk Signal Detail

```
GET /api/intake/risks/:id
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Risk signal ID |

**Response `200 OK`:** Same shape as a single item in the list response.

**Response `404 Not Found`:**

```json
{
  "error": "NOT_FOUND",
  "message": "Risk signal not found"
}
```

---

### 7. List Idea Gate Results

Retrieve agent idea review gate decisions.

```
GET /api/intake/gate-results
```

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `decision` | string | — | Filter by decision (`promote`, `reject`, `defer`) |
| `gateType` | string | — | Filter by gate type (`idea-review`) |
| `since` | ISO-8601 | — | Return results evaluated after this timestamp |
| `limit` | integer | `50` | Max results (1–200) |
| `cursor` | string | — | Pagination cursor |

**Response `200 OK`:**

```json
{
  "items": [
    {
      "schemaVersion": 1,
      "gateType": "idea-review",
      "decision": "promote",
      "markerId": "idea-opp-a1b2c3d4-review",
      "capturedAt": "2026-05-11T15:00:00Z",
      "targetIdea": "opp-a1b2c3d4",
      "factsRead": [
        {
          "source": "opportunity-signal",
          "summary": "Opportunity has validated hypothesis and bounded experiment"
        },
        {
          "source": "main-health.json",
          "summary": "Main branch health: green"
        }
      ],
      "blockers": [],
      "warnings": [
        {
          "code": "SCOPE_MEDIUM",
          "message": "Effort estimate is medium; consider splitting into smaller experiments."
        }
      ],
      "producedFacts": [
        { "key": "novelty-score", "value": "0.72" },
        { "key": "scope-feasibility", "value": "pass" },
        { "key": "architectural-fit", "value": "pass" }
      ]
    }
  ],
  "nextCursor": null,
  "totalEstimate": 12
}
```

**Data source:** Fact events with `eventType` matching gate result patterns
in `.github/ai-state/fact-events.ndjson`, or dedicated gate result files
under `.github/ai-state/gate-results/`.

---

### 8. Get Idea Gate Result Detail

```
GET /api/intake/gate-results/:markerId
```

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `markerId` | string | Gate result marker ID (e.g. `idea-opp-a1b2c3d4-review`) |

**Response `200 OK`:** Same shape as a single item in the list response.

**Response `404 Not Found`:**

```json
{
  "error": "NOT_FOUND",
  "message": "Gate result not found"
}
```

---

### 9. Intake Summary

Aggregate counts for dashboard summary cards.

```
GET /api/intake/summary
```

**Response `200 OK`:**

```json
{
  "facts": {
    "total": 142,
    "untriaged": 8,
    "bySeverity": {
      "critical": 1,
      "high": 3,
      "medium": 2,
      "low": 2
    }
  },
  "opportunities": {
    "total": 7,
    "byStatus": {
      "draft": 2,
      "validated": 3,
      "accepted": 1,
      "scheduled": 1,
      "rejected": 0
    }
  },
  "risks": {
    "total": 5,
    "combinedScore": 65,
    "bySeverity": {
      "critical": 1,
      "high": 2,
      "medium": 1,
      "low": 1
    }
  },
  "gateResults": {
    "total": 12,
    "recentPromotions": 3,
    "recentRejections": 1
  }
}
```

---

### 10. Intake Health

Server health check.

```
GET /api/intake/health
```

**Response `200 OK`:**

```json
{
  "ok": true,
  "uptime": 123.456,
  "dataSources": {
    "factEvents": { "ok": true, "lastModified": "2026-05-12T11:30:00Z" },
    "opportunitySignals": { "ok": true, "lastModified": "2026-05-11T14:00:00Z" },
    "riskSignals": { "ok": true, "lastModified": "2026-05-12T11:30:00Z" },
    "metaSignals": { "ok": true, "lastModified": "2026-05-12T10:00:00Z" }
  }
}
```

If a data source is missing or unreadable, `ok` is `false` for that source
and the endpoint returns `200` with degraded status. Consumers should
check individual source health.

---

## Error Responses

All endpoints use consistent error shapes.

| Status | Code | Meaning |
|--------|------|---------|
| `400` | `INVALID_PARAMETER` | Query parameter out of range or malformed |
| `404` | `NOT_FOUND` | Resource does not exist |
| `500` | `INTERNAL_ERROR` | Server-side failure |

**Error shape:**

```json
{
  "error": "INVALID_PARAMETER",
  "message": "limit must be between 1 and 200",
  "field": "limit"
}
```

---

## Pagination

List endpoints support cursor-based pagination. The `nextCursor` field in
the response is `null` when no more results are available. Pass the cursor
value as the `cursor` query parameter to fetch the next page.

Cursors are opaque strings — clients must not parse or construct them.

---

## Security Model

| Constraint | Enforcement |
|------------|------------|
| Local-only binding | Server listens on `127.0.0.1`, not `0.0.0.0` |
| No secrets served | All data is pre-sanitized before storage |
| Read-only | No POST/PUT/DELETE endpoints in this sketch |
| No raw payloads | Evidence URLs are sanitized; no embedded credentials |
| Injection-safe | Responses do not include raw external text without sanitization |

---

## Integration Points

### Fact Event Ledger

Endpoints 1 and 2 read from `.github/ai-state/fact-events.ndjson`. The
API server tails the NDJSON file and indexes entries in memory. New entries
appear after the next file poll (implementation-defined interval).

### Opportunity Signals

Endpoints 3 and 4 read from `.github/ai-state/opportunity-signals/`.
Each `opp-*.json` file is an independent signal. The API server scans the
directory and filters by status.

### Risk Signals

Endpoints 5 and 6 combine data from:
- `.github/ai-state/risk-signals.json` (external risks)
- `.github/ai-state/meta-signals.json` (internal risk score)
- `.github/ai-state/gap-ledger.ndjson` (gap-based risks)

### Idea Gate Results

Endpoints 7 and 8 read from gate result records in the fact event ledger
or dedicated gate result files.

### WebUI Dashboard

The summary endpoint (9) is designed for the dashboard header cards defined
in [external-intake-webui-concept.md](external-intake-webui-concept.md) §
Risk Signal Dashboard. The health endpoint (10) supports the dashboard's
data-source status indicators.

---

## Implementation Notes

- **No separate database.** All data lives in `.github/ai-state/` files.
  The API server reads files directly, consistent with the provider pool
  WebUI server pattern.
- **In-memory index.** For acceptable read performance, the server
  maintains an in-memory index of facts, opportunities, and gate results.
  The index rebuilds on file change (via `fs.watch` or polling).
- **Zero dependencies.** Built on Node.js built-in modules only, matching
  the provider pool WebUI server approach.
- **Future write endpoints.** When write endpoints are needed (e.g.,
  triage actions, opportunity status transitions), they should delegate
  to the executable loop scripts rather than writing state files directly.

---

## References

- [External Intake WebUI Concept](external-intake-webui-concept.md) — WebUI view definitions
- [External Intake Executable Loop](external-intake-executable-loop.md) — Intake pipeline stages
- [External Facts Schema](external-facts-schema.md) — External fact entry fields
- [Opportunity Signal Schema](opportunity-signal-schema.md) — Opportunity signal fields
- [Risk Signal Schema](risk-signal-schema.md) — Risk signal fields
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Idea promotion criteria
- [Gate Result Schema](gate-result-schema.md) — Gate result fields
- [Provider Pool WebUI Server](provider-pool-webui-server.md) — Reference implementation pattern
- [#982](https://github.com/taoyu051818-sys/lian-nest-server/issues/982) — This feature
