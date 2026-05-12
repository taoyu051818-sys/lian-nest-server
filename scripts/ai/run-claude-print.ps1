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

# Collect all issue numbers for context
$allIssues = @($issueNum)
if ($task.issues) {
    foreach ($i in $task.issues) {
        if ($i -ne $issueNum) { $allIssues += $i }
    }
}
$issuesStr = $allIssues -join ", "

# Build allowed files list
$allowedStr = ($task.allowedFiles | ForEach-Object { "- $_" }) -join "`n"

# Build forbidden files list
$forbiddenStr = ($task.forbiddenFiles | ForEach-Object { "- $_" }) -join "`n"

# Build validation commands list
$valCmdsStr = ($task.validationCommands | ForEach-Object { "- $_" }) -join "`n"

# Build role packet section
$roleSection = ""
if ($task.rolePacket) {
    $roleSection += "Actor role: $($task.rolePacket.actorRole)"
    if ($task.rolePacket.description) {
        $roleSection += "`n$($task.rolePacket.description)"
    }
}

# Build attention areas section
$attentionSection = ""
if ($task.attentionAreas) {
    if ($task.attentionAreas.focus -and $task.attentionAreas.focus.Count -gt 0) {
        $attentionSection += "Focus on:`n"
        foreach ($f in $task.attentionAreas.focus) { $attentionSection += "- $f`n" }
    }
    if ($task.attentionAreas.knownBlindspots -and $task.attentionAreas.knownBlindspots.Count -gt 0) {
        $attentionSection += "Known blindspots:`n"
        foreach ($b in $task.attentionAreas.knownBlindspots) { $attentionSection += "- $b`n" }
    }
}

# Build budgets section
$budgetsSection = ""
if ($task.budgets) {
    $parts = @()
    if ($task.budgets.maxFiles) { $parts += "maxFiles=$($task.budgets.maxFiles)" }
    if ($task.budgets.maxLinesChanged) { $parts += "maxLinesChanged=$($task.budgets.maxLinesChanged)" }
    if ($task.budgets.softTimeMinutes) { $parts += "softTimeMinutes=$($task.budgets.softTimeMinutes)" }
    if ($task.budgets.hardTimeMinutes) { $parts += "hardTimeMinutes=$($task.budgets.hardTimeMinutes)" }
    $budgetsSection = $parts -join ", "
}

# Build source of truth docs section
$sourceOfTruthSection = ""
if ($task.sourceOfTruthDocs -and $task.sourceOfTruthDocs.Count -gt 0) {
    $sourceOfTruthSection += ($task.sourceOfTruthDocs | ForEach-Object { "- $_" }) -join "`n"
}

# Build issue repo string (for gh CLI)
$repoSlug = "taoyu051818-sys/lian-nest-server"

$promptParts = @()
$promptParts += "You are a Claude Code worker in the lian-nest-server repository."
$promptParts += ""
$promptParts += "Task: $($task.rolePacket.description)"
$promptParts += "GitHub issue: https://github.com/$repoSlug/issues/$issueNum"
$promptParts += ""
$promptParts += "First read the GitHub issue body and relevant repository docs. Use the issue and current repository files as the semantic source of truth; use the JSON control appendix only for boundaries, risk, validation, and routing."
$promptParts += ""
$promptParts += "Deliver a small, bounded PR that closes #$issueNum. Keep changes inside allowedFiles. Run the listed validation commands. If blocked, do not make broad edits; leave a concise GitHub issue comment explaining the blocker and evidence."
$promptParts += "---"
$promptParts += "CONTROL APPENDIX (launcher generated)"
$promptParts += "Task type: $($task.taskType)"
$promptParts += "Risk: $($task.risk)"
$promptParts += "Conflict group: $($task.conflictGroup)"
$promptParts += "Target issue: $issueNum"
$promptParts += "Target PR: $($task.targetPR)"
$promptParts += "Issues: $issuesStr"
$promptParts += "Expected PR: $($task.expectedPR)"
$promptParts += "Allowed files:"
$promptParts += $allowedStr
$promptParts += "Forbidden files:"
$promptParts += $forbiddenStr
$promptParts += "Validation commands:"
$promptParts += $valCmdsStr

if ($roleSection) {
    $promptParts += "Role packet:"
    $promptParts += $roleSection
}

if ($attentionSection) {
    $promptParts += ""
    $promptParts += "Attention areas:"
    $promptParts += $attentionSection.TrimEnd()
}

if ($budgetsSection) {
    $promptParts += "Budgets: {$budgetsSection}"
}

if ($sourceOfTruthSection) {
    $promptParts += ""
    $promptParts += "Source of truth docs:"
    $promptParts += $sourceOfTruthSection
}

$promptParts += ""
$promptParts += "Use these boundaries as hard constraints. If the requested fix requires files outside allowedFiles, stop and explain the blocker instead of making an unbounded change."
$promptParts += "Do NOT output secrets, tokens, auth output, credentials, .env contents, local transcript contents, or llm_io_logs contents."

$promptText = $promptParts -join "`n"

# ── Build allowed tools ──────────────────────────────────────────────────────

# Restrict tool access based on task type
$allowedTools = @("Edit", "Write", "Read", "Glob", "Grep")
# Allow reading the GitHub issue body (bounded, read-only)
$allowedTools += "Bash(gh issue view *)"
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

# Execute claude in this worker process. Avoid Start-Process here: on
# Windows, the npm PowerShell shim plus a long multi-line prompt can be
# truncated or re-quoted, causing Claude to receive an empty prompt.
$claudeCommand = Get-Command "claude" -ErrorAction Stop

Push-Location $Worktree
try {
    $stdoutText = & $claudeCommand.Source @claudeArgs 2> ".claude-error.txt"
    $exitCode = $LASTEXITCODE
    $stdoutText | Out-String | Set-Content -Encoding UTF8 ".claude-output.txt"
} finally {
    Pop-Location
}

$stdout = if (Test-Path "$Worktree/.claude-output.txt") { Get-Content "$Worktree/.claude-output.txt" -Raw } else { "" }
$stderr = if (Test-Path "$Worktree/.claude-error.txt") { Get-Content "$Worktree/.claude-error.txt" -Raw } else { "" }

# ── Report results ───────────────────────────────────────────────────────────

# Sanitization note: stdout/stderr may contain secrets, tokens, or raw LLM
# transcripts. Console output is for local debugging only — never paste or
# publish it directly. Use publish-agent-result.ps1 which enforces redaction.

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

Write-Host ""
Write-Host "[sanitization] Output above is for local debugging only." -ForegroundColor DarkYellow
Write-Host "[sanitization] Do NOT paste raw logs into issues, PRs, or comments." -ForegroundColor DarkYellow
Write-Host "[sanitization] Use publish-agent-result.ps1 to publish sanitized results." -ForegroundColor DarkYellow

# ── Cleanup temp files before staging ────────────────────────────────────────

Remove-Item "$Worktree/.claude-output.txt" -ErrorAction SilentlyContinue
Remove-Item "$Worktree/.claude-error.txt" -ErrorAction SilentlyContinue

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

Write-Step "Worker complete for issue #$issueNum"
