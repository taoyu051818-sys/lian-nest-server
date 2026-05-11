#Requires -Version 7.0
<#
.SYNOPSIS
    Runs a Claude Code worker in --print mode against a worktree.

.DESCRIPTION
    Invokes Claude Code with the task contract as context, constrained to the
    worktree directory. Captures output and commits results. Designed for
    self-hosted use — no external orchestration service required.

.PARAMETER TaskFile
    Path to a task JSON file conforming to scripts/ai/task.schema.json.

.PARAMETER Branch
    Git branch name for the worktree.

.PARAMETER Worktree
    Path to the git worktree directory.

.EXAMPLE
    ./scripts/ai/run-claude-print.ps1 -TaskFile ./tasks/issue-86.json -Branch claude/issue-86 -Worktree .claude/worktrees/claude/issue-86
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TaskFile,

    [Parameter(Mandatory = $true)]
    [string]$Branch,

    [Parameter(Mandatory = $true)]
    [string]$Worktree
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "   FAIL: $msg" -ForegroundColor Red; exit 1 }

# ── Validate inputs ──────────────────────────────────────────────────────────

if (-not (Test-Path $TaskFile)) {
    Write-Fail "Task file not found: $TaskFile"
}

if (-not (Test-Path $Worktree)) {
    Write-Fail "Worktree not found: $Worktree"
}

# ── Load task ────────────────────────────────────────────────────────────────

$task = Get-Content $TaskFile -Raw | ConvertFrom-Json
$issueNum = $task.targetIssue

Write-Step "Preparing worker for issue #$issueNum"

# ── Build prompt ─────────────────────────────────────────────────────────────

$promptParts = @()
$promptParts += "You are an AI worker implementing issue #$issueNum in the lian-nest-server repository."
$promptParts += ""
$promptParts += "## Task Contract"
$promptParts += (Get-Content $TaskFile -Raw)
$promptParts += ""
$promptParts += "## Hard Rules"
$promptParts += "- Only edit files listed in allowedFiles."
$promptParts += "- Never edit files listed in forbiddenFiles."
$promptParts += "- Run all validationCommands before committing."
$promptParts += "- If the task requires changes outside allowedFiles, stop and comment on the issue with the blocker."
$promptParts += "- Commit with a message referencing issue #$issueNum."
$promptParts += "- Do NOT push or create a PR — the orchestrator handles that."

$promptText = $promptParts -join "`n"

# ── Build allowed tools ──────────────────────────────────────────────────────

# Restrict tool access based on task type
$allowedTools = @("Edit", "Write")
if ($task.taskType -eq "execution") {
    $allowedTools += "Bash(git *)"
    $allowedTools += "Bash(npm run *)"
    if ($task.validationCommands) {
        foreach ($cmd in $task.validationCommands) {
            # Add each validation command pattern
            $allowedTools += "Bash($cmd)"
        }
    }
}

$allowedToolsStr = $allowedTools -join ","

Write-Step "Allowed tools: $allowedToolsStr"

# ── Invoke Claude Code ───────────────────────────────────────────────────────

Write-Step "Launching Claude Code (--print mode)"

$claudeArgs = @(
    "--print"
    "--output-format", "text"
    "--allowedTools", $allowedToolsStr
    "-p", $promptText
)

Write-Step "Working directory: $Worktree"

# Run in the worktree directory
$env:CLAUDE_WORKING_DIRECTORY = $Worktree
$env:CLAUDE_CODE_ENTRYPOINT = "batch-launcher"

# Execute claude
$process = Start-Process -FilePath "claude" -ArgumentList $claudeArgs -WorkingDirectory $Worktree -NoNewWindow -PassThru -Wait -RedirectStandardOutput "$Worktree/.claude-output.txt" -RedirectStandardError "$Worktree/.claude-error.txt"

$exitCode = $process.ExitCode
$stdout = if (Test-Path "$Worktree/.claude-output.txt") { Get-Content "$Worktree/.claude-output.txt" -Raw } else { "" }
$stderr = if (Test-Path "$Worktree/.claude-error.txt") { Get-Content "$Worktree/.claude-error.txt" -Raw } else { "" }

# ── Report results ───────────────────────────────────────────────────────────

if ($exitCode -eq 0) {
    Write-Ok "Claude Code completed successfully"
    Write-Host $stdout
} else {
    Write-Host "Claude Code exited with code: $exitCode" -ForegroundColor Yellow
    Write-Host "STDOUT:" -ForegroundColor Gray
    Write-Host $stdout
    Write-Host "STDERR:" -ForegroundColor Gray
    Write-Host $stderr
}

# ── Commit if changes exist ──────────────────────────────────────────────────

Write-Step "Checking for changes to commit"

Push-Location $Worktree
try {
    $gitStatus = git status --porcelain
    if ($gitStatus) {
        Write-Step "Staging and committing changes"
        git add -A
        git commit -m "feat(ai-worker): implement issue #$issueNum

        Automated by self-hosted batch launcher.
        Task type: $($task.taskType)
        Risk: $($task.risk)
        Conflict group: $($task.conflictGroup)

        Co-Authored-By: Claude Code <noreply@anthropic.com>"

        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Changes committed on branch $Branch"
        } else {
            Write-Host "   Commit failed — worker may need to fix conflicts" -ForegroundColor Yellow
        }
    } else {
        Write-Ok "No changes to commit"
    }
} finally {
    Pop-Location
}

# ── Cleanup temp files ───────────────────────────────────────────────────────

Remove-Item "$Worktree/.claude-output.txt" -ErrorAction SilentlyContinue
Remove-Item "$Worktree/.claude-error.txt" -ErrorAction SilentlyContinue

Write-Step "Worker complete for issue #$issueNum"
