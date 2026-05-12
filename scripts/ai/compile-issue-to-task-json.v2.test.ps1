#Requires -Version 7.0
<#
.SYNOPSIS
    Fixture-driven tests for compile-issue-to-task-json.ps1 v2 output mode.

.DESCRIPTION
    Exercises the v2 output transformations of the issue-to-task compiler
    without modifying the compiler implementation. Covers:
      - Promoted fields (actorRole, roleDescription, attentionFocus, etc.)
      - Renamed fields (validationCommands→validation, budgets→budget)
      - v2-only optional fields (writeSet, sharedLocks, dependsOnFacts, etc.)
      - workerClass derivation from conflictGroup
      - v1 compat wrappers preserved in v2 output
      - LLM contract validation in v2 mode
      - Error cases (missing required fields, invalid enums)

.EXAMPLE
    pwsh ./scripts/ai/compile-issue-to-task-json.v2.test.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$compilerPath = Join-Path $scriptDir "compile-issue-to-task-json.ps1"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "v2-compiler-tests-$(Get-Random)"

$passed = 0
$failed = 0
$errors = @()

function Write-TestHeader($name) {
    Write-Host "`n--- TEST: $name ---" -ForegroundColor Cyan
}

function Write-Pass($msg) {
    Write-Host "   PASS: $msg" -ForegroundColor Green
    $script:passed++
}

function Write-Fail($msg) {
    Write-Host "   FAIL: $msg" -ForegroundColor Red
    $script:failed++
    $script:errors += $msg
}

function Assert-Field($obj, $fieldName, $expectedValue, $testName) {
    $actual = $obj.$fieldName
    if ($null -eq $expectedValue) {
        if ($null -ne $actual) {
            Write-Fail "${testName}: expected ${fieldName} to be null, got '${actual}'"
        } else {
            Write-Pass "${fieldName} is null as expected"
        }
    } elseif ($expectedValue -is [bool]) {
        if ($actual -ne $expectedValue) {
            Write-Fail "${testName}: expected ${fieldName}=${expectedValue}, got '${actual}'"
        } else {
            Write-Pass "${fieldName}=${actual}"
        }
    } elseif ($expectedValue -is [System.Collections.IList]) {
        $expectedJson = $expectedValue | ConvertTo-Json -Compress
        $actualJson = $actual | ConvertTo-Json -Compress
        if ($expectedJson -ne $actualJson) {
            Write-Fail "${testName}: expected ${fieldName}=${expectedJson}, got '${actualJson}'"
        } else {
            Write-Pass "${fieldName} matches expected array"
        }
    } else {
        if ($actual -ne $expectedValue) {
            Write-Fail "${testName}: expected ${fieldName}='${expectedValue}', got '${actual}'"
        } else {
            Write-Pass "${fieldName}='${actual}'"
        }
    }
}

function Assert-HasField($obj, $fieldName, $testName) {
    if (-not ($obj.PSObject.Properties.Name -contains $fieldName)) {
        Write-Fail "${testName}: missing expected field '${fieldName}'"
    } else {
        Write-Pass "has field '${fieldName}'"
    }
}

function Assert-NotHasField($obj, $fieldName, $testName) {
    if ($obj.PSObject.Properties.Name -contains $fieldName) {
        Write-Fail "${testName}: unexpected field '${fieldName}' present"
    } else {
        Write-Pass "field '${fieldName}' absent as expected"
    }
}

function Invoke-Compiler($issueJson, $outputMode = "v2") {
    $issueFile = Join-Path $tempDir "input-$(Get-Random).json"
    $outputFile = Join-Path $tempDir "output-$(Get-Random).json"
    Set-Content $issueFile -Value $issueJson -Encoding UTF8
    & pwsh $compilerPath -IssueFile $issueFile -OutputMode $outputMode -DryRun:$false -OutputFile $outputFile 2>&1 | Out-Null
    if (Test-Path $outputFile) {
        $result = Get-Content $outputFile -Raw | ConvertFrom-Json
        return $result
    }
    return $null
}

