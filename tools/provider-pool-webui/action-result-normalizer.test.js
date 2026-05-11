#!/usr/bin/env node

/**
 * action-result-normalizer.test.js
 *
 * Tests for the WebUI action result normalizer.
 * Self-contained, no external test framework.
 *
 * Run: node tools/provider-pool-webui/action-result-normalizer.test.js
 */

const {
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
} = require("./lib/action-result-normalizer");

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log("  PASS  " + name);
  } else {
    failed++;
    console.error("  FAIL  " + name);
  }
}

// --- Constants ---------------------------------------------------------------

console.log("\nConstants\n");

assert(SCHEMA_VERSION === 1, "SCHEMA_VERSION is 1");
assert(MAX_STRING_LENGTH === 500, "MAX_STRING_LENGTH is 500");
assert(MAX_ARRAY_LENGTH === 50, "MAX_ARRAY_LENGTH is 50");
assert(MAX_OBJECT_KEYS === 30, "MAX_OBJECT_KEYS is 30");

// --- redactSecrets -----------------------------------------------------------

console.log("\nredactSecrets\n");

{
  assert(redactSecrets("hello world") === "hello world", "leaves normal text unchanged");
  assert(
    redactSecrets("ghp_abc123xyz").includes("[redacted"),
    "redacts GitHub personal access token"
  );
  assert(
    redactSecrets("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc")
      .includes("[redacted"),
    "redacts Bearer JWT token"
  );
  assert(
    redactSecrets("AKIAIOSFODNN7EXAMPLE").includes("[redacted"),
    "redacts AWS key"
  );
  assert(
    redactSecrets("Basic dXNlcjpwYXNz").includes("[redacted"),
    "redacts Basic auth"
  );
  assert(
    typeof redactSecrets(null) === "object" || redactSecrets(null) === null,
    "handles null input"
  );
}

// --- capString ---------------------------------------------------------------

console.log("\ncapString\n");

{
  assert(capString("short") === "short", "leaves short strings unchanged");
  assert(capString("") === "", "leaves empty string unchanged");

  const long = "x".repeat(600);
  const capped = capString(long);
  assert(capped.length < 600, "caps long strings");
  assert(capped.includes("truncated"), "indicates truncation");
  assert(capped.includes("600"), "reports original length");

  const exact = "y".repeat(MAX_STRING_LENGTH);
  assert(capString(exact).length === MAX_STRING_LENGTH, "does not cap at exact limit");
}

// --- sanitizeValue -----------------------------------------------------------

console.log("\nsanitizeValue\n");

{
  assert(sanitizeValue(null) === null, "null passes through");
  assert(sanitizeValue(undefined) === undefined, "undefined passes through");
  assert(sanitizeValue(42) === 42, "number passes through");
  assert(sanitizeValue(true) === true, "boolean passes through");
  assert(sanitizeValue("hello") === "hello", "string passes through");

  const longStr = "a".repeat(600);
  assert(sanitizeValue(longStr).length < 600, "caps long strings");

  assert(
    sanitizeValue("ghp_secrettoken123").includes("[redacted"),
    "redacts secrets in strings"
  );

  const arr = [1, 2, 3];
  assert(Array.isArray(sanitizeValue(arr)), "arrays stay as arrays");
  assert(sanitizeValue(arr).length === 3, "array length preserved");

  const bigArr = Array.from({ length: 60 }, (_, i) => i);
  const sanitizedArr = sanitizeValue(bigArr);
  assert(sanitizedArr.length <= MAX_ARRAY_LENGTH + 1, "caps array length (plus truncation notice)");

  const obj = { a: 1, b: "test" };
  assert(typeof sanitizeValue(obj) === "object", "objects stay as objects");
  assert(sanitizeValue(obj).a === 1, "object values preserved");
}

// --- sanitizeObject ----------------------------------------------------------

console.log("\nsanitizeObject\n");

