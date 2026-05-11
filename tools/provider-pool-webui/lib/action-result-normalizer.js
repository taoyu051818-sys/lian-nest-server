"use strict";

/**
 * action-result-normalizer.js
 *
 * Normalizes action result payloads for consistent WebUI rendering.
 * Ensures every action result has a predictable shape regardless of
 * which action module or handler produced it.
 *
 * Key invariants:
 * - Secret-like fields are redacted before display
 * - Large output fields are capped to prevent UI overflow
 * - Error code, status, and nextAction are always preserved
 * - Output is sanitized machine-readable JSON
 */

// --- Constants ---------------------------------------------------------------

const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 50;
const MAX_OBJECT_KEYS = 30;
const SCHEMA_VERSION = 1;

// --- Secret patterns ---------------------------------------------------------

const SECRET_KEY_PATTERN =
  /(?:api[_-]?key|token|secret|password|credential|auth|private[_-]?key)/i;

const SECRET_VALUE_PATTERNS = [
  // Key=value pairs with secret-like keys
  {
    pattern:
      /(?:password|secret|token|api[_-]?key|auth|credential)[=:]\s*\S+/gi,
    replacement: (match) => {
      const sep = match.includes("=") ? "=" : ":";
      const key = match.split(sep)[0].trim();
      return key + sep + "[redacted]";
    },
  },
  // GitHub tokens
  { pattern: /gh[pousr]_[A-Za-z0-9]+/g, replacement: "[redacted-gh-token]" },
  // Bearer tokens
  { pattern: /Bearer\s+\S+/gi, replacement: "Bearer [redacted]" },
  // Basic auth
  { pattern: /Basic\s+[A-Za-z0-9+/=]+/gi, replacement: "Basic [redacted]" },
  // AWS-style keys
  { pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/g, replacement: "[redacted-aws-key]" },
  // JWT tokens
  {
    pattern:
      /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: "[redacted-jwt]",
  },
  // Long base64-like strings
  { pattern: /[A-Za-z0-9+/=]{40,}/g, replacement: "[redacted-token]" },
  // Private key headers
  {
    pattern:
      /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    replacement: "[redacted-private-key]",
  },
];

// --- Sanitization helpers ----------------------------------------------------

/**
 * Redact secret-like values in a string.
 */
function redactSecrets(text) {
  if (typeof text !== "string") return text;
  let result = text;
  for (const { pattern, replacement } of SECRET_VALUE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Cap a string to MAX_STRING_LENGTH.
 */
function capString(text) {
  if (typeof text !== "string") return text;
  if (text.length <= MAX_STRING_LENGTH) return text;
  return text.slice(0, MAX_STRING_LENGTH) + `...[truncated, ${text.length} chars total]`;
}

/**
 * Sanitize a single value: redact secrets, cap strings.
 */
function sanitizeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return capString(redactSecrets(value));
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const capped = value.slice(0, MAX_ARRAY_LENGTH);
    const result = capped.map(sanitizeValue);
    if (value.length > MAX_ARRAY_LENGTH) {
      result.push(`...[${value.length - MAX_ARRAY_LENGTH} more items truncated]`);
    }
    return result;
  }
  if (typeof value === "object") {
    return sanitizeObject(value);
  }
  return value;
}

/**
 * Sanitize an object: redact secret keys, cap string values, limit key count.
 */
function sanitizeObject(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const entries = Object.entries(obj);
  const capped = entries.slice(0, MAX_OBJECT_KEYS);
  const result = {};
  for (const [key, value] of capped) {
    if (SECRET_KEY_PATTERN.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = sanitizeValue(value);
    }
  }
  if (entries.length > MAX_OBJECT_KEYS) {
    result._truncatedKeys = entries.length - MAX_OBJECT_KEYS;
  }
  return result;
}

// --- Status classification ---------------------------------------------------

/**
 * Determine a normalized status string from a raw result.
 */
