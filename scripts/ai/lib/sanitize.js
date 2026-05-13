'use strict';

function sanitize(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[A-Za-z0-9+/=]{40,}/g, '[redacted-token]')
    .replace(/ghp_[A-Za-z0-9]+/g, '[redacted-gh-token]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/password[=:]\s*\S+/gi, 'password=[redacted]')
    .replace(/secret[=:]\s*\S+/gi, 'secret=[redacted]')
    .replace(/token[=:]\s*\S+/gi, 'token=[redacted]')
    .slice(0, 500);
}

function sanitizeFacts(facts) {
  if (!facts || typeof facts !== 'object') return facts;
  const sanitized = {};
  for (const [key, value] of Object.entries(facts)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitize(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

module.exports = { sanitize, sanitizeFacts };
