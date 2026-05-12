#Requires -Version 7.0
<#
.SYNOPSIS
    Runs a Claude Code worker in --print mode against a worktree.

.DESCRIPTION
    Invokes Claude Code with the task contract as context, constrained to the
    worktree directory. Captures output and commits results. Designed for
    self-hosted use -no external orchestration service required.

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

# -- Helpers --

function Write-Step($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "   FAIL: $msg" -ForegroundColor Red; exit 1 }
function Has-Prop($obj, [string]$name) {
    return $null -ne $obj -and ($obj.PSObject.Properties.Name -contains $name)
}

function Get-OptionalField {
    param($Obj, [string]$Field, $Default = $null)
    if ($null -eq $Obj) { return $Default }
    if ($Obj.PSObject.Properties.Name -contains $Field) {
        $val = $Obj.$Field
        if ($null -eq $val) { return $Default }
        return $val
    }
    return $Default
}

function Select-TaskFromBatch {
    <#
    .SYNOPSIS
        Selects a single task from a JSON file that may be a single object or an array.
        When the file contains multiple tasks, extracts the issue number from the
        Branch name (e.g. "claude/issue-1291-task-board-projection" -> 1291) and
        matches it against targetIssue.
    #>
    param([string]$FilePath, [string]$BranchName)

    $raw = Get-Content $FilePath -Raw -Encoding UTF8
    $parsed = $raw | ConvertFrom-Json

    # Single object - return directly
    if ($parsed -isnot [System.Array]) {
        return $parsed
    }

    $tasks = @($parsed)
    if ($tasks.Count -eq 1) {
        return $tasks[0]
    }

    # Multiple tasks - extract issue number from branch name
    # Branch format: claude/issue-<NUMBER>-<conflict-group>
    $issueMatch = [regex]::Match($BranchName, 'issue-(\d+)')
    if (-not $issueMatch.Success) {
        Write-Fail "BATCH_SINGLE_TASK_MISMATCH: Branch '$BranchName' does not contain an issue number (expected format: claude/issue-<N>-...). Cannot select task from batch of $($tasks.Count)."
    }

    $targetIssue = [int]$issueMatch.Groups[1].Value
    foreach ($t in $tasks) {
        if ([int]$t.targetIssue -eq $targetIssue) {
            return $t
        }
    }

    # No match found
    $availableIssues = ($tasks | ForEach-Object { "#$($_.targetIssue)" }) -join ", "
    Write-Fail "BATCH_SINGLE_TASK_MISMATCH: Branch '$BranchName' targets issue #$targetIssue, but batch file contains: $availableIssues. No matching task found."
}

# -- Validate inputs --

if (-not (Test-Path $TaskFile)) {
    Write-Fail "Task file not found: $TaskFile"
}

if (-not (Test-Path $Worktree)) {
    Write-Fail "Worktree not found: $Worktree"
}

# -- Load task --

$task = Select-TaskFromBatch -FilePath $TaskFile -BranchName $Branch
$issueNum = $task.targetIssue

Write-Step "Preparing worker for issue #$issueNum"

# -- Build prompt --

# Collect all issue numbers for context - safely access optional 'issues' field
$allIssues = @($issueNum)
$issuesRaw = Get-OptionalField $task "issues" @()
if ($issuesRaw) {
    foreach ($i in @($issuesRaw)) {
        if ($i -ne $issueNum) { $allIssues += $i }
    }
}
$issuesStr = $allIssues -join ", "

# Build allowed files list
$allowedFiles = @(Get-OptionalField $task "allowedFiles" @())
$allowedStr = ($allowedFiles | ForEach-Object { "- $_" }) -join "`n"

# Build forbidden files list
$forbiddenFiles = @(Get-OptionalField $task "forbiddenFiles" @())
$forbiddenStr = ($forbiddenFiles | ForEach-Object { "- $_" }) -join "`n"

# Build validation commands list - safely access optional field
$valCmds = @(Get-OptionalField $task "validationCommands" @())
$valCmdsStr = ($valCmds | ForEach-Object { "- $_" }) -join "`n"