function classifyStatus(raw) {
  if (!raw || typeof raw !== "object") return "unknown";
  if (raw.ok === true) return "success";
  if (raw.ok === false) return "error";
  if (raw.mode === "preview") return "preview";
  if (raw.mode === "execute") return "executed";
  if (raw.mode === "rejected") return "rejected";
  if (raw.mode === "confirmation-required") return "confirmation-required";
  if (raw.status) return String(raw.status);
  return "unknown";
}

/**
 * Determine severity for UI display.
 */
function classifySeverity(raw) {
  if (!raw || typeof raw !== "object") return "info";
  // confirmation-required is always a warning (needs operator action)
  if (raw.mode === "confirmation-required") return "warning";
  // ok flag takes precedence over mode
  if (raw.ok === true) return "success";
  if (raw.ok === false) return "error";
  // Mode-based classification for results without explicit ok
  if (raw.mode === "preview") return "info";
  if (raw.mode === "execute") return "success";
  if (raw.mode === "rejected") return "warning";
  return "info";
}

// --- Main normalizer ---------------------------------------------------------

/**
 * Normalize an action result for consistent WebUI rendering.
 *
 * @param {object} raw - Raw action result from any handler/runner
 * @param {object} [context] - Optional context about the action
 * @param {string} [context.actionId] - The action identifier
 * @param {string} [context.label] - Human-readable action label
 * @returns {object} Normalized result
 */
function normalizeResult(raw, context) {
  const ctx = context || {};
  const status = classifyStatus(raw);
  const severity = classifySeverity(raw);

  const normalized = {
    schemaVersion: SCHEMA_VERSION,
    normalizedAt: new Date().toISOString(),
    actionId: ctx.actionId || (raw && raw.action) || null,
    label: ctx.label || null,
    status,
    severity,
  };

  if (!raw || typeof raw !== "object") {
    normalized.ok = false;
    normalized.error = "No result provided";
    return normalized;
  }

  // Preserve ok flag
  if (raw.ok !== undefined) {
    normalized.ok = !!raw.ok;
  }

  // Preserve mode
  if (raw.mode) {
    normalized.mode = sanitizeValue(raw.mode);
  }

  // Preserve error
  if (raw.error) {
    normalized.error = sanitizeValue(raw.error);
  }

  // Preserve error code
  if (raw.errorCode || raw.code) {
    normalized.errorCode = sanitizeValue(raw.errorCode || raw.code);
  }

  // Preserve nextAction
  if (raw.nextAction) {
    normalized.nextAction = sanitizeValue(raw.nextAction);
  }

  // Preserve changes array
  if (Array.isArray(raw.changes)) {
    normalized.changes = sanitizeValue(raw.changes);
  }

  // Preserve summary
  if (raw.summary) {
    normalized.summary = sanitizeValue(raw.summary);
  }

  // Preserve timestamp
  if (raw.timestamp) {
    normalized.timestamp = sanitizeValue(raw.timestamp);
  }

  // Preserve audit reference
  if (raw.audit) {
    normalized.audit = sanitizeValue(raw.audit);
  }

  // Preserve any additional result data
  if (raw.result) {
    normalized.result = sanitizeValue(raw.result);
  }

  // Preserve preview data
  if (raw.preview) {
    normalized.preview = sanitizeValue(raw.preview);
  }

  // Preserve message
  if (raw.message) {
    normalized.message = sanitizeValue(raw.message);
  }

  return normalized;
}

/**
 * Normalize an array of action results.
 *
 * @param {object[]} results - Array of raw results
 * @param {object} [context] - Shared context for all results
 * @returns {object[]} Array of normalized results
 */
function normalizeResults(results, context) {
  if (!Array.isArray(results)) return [];
  return results.map((r) => normalizeResult(r, context));
}

// --- Exports -----------------------------------------------------------------

module.exports = {
  normalizeResult,
  normalizeResults,
  sanitizeValue,
  sanitizeObject,
  redactSecrets,
  capString,
  classifyStatus,
  classifySeverity,
  SCHEMA_VERSION,
  MAX_STRING_LENGTH,
  MAX_ARRAY_LENGTH,
  MAX_OBJECT_KEYS,
  SECRET_KEY_PATTERN,
  SECRET_VALUE_PATTERNS,
};
