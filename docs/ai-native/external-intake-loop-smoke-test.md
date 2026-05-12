# External Intake Loop Smoke Test Plan

Defines a minimal end-to-end smoke test for the external intake loop:
write fact, validate, calculate signals, idea gate, result writer.

> **Closes:** [#986](https://github.com/taoyu051818-sys/lian-nest-server/issues/986)
>
> **Cross-references:**
> [external-intake-executable-loop.md](external-intake-executable-loop.md) for the full loop protocol,
> [agent-idea-review-gate.md](agent-idea-review-gate.md) for gate criteria,
> [external-reality-intake.md](external-reality-intake.md) for the intake
> boundary contract.

---

## Audience

Operators and orchestrators who need to verify the external intake loop
works end-to-end after a change to any script in the pipeline.

---

## Pipeline Under Test

```
1. write-fact-event.js       → fact-events.ndjson
2. validate-external-fact.js → validates fact records
3. calculate-opportunity-signals.js → opportunity-signals-summary.json
4. check-agent-idea-gate.js  → agent-idea-gate-result.json
5. write-result-fact.js      → result fact appended to fact-events.ndjson
```

Each stage feeds the next. The smoke test exercises all five stages in
sequence using synthetic data and a temporary output directory so no
production state is modified.

---

## Preconditions

- Node.js available on PATH.
- Repository root is the current working directory.
- `.github/ai-state/` directory may or may not exist (scripts create it).

---

## Test Data

### Fact Event (Stage 1 input)

```json
{
  "type": "evidence.intake",
  "subject": "smoke-test external intake loop",
  "actor": "smoke-test",
  "facts": {
    "sourceClass": "github-issue",
    "reliabilityTier": "high",
    "rawHash": "aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344"
  }
}
```

### Idea Candidate (Stage 4 input)

Derived from the opportunity signal produced by Stage 3. The candidate
JSON is constructed by the test harness from the signal output:

```json
{
  "source": "meta-signal",
  "title": "Smoke test: verify intake loop end-to-end",
  "reason": "failureScore=0, topPain=none. Synthetic signal for smoke test.",
  "confidence": 80,
  "priority": "low",
  "signalValues": { "failureScore": 1, "frictionScore": 0, "riskScore": 0 },
  "signalCapturedAt": "<now>",
  "actionHint": "No action required — smoke test only.",
  "suggestedConflictGroup": "smoke-test-intake-loop",
  "suggestedAllowedFiles": ["docs/ai-native/external-intake-loop-smoke-test.md"],
  "suggestedWorkerType": "docs",
  "acceptanceCriteria": ["Smoke test completes without error"],
  "validationCommands": ["node scripts/ai/write-fact-event.js --self-test"]
}
```

---

## Stage-by-Stage Procedure

### Stage 1: Write Fact Event

**Script:** `write-fact-event.js`

**Command (dry-run):**

```bash
node scripts/ai/write-fact-event.js \
  --type evidence.intake \
  --subject "smoke-test external intake loop" \
  --actor "smoke-test" \
  --facts '{"sourceClass":"github-issue","reliabilityTier":"high","rawHash":"aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344"}'
```

**Command (live — writes to ledger):**

```bash
node scripts/ai/write-fact-event.js \
  --type evidence.intake \
  --subject "smoke-test external intake loop" \
  --actor "smoke-test" \
  --live \
  --facts '{"sourceClass":"github-issue","reliabilityTier":"high","rawHash":"aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344"}'
```

**Expected:**
- Exit code 0.
- In dry-run: event JSON printed to stdout, no file modified.
- In live: event appended to `.github/ai-state/fact-events.ndjson`.

**Verify:**

```bash
node scripts/ai/write-fact-event.js --self-test
```

Self-test must exit 0.

---

### Stage 2: Validate External Fact

**Script:** `validate-external-fact.js`

**Command:**

```bash
node scripts/ai/validate-external-fact.js \
  --json '{"sourceClass":"github-issue","capturedAt":"2026-05-12T10:00:00Z","reliabilityTier":"high","rawHash":"aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344"}'
```

**Expected:**
- Exit code 0.
- JSON output with `"valid": true`.

**Verify (also validates the ledger after live write):**

```bash
node scripts/ai/validate-external-fact.js \
  --file .github/ai-state/fact-events.ndjson
```

Exit code 0, `"valid": true`.

---

### Stage 3: Calculate Opportunity Signals

**Script:** `calculate-opportunity-signals.js`

**Command (stdout):**

```bash
node scripts/ai/calculate-opportunity-signals.js --stdout
```

**Command (dry-run):**

```bash
node scripts/ai/calculate-opportunity-signals.js --dryRun
```

**Expected:**
- Exit code 0.
- Output includes `signalCount` (0 or more).
- If fact events exist from Stage 1 live write and their reliability tier
  score >= 40, at least one signal candidate is produced.

**Verify:**

If `--stdout` is used, parse the JSON and confirm:
- `calculatedAt` is a valid ISO-8601 timestamp.
- `inputSources.factEvents` path is set.
- `signals` is an array.

---

### Stage 4: Agent Idea Gate

**Script:** `check-agent-idea-gate.js`

**Command (stdout):**

```bash
echo '{"source":"meta-signal","title":"Smoke test: verify intake loop end-to-end","reason":"failureScore=1. Synthetic signal for smoke test.","confidence":80,"priority":"low","signalValues":{"failureScore":1},"signalCapturedAt":"2026-05-12T10:00:00Z","actionHint":"No action required.","suggestedConflictGroup":"smoke-test-intake-loop","suggestedAllowedFiles":["docs/ai-native/external-intake-loop-smoke-test.md"],"suggestedWorkerType":"docs","acceptanceCriteria":["Smoke test completes without error"],"validationCommands":["node scripts/ai/write-fact-event.js --self-test"]}' | node scripts/ai/check-agent-idea-gate.js --stdin --stdout
```

**Expected:**
- Exit code 0 (promote or warn, not reject).
- JSON output with `gateType: "idea-review"`.
- `decision` is `"promote"` or `"warn"`.
- `blockers` array is empty.

---

### Stage 5: Write Result Fact

**Script:** `write-result-fact.js`

**Command (dry-run):**

```bash
node scripts/ai/write-result-fact.js \
  --kind worker.complete \
  --status pass \
  --validation "smoke-test PASS" \
  --actor smoke-test
```

**Command (live):**

```bash
node scripts/ai/write-result-fact.js \
  --kind worker.complete \
  --status pass \
  --validation "smoke-test PASS" \
  --actor smoke-test \
  --live
```

**Expected:**
- Exit code 0.
- In dry-run: event JSON printed to stdout.
- In live: event appended to `.github/ai-state/fact-events.ndjson`.

**Verify:**

```bash
node scripts/ai/write-result-fact.js --self-test
```

Self-test must exit 0.

---

## Full Sequence (Copy-Paste)

Run all five stages in order. Use `--live` only when you intend to
modify the ledger. For CI or read-only validation, omit `--live` to
stay in dry-run mode.

```bash
# Stage 1: Write fact event (dry-run)
node scripts/ai/write-fact-event.js \
  --type evidence.intake \
  --subject "smoke-test external intake loop" \
  --actor "smoke-test" \
  --facts '{"sourceClass":"github-issue","reliabilityTier":"high","rawHash":"aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344"}'

# Stage 2: Validate
node scripts/ai/validate-external-fact.js \
  --json '{"sourceClass":"github-issue","capturedAt":"2026-05-12T10:00:00Z","reliabilityTier":"high"}'

# Stage 3: Calculate signals (dry-run)
node scripts/ai/calculate-opportunity-signals.js --dryRun

# Stage 4: Idea gate
echo '{"source":"meta-signal","title":"Smoke test: verify intake loop end-to-end","reason":"failureScore=1. Synthetic.","confidence":80,"priority":"low","signalValues":{"failureScore":1},"signalCapturedAt":"2026-05-12T10:00:00Z","actionHint":"No action.","suggestedConflictGroup":"smoke-test-intake-loop","suggestedAllowedFiles":["docs/ai-native/external-intake-loop-smoke-test.md"],"suggestedWorkerType":"docs","acceptanceCriteria":["Smoke test completes without error"],"validationCommands":["node scripts/ai/write-fact-event.js --self-test"]}' | node scripts/ai/check-agent-idea-gate.js --stdin --stdout

# Stage 5: Result fact (dry-run)
node scripts/ai/write-result-fact.js \
  --kind worker.complete \
  --status pass \
  --validation "smoke-test PASS" \
  --actor smoke-test
```

---

## Pass Criteria

| Stage | Script | Exit Code | Key Assertion |
|-------|--------|:---------:|---------------|
| 1 | `write-fact-event.js` | 0 | Self-test passes; event JSON well-formed |
| 2 | `validate-external-fact.js` | 0 | `valid: true` for known-good record |
| 3 | `calculate-opportunity-signals.js` | 0 | JSON output with `signals` array |
| 4 | `check-agent-idea-gate.js` | 0 | `decision` is promote or warn; no blockers |
| 5 | `write-result-fact.js` | 0 | Self-test passes; event JSON well-formed |

All stages must exit 0. Any non-zero exit is a failure.

---

## Failure Modes

| Failure | Stage | Symptom | Recovery |
|---------|:-----:|---------|----------|
| Missing `--type` | 1 | Exit 2, stderr message | Pass `--type` argument |
| Invalid JSON in `--facts` | 1 | Exit 2 | Validate JSON syntax |
| Invalid `sourceClass` | 2 | Exit 1, `valid: false` | Use a known class from the enum |
| No fact events file | 3 | Exit 0, `signalCount: 0` | Write at least one `evidence.intake` event first |
| Gate rejects candidate | 4 | Exit 1, blockers present | Fix candidate fields per blocker message |
| Invalid `--kind` | 5 | Exit 2 | Use one of the allowed result kinds |

---

## Teardown

If the test was run with `--live`, remove the test entries from the
ledger:

```bash
# Remove smoke-test entries from fact-events.ndjson
grep -v '"smoke-test"' .github/ai-state/fact-events.ndjson > /tmp/fact-events-clean.ndjson
mv /tmp/fact-events-clean.ndjson .github/ai-state/fact-events.ndjson
```

In dry-run mode, no teardown is needed.

---

## References

- [External Intake Executable Loop](external-intake-executable-loop.md) — Full loop protocol
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Gate criteria
- [External Reality Intake](external-reality-intake.md) — Intake boundary contract
- [Fact Event Ledger](fact-event-ledger.md) — Append-only event log
- [Opportunity Signal Schema](opportunity-signal-schema.md) — Signal fields
- [Gate Result Schema](gate-result-schema.md) — Gate result JSON schema