{
  assert(sanitizeObject(null) === null, "null passes through");
  assert(sanitizeObject(undefined) === undefined, "undefined passes through");

  const obj = { name: "test", value: 42 };
  const s = sanitizeObject(obj);
  assert(s.name === "test", "preserves normal keys");
  assert(s.value === 42, "preserves numeric values");

  const withSecret = { apiKey: "my-secret-key", normal: "ok" };
  const sanitized = sanitizeObject(withSecret);
  assert(sanitized.apiKey === "[redacted]", "redacts secret keys");
  assert(sanitized.normal === "ok", "preserves non-secret keys");

  const withToken = { token: "abc123", name: "test" };
  assert(sanitizeObject(withToken).token === "[redacted]", "redacts token key");

  const withPassword = { password: "hunter2", id: 1 };
  assert(sanitizeObject(withPassword).password === "[redacted]", "redacts password key");

  // Test key count capping
  const manyKeys = {};
  for (let i = 0; i < 40; i++) {
    manyKeys[`key${i}`] = i;
  }
  const cappedObj = sanitizeObject(manyKeys);
  assert(
    cappedObj._truncatedKeys !== undefined,
    "adds _truncatedKeys when object has too many keys"
  );
  assert(cappedObj._truncatedKeys === 10, "reports correct truncation count");
}

// --- classifyStatus ----------------------------------------------------------

console.log("\nclassifyStatus\n");

{
  assert(classifyStatus({ ok: true }) === "success", "ok:true -> success");
  assert(classifyStatus({ ok: false }) === "error", "ok:false -> error");
  assert(classifyStatus({ mode: "preview" }) === "preview", "mode:preview -> preview");
  assert(classifyStatus({ mode: "execute" }) === "executed", "mode:execute -> executed");
  assert(classifyStatus({ mode: "rejected" }) === "rejected", "mode:rejected -> rejected");
  assert(
    classifyStatus({ mode: "confirmation-required" }) === "confirmation-required",
    "mode:confirmation-required -> confirmation-required"
  );
  assert(classifyStatus({ status: "custom" }) === "custom", "custom status preserved");
  assert(classifyStatus(null) === "unknown", "null -> unknown");
  assert(classifyStatus({}) === "unknown", "empty object -> unknown");
}

// --- classifySeverity --------------------------------------------------------

console.log("\nclassifySeverity\n");

{
  assert(classifySeverity({ ok: true }) === "success", "ok:true -> success");
  assert(classifySeverity({ ok: false }) === "error", "ok:false -> error");
  assert(classifySeverity({ mode: "rejected" }) === "warning", "rejected -> warning");
  assert(
    classifySeverity({ mode: "confirmation-required" }) === "warning",
    "confirmation-required -> warning"
  );
  assert(classifySeverity({ mode: "preview" }) === "info", "preview -> info");
  assert(classifySeverity({ mode: "execute" }) === "success", "execute -> success");
  assert(classifySeverity(null) === "info", "null -> info");
  assert(classifySeverity({}) === "info", "empty object -> info");
}

// --- normalizeResult ---------------------------------------------------------

console.log("\nnormalizeResult\n");