# Build role packet section - safely access optional nested fields
$roleSection = ""
$rolePacket = Get-OptionalField $task "rolePacket" $null
if ($rolePacket) {
    $actorRole = Get-OptionalField $rolePacket "actorRole" "unknown"
    $roleSection += "Actor role: $actorRole"
    $roleDesc = Get-OptionalField $rolePacket "description" $null
    if ($roleDesc) {
        $roleSection += "`n$roleDesc"
    }
}

# Build attention areas section - safely access optional nested field
$attentionSection = ""
$attentionAreas = Get-OptionalField $task "attentionAreas" $null
if ($attentionAreas) {
    $focusList = Get-OptionalField $attentionAreas "focus" @()
    if ($focusList -and @($focusList).Count -gt 0) {
        $attentionSection += "Focus on:`n"
        foreach ($f in @($focusList)) { $attentionSection += "- $f`n" }
    }
    $blindspots = Get-OptionalField $attentionAreas "knownBlindspots" @()
    if ($blindspots -and @($blindspots).Count -gt 0) {
        $attentionSection += "Known blindspots:`n"
        foreach ($b in @($blindspots)) { $attentionSection += "- $b`n" }
    }
}

# Build budgets section - safely access optional nested field
$budgetsSection = ""
$budgets = Get-OptionalField $task "budgets" $null
if ($budgets) {
    $parts = @()
    $mf = Get-OptionalField $budgets "maxFiles" $null
    if ($mf) { $parts += "maxFiles=$mf" }
    $mlc = Get-OptionalField $budgets "maxLinesChanged" $null
    if ($mlc) { $parts += "maxLinesChanged=$mlc" }
    $stm = Get-OptionalField $budgets "softTimeMinutes" $null
    if ($stm) { $parts += "softTimeMinutes=$stm" }
    $htm = Get-OptionalField $budgets "hardTimeMinutes" $null
    if ($htm) { $parts += "hardTimeMinutes=$htm" }
    $budgetsSection = $parts -join ", "
}

# Build source of truth docs section - safely access optional field
$sourceOfTruthSection = ""
$sotDocs = Get-OptionalField $task "sourceOfTruthDocs" @()
if ($sotDocs -and @($sotDocs).Count -gt 0) {
    $sourceOfTruthSection += (@($sotDocs) | ForEach-Object { "- $_" }) -join "`n"
}

# Build issue repo string (for gh CLI)
$repoSlug = "taoyu051818-sys/lian-nest-server"

$promptParts = @()
$promptParts += "You are a Claude Code worker in the lian-nest-server repository."
$promptParts += ""
$taskDesc = Get-OptionalField $rolePacket "description" "No description provided"
$promptParts += "Task: $taskDesc"
$promptParts += "GitHub issue: https://github.com/$repoSlug/issues/$issueNum"
$promptParts += ""
$promptParts += "First read the GitHub issue body and relevant repository docs. Use the issue and current repository files as the semantic source of truth; use the JSON control appendix only for boundaries, risk, validation, and routing."
$promptParts += ""
$promptParts += "Deliver a small, bounded PR that closes #$issueNum. Keep changes inside allowedFiles. Run the listed validation commands. If blocked, do not make broad edits; leave a concise GitHub issue comment explaining the blocker and evidence."
$promptParts += "---"
$promptParts += "CONTROL APPENDIX (launcher generated)"
$promptParts += "Task type: $(Get-OptionalField $task 'taskType' 'unknown')"
$promptParts += "Risk: $(Get-OptionalField $task 'risk' 'unknown')"
$promptParts += "Conflict group: $(Get-OptionalField $task 'conflictGroup' 'unknown')"
$promptParts += "Target issue: $issueNum"
$targetPrValue = Get-OptionalField $task "targetPR" "none"
$promptParts += "Target PR: $targetPrValue"
$promptParts += "Issues: $issuesStr"
$expectedPrValue = Get-OptionalField $task "expectedPR" "unknown"
$promptParts += "Expected PR: $expectedPrValue"
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

# -- Build allowed tools --

