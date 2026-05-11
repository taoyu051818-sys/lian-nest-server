'use strict';

/**
 * audit-store.js
 *
 * Append-only sanitized WebUI action audit helper.
 * Writes sanitized JSONL events to a local audit log file.
 *
 * Key invariants:
 * - Append-only: never modifies or truncates the log file
 * - All string fields are sanitized before writing (secrets redacted)
 * - No raw stdout/stderr content is ever logged
 * - Dry-run by default; requires explicit --live to write
 */

const fs = require('node:fs');
const path = require('node:path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_AUDIT_PATH = path.join(REPO_ROOT, '.github', 'ai-state', 'webui-action-audit.jsonl');
const AUDIT_VERSION = 1;
const MAX_STRING_LENGTH = 500;

// ── Sanitization ─────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  // Long base64-like strings (potential tokens/keys)
  { pattern: /[A-Za-z0-9+/=]{40,}/g, replacement: '[redacted-token]' },
  // GitHub personal access tokens
  { pattern: /ghp_[A-Za-z0-9]+/g, replacement: '[redacted-gh-token]' },
  // GitHub OAuth tokens
  { pattern: /gho_[A-Za-z0-9]+/g, replacement: '[redacted-gh-oauth]' },
  // GitHub app tokens
  { pattern: /(ghu|ghs|ghr)_[A-Za-z0-9]+/g, replacement: '[redacted-gh-app]' },
  // Bearer tokens
  { pattern: /Bearer\s+\S+/gi, replacement: 'Bearer [redacted]' },
  // Basic auth
  { pattern: /Basic\s+[A-Za-z0-9+/=]+/gi, replacement: 'Basic [redacted]' },
  // Common secret key patterns
  { pattern: /(?:password|secret|token|api[_-]?key|auth)[=:]\s*\S+/gi, replacement: (match) => {
    const sep = match.includes('=') ? '=' : ':';
    const key = match.split(sep)[0].trim();
    return `${key}${sep}[redacted]`;
  }},
  // AWS-style keys
  { pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/g, replacement: '[redacted-aws-key]' },
  // JWT tokens (three dot-separated base64 segments)
  { pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: '[redacted-jwt]' },
  // Private key headers
  { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g, replacement: '[redacted-private-key]' },
];

/**
 * Sanitize a single string value.
 * Redacts potential secrets and truncates to MAX_STRING_LENGTH.
 */
function sanitizeString(text) {
  if (typeof text !== 'string') return text;
  let result = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    if (typeof replacement === 'function') {
      result = result.replace(pattern, replacement);
    } else {
      result = result.replace(pattern, replacement);
    }
  }
  return result.slice(0, MAX_STRING_LENGTH);
}

/**
 * Recursively sanitize all string values in an object.
 * Arrays and nested objects are traversed depth-first.
 */
function sanitizeValue(value) {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeObject(value);
  }
  return value;
}

/**
 * Sanitize all string values in a flat object.
 */
function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeValue(value);
  }
  return sanitized;
}

// ── Stdout/stderr redaction ──────────────────────────────────────────────────

/**
 * Check if a string looks like raw stdout/stderr output.
 * Returns true for strings containing ANSI escape codes, process output markers,
 * or other terminal artifacts that should not be in audit logs.
 */