{
  // Success result
  const success = normalizeResult({
    ok: true,
    action: "disable-provider",
    mode: "preview",
    changes: [{ field: "status", from: "available", to: "disabled" }],
    summary: "Disable provider-default",
    timestamp: "2026-05-12T00:00:00Z",
  });
  assert(success.schemaVersion === 1, "has schema version");
  assert(typeof success.normalizedAt === "string", "has normalizedAt");
  assert(success.status === "success", "status is success");
  assert(success.severity === "success", "severity is success");
  assert(success.ok === true, "ok is true");
  assert(success.mode === "preview", "mode preserved");
  assert(Array.isArray(success.changes), "changes preserved");
  assert(success.summary === "Disable provider-default", "summary preserved");
  assert(success.timestamp === "2026-05-12T00:00:00Z", "timestamp preserved");

  // Error result
  const error = normalizeResult({
    ok: false,
    action: "disable-provider",
    mode: "rejected",
    error: "Provider not found",
    errorCode: "PROVIDER_NOT_FOUND",
    timestamp: "2026-05-12T00:00:00Z",
  });
  assert(error.status === "error", "error status");
  assert(error.severity === "error", "error severity");
  assert(error.error === "Provider not found", "error message preserved");
  assert(error.errorCode === "PROVIDER_NOT_FOUND", "error code preserved");

  // With nextAction
  const withNext = normalizeResult({
    ok: false,
    mode: "confirmation-required",
    nextAction: "confirm-execute",
    changes: [{ field: "status" }],
    summary: "Would disable provider",
  });
  assert(withNext.nextAction === "confirm-execute", "nextAction preserved");
  assert(withNext.severity === "warning", "confirmation-required is warning");

  // With context
  const withCtx = normalizeResult(
    { ok: true, mode: "preview" },
    { actionId: "reset-cooldown", label: "Reset Cooldown" }
  );
  assert(withCtx.actionId === "reset-cooldown", "context actionId applied");
  assert(withCtx.label === "Reset Cooldown", "context label applied");

  // With audit
  const withAudit = normalizeResult({
    ok: true,
    mode: "execute",
    audit: { timestamp: "2026-05-12T00:00:00Z", actor: "webui" },
  });
  assert(withAudit.audit !== null, "audit preserved");
  assert(withAudit.audit.actor === "webui", "audit actor preserved");

  // Null result
  const nullResult = normalizeResult(null);
  assert(nullResult.ok === false, "null result has ok=false");
  assert(nullResult.error === "No result provided", "null result has error message");
  assert(nullResult.status === "unknown", "null result status is unknown");

  // Undefined result
  const undefResult = normalizeResult(undefined);
  assert(undefResult.ok === false, "undefined result has ok=false");

  // Result with secret in summary
  const secretSummary = normalizeResult({
    ok: true,
    summary: "Token ghp_abc123xyz was used",
  });
  assert(
    secretSummary.summary.includes("[redacted"),
    "secrets redacted from summary"
  );

  // Result with long summary
  const longSummary = normalizeResult({
    ok: true,
    summary: "x".repeat(600),
  });
  assert(longSummary.summary.length < 600, "long summary is capped");

  // Result with preview data
  const withPreview = normalizeResult({
    ok: true,
    mode: "preview",
    preview: { wouldReset: true, providerId: "provider-default" },
  });
  assert(withPreview.preview !== null, "preview data preserved");
  assert(withPreview.preview.wouldReset === true, "preview nested value preserved");

  // Result with result data
  const withResult = normalizeResult({
    ok: true,
    result: { reset: true, providerId: "provider-default" },
  });
  assert(withResult.result !== null, "result data preserved");
  assert(withResult.result.reset === true, "result nested value preserved");

  // Result with message
  const withMessage = normalizeResult({
    ok: true,
    message: "Action completed successfully",
  });
  assert(withMessage.message === "Action completed successfully", "message preserved");
}

// --- normalizeResults --------------------------------------------------------

console.log("\nnormalizeResults\n");

{
  const results = normalizeResults([
    { ok: true, mode: "preview" },
    { ok: false, error: "failed" },
    null,
  ]);
  assert(results.length === 3, "normalizes all results");
  assert(results[0].ok === true, "first result ok");
  assert(results[1].ok === false, "second result not ok");
  assert(results[2].ok === false, "null result handled");

  const empty = normalizeResults(null);
  assert(empty.length === 0, "null input returns empty array");

  const notArray = normalizeResults("not-an-array");
  assert(notArray.length === 0, "non-array input returns empty array");

  const withCtx = normalizeResults(
    [{ ok: true }],
    { actionId: "test-action", label: "Test" }
  );
  assert(withCtx[0].actionId === "test-action", "context applied to all results");
}

// --- Secret redaction in nested objects --------------------------------------

console.log("\nSecret redaction in nested objects\n");

{
  const result = normalizeResult({
    ok: true,
    summary: "Using apiKey=sk_live_abc123def456ghi789",
    details: {
      token: "secret-token-value",
      normalField: "safe value",
      nested: {
        password: "should-be-redacted",
        safe: "ok",
      },
    },
  });
  assert(
    !JSON.stringify(result).includes("sk_live_abc123def456ghi789"),
    "API key redacted from summary"
  );
}