# Restrict tool access based on task type
$allowedTools = @("Edit", "Write", "Read", "Glob", "Grep")
# Allow reading the GitHub issue body (bounded, read-only)
$allowedTools += "Bash(gh issue view *)"
if ((Get-OptionalField $task "taskType" "") -eq "execution") {
    $allowedTools += "Bash(git *)"
    $allowedTools += "Bash(npm run *)"
    $valCmdsForTools = Get-OptionalField $task "validationCommands" @()
    if ($valCmdsForTools) {
        foreach ($cmd in @($valCmdsForTools)) {
            # Add each validation command pattern
            $allowedTools += "Bash($cmd)"
        }
    }
}

$allowedToolsStr = $allowedTools -join ","

Write-Step "Allowed tools: $allowedToolsStr"

# -- Invoke Claude Code --

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

# -- Telemetry: emit start event --

$telemetryWriter = Join-Path $PSScriptRoot "write-worker-telemetry-event.js"
$startedAt = [DateTime]::UtcNow

if (Test-Path $telemetryWriter) {
    Write-Step "Emitting worker telemetry start event"
    $telemetryRole = Get-OptionalField $rolePacket "actorRole" "unknown"
    try {
        node $telemetryWriter --event start --task-id $Branch --issue-number $issueNum --actor-role $telemetryRole --live 2>$null
        if ($LASTEXITCODE -eq 0) { Write-Ok "Telemetry start event recorded" }
    } catch {
        Write-Host "   Telemetry start event failed (non-blocking)" -ForegroundColor DarkYellow
    }
}

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

# -- Telemetry: emit complete event --

if (Test-Path $telemetryWriter) {
    Write-Step "Emitting worker telemetry complete event"
    $endedAt = [DateTime]::UtcNow
    $elapsedMs = [int]($endedAt - $startedAt).TotalMilliseconds
    $telemetryRole2 = Get-OptionalField $rolePacket "actorRole" "unknown"
    try {
        node $telemetryWriter --event complete --task-id $Branch --issue-number $issueNum --actor-role $telemetryRole2 --elapsed-ms $elapsedMs --live 2>$null
        if ($LASTEXITCODE -eq 0) { Write-Ok "Telemetry complete event recorded (${elapsedMs}ms)" }
    } catch {
        Write-Host "   Telemetry complete event failed (non-blocking)" -ForegroundColor DarkYellow
    }
}

$stdout = if (Test-Path "$Worktree/.claude-output.txt") { Get-Content "$Worktree/.claude-output.txt" -Raw } else { "" }
$stderr = if (Test-Path "$Worktree/.claude-error.txt") { Get-Content "$Worktree/.claude-error.txt" -Raw } else { "" }

# -- Report results --

# Sanitization note: stdout/stderr may contain secrets, tokens, or raw LLM
# transcripts. Console output is for local debugging only -never paste or
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

# -- Cleanup temp files before staging --

Remove-Item "$Worktree/.claude-output.txt" -ErrorAction SilentlyContinue
Remove-Item "$Worktree/.claude-error.txt" -ErrorAction SilentlyContinue

# -- Commit if changes exist --

Write-Step "Checking for changes to commit"

Push-Location $Worktree
try {
    $gitStatus = git status --porcelain
    if ($gitStatus) {
        Write-Step "Staging and committing changes"
        git add -A
        git commit -m "feat(ai-worker): implement issue #$issueNum

        Automated by self-hosted batch launcher.
        Task type: $(Get-OptionalField $task 'taskType' 'unknown')
        Risk: $(Get-OptionalField $task 'risk' 'unknown')
        Conflict group: $(Get-OptionalField $task 'conflictGroup' 'unknown')

        Co-Authored-By: Claude Code <noreply@anthropic.com>"

        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Changes committed on branch $Branch"
        } else {
            Write-Host "   Commit failed -worker may need to fix conflicts" -ForegroundColor Yellow
        }
    } else {
        Write-Ok "No changes to commit"
    }
} finally {
    Pop-Location
}

Write-Step "Worker complete for issue #$issueNum"