function Invoke-CompilerExpectFail($issueJson, $outputMode = "v2") {
    $issueFile = Join-Path $tempDir "input-$(Get-Random).json"
    Set-Content $issueFile -Value $issueJson -Encoding UTF8
    $output = & pwsh $compilerPath -IssueFile $issueFile -OutputMode $outputMode -DryRun:$false 2>&1
    $exitCode = $LASTEXITCODE
    return @{ ExitCode = $exitCode; Output = $output }
}

# ── Setup ────────────────────────────────────────────────────────────────────

if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

Write-Host "`n========================================" -ForegroundColor White
Write-Host "  v2 Compiler Fixture Tests" -ForegroundColor White
Write-Host "========================================" -ForegroundColor White

# ── FIXTURE 1: Full v2 with all promoted fields ─────────────────────────────

Write-TestHeader "Full v2 — all promoted fields"

$fixture1 = @'
{
    "targetIssue": 400,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "control-test-fixture",
    "allowedFiles": ["scripts/ai/test.ps1"],
    "forbiddenFiles": ["src/**"],
    "validationCommands": ["pwsh ./scripts/ai/test.ps1"],
    "rolePacket": {
        "actorRole": "test-worker",
        "description": "Test fixture worker"
    },
    "attentionAreas": {
        "focus": ["Stay inside allowedFiles"],
        "knownBlindspots": ["Do not edit src"]
    },
    "reviewAndAcceptance": {
        "requiredReviewRoles": ["orchestration-review"],
        "acceptanceOwner": "taoyu051818-sys"
    },
    "budgets": {
        "maxFiles": 4,
        "maxLinesChanged": 200,
        "softTimeMinutes": 30,
        "hardTimeMinutes": 60
    },
    "issues": [400],
    "expectedPR": true
}
'@

try {
    $result1 = Invoke-Compiler $fixture1
    Assert-Field $result1 "actorRole" "test-worker" "fixture1"
    Assert-Field $result1 "roleDescription" "Test fixture worker" "fixture1"
    Assert-HasField $result1 "attentionFocus" "fixture1"
    Assert-HasField $result1 "knownBlindspots" "fixture1"
    Assert-HasField $result1 "requiredReviewRoles" "fixture1"
    Assert-Field $result1 "acceptanceOwner" "taoyu051818-sys" "fixture1"
    Assert-NotHasField $result1 "validationCommands" "fixture1"
    Assert-HasField $result1 "validation" "fixture1"
    Assert-NotHasField $result1 "budgets" "fixture1"
    Assert-HasField $result1 "budget" "fixture1"
    Assert-HasField $result1 "rolePacket" "fixture1"
    Assert-HasField $result1 "attentionAreas" "fixture1"
    Assert-HasField $result1 "reviewAndAcceptance" "fixture1"
} catch {
    Write-Fail "fixture1 threw: $_"
}

# ── FIXTURE 2: workerClass passthrough ───────────────────────────────────────

Write-TestHeader "workerClass passthrough when provided"

$fixture2 = @'
{
    "targetIssue": 401,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "test-group",
    "allowedFiles": ["docs/test.md"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "docs-worker",
        "description": "Docs worker"
    },
    "workerClass": "docs-worker-custom"
}
'@

try {
    $result2 = Invoke-Compiler $fixture2
    Assert-Field $result2 "workerClass" "docs-worker-custom" "fixture2"
} catch {
    Write-Fail "fixture2 threw: $_"
}

# ── FIXTURE 3: workerClass derivation from conflictGroup ────────────────────

Write-TestHeader "workerClass derived from conflictGroup when omitted"

$fixture3 = @'
{
    "targetIssue": 402,
    "taskType": "research",
    "risk": "low",
    "conflictGroup": "derived-class-group",
    "allowedFiles": ["docs/research.md"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "research-worker",
        "description": "Research worker"
    }
}
'@

try {
    $result3 = Invoke-Compiler $fixture3
    Assert-Field $result3 "workerClass" "derived-class-group" "fixture3"
} catch {
    Write-Fail "fixture3 threw: $_"
}

# ── FIXTURE 4: v2-only optional fields passthrough ──────────────────────────

Write-TestHeader "v2-only optional fields passthrough"

