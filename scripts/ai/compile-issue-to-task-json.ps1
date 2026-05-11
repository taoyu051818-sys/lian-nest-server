#Requires -Version 7.0
<#
.SYNOPSIS
    Compile a GitHub issue JSON into a worker task JSON contract.

.DESCRIPTION
    Reads issue metadata from a JSON file or stdin and emits a task JSON
    conforming to scripts/ai/task.schema.json. Refuses to emit when
    required fields (allowedFiles, validationCommands, risk) are missing
    or when the issue is too broad / underspecified.

    This is a dry-run skeleton -- no live GitHub API calls are made.
    Input must be structured JSON (not raw markdown).

.PARAMETER IssueFile
    Path to an issue JSON file. If omitted, reads from stdin.

.PARAMETER OutputFile
    Path to write the compiled task JSON. If omitted, writes to stdout.

.PARAMETER DryRun
    Print diagnostics without emitting task JSON. Default mode.

.EXAMPLE
    ./scripts/ai/compile-issue-to-task-json.ps1 -IssueFile ./fixtures/issue-149.json

.EXAMPLE
    Get-Content issue.json -Raw | ./scripts/ai/compile-issue-to-task-json.ps1

.EXAMPLE
    ./scripts/ai/compile-issue-to-task-json.ps1 -IssueFile ./fixtures/issue-149.json -OutputFile ./tasks/issue-149.json
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$IssueFile,

    [Parameter(Mandatory = $false)]
    [string]$OutputFile,

    [switch]$DryRun,

    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Help ─────────────────────────────────────────────────────────────────────

