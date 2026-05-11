<#
.SYNOPSIS
    Publishes agent result summaries to GitHub issues or PRs with idempotent markers.
.DESCRIPTION
    Posts structured comments using <!-- ai-result:<id>:begin/end --> markers.
    Re-running with the same MarkerId updates the existing comment.
    Supports kinds: execution, review, audit, metrics.
    See docs/ai-native/result-publishing.md for redaction policy.
.EXAMPLE
    ./scripts/ai/publish-agent-result.ps1 -Repo "o/r" -TargetIssue 88 -Kind execution -Summary "PASS" -MarkerId "issue-88-exec"
#>

[CmdletBinding(DefaultParameterSetName = "Issue")]
param(
    [Parameter(Mandatory = $false)]
    [string]$Repo = $env:GH_REPO,

    [Parameter(Mandatory = $true, ParameterSetName = "Issue")]
    [int]$TargetIssue,

    [Parameter(Mandatory = $true, ParameterSetName = "PR")]
    [int]$TargetPR,

    [Parameter(Mandatory = $true)]
    [ValidateSet("execution", "review", "audit", "metrics")]
    [string]$Kind,

    [Parameter(Mandatory = $true)]
    [string]$Summary,

    [Parameter(Mandatory = $false)]
    [string]$Body = "",

    [Parameter(Mandatory = $true)]
    [string]$MarkerId,

    [Parameter(Mandatory = $false)]
    [string]$ChangedFiles = "",

    [Parameter(Mandatory = $false)]
    [string]$ValidationEvidence = "",

    [Parameter(Mandatory = $false)]
    [string]$LinkedIssues = "",

    [Parameter(Mandatory = $false)]
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

if (-not $Repo) {
    Write-Error "Repo is required. Pass -Repo OWNER/NAME or set GH_REPO env var."
    exit 1
}

# Validate marker ID is safe (alphanumeric, hyphens, underscores, dots only)
if ($MarkerId -notmatch '^[a-zA-Z0-9._-]+$') {
    Write-Error "MarkerId must contain only alphanumeric, hyphens, underscores, dots. Got: $MarkerId"
    exit 1
}

# Validate summary does not contain secrets patterns
$secretPatterns = @(
    'ghp_[a-zA-Z0-9]{36}',
    'gho_[a-zA-Z0-9]{36}',
    'github_pat_[a-zA-Z0-9_]{22,}',
    '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'AKIA[0-9A-Z]{16}',
    'password\s*[:=]',
    'secret\s*[:=]',
    'token\s*[:=]'
)
foreach ($pattern in $secretPatterns) {
    if ($Summary -match $pattern -or $Body -match $pattern) {
        Write-Error "Potential secret detected in content. Redact and retry."
        exit 1
    }
}

# ---------------------------------------------------------------------------
# Marker constants
# ---------------------------------------------------------------------------

$OPEN_MARKER  = "<!-- ai-result:$MarkerId:begin -->"
$CLOSE_MARKER = "<!-- ai-result:$MarkerId:end -->"

# ---------------------------------------------------------------------------
# Build comment body
# ---------------------------------------------------------------------------

$lines = @()
$lines += $OPEN_MARKER
$lines += ""
$lines += "### :robot: Agent Result ($Kind)"
$lines += ""
$lines += "**Status:** $Summary"
$lines += ""

if ($ChangedFiles) {
    $lines += "<details>"
    $lines += "<summary>Changed files</summary>"
    $lines += ""
    foreach ($file in ($ChangedFiles -split ",")) {
        $trimmed = $file.Trim()
        if ($trimmed) {
            $lines += "- ``$trimmed``"
        }
    }
    $lines += ""
    $lines += "</details>"
    $lines += ""
}

if ($Body) {
    $lines += $Body
    $lines += ""
}

if ($ValidationEvidence) {
    $lines += "<details>"
    $lines += "<summary>Validation evidence</summary>"
    $lines += ""
    $lines += "```"
    $lines += $ValidationEvidence
    $lines += "```"
    $lines += ""
    $lines += "</details>"
    $lines += ""
}

if ($LinkedIssues) {
    $lines += $LinkedIssues
    $lines += ""
}

$lines += $CLOSE_MARKER

$commentBody = $lines -join "`n"

# ---------------------------------------------------------------------------
# Dry-run output
# ---------------------------------------------------------------------------

if ($DryRun) {
    Write-Output "=== DRY RUN ==="
    Write-Output "Target: $(if ($TargetIssue) { "issue #$TargetIssue" } else { "PR #$TargetPR" })"
    Write-Output "Repo: $Repo"
    Write-Output ""
    Write-Output $commentBody
    Write-Output ""
    Write-Output "=== END DRY RUN ==="
    exit 0
}

# ---------------------------------------------------------------------------
# Check for existing comment (idempotency)
# ---------------------------------------------------------------------------

$targetNum = if ($TargetIssue) { $TargetIssue } else { $TargetPR }
$targetType = if ($TargetIssue) { "issue" } else { "pr" }

Write-Verbose "Searching for existing comment with marker $MarkerId on $targetType #$targetNum..."

$existingCommentId = $null
try {
    $commentsJson = gh api "repos/$Repo/issues/$targetNum/comments" --paginate 2>&1
    $comments = $commentsJson | ConvertFrom-Json
    foreach ($comment in $comments) {
        if ($comment.body -match [regex]::Escape($OPEN_MARKER)) {
            $existingCommentId = $comment.id
            Write-Verbose "Found existing comment: $existingCommentId"
            break
        }
    }
} catch {
    Write-Verbose "No existing comment found or API error: $_"
}

# ---------------------------------------------------------------------------
# Post or update comment
# ---------------------------------------------------------------------------

if ($existingCommentId) {
    Write-Output "Updating existing comment $existingCommentId on $targetType #$targetNum..."
    gh api "repos/$Repo/issues/comments/$existingCommentId" `
        -X PATCH `
        -f body="$commentBody" | Out-Null
    Write-Output "Updated comment $existingCommentId."
} else {
    Write-Output "Posting new comment on $targetType #$targetNum..."
    gh api "repos/$Repo/issues/$targetNum/comments" `
        -X POST `
        -f body="$commentBody" | Out-Null
    Write-Output "Posted comment on $targetType #$targetNum."
}

Write-Output "Done."