$fixture4 = @'
{
    "targetIssue": 403,
    "taskType": "execution",
    "risk": "medium",
    "conflictGroup": "v2-optional-fields",
    "allowedFiles": ["schemas/test.json"],
    "forbiddenFiles": ["src/**"],
    "validationCommands": ["npm run check", "npm run build"],
    "rolePacket": {
        "actorRole": "schema-worker",
        "description": "Schema worker"
    },
    "workerClass": "schema-task-v2",
    "writeSet": ["schemas/test.json"],
    "sharedLocks": ["docs/ai-native/SOP.md"],
    "dependsOnFacts": [
        { "factId": "fact:schema:base", "description": "Base schema exists" }
    ],
    "producesFacts": [
        { "factId": "fact:schema:test", "description": "Test schema created", "confidence": "definite" }
    ],
    "telemetry": {
        "emitHeartbeat": true,
        "heartbeatIntervalSeconds": 60,
        "logLevel": "verbose",
        "tags": ["test-wave"]
    },
    "rollbackPlan": {
        "strategy": "git-revert",
        "notes": "Schema-only change"
    },
    "sourceOfTruthDocs": ["docs/ai-native/SOP.md"],
    "blockedBy": [399],
    "mainHealthPolicy": "gate-all",
    "generatedCodePolicy": "forbid"
}
'@

try {
    $result4 = Invoke-Compiler $fixture4
    Assert-HasField $result4 "writeSet" "fixture4"
    Assert-HasField $result4 "sharedLocks" "fixture4"
    Assert-HasField $result4 "dependsOnFacts" "fixture4"
    Assert-HasField $result4 "producesFacts" "fixture4"
    Assert-HasField $result4 "telemetry" "fixture4"
    Assert-HasField $result4 "rollbackPlan" "fixture4"
    Assert-HasField $result4 "sourceOfTruthDocs" "fixture4"
    Assert-HasField $result4 "blockedBy" "fixture4"
    Assert-HasField $result4 "mainHealthPolicy" "fixture4"
    Assert-HasField $result4 "generatedCodePolicy" "fixture4"
    Assert-Field $result4 "workerClass" "schema-task-v2" "fixture4"
} catch {
    Write-Fail "fixture4 threw: $_"
}

# ── FIXTURE 5: v2 output preserves v1 compat wrappers ───────────────────────

Write-TestHeader "v1 compat wrappers preserved in v2 output"

$fixture5 = @'
{
    "targetIssue": 404,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "compat-test",
    "allowedFiles": ["scripts/ai/test.ps1"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "compat-worker",
        "description": "Compat worker"
    },
    "attentionAreas": {
        "focus": ["focus item"],
        "knownBlindspots": ["blindspot item"]
    },
    "reviewAndAcceptance": {
        "requiredReviewRoles": ["review-role"],
        "acceptanceOwner": "owner-user"
    }
}
'@

try {
    $result5 = Invoke-Compiler $fixture5
    Assert-HasField $result5 "rolePacket" "fixture5"
    Assert-HasField $result5 "attentionAreas" "fixture5"
    Assert-HasField $result5 "reviewAndAcceptance" "fixture5"
    Assert-Field $result5 "actorRole" "compat-worker" "fixture5"
    Assert-Field $result5 "roleDescription" "Compat worker" "fixture5"
} catch {
    Write-Fail "fixture5 threw: $_"
}

# ── FIXTURE 6: LLM contract validation in v2 mode ──────────────────────────

Write-TestHeader "LLM contract validation in v2 mode"

$fixture6 = @'
{
    "targetIssue": 405,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "llm-test",
    "allowedFiles": ["scripts/ai/test.ps1"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "llm-worker",
        "description": "LLM worker"
    },
    "llmExtracted": true,
    "knowledgeRefs": ["docs/ai-native/SOP.md"],
    "promptHandoff": "Add fixture coverage for v2 compiler"
}
'@

try {
    $result6 = Invoke-Compiler $fixture6
    Assert-Field $result6 "llmExtracted" $true "fixture6"
    Assert-HasField $result6 "knowledgeRefs" "fixture6"
    Assert-HasField $result6 "promptHandoff" "fixture6"
} catch {
    Write-Fail "fixture6 threw: $_"
}