if ($Help) {
    @"

compile-issue-to-task-json.ps1 — Issue-to-task compiler

USAGE
    ./scripts/ai/compile-issue-to-task-json.ps1 [options]

OPTIONS
    -IssueFile <path>    Path to an issue JSON file. If omitted, reads from stdin.
    -OutputFile <path>   Path to write the compiled task JSON. If omitted, writes to stdout.
    -DryRun              Print diagnostics without emitting task JSON (default mode).
    -Help                Show this help message.

LLM CONTRACT
    When the input JSON contains "llmExtracted": true, the compiler applies
    stricter validation: knowledgeRefs and promptHandoff must be present and
    non-empty. This signals that the task JSON was produced by an LLM (e.g.
    Claude) parsing the issue body, so richer semantic fields are expected.

    When llmExtracted is absent or false, the compiler uses the standard
    deterministic path — only structural fields (allowedFiles, risk, etc.)
    are required. Semantic fields are optional and passed through if present.

    Deterministic parsing is always the fallback. LLM extraction augments it;
    it never replaces it.

EXIT CODES
    0   Success (task JSON emitted or dry-run completed)
    1   Validation failure (missing fields, bad enums, underspecified issue)
    2   Invalid arguments

EXAMPLES
    # Dry-run from file
    ./scripts/ai/compile-issue-to-task-json.ps1 -IssueFile ./fixtures/issue-149.json

    # Write output
    ./scripts/ai/compile-issue-to-task-json.ps1 -IssueFile ./fixtures/issue-149.json -DryRun:`$false -OutputFile ./tasks/issue-149.json

    # Pipe from stdin
    Get-Content issue.json -Raw | ./scripts/ai/compile-issue-to-task-json.ps1

"@ | Write-Host
    exit 0
}

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   WARN: $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "   FAIL: $msg" -ForegroundColor Red; exit 1 }

# ── Load issue JSON ──────────────────────────────────────────────────────────

Write-Step "Loading issue input"

if ($IssueFile) {
    if (-not (Test-Path $IssueFile)) {
        Write-Fail "Issue file not found: $IssueFile"
    }
    try {
        $issue = Get-Content $IssueFile -Raw | ConvertFrom-Json
    } catch {
        Write-Fail "Invalid JSON in issue file: $_"
    }
    Write-Ok "Loaded from file: $IssueFile"
} else {
    Write-Step "Reading from stdin"
    try {
        $rawInput = $input | Out-String
        if ([string]::IsNullOrWhiteSpace($rawInput)) {
            Write-Fail "No input received on stdin. Provide -IssueFile or pipe JSON input."
        }
        $issue = $rawInput | ConvertFrom-Json
    } catch {
        Write-Fail "Invalid JSON from stdin: $_"
    }
    Write-Ok "Loaded from stdin"
}

# ── Validate required issue fields ───────────────────────────────────────────

Write-Step "Validating issue fields"

# These fields must be present and non-empty for the compiler to emit a task.
$requiredFields = @(
    "targetIssue",
    "taskType",
    "risk",
    "conflictGroup",
    "allowedFiles",
    "validationCommands",
    "rolePacket"
)

$missingFields = @()
foreach ($field in $requiredFields) {
    $present = $issue.PSObject.Properties.Name -contains $field
    if (-not $present) {
        $missingFields += $field
    } else {
        # Check for empty arrays / null / whitespace
        $value = $issue.$field
        if ($null -eq $value) {
            $missingFields += "$field (null)"
        } elseif ($value -is [System.Collections.IList] -and $value.Count -eq 0) {
            $missingFields += "$field (empty array)"
        } elseif ($value -is [string] -and [string]::IsNullOrWhiteSpace($value)) {
            $missingFields += "$field (empty string)"
        }
    }
}

if ($missingFields.Count -gt 0) {
    Write-Fail "Issue is underspecified. Missing required fields: $($missingFields -join ', ')"
}

Write-Ok "All required fields present"

# ── Validate enum values ─────────────────────────────────────────────────────

Write-Step "Validating enum values"

$validTaskTypes = @("execution", "research", "review")
if ($issue.taskType -notin $validTaskTypes) {
    Write-Fail "Invalid taskType: $($issue.taskType). Must be one of: $($validTaskTypes -join ', ')"
}

$validRisks = @("low", "medium", "high")
if ($issue.risk -notin $validRisks) {
    Write-Fail "Invalid risk: $($issue.risk). Must be one of: $($validRisks -join ', ')"
}

if ($issue.allowedFiles.Count -eq 0) {
    Write-Fail "allowedFiles must not be empty"
}

if (-not $issue.rolePacket.actorRole) {
    Write-Fail "rolePacket.actorRole is required"
}

Write-Ok "Enums valid (taskType=$($issue.taskType), risk=$($issue.risk))"

# ── Detect underspecified issues ─────────────────────────────────────────────

Write-Step "Checking issue specificity"

$warnings = @()

# Warn if forbiddenFiles is missing (not blocking, but risky)
if (-not ($issue.PSObject.Properties.Name -contains "forbiddenFiles") -or
    ($issue.forbiddenFiles -is [System.Collections.IList] -and $issue.forbiddenFiles.Count -eq 0)) {
    $warnings += "forbiddenFiles is empty or missing -- worker may edit unintended files"
}

# Warn if allowedFiles looks too broad
foreach ($pattern in $issue.allowedFiles) {
    if ($pattern -eq "*" -or $pattern -eq "**" -or $pattern -eq "**/*") {
        $warnings += "allowedFiles contains broad pattern '$pattern' -- issue may be underspecified"
    }
}

# Warn if validationCommands is very short
if ($issue.validationCommands.Count -lt 1) {
    $warnings += "validationCommands has fewer than 1 entry -- no validation evidence will be produced"
}

foreach ($w in $warnings) {
    Write-Warn $w
}

if ($warnings.Count -eq 0) {
    Write-Ok "Issue specificity looks good"
}

# ── LLM contract validation ──────────────────────────────────────────────────
# When the input claims llmExtracted=true, the compiler expects richer semantic
# fields (knowledgeRefs, promptHandoff) to be present. Missing semantic fields
# trigger a warning — not a hard block — because the deterministic fallback
# path always works regardless of LLM extraction.

$isLlmExtracted = $issue.PSObject.Properties.Name -contains "llmExtracted" -and $issue.llmExtracted -eq $true

if ($isLlmExtracted) {
    Write-Step "LLM contract validation (llmExtracted=true)"

    $llmWarnings = @()

    # knowledgeRefs should be present and non-empty for LLM-extracted tasks
    $hasKnowledgeRefs = $issue.PSObject.Properties.Name -contains "knowledgeRefs" -and
        $issue.knowledgeRefs -is [System.Collections.IList] -and
        $issue.knowledgeRefs.Count -gt 0
    if (-not $hasKnowledgeRefs) {
        $llmWarnings += "llmExtracted=true but knowledgeRefs is missing or empty -- LLM should populate semantic references"
    }

    # promptHandoff should be present and non-empty for LLM-extracted tasks
    $hasPromptHandoff = $issue.PSObject.Properties.Name -contains "promptHandoff" -and
        $issue.promptHandoff -is [string] -and
        -not [string]::IsNullOrWhiteSpace($issue.promptHandoff)
    if (-not $hasPromptHandoff) {
        $llmWarnings += "llmExtracted=true but promptHandoff is missing or empty -- LLM should produce a concise handoff"
    }

    foreach ($w in $llmWarnings) {
        Write-Warn $w
    }

    if ($llmWarnings.Count -eq 0) {
        Write-Ok "LLM contract: semantic fields present"
    }
}

# ── Build task JSON ──────────────────────────────────────────────────────────

Write-Step "Building task JSON"

$task = [ordered]@{
    taskType           = $issue.taskType
    risk               = $issue.risk
    conflictGroup      = $issue.conflictGroup
    targetIssue        = $issue.targetIssue
    targetPR           = if ($issue.PSObject.Properties.Name -contains "targetPR") { $issue.targetPR } else { $null }
    issues             = if ($issue.PSObject.Properties.Name -contains "issues") { $issue.issues } else { @() }
    expectedPR         = if ($issue.PSObject.Properties.Name -contains "expectedPR") { $issue.expectedPR } else { $true }
    allowedFiles       = @($issue.allowedFiles)
    forbiddenFiles     = if ($issue.PSObject.Properties.Name -contains "forbiddenFiles") { @($issue.forbiddenFiles) } else { @() }
    validationCommands = @($issue.validationCommands)
    rolePacket         = @{
        actorRole   = $issue.rolePacket.actorRole
        description = if ($issue.rolePacket.PSObject.Properties.Name -contains "description") {
            $issue.rolePacket.description
        } else {
            "Worker for issue #$($issue.targetIssue)"
        }
    }
}

# ── Semantic context handoff ──────────────────────────────────────────────
# These fields point the worker to the issue body and referenced docs.
# They are lightweight pointers, not duplicated semantics.

# sourceIssue: always constructed from targetIssue
$task["sourceIssue"] = "https://github.com/taoyu051818-sys/lian-nest-server/issues/$($issue.targetIssue)"

# knowledgeRefs: pass through from input if present
if ($issue.PSObject.Properties.Name -contains "knowledgeRefs") {
    $task["knowledgeRefs"] = @($issue.knowledgeRefs)
}

# promptHandoff: pass through from input if present
if ($issue.PSObject.Properties.Name -contains "promptHandoff") {
    $task["promptHandoff"] = $issue.promptHandoff
}

# llmExtracted: pass through from input if present
if ($issue.PSObject.Properties.Name -contains "llmExtracted") {
    $task["llmExtracted"] = [bool]$issue.llmExtracted
}

# Copy optional fields if present
$optionalFields = @(
    "attentionAreas", "reviewAndAcceptance", "budgets",
    "complexityAssessment", "stragglerPolicy", "pmPhase"
)

foreach ($field in $optionalFields) {
    if ($issue.PSObject.Properties.Name -contains $field) {
        $task[$field] = $issue.$field
    }
}

Write-Ok "Task JSON built (issue #$($task.targetIssue), type=$($task.taskType), risk=$($task.risk))"

# ── Dry run exit ─────────────────────────────────────────────────────────────

if ($DryRun) {
    Write-Step "DRY RUN -- printing compiled task JSON (not written to file)"
    Write-Host ""
    $task | ConvertTo-Json -Depth 10 | Write-Host
    Write-Host ""

    if ($warnings.Count -gt 0) {
        Write-Warn "$($warnings.Count) warning(s) found. Review before executing."
    }

    Write-Host ""
    Write-Host "To write output:" -ForegroundColor Yellow
    if ($IssueFile) {
        Write-Host "  ./scripts/ai/compile-issue-to-task-json.ps1 -IssueFile $IssueFile -DryRun:`$false -OutputFile ./tasks/task.json" -ForegroundColor Yellow
    } else {
        Write-Host "  ... | ./scripts/ai/compile-issue-to-task-json.ps1 -DryRun:`$false -OutputFile ./tasks/task.json" -ForegroundColor Yellow
    }
    exit 0
}

# ── Write output ─────────────────────────────────────────────────────────────

$taskJson = $task | ConvertTo-Json -Depth 10

if ($OutputFile) {
    $outDir = Split-Path $OutputFile -Parent
    if ($outDir -and -not (Test-Path $outDir)) {
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    }
    Set-Content $OutputFile -Value $taskJson -Encoding UTF8
    Write-Ok "Task JSON written to: $OutputFile"
} else {
    Write-Host $taskJson
}

Write-Step "Compiler complete"