// --- Edge cases --------------------------------------------------------------

console.log("\nEdge cases\n");

{
  // Empty object
  const empty = normalizeResult({});
  assert(empty.status === "unknown", "empty object status unknown");
  assert(empty.severity === "info", "empty object severity info");
  assert(empty.schemaVersion === 1, "empty object has schema version");

  // Object with only action
  const onlyAction = normalizeResult({ action: "test" });
  assert(onlyAction.status === "unknown", "only-action status unknown");

  // Boolean ok with no mode
  const boolOk = normalizeResult({ ok: true });
  assert(boolOk.status === "success", "bool ok -> success");
  assert(boolOk.severity === "success", "bool ok severity success");

  // Numeric error code
  const numericCode = normalizeResult({
    ok: false,
    errorCode: 404,
    error: "Not found",
  });
  assert(numericCode.errorCode === 404, "numeric error code preserved");

  // String code field
  const stringCode = normalizeResult({
    ok: false,
    code: "ERR_NOT_FOUND",
    error: "Not found",
  });
  assert(stringCode.errorCode === "ERR_NOT_FOUND", "string code mapped to errorCode");
}

// --- Boundary cases: redactSecrets -------------------------------------------

console.log("\nBoundary cases: redactSecrets\n");

{
  assert(redactSecrets("") === "", "empty string returns empty");
  assert(
    !redactSecrets("normal text with no secrets").includes("[redacted"),
    "clean text passes through"
  );
  assert(
    redactSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----")
      .includes("[redacted-private-key]"),
    "private key content redacted"
  );
  const multiSecret = "token=abc123 and password=xyz789";
  const redactedMulti = redactSecrets(multiSecret);
  assert(
    redactedMulti.includes("[redacted"),
    "multiple secrets in one string redacted"
  );
}

// --- Boundary cases: capString -----------------------------------------------

console.log("\nBoundary cases: capString\n");

{
  assert(capString(123) === 123, "non-string number passes through");
  assert(capString(null) === null, "null passes through");
  assert(capString(undefined) === undefined, "undefined passes through");
}

// --- Boundary cases: sanitizeValue -------------------------------------------

console.log("\nBoundary cases: sanitizeValue\n");

{
  assert(typeof sanitizeValue(NaN) === "number", "NaN passes through as number");
  assert(sanitizeValue(Infinity) === Infinity, "Infinity passes through");
  assert(sanitizeValue(0) === 0, "zero passes through");
  assert(sanitizeValue(false) === false, "false passes through");
  assert(sanitizeValue("") === "", "empty string passes through");

  const deep = { a: { b: { c: { d: { e: "deep" } } } } };
  assert(sanitizeValue(deep).a.b.c.d.e === "deep", "deeply nested values preserved");

  const arrWithSecrets = ["normal", "ghp_abc123xyz", "safe"];
  const sanitizedArr = sanitizeValue(arrWithSecrets);
  assert(!sanitizedArr[1].includes("ghp_abc"), "secrets in arrays redacted");
}

// --- Boundary cases: sanitizeObject ------------------------------------------

console.log("\nBoundary cases: sanitizeObject\n");

{
  const emptyObj = sanitizeObject({});
  assert(typeof emptyObj === "object" && emptyObj !== null, "empty object returns object");
  assert(Object.keys(emptyObj).length === 0, "empty object has no keys");

  const exactKeys = {};
  for (let i = 0; i < MAX_OBJECT_KEYS; i++) {
    exactKeys[`key${i}`] = i;
  }
  const exactSanitized = sanitizeObject(exactKeys);
  assert(exactSanitized._truncatedKeys === undefined, "exactly MAX_OBJECT_KEYS not truncated");

  const allSecrets = { apiKey: "a", token: "b", password: "c" };
  const allRedacted = sanitizeObject(allSecrets);
  assert(allRedacted.apiKey === "[redacted]", "all-secret apiKey redacted");
  assert(allRedacted.token === "[redacted]", "all-secret token redacted");
  assert(allRedacted.password === "[redacted]", "all-secret password redacted");

  const nestedSecrets = { normal: { apiKey: "secret-val", safe: "ok" } };
  const nestedSanitized = sanitizeObject(nestedSecrets);
  assert(nestedSanitized.normal.apiKey === "[redacted]", "nested secret key redacted");
  assert(nestedSanitized.normal.safe === "ok", "nested non-secret key preserved");
}

