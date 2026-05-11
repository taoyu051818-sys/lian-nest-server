# Provider Key WebUI Test Index

Test coverage map for the provider key management WebUI feature
(`provider.testKey` and `provider.rotateKey` actions, Provider
Settings panel, and key health indicators).

> **Closes:** [#820](https://github.com/taoyu051818-sys/lian-nest-server/issues/820)
> **Parent design:** [Provider Key Management WebUI](provider-key-management-webui.md)
> **API contract:** [Provider Key Management API](../contracts/provider-key-management-api.md)

---

## Test Categories

### Action Module Tests

| Test file | Action module | Coverage | Status |
|-----------|---------------|----------|--------|
| `actions/provider-test-key.test.js` | `provider.testKey` | Preview payload shape, execute returns valid/auth-failure/timeout/network-error, confirmation token `TEST`, no secrets in result, provider-not-found 404, missing-providerId 400 | Missing |
| `actions/provider-rotate-key.test.js` | `provider.rotateKey` | Preview shows rotation steps and masked source, execute resets state and runs probe, confirmation token `ROTATE <id>` exact match, not-rotatable 409, provider-not-found 404, probe-failure re-disables, audit entry written | Missing |

### Library / Integration Tests

| Test file | Module under test | Coverage | Status |
|-----------|-------------------|----------|--------|
| `provider-settings-panel.test.js` | Provider Settings panel | Panel renders for each provider, health badge derivation (valid/auth-failure/unknown/testing), source type display, masked source key, last auth event timestamp, cooldown display | Missing |
| `key-health-badge.test.js` | Key health badge logic | Badge mapping from `lastFailureClass`, unknown state when no history, testing pulse during probe, transitions between states | Missing |
| `auth-probe.test.js` | Auth probe utility | Probe uses existing credential resolution, 10s timeout, single attempt (no retries), result recorded in history, credential never in response | Missing |

### Security Tests

| Test file | Coverage | Status |
|-----------|----------|--------|
| `provider-key-secrets.test.js` | No raw key in any preview/execute response, `sanitizeObject` scrubs credential fields, masked key uses glob masking only, audit payloads are secret-free | Missing |
| `provider-key-confirmation.test.js` | `provider.rotateKey` requires exact `ROTATE <providerId>` token, `provider.testKey` requires `TEST`, mismatched token returns 409, empty token rejected | Missing |
| `provider-key-human-gate.test.js` | `provider.rotateKey` has `humanRequired: true`, `provider.testKey` does not require human gate, rotation cannot proceed without typed confirmation | Missing |

### Smoke / E2E Tests

| Test file | Coverage | Status |
|-----------|----------|--------|
| `provider-settings-smoke.test.js` | Provider Settings tab loads, provider rows render with correct fields, Test Key button triggers preview, Rotate Key button shows confirmation dialog, rotation workflow end-to-end (preview → confirm → execute → probe → audit) | Missing |

---

## Coverage Gaps

The following areas have no test coverage yet:

1. **All action module tests** — `provider.testKey` and `provider.rotateKey` modules do not exist.
2. **Provider Settings panel** — No UI component tests for the third tab.
3. **Auth probe utility** — No tests for the lightweight auth probe behavior.
4. **Key health badge derivation** — No tests for badge state machine logic.
5. **Secret isolation** — No tests verifying that key material never leaks through the provider key actions.
6. **Confirmation token enforcement** — No tests for the `ROTATE <id>` exact-match gate.
7. **Post-rotation probe failure** — No tests for the re-disable path when a rotated key still fails.
8. **Rotation precondition checks** — No tests for the `disabled` + `auth` failure class requirement.

---

## Test Infrastructure Notes

- All tests should be self-contained Node.js scripts using inline `assert()`.
- Run individually with `node <path>`.
- Action module tests should follow the pattern established in
  `tools/provider-pool-webui/tests/actions/*.test.js`.
- Security tests should verify that `sanitizeObject` is applied to all
  preview and execute payloads.
- The auth probe test should mock the provider API to avoid billable calls.

---

## References

- [Provider Key Management WebUI](provider-key-management-webui.md) — full design doc
- [Provider Key Management API Contract](../contracts/provider-key-management-api.md) — endpoint contract
- [Provider Pool WebUI Test Index](../tools/provider-pool-webui/README.md#test-index) — existing test pattern
- [WebUI Control Map](webui-control-map.md) — action risk gates
- [Provider Pool WebUI Security](provider-pool-webui-security.md) — security model
