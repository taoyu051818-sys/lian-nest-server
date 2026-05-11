# Legacy Freeze Rules

Rules governing how legacy backend code may (and may not) be used in this repository.

## Core Principle

The legacy backend is a **behavior reference only**. It is not a code dependency.

## Rules

### 1. No Direct Imports

Do not import, require, or dynamically load any module from the legacy backend.
The Nest rewrite must stand on its own.

**Forbidden:**
```js
const legacy = require('../../old-backend/lib/topics');
```

**Allowed:**
- Reading legacy source files during development for understanding behavior.
- Documenting legacy behavior in `docs/contracts/` or `docs/migration/`.

### 2. No Legacy Runtime Dependencies

Do not add legacy backend packages to `package.json`.
If a Nest module needs a library the legacy backend uses, add it as a fresh dependency
with its own version resolution.

### 3. No Copy-Paste Migration

Do not copy large blocks of legacy code into the new backend.
Small utility snippets (under 20 lines) may be adapted if:

- They contain no legacy framework coupling (e.g., NodeBB plugin hooks).
- They are annotated with a comment noting the legacy origin.
- They are replaced with idiomatic Nest code when time permits.

### 4. Legacy Backend is Optional in CI

Tests and CI must not require the legacy backend to be running.
Contract verification should use:

- Static route inventory comparison (the `check-route-parity.js` script).
- Snapshot tests of expected response shapes.
- Manual review against the documented contract.

If a test needs the legacy backend, it must be gated behind an explicit
environment variable (e.g., `LEGACY_BACKEND_URL`) and skipped when unset.

### 5. Behavior Documentation Over Behavior Replication

When legacy behavior is ambiguous or surprising, document the behavior
in `docs/contracts/` rather than replicating the ambiguity. If the ambiguity
is intentional, flag it for product decision.

### 6. Freeze Boundaries

The legacy backend may change for critical security patches, but
feature work should target the Nest backend. Track any legacy changes
that affect route parity in this document's changelog below.

## Changelog

| Date | Legacy Change | Impact on Parity | Issue |
|------|---------------|-------------------|-------|
| --   | (none yet)    |                   |       |