// --- Boundary cases: classifyStatus ------------------------------------------

console.log("\nBoundary cases: classifyStatus\n");

{
  // ok uses strict equality — non-boolean truthy/falsy values fall through
  assert(classifyStatus({ ok: "yes" }) === "unknown", "non-boolean ok string -> unknown");
  assert(classifyStatus({ ok: 0 }) === "unknown", "non-boolean ok 0 -> unknown");
  assert(classifyStatus({ ok: 1 }) === "unknown", "non-boolean ok 1 -> unknown");
  assert(
    classifyStatus({ ok: false, mode: "preview" }) === "error",
    "ok:false takes precedence over mode"
  );
  assert(
    classifyStatus({ ok: true, mode: "rejected" }) === "success",
    "ok:true takes precedence over mode"
  );
  assert(classifyStatus({ mode: "unknown-mode" }) === "unknown", "unknown mode -> unknown");
}

// --- Boundary cases: classifySeverity ----------------------------------------

console.log("\nBoundary cases: classifySeverity\n");

{
  // ok uses strict equality — non-boolean truthy/falsy values fall through
  assert(classifySeverity({ ok: "yes" }) === "info", "non-boolean ok string -> info");
  assert(classifySeverity({ ok: 0 }) === "info", "non-boolean ok 0 -> info");
  assert(classifySeverity({ ok: 1 }) === "info", "non-boolean ok 1 -> info");
  assert(
    classifySeverity({ ok: false, mode: "preview" }) === "error",
    "ok:false takes precedence over preview"
  );
  assert(
    classifySeverity({ ok: true, mode: "rejected" }) === "success",
    "ok:true takes precedence over rejected"
  );
  assert(classifySeverity({ mode: "unknown-mode" }) === "info", "unknown mode -> info");
  assert(
    classifySeverity({ ok: false, mode: "confirmation-required" }) === "warning",
    "confirmation-required still warning even with ok:false"
  );
}

// --- Boundary cases: normalizeResult -----------------------------------------

console.log("\nBoundary cases: normalizeResult\n");

{
  // Both errorCode and code — errorCode wins
  const bothCodes = normalizeResult({
    ok: false,
    errorCode: "PRIMARY",
    code: "SECONDARY",
    error: "fail",
  });
  assert(bothCodes.errorCode === "PRIMARY", "errorCode takes precedence over code");

  // Non-array changes field is dropped
  const nonArrayChanges = normalizeResult({ ok: true, changes: "not-an-array" });
  assert(nonArrayChanges.changes === undefined, "non-array changes dropped");

  // Context with only actionId
  const ctxActionOnly = normalizeResult({ ok: true }, { actionId: "test-id" });
  assert(ctxActionOnly.actionId === "test-id", "context actionId without label");
  assert(ctxActionOnly.label === null, "missing context label is null");

  // Context with only label
  const ctxLabelOnly = normalizeResult({ ok: true }, { label: "Test Label" });
  assert(ctxLabelOnly.label === "Test Label", "context label without actionId");

  // Audit object with secret fields
  const auditSecret = normalizeResult({
    ok: true,
    audit: { token: "secret-value", actor: "webui" },
  });
  assert(auditSecret.audit.token === "[redacted]", "audit secrets redacted");
  assert(auditSecret.audit.actor === "webui", "audit non-secret preserved");

  // Empty string summary is falsy, skipped
  const emptySummary = normalizeResult({ ok: true, summary: "" });
  assert(
    !("summary" in emptySummary) || emptySummary.summary === "",
    "empty summary handled"
  );

  // Zero numeric values preserved
  const zeroValues = normalizeResult({
    ok: true,
    changes: [{ count: 0, label: "" }],
  });
  assert(zeroValues.changes[0].count === 0, "zero numeric values preserved");

  // Minimal valid result
  const minimal = normalizeResult({ ok: true });
  assert(minimal.schemaVersion === 1, "minimal result has schema version");
  assert(minimal.status === "success", "minimal result status");
  assert(minimal.severity === "success", "minimal result severity");
}

