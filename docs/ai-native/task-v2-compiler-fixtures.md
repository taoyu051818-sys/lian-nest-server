# Task-v2 Compiler Fixture Coverage

Fixture-driven test suite for the issue-to-task compiler v2 output mode.

**Test script**: [`scripts/ai/compile-issue-to-task-json.v2.test.ps1`](../../scripts/ai/compile-issue-to-task-json.v2.test.ps1)

## What This Covers

The test script exercises the compiler's `-OutputMode v2` path without
modifying the compiler implementation. Each fixture is an inline JSON
blob fed to the compiler via temp files.

### Fixture Inventory

| # | Name | Asserts |
|---|---|---|
| 1 | Full v2 — all promoted fields | `actorRole`, `roleDescription`, `attentionFocus`, `knownBlindspots`, `requiredReviewRoles`, `acceptanceOwner` promoted to top-level; `validation` replaces `validationCommands`; `budget` replaces `budgets`; v1 compat wrappers (`rolePacket`, `attentionAreas`, `reviewAndAcceptance`) still present |
| 2 | workerClass passthrough | `workerClass` from input is preserved verbatim |
| 3 | workerClass derivation | When `workerClass` is omitted, compiler derives it from `conflictGroup` |
| 4 | v2-only optional fields | `writeSet`, `sharedLocks`, `dependsOnFacts`, `producesFacts`, `telemetry`, `rollbackPlan`, `sourceOfTruthDocs`, `blockedBy`, `mainHealthPolicy`, `generatedCodePolicy` all pass through |
| 5 | v1 compat wrappers preserved | Nested v1 wrappers remain alongside promoted top-level fields |
| 6 | LLM contract validation | `llmExtracted=true` with `knowledgeRefs` and `promptHandoff` present passes cleanly |
| 7 | LLM contract warning path | `llmExtracted=true` without semantic fields emits warnings but still produces output |
| 8 | Minimal v1 input in v2 mode | Bare-minimum v1 input compiles to v2; absent optional v2 fields stay absent |
| 9 | Error: missing `allowedFiles` | Compiler exits non-zero |
| 10 | Error: invalid `taskType` | Compiler exits non-zero |
| 11 | Error: invalid `risk` | Compiler exits non-zero |
| 12 | Error: empty `actorRole` | Compiler exits non-zero |
| 13 | `sourceIssue` auto-generated | URL constructed from `targetIssue` |
| 14 | v1 mode regression guard | v1 output retains `validationCommands`, does not emit `validation` or `actorRole` |

### Assertion Categories

- **Field promotion**: v1 nested fields appear at top-level in v2 output
- **Field rename**: `validationCommands`→`validation`, `budgets`→`budget`
- **Field passthrough**: v2-only fields from input appear in output unchanged
- **Compat wrappers**: v1 wrappers (`rolePacket`, `attentionAreas`, `reviewAndAcceptance`) preserved
- **workerClass derivation**: defaults to `conflictGroup` when omitted
- **LLM contract**: warns on missing semantic fields, does not block
- **Error rejection**: missing/invalid required fields cause non-zero exit
- **v1 regression**: default mode output unchanged

## Running

```powershell
pwsh ./scripts/ai/compile-issue-to-task-json.v2.test.ps1
```

Exit code 0 = all fixtures pass. Exit code 1 = one or more failures with details.

## Adding New Fixtures

1. Add a new `$fixtureN` JSON block with a unique `targetIssue` number (use 500+ range)
2. Call `Invoke-Compiler` or `Invoke-CompilerExpectFail`
3. Use `Assert-Field`, `Assert-HasField`, or `Assert-NotHasField` to validate
4. Keep fixture JSON inline (no external files) for portability
5. Update this doc's fixture inventory table

## See Also

- [Issue-to-Task Compiler: task-v2 Output Mode](issue-to-task-task-v2-mode.md)
- [Task Schema v2](task-schema-v2.md)
- [Issue-to-Task Compiler](issue-to-task-compiler.md)