# ── FIXTURE 7: LLM contract missing semantic fields (warning path) ──────────

Write-TestHeader "LLM contract missing semantic fields (warning, not failure)"

$fixture7 = @'
{
    "targetIssue": 406,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "llm-missing-test",
    "allowedFiles": ["scripts/ai/test.ps1"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "llm-worker",
        "description": "LLM worker"
    },
    "llmExtracted": true
}
'@

try {
    $result7 = Invoke-Compiler $fixture7
    if ($null -ne $result7) {
        Write-Pass "compiler emitted output despite missing LLM semantic fields"
    } else {
        Write-Fail "fixture7: compiler did not emit output"
    }
} catch {
    Write-Fail "fixture7 threw: $_"
}

# ── FIXTURE 8: Minimal v1 input in v2 mode ──────────────────────────────────

Write-TestHeader "Minimal v1 input compiled in v2 mode"

$fixture8 = @'
{
    "targetIssue": 407,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "minimal-v2",
    "allowedFiles": ["docs/test.md"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "minimal-worker",
        "description": "Minimal worker"
    }
}
'@

try {
    $result8 = Invoke-Compiler $fixture8
    Assert-Field $result8 "actorRole" "minimal-worker" "fixture8"
    Assert-Field $result8 "workerClass" "minimal-v2" "fixture8"
    Assert-HasField $result8 "validation" "fixture8"
    Assert-NotHasField $result8 "validationCommands" "fixture8"
    Assert-NotHasField $result8 "writeSet" "fixture8"
    Assert-NotHasField $result8 "sharedLocks" "fixture8"
    Assert-NotHasField $result8 "dependsOnFacts" "fixture8"
    Assert-NotHasField $result8 "telemetry" "fixture8"
    Assert-NotHasField $result8 "rollbackPlan" "fixture8"
} catch {
    Write-Fail "fixture8 threw: $_"
}

# ── FIXTURE 9: Error — missing required field ───────────────────────────────

Write-TestHeader "Error case — missing allowedFiles"

$fixture9 = @'
{
    "targetIssue": 408,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "error-test",
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "error-worker",
        "description": "Error worker"
    }
}
'@

try {
    $result9 = Invoke-CompilerExpectFail $fixture9
    if ($result9.ExitCode -ne 0) {
        Write-Pass "compiler rejected input with exit code $($result9.ExitCode)"
    } else {
        Write-Fail "fixture9: compiler should have failed but exited 0"
    }
} catch {
    Write-Fail "fixture9 threw: $_"
}

# ── FIXTURE 10: Error — invalid taskType enum ──────────────────────────────

Write-TestHeader "Error case — invalid taskType"

$fixture10 = @'
{
    "targetIssue": 409,
    "taskType": "invalid-type",
    "risk": "low",
    "conflictGroup": "enum-error-test",
    "allowedFiles": ["docs/test.md"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "enum-worker",
        "description": "Enum worker"
    }
}
'@

try {
    $result10 = Invoke-CompilerExpectFail $fixture10
    if ($result10.ExitCode -ne 0) {
        Write-Pass "compiler rejected invalid taskType with exit code $($result10.ExitCode)"
    } else {
        Write-Fail "fixture10: compiler should have failed but exited 0"
    }
} catch {
    Write-Fail "fixture10 threw: $_"
}

# ── FIXTURE 11: Error — invalid risk enum ──────────────────────────────────

Write-TestHeader "Error case — invalid risk"

$fixture11 = @'
{
    "targetIssue": 410,
    "taskType": "execution",
    "risk": "extreme",
    "conflictGroup": "risk-error-test",
    "allowedFiles": ["docs/test.md"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "risk-worker",
        "description": "Risk worker"
    }
}
'@

try {
    $result11 = Invoke-CompilerExpectFail $fixture11
    if ($result11.ExitCode -ne 0) {
        Write-Pass "compiler rejected invalid risk with exit code $($result11.ExitCode)"
    } else {
        Write-Fail "fixture11: compiler should have failed but exited 0"
    }
} catch {
    Write-Fail "fixture11 threw: $_"
}

