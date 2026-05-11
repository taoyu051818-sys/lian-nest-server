/**
 * NodeBB Module — shared types, auth modes, and response normalization.
 *
 * Every type consumed or produced by NodebbModule lives here so that
 * downstream modules import from '@nodebb' without reaching into internals.
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export enum NodebbAuthMode {
  /** Server-to-server: Authorization: Bearer <token> */
  API_TOKEN = 'api_token',
  /** User-context proxy: session cookie forwarded from browser */
  SESSION = 'session',
  /** Public endpoints that need no credentials */
  NONE = 'none',
}

export interface NodebbAuth {
  mode: NodebbAuthMode;
  token?: string;
  sessionCookie?: string;
}

// ---------------------------------------------------------------------------
// Response normalization
// ---------------------------------------------------------------------------

export enum BodyStatus {
  OK = 'ok',
  ERROR = 'error',
  NOT_FOUND = 'not_found',
}

export interface NodebbNormalizedResponse<T> {
  status: BodyStatus;
  statusCode: number;
  data: T | null;
  error: string | null;
}

/**
 * Build a success envelope.
 */
export function normalizeOk<T>(
  data: T,
  statusCode = 200,
): NodebbNormalizedResponse<T> {
  return { status: BodyStatus.OK, statusCode, data, error: null };
}

/**
 * Build an error envelope.
 */
export function normalizeError<T = null>(
  statusCode: number,
  message: string,
): NodebbNormalizedResponse<T> {
  const status =
    statusCode === 404 ? BodyStatus.NOT_FOUND : BodyStatus.ERROR;
  return { status, statusCode, data: null as T, error: message };
}

// ---------------------------------------------------------------------------
// Resource DTOs
// ---------------------------------------------------------------------------

export interface NodebbPaginated<T> {
  items: T[];
  totalCount: number;
  page: number;
  perPage: number;
}

export interface NodebbTopic {
  tid: number;
  uid: number;
  cid: number;
  title: string;
  slug: string;
  mainPid: number;
  postcount: number;
  viewcount: number;
  timestamp: number;
}

export interface NodebbPost {
  pid: number;
  tid: number;
  uid: number;
  content: string;
  timestamp: number;
  edited?: number;
  deleted?: boolean;
}

export interface NodebbUser {
  uid: number;
  username: string;
  userslug: string;
  email?: string;
  joindate: number;
  reputation: number;
  postcount: number;
}

export interface NodebbNotification {
  nid: string;
  type: string;
  bodyShort: string;
  bodyLong?: string;
  nidFrom: number;
  datetime: number;
  read: boolean;
}

export interface NodebbTag {
  value: string;
  score: number;
  color?: string;
}