// --- Boundary cases: normalizeResults ----------------------------------------

console.log("\nBoundary cases: normalizeResults\n");

{
  // Undefined entries
  const withUndefined = normalizeResults([undefined, { ok: true }, undefined]);
  assert(withUndefined.length === 3, "undefined entries preserved in length");
  assert(withUndefined[0].ok === false, "leading undefined -> ok=false");
  assert(withUndefined[2].ok === false, "trailing undefined -> ok=false");

  // Mixed primitive types
  const mixed = normalizeResults([{ ok: true }, "string", 42, null]);
  assert(mixed.length === 4, "mixed types preserved in length");
  assert(mixed[0].ok === true, "valid object entry works");
  assert(mixed[1].ok === false, "string entry -> ok=false");
  assert(mixed[2].ok === false, "number entry -> ok=false");
  assert(mixed[3].ok === false, "null entry -> ok=false");

  // Empty array
  const emptyArr = normalizeResults([]);
  assert(emptyArr.length === 0, "empty array returns empty");

  // Large array beyond MAX_ARRAY_LENGTH
  const bigArray = Array.from({ length: 60 }, (_, i) => ({ ok: true, index: i }));
  const normalizedBig = normalizeResults(bigArray);
  assert(normalizedBig.length === 60, "large array length preserved");
  assert(normalizedBig[59].ok === true, "last element in large array normalized");
}

// --- Redaction edge cases: SECRET_KEY_PATTERN key names ----------------------

console.log("\nRedaction edge cases: SECRET_KEY_PATTERN key names\n");

{
  // secret key
  const withSecret = { secret: "val1", safe: "ok" };
  assert(sanitizeObject(withSecret).secret === "[redacted]", "redacts 'secret' key");

  // credential key
  const withCred = { credential: "val2", safe: "ok" };
  assert(sanitizeObject(withCred).credential === "[redacted]", "redacts 'credential' key");

  // auth key
  const withAuth = { auth: "val3", safe: "ok" };
  assert(sanitizeObject(withAuth).auth === "[redacted]", "redacts 'auth' key");

  // private_key key
  const withPrivKey = { private_key: "val4", safe: "ok" };
  assert(sanitizeObject(withPrivKey).private_key === "[redacted]", "redacts 'private_key' key");

  // private-key key
  const withPrivDash = { "private-key": "val5", safe: "ok" };
  assert(sanitizeObject(withPrivDash)["private-key"] === "[redacted]", "redacts 'private-key' key");

  // api_key (underscore variant)
  const withUnderscore = { api_key: "val6", safe: "ok" };
  assert(sanitizeObject(withUnderscore).api_key === "[redacted]", "redacts 'api_key' key");

  // api-key (dash variant)
  const withDash = { "api-key": "val7", safe: "ok" };
  assert(sanitizeObject(withDash)["api-key"] === "[redacted]", "redacts 'api-key' key");

  // Case insensitivity: APIKEY
  const withUpper = { APIKEY: "val8", safe: "ok" };
  assert(sanitizeObject(withUpper).APIKEY === "[redacted]", "redacts uppercase APIKEY");

  // Case insensitivity: TOKEN
  const withUpperToken = { TOKEN: "val9", safe: "ok" };
  assert(sanitizeObject(withUpperToken).TOKEN === "[redacted]", "redacts uppercase TOKEN");

  // Case insensitivity: Password (mixed case)
  const withMixed = { Password: "val10", safe: "ok" };
  assert(sanitizeObject(withMixed).Password === "[redacted]", "redacts mixed-case Password");

  // auth_token compound
  const withAuthToken = { auth_token: "val11", safe: "ok" };
  assert(sanitizeObject(withAuthToken).auth_token === "[redacted]", "redacts 'auth_token' compound key");
}

// --- Redaction edge cases: SECRET_VALUE_PATTERNS variants --------------------