# ── FIXTURE 12: Error — empty rolePacket.actorRole ─────────────────────────

Write-TestHeader "Error case — empty actorRole"

$fixture12 = @'
{
    "targetIssue": 411,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "role-error-test",
    "allowedFiles": ["docs/test.md"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "",
        "description": "Empty role worker"
    }
}
'@

try {
    $result12 = Invoke-CompilerExpectFail $fixture12
    if ($result12.ExitCode -ne 0) {
        Write-Pass "compiler rejected empty actorRole with exit code $($result12.ExitCode)"
    } else {
        Write-Fail "fixture12: compiler should have failed but exited 0"
    }
} catch {
    Write-Fail "fixture12 threw: $_"
}

# ── FIXTURE 13: sourceIssue auto-generated from targetIssue ────────────────

Write-TestHeader "sourceIssue auto-generated in v2 mode"

$fixture13 = @'
{
    "targetIssue": 452,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "source-issue-test",
    "allowedFiles": ["docs/test.md"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "source-worker",
        "description": "Source issue worker"
    }
}
'@

try {
    $result13 = Invoke-Compiler $fixture13
    $expectedUrl = "https://github.com/taoyu051818-sys/lian-nest-server/issues/452"
    Assert-Field $result13 "sourceIssue" $expectedUrl "fixture13"
} catch {
    Write-Fail "fixture13 threw: $_"
}

# ── FIXTURE 14: v1 mode output unchanged ────────────────────────────────────

Write-TestHeader "v1 mode output unchanged (regression guard)"

$fixture14 = @'
{
    "targetIssue": 413,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "v1-regression",
    "allowedFiles": ["docs/test.md"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "v1-worker",
        "description": "V1 regression worker"
    }
}
'@

try {
    $result14 = Invoke-Compiler $fixture14 "v1"
    Assert-HasField $result14 "validationCommands" "fixture14"
    Assert-NotHasField $result14 "validation" "fixture14"
    Assert-NotHasField $result14 "actorRole" "fixture14"
    Assert-NotHasField $result14 "workerClass" "fixture14"
    Assert-Field $result14 "taskType" "execution" "fixture14"
} catch {
    Write-Fail "fixture14 threw: $_"
}

# ── FIXTURE 15: Self-cycle batch — generic conflictGroup normalization ───────

Write-TestHeader "Self-cycle batch — three issues with generic conflictGroup ai-auto"

$fixture15a = @'
{
    "targetIssue": 501,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "ai-auto",
    "allowedFiles": ["docs/readme.md"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "docs-worker",
        "description": "Docs worker A"
    }
}
'@

$fixture15b = @'
{
    "targetIssue": 502,
    "taskType": "research",
    "risk": "low",
    "conflictGroup": "ai-auto",
    "allowedFiles": ["docs/guide.md"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "docs-worker",
        "description": "Docs worker B"
    }
}
'@

$fixture15c = @'
{
    "targetIssue": 503,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "ai-auto",
    "allowedFiles": ["docs/api.md"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "docs-worker",
        "description": "Docs worker C"
    }
}
'@

try {
    $result15a = Invoke-Compiler $fixture15a
    $result15b = Invoke-Compiler $fixture15b
    $result15c = Invoke-Compiler $fixture15c

    # Each should have a unique conflictGroup derived from targetIssue + taskType
    Assert-Field $result15a "conflictGroup" "self-cycle-501-execution" "fixture15a"
    Assert-Field $result15b "conflictGroup" "self-cycle-502-research" "fixture15b"
    Assert-Field $result15c "conflictGroup" "self-cycle-503-execution" "fixture15c"

    # Verify all three are distinct
    $groups = @($result15a.conflictGroup, $result15b.conflictGroup, $result15c.conflictGroup)
    $uniqueGroups = $groups | Sort-Object -Unique
    if ($uniqueGroups.Count -eq 3) {
        Write-Pass "all three conflictGroups are unique"
    } else {
        Write-Fail "fixture15: expected 3 unique conflictGroups, got $($uniqueGroups.Count)"
    }
} catch {
    Write-Fail "fixture15 threw: $_"
}

# ── FIXTURE 16: Self-cycle batch — broad allowedFiles narrowed via writeSet ──