function looksLikeRawProcessOutput(text) {
  if (typeof text !== 'string') return false;
  // ANSI escape codes (raw ESC byte or escaped forms from JSON: , \x1b)
  if (/[\x1b\x9b][\[()#;?]*[0-9;]*[a-zA-Z]/.test(text)) return true;
  if (/\\(?:u00[1a][0-9a-f]|x[1a][0-9a-f])[\[()#;?]*[0-9;]*[a-zA-Z]/i.test(text)) return true;
  // Common process output markers
  if (/^(?:stdout|stderr|STDERR|STDOUT)[:\s]/i.test(text)) return true;
  // Excessively long single-line output (likely raw logs)
  if (text.length > 2000 && !text.includes('\n')) return true;
  return false;
}

// ── Audit entry building ─────────────────────────────────────────────────────

/**
 * Validate required fields for an audit entry.
 * Returns an error string if invalid, null if valid.
 */
function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return 'entry must be a non-null object';
  }
  if (!entry.action || typeof entry.action !== 'string') {
    return 'action is required and must be a non-empty string';
  }
  if (entry.action.length > 200) {
    return 'action must be 200 characters or fewer';
  }
  if (entry.details && typeof entry.details !== 'object') {
    return 'details must be an object if provided';
  }
  return null;
}

/**
 * Build a sanitized audit entry from raw input.
 * Applies all sanitization rules and adds metadata.
 */
function buildEntry({ action, actor, target, details, outcome }) {
  const entry = {
    auditVersion: AUDIT_VERSION,
    capturedAt: new Date().toISOString(),
    action: sanitizeString(action),
  };

  if (actor !== undefined && actor !== null) {
    entry.actor = sanitizeString(String(actor));
  }
  if (target !== undefined && target !== null) {
    entry.target = sanitizeString(String(target));
  }
  if (details !== undefined && details !== null) {
    // Reject raw stdout/stderr in details
    const detailsStr = JSON.stringify(details);
    if (looksLikeRawProcessOutput(detailsStr)) {
      entry.details = { _warning: 'raw process output redacted from audit' };
    } else {
      entry.details = sanitizeValue(details);
    }
  }
  if (outcome !== undefined && outcome !== null) {
    entry.outcome = sanitizeString(String(outcome));
  }

  return entry;
}

// ── File operations ──────────────────────────────────────────────────────────

/**
 * Append a single JSONL line to the audit file.
 * Creates the directory if needed. Never modifies existing content.
 */
function appendEntry(filePath, entry) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(filePath, line, 'utf8');
}

/**
 * Read all audit entries from a JSONL file.
 * Returns an empty array if the file doesn't exist.
 * Silently skips malformed lines.
 */
function readEntries(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const entries = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch {
        // Skip malformed lines
      }
    }
    return entries;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Count the number of entries in the audit file.
 */
function countEntries(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let count = 0;
    for (const line of content.split('\n')) {
      if (line.trim()) count++;
    }
    return count;
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create an audit store instance.
 *
 * @param {object} options
 * @param {string} [options.filePath] - Path to the JSONL audit file
 * @param {boolean} [options.dryRun] - If true, preview without writing (default: true)
 * @returns {object} Audit store instance
 */
function createAuditStore(options = {}) {
  const filePath = options.filePath || DEFAULT_AUDIT_PATH;
  const dryRun = options.dryRun !== false; // Default to dry-run

  return {
    /**
     * Record an action in the audit log.
     *
     * @param {object} entry
     * @param {string} entry.action - The action being audited (required)
     * @param {string} [entry.actor] - Who performed the action
     * @param {string} [entry.target] - What was acted upon
     * @param {object} [entry.details] - Additional context (will be sanitized)
     * @param {string} [entry.outcome] - Result of the action
     * @returns {{ ok: boolean, entry?: object, error?: string, dryRun: boolean }}
     */
    record(entry) {
      const validationError = validateEntry(entry);
      if (validationError) {
        return { ok: false, error: validationError, dryRun };
      }

      const sanitized = buildEntry(entry);

      if (dryRun) {
        return { ok: true, entry: sanitized, dryRun: true };
      }

      try {
        appendEntry(filePath, sanitized);
        return { ok: true, entry: sanitized, dryRun: false };
      } catch (err) {
        return { ok: false, error: `write failed: ${err.message}`, dryRun: false };
      }
    },

    /**
     * Read all entries from the audit log.
     * @returns {object[]} Array of audit entries
     */
    read() {
      return readEntries(filePath);
    },

    /**
     * Count entries in the audit log.
     * @returns {number}
     */
    count() {
      return countEntries(filePath);
    },

    /**
     * Get the configured file path.
     * @returns {string}
     */
    getPath() {
      return filePath;
    },

    /**
     * Check if running in dry-run mode.
     * @returns {boolean}
     */
    isDryRun() {
      return dryRun;
    },
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  createAuditStore,
  sanitizeString,
  sanitizeValue,
  sanitizeObject,
  looksLikeRawProcessOutput,
  validateEntry,
  buildEntry,
  appendEntry,
  readEntries,
  countEntries,
  AUDIT_VERSION,
  DEFAULT_AUDIT_PATH,
  MAX_STRING_LENGTH,
  SECRET_PATTERNS,
};
