/**
 * NodeBB adapter error taxonomy — type-only contracts.
 *
 * These types classify errors from NodeBB API calls into categories
 * for structured error handling, health logging, and metrics.
 *
 * No runtime wiring — pure type definitions only.
 * See docs/architecture/nodebb-error-taxonomy.md for the full taxonomy.
 */

// ---------------------------------------------------------------------------
// Error categories
// ---------------------------------------------------------------------------

export enum NodebbErrorCategory {
  /** HTTP 4xx/5xx from NodeBB (transport-level failure). */
  HTTP_CLIENT = 'HTTP_CLIENT',
  /** HTTP 200 but NodeBB body has { status: "error" }. */
  BODY_STATUS = 'BODY_STATUS',
  /** Authentication or authorization failure. */
  AUTH = 'AUTH',
  /** Request or socket timeout. */
  TIMEOUT = 'TIMEOUT',
  /** Network-level failure (DNS, connection refused/reset). */
  NETWORK = 'NETWORK',
  /** Unclassified error. */
  UNKNOWN = 'UNKNOWN',
}

// ---------------------------------------------------------------------------
// Error codes — machine-readable identifiers within each category
// ---------------------------------------------------------------------------

export enum NodebbHttpErrorCode {
  HTTP_BAD_REQUEST = 'HTTP_BAD_REQUEST',
  HTTP_NOT_FOUND = 'HTTP_NOT_FOUND',
  HTTP_METHOD_NOT_ALLOWED = 'HTTP_METHOD_NOT_ALLOWED',
  HTTP_CONFLICT = 'HTTP_CONFLICT',
  HTTP_UNPROCESSABLE = 'HTTP_UNPROCESSABLE',
  HTTP_TOO_MANY_REQUESTS = 'HTTP_TOO_MANY_REQUESTS',
  HTTP_BAD_GATEWAY = 'HTTP_BAD_GATEWAY',
  HTTP_SERVICE_UNAVAILABLE = 'HTTP_SERVICE_UNAVAILABLE',
  HTTP_GATEWAY_TIMEOUT = 'HTTP_GATEWAY_TIMEOUT',
  HTTP_OTHER = 'HTTP_OTHER',
}

export enum NodebbAuthErrorCode {
  AUTH_UNAUTHORIZED = 'AUTH_UNAUTHORIZED',
  AUTH_FORBIDDEN = 'AUTH_FORBIDDEN',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_SESSION_INVALID = 'AUTH_SESSION_INVALID',
}

export enum NodebbTimeoutErrorCode {
  TIMEOUT_REQUEST = 'TIMEOUT_REQUEST',
  TIMEOUT_SOCKET = 'TIMEOUT_SOCKET',
  TIMEOUT_CONNECT = 'TIMEOUT_CONNECT',
}

export enum NodebbNetworkErrorCode {
  NETWORK_DNS = 'NETWORK_DNS',
  NETWORK_CONNECTION_REFUSED = 'NETWORK_CONNECTION_REFUSED',
  NETWORK_CONNECTION_RESET = 'NETWORK_CONNECTION_RESET',
  NETWORK_OTHER = 'NETWORK_OTHER',
}

export enum NodebbBodyErrorCode {
  BODY_ERROR = 'BODY_ERROR',
  BODY_NOT_FOUND = 'BODY_NOT_FOUND',
}

export enum NodebbUnknownErrorCode {
  UNKNOWN = 'UNKNOWN',
}

/**
 * Union of all error codes. Adapters use this to tag classified errors.
 */
export type NodebbErrorCode =
  | NodebbHttpErrorCode
  | NodebbAuthErrorCode
  | NodebbTimeoutErrorCode
  | NodebbNetworkErrorCode
  | NodebbBodyErrorCode
  | NodebbUnknownErrorCode;

// ---------------------------------------------------------------------------
// Classified error — the primary contract for service-layer consumers
// ---------------------------------------------------------------------------

/**
 * A classified NodeBB error. Wraps the original response metadata
 * with the resolved category and machine-readable error code.
 *
 * Adapters produce this; service-layer code consumes it.
 */
export interface NodebbClassifiedError {
  category: NodebbErrorCategory;
  code: NodebbErrorCode;
  /** Human-readable message from NodeBB or the adapter. */
  message: string;
  /** HTTP status code (0 if no HTTP response was received). */
  statusCode: number;
  /** Whether this error is retryable (guideline, not enforced). */
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// HTTP status → error code mapping (pure type-level reference)
// ---------------------------------------------------------------------------

/**
 * Maps HTTP status codes to their error code.
 * Use as a lookup reference in adapter classification logic.
 */
export interface NodebbHttpStatusCodeMap {
  400: NodebbHttpErrorCode.HTTP_BAD_REQUEST;
  401: NodebbAuthErrorCode.AUTH_UNAUTHORIZED;
  403: NodebbAuthErrorCode.AUTH_FORBIDDEN;
  404: NodebbHttpErrorCode.HTTP_NOT_FOUND;
  405: NodebbHttpErrorCode.HTTP_METHOD_NOT_ALLOWED;
  408: NodebbTimeoutErrorCode.TIMEOUT_REQUEST;
  409: NodebbHttpErrorCode.HTTP_CONFLICT;
  422: NodebbHttpErrorCode.HTTP_UNPROCESSABLE;
  429: NodebbHttpErrorCode.HTTP_TOO_MANY_REQUESTS;
  502: NodebbHttpErrorCode.HTTP_BAD_GATEWAY;
  503: NodebbHttpErrorCode.HTTP_SERVICE_UNAVAILABLE;
  504: NodebbHttpErrorCode.HTTP_GATEWAY_TIMEOUT;
}

// ---------------------------------------------------------------------------
// Retryability defaults by category
// ---------------------------------------------------------------------------

/**
 * Default retryability per category. Adapters may override per-code.
 *
 * Guideline values:
 *   HTTP_CLIENT  → false  (client errors are not retryable; server errors may be)
 *   BODY_STATUS  → false  (NodeBB business-logic rejection)
 *   AUTH         → false  (must re-authenticate, not retry)
 *   TIMEOUT      → true   (retry with backoff)
 *   NETWORK      → true   (retry with backoff, circuit-break)
 *   UNKNOWN      → false  (do not retry blindly)
 */
export type NodebbRetryableByCategory = {
  readonly [K in NodebbErrorCategory]: boolean;
};