Write-TestHeader "Self-cycle batch — broad allowedFiles narrowed via writeSet"

$fixture16 = @'
{
    "targetIssue": 504,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "ai-auto",
    "allowedFiles": ["docs/**"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "docs-worker",
        "description": "Docs worker with writeSet"
    },
    "writeSet": ["docs/specific-guide.md", "docs/api-reference.md"]
}
'@

try {
    $result16 = Invoke-Compiler $fixture16
    Assert-Field $result16 "conflictGroup" "self-cycle-504-execution" "fixture16"
    # allowedFiles should be narrowed to writeSet
    $expectedFiles = @("docs/specific-guide.md", "docs/api-reference.md")
    Assert-Field $result16 "allowedFiles" $expectedFiles "fixture16"
} catch {
    Write-Fail "fixture16 threw: $_"
}

# ── FIXTURE 17: Self-cycle batch — broad allowedFiles narrowed via sourceOfTruthDocs ──

Write-TestHeader "Self-cycle batch — broad allowedFiles narrowed via sourceOfTruthDocs"

$fixture17 = @'
{
    "targetIssue": 505,
    "taskType": "research",
    "risk": "low",
    "conflictGroup": "auto",
    "allowedFiles": ["docs/**"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "research-worker",
        "description": "Research worker with sourceOfTruthDocs"
    },
    "sourceOfTruthDocs": ["docs/architecture.md", "docs/decisions/adr-001.md"]
}
'@

try {
    $result17 = Invoke-Compiler $fixture17
    Assert-Field $result17 "conflictGroup" "self-cycle-505-research" "fixture17"
    # allowedFiles should be narrowed to sourceOfTruthDocs
    $expectedDocs = @("docs/architecture.md", "docs/decisions/adr-001.md")
    Assert-Field $result17 "allowedFiles" $expectedDocs "fixture17"
} catch {
    Write-Fail "fixture17 threw: $_"
}

# ── FIXTURE 18: Non-generic conflictGroup preserved ──────────────────────────

Write-TestHeader "Non-generic conflictGroup preserved as-is"

$fixture18 = @'
{
    "targetIssue": 506,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "auth-core",
    "allowedFiles": ["docs/auth.md"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "auth-worker",
        "description": "Auth worker"
    }
}
'@

try {
    $result18 = Invoke-Compiler $fixture18
    Assert-Field $result18 "conflictGroup" "auth-core" "fixture18"
} catch {
    Write-Fail "fixture18 threw: $_"
}

# ── FIXTURE 19: Broad allowedFiles without narrowing hints (warning only) ────

Write-TestHeader "Broad allowedFiles without narrowing hints preserves original"

$fixture19 = @'
{
    "targetIssue": 507,
    "taskType": "execution",
    "risk": "low",
    "conflictGroup": "ai-auto",
    "allowedFiles": ["docs/**"],
    "forbiddenFiles": [],
    "validationCommands": ["npm run check"],
    "rolePacket": {
        "actorRole": "docs-worker",
        "description": "Docs worker without hints"
    }
}
'@

try {
    $result19 = Invoke-Compiler $fixture19
    Assert-Field $result19 "conflictGroup" "self-cycle-507-execution" "fixture19"
    # allowedFiles stays broad since no narrowing hints available
    Assert-Field $result19 "allowedFiles" @("docs/**") "fixture19"
} catch {
    Write-Fail "fixture19 threw: $_"
}

# ── Cleanup ──────────────────────────────────────────────────────────────────

Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

# ── Summary ──────────────────────────────────────────────────────────────────

Write-Host "`n========================================" -ForegroundColor White
Write-Host "  v2 Compiler Fixture Test Summary" -ForegroundColor White
Write-Host "========================================" -ForegroundColor White
Write-Host "   Passed: $passed" -ForegroundColor Green
Write-Host "   Failed: $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })

if ($failed -gt 0) {
    Write-Host "`n  Failures:" -ForegroundColor Red
    foreach ($e in $errors) {
        Write-Host "    - $e" -ForegroundColor Red
    }
    exit 1
}

Write-Host "`n  All tests passed." -ForegroundColor Green
exit 0