console.log("\nRedaction edge cases: SECRET_VALUE_PATTERNS variants\n");

{
  // GitHub gho_ token (OAuth)
  assert(
    redactSecrets("gho_abc123xyz").includes("[redacted"),
    "redacts GitHub gho_ token"
  );

  // GitHub ghs_ token (server-to-server)
  assert(
    redactSecrets("ghs_abc123xyz").includes("[redacted"),
    "redacts GitHub ghs_ token"
  );

  // GitHub ghu_ token (user-to-server)
  assert(
    redactSecrets("ghu_abc123xyz").includes("[redacted"),
    "redacts GitHub ghu_ token"
  );

  // AWS ASIA prefix (temporary credentials)
  assert(
    redactSecrets("ASIAIOSFODNN7EXAMPLE").includes("[redacted"),
    "redacts AWS ASIA key"
  );

  // credential=value pattern
  assert(
    redactSecrets("credential=mysecretvalue").includes("[redacted"),
    "redacts credential=value pattern"
  );

  // api_key=value pattern
  assert(
    redactSecrets("api_key=sk_live_12345").includes("[redacted"),
    "redacts api_key=value pattern"
  );

  // api-key=value pattern
  assert(
    redactSecrets("api-key=sk_live_12345").includes("[redacted"),
    "redacts api-key=value pattern"
  );

  // EC private key
  assert(
    redactSecrets("-----BEGIN EC PRIVATE KEY-----\nMIIEow...\n-----END EC PRIVATE KEY-----")
      .includes("[redacted-private-key]"),
    "EC private key redacted"
  );

  // DSA private key
  assert(
    redactSecrets("-----BEGIN DSA PRIVATE KEY-----\nMIIEow...\n-----END DSA PRIVATE KEY-----")
      .includes("[redacted-private-key]"),
    "DSA private key redacted"
  );

  // Long base64-like string (40+ chars, no whitespace)
  const longBase64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop"; // 42 chars
  assert(
    redactSecrets(longBase64).includes("[redacted"),
    "redacts long base64-like string (40+ chars)"
  );

  // Bearer with lowercase
  assert(
    redactSecrets("bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc")
      .includes("[redacted"),
    "redacts lowercase bearer token"
  );

  // Basic with lowercase
  assert(
    redactSecrets("basic dXNlcjpwYXNz").includes("[redacted"),
    "redacts lowercase basic auth"
  );
}

// --- Redaction edge cases: normalizeResult secret fields ---------------------

console.log("\nRedaction edge cases: normalizeResult secret fields\n");

{
  // Error message with secret
  const errorSecret = normalizeResult({
    ok: false,
    error: "Auth failed: token=ghp_secret123",
  });
  assert(
    errorSecret.error.includes("[redacted"),
    "secrets redacted from error field"
  );

  // Message with secret
  const msgSecret = normalizeResult({
    ok: true,
    message: "Connected with api_key=sk_live_abc123",
  });
  assert(
    msgSecret.message.includes("[redacted"),
    "secrets redacted from message field"
  );

  // Preview nested object with secret keys
  const previewSecret = normalizeResult({
    ok: true,
    mode: "preview",
    preview: { apiKey: "secret-val", providerId: "p1" },
  });
  assert(
    previewSecret.preview.apiKey === "[redacted]",
    "secret key redacted in preview nested object"
  );
  assert(
    previewSecret.preview.providerId === "p1",
    "non-secret key preserved in preview nested object"
  );

  // Result nested object with secret keys
  const resultSecret = normalizeResult({
    ok: true,
    result: { token: "abc123", name: "test" },
  });
  assert(
    resultSecret.result.token === "[redacted]",
    "secret key redacted in result nested object"
  );
  assert(
    resultSecret.result.name === "test",
    "non-secret key preserved in result nested object"
  );

  // Changes array with secret values
  const changesSecret = normalizeResult({
    ok: true,
    changes: [
      { field: "apiKey", from: "ghp_old123", to: "ghp_new456" },
      { field: "status", from: "available", to: "disabled" },
    ],
  });
  assert(
    !JSON.stringify(changesSecret.changes).includes("ghp_old123"),
    "secrets in changes array values redacted"
  );
  assert(
    !JSON.stringify(changesSecret.changes).includes("ghp_new456"),
    "second secret in changes array redacted"
  );

  // Audit nested with multiple secret keys
  const auditMulti = normalizeResult({
    ok: true,
    audit: { token: "t1", apiKey: "k1", password: "p1", actor: "admin" },
  });
  assert(auditMulti.audit.token === "[redacted]", "audit token redacted");
  assert(auditMulti.audit.apiKey === "[redacted]", "audit apiKey redacted");
  assert(auditMulti.audit.password === "[redacted]", "audit password redacted");
  assert(auditMulti.audit.actor === "admin", "audit actor preserved with multiple secrets");

  // Deeply nested secret
  const deepSecret = normalizeResult({
    ok: true,
    result: { level1: { level2: { apiKey: "deep-secret", safe: "ok" } } },
  });
  assert(
    deepSecret.result.level1.level2.apiKey === "[redacted]",
    "deeply nested secret key redacted"
  );
  assert(
    deepSecret.result.level1.level2.safe === "ok",
    "deeply nested non-secret key preserved"
  );
}

