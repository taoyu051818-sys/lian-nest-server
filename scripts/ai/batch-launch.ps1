#Requires -Version 7.0
<#
.SYNOPSIS
    Self-hosted AI batch launcher for lian-nest-server.

.DESCRIPTION
    Reads a task JSON file, validates it against the schema, and launches a
    Claude Code worker in a new git worktree. Designed for local orchestrator
    use — no CI secrets or runtime dependencies required.

.PARAMETER TaskFile
    Path to a task JSON file conforming to scripts/ai/task.schema.json.

.PARAMETER DryRun
    Print the launch plan without executing. Default mode.

.EXAMPLE
    ./scripts/ai/batch-launch.ps1 -TaskFile ./tasks/issue-86.json -DryRun
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TaskFile,

    [switch]$DryRun = $true,
    [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   WARN: $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "   FAIL: $msg" -ForegroundColor Red; exit 1 }

# ── Load task JSON ───────────────────────────────────────────────────────────

Write-Step "Loading task file: $TaskFile"

if (-not (Test-Path $TaskFile)) {
    Write-Fail "Task file not found: $TaskFile"
}

try {
    $task = Get-Content $TaskFile -Raw | ConvertFrom-Json
} catch {
    Write-Fail "Invalid JSON: $_"
}

# ── Validate required fields ─────────────────────────────────────────────────

Write-Step "Validating task contract"

$requiredFields = @(
    "taskType", "risk", "conflictGroup", "targetIssue",
    "allowedFiles", "forbiddenFiles", "validationCommands", "rolePacket"
)

foreach ($field in $requiredFields) {
    if (-not ($task.PSObject.Properties.Name -contains $field)) {
        Write-Fail "Missing required field: $field"
    }
}

# Validate enum values
$validTaskTypes = @("execution", "research", "review")
if ($task.taskType -notin $validTaskTypes) {
    Write-Fail "Invalid taskType: $($task.taskType). Must be one of: $($validTaskTypes -join ', ')"
}

$validRisks = @("low", "medium", "high")
if ($task.risk -notin $validRisks) {
    Write-Fail "Invalid risk: $($task.risk). Must be one of: $($validRisks -join ', ')"
}

if ($task.allowedFiles.Count -eq 0) {
    Write-Fail "allowedFiles must not be empty"
}

if (-not $task.rolePacket.actorRole) {
    Write-Fail "rolePacket.actorRole is required"
}

Write-Ok "Task contract valid (issue #$($task.targetIssue), type=$($task.taskType), risk=$($task.risk))"

# ── Build branch name ────────────────────────────────────────────────────────

$branchName = "claude/issue-$($task.targetIssue)-$($task.conflictGroup -replace '[^a-zA-Z0-9-]', '-')"
Write-Step "Target branch: $branchName"

# ── Build worktree path ──────────────────────────────────────────────────────

$worktreeDir = ".claude/worktrees/$branchName"
Write-Step "Worktree path: $worktreeDir"

# ── Build allowed files summary ──────────────────────────────────────────────

Write-Step "File boundaries"
Write-Host "   Allowed:" -ForegroundColor Gray
foreach ($pattern in $task.allowedFiles) {
    Write-Host "     + $pattern" -ForegroundColor Gray
}
Write-Host "   Forbidden:" -ForegroundColor Gray
foreach ($pattern in $task.forbiddenFiles) {
    Write-Host "     - $pattern" -ForegroundColor Gray
}

# ── Dry run exit ─────────────────────────────────────────────────────────────

if ($DryRun -and -not $Execute) {
    Write-Step "DRY RUN — no changes made"
    Write-Host ""
    Write-Host "To execute:" -ForegroundColor Yellow
    Write-Host "  ./scripts/ai/batch-launch.ps1 -TaskFile $TaskFile -Execute" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Worker command:" -ForegroundColor Yellow
    Write-Host "  ./scripts/ai/run-claude-print.ps1 -TaskFile $TaskFile -Branch $branchName -Worktree $worktreeDir" -ForegroundColor Yellow
    exit 0
}

# ── Execute mode ─────────────────────────────────────────────────────────────

Write-Step "EXECUTE mode — launching worker"

# Create worktree
Write-Step "Creating git worktree: $worktreeDir"
git worktree add -b $branchName $worktreeDir main 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Failed to create worktree (branch may already exist)"
}
Write-Ok "Worktree created"

# Run worker
Write-Step "Running Claude Code worker"
$claudeArgs = @(
    "--print"
    "--output-format", "text"
    "-p", (Get-Content $TaskFile -Raw)
    "--allowedTools", "Edit,Write,Bash(git *),Bash(npm run *),Bash(gh *)"
)

& ./scripts/ai/run-claude-print.ps1 -TaskFile $TaskFile -Branch $branchName -Worktree $worktreeDir

Write-Step "Batch launcher complete"