// --- Redaction edge cases: stable response shape -----------------------------

console.log("\nRedaction edge cases: stable response shape\n");

{
  // normalizedAt is valid ISO 8601
  const r = normalizeResult({ ok: true });
  assert(
    !isNaN(Date.parse(r.normalizedAt)),
    "normalizedAt is valid ISO 8601 date"
  );

  // schemaVersion is always present
  assert(r.schemaVersion === 1, "schemaVersion always present");

  // status is always a string
  assert(typeof r.status === "string", "status is always a string");

  // severity is always a string
  assert(typeof r.severity === "string", "severity is always a string");

  // actionId defaults to null when no context or raw.action
  const noAction = normalizeResult({ ok: true });
  assert(noAction.actionId === null, "actionId defaults to null");

  // label defaults to null when no context
  assert(noAction.label === null, "label defaults to null");

  // ok is boolean after normalization
  assert(typeof r.ok === "boolean", "ok is boolean type");

  // Normalized result has all expected top-level keys for success
  const successKeys = Object.keys(normalizeResult({ ok: true, mode: "preview" }));
  assert(successKeys.includes("schemaVersion"), "shape includes schemaVersion");
  assert(successKeys.includes("normalizedAt"), "shape includes normalizedAt");
  assert(successKeys.includes("status"), "shape includes status");
  assert(successKeys.includes("severity"), "shape includes severity");
  assert(successKeys.includes("ok"), "shape includes ok");
  assert(successKeys.includes("mode"), "shape includes mode for preview");

  // Normalized error result has error-specific keys
  const errKeys = Object.keys(normalizeResult({ ok: false, error: "fail", errorCode: "X" }));
  assert(errKeys.includes("error"), "error shape includes error");
  assert(errKeys.includes("errorCode"), "error shape includes errorCode");

  // Undefined raw fields are absent from output (not undefined-valued)
  const minimal = normalizeResult({ ok: true });
  assert(!("error" in minimal), "absent raw.error not in output");
  assert(!("errorCode" in minimal), "absent raw.errorCode not in output");
  assert(!("nextAction" in minimal), "absent raw.nextAction not in output");
  assert(!("changes" in minimal), "absent raw.changes not in output");
  assert(!("preview" in minimal), "absent raw.preview not in output");
  assert(!("result" in minimal), "absent raw.result not in output");
  assert(!("audit" in minimal), "absent raw.audit not in output");
  assert(!("message" in minimal), "absent raw.message not in output");

  // Falsy-but-valid values preserved (0, false, empty string)
  const falsyVals = normalizeResult({
    ok: true,
    changes: [{ count: 0, active: false, label: "" }],
  });
  assert(falsyVals.changes[0].count === 0, "zero preserved in changes");
  assert(falsyVals.changes[0].active === false, "false preserved in changes");
  assert(falsyVals.changes[0].label === "", "empty string preserved in changes");
}

// --- Summary -----------------------------------------------------------------

console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);
