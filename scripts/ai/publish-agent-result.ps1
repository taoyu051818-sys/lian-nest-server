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

# ---------------------------------------------------------------------------
# Sanitization helpers
# ---------------------------------------------------------------------------

$MAX_VALIDATION_LINES = 200
$MAX_COMMENT_CHARS    = 65000  # GitHub limit is 65536; leave headroom

function Strip-AnsiEscapes {
    param([string]$Text)
    return $Text -replace '\x1b\[[0-9;]*[A-Za-z]', ''
}

function Truncate-Lines {
    param([string]$Text, [int]$MaxLines)
    $allLines = $Text -split "`n"
    if ($allLines.Count -le $MaxLines) { return $Text }
    $kept = $allLines[0..($MaxLines - 1)] -join "`n"
    return "$kept`n... (truncated: $($allLines.Count) lines total, showing first $MaxLines)"
}

# ---------------------------------------------------------------------------
# Scan ALL user-supplied content for secrets
# ---------------------------------------------------------------------------

$secretPatterns = @(
    'ghp_[a-zA-Z0-9]{36}',
    'gho_[a-zA-Z0-9]{36}',
    'github_pat_[a-zA-Z0-9_]{22,}',
    'glpat-[a-zA-Z0-9_-]{20,}',
    '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'AKIA[0-9A-Z]{16}',
    'xox[bpors]-[a-zA-Z0-9-]{10,}',
    'Bearer\s+[A-Za-z0-9._-]{20,}',
    'password\s*[:=]\s*\S+',
    'secret\s*[:=]\s*\S+',
    'token\s*[:=]\s*\S+'
)

$allContent = @($Summary, $Body, $ValidationEvidence, $ChangedFiles, $LinkedIssues) | Where-Object { $_ }
foreach ($content in $allContent) {
    foreach ($pattern in $secretPatterns) {
        if ($content -match $pattern) {
            Write-Error "Potential secret detected in content (pattern: $pattern). Redact and retry."
            exit 1
        }
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
    $sanitizedEvidence = Strip-AnsiEscapes $ValidationEvidence
    $sanitizedEvidence = Truncate-Lines $sanitizedEvidence $MAX_VALIDATION_LINES
    $lines += "<details>"
    $lines += "<summary>Validation evidence</summary>"
    $lines += ""
    $lines += '```'
    $lines += $sanitizedEvidence
    $lines += '```'
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

# Guard: truncate if comment exceeds GitHub's limit
if ($commentBody.Length -gt $MAX_COMMENT_CHARS) {
    Write-Warning "Comment body ($($commentBody.Length) chars) exceeds $MAX_COMMENT_CHARS limit. Truncating."
    $commentBody = $commentBody.Substring(0, $MAX_COMMENT_CHARS - 60) + "`n`n... (truncated to fit GitHub comment size limit)"
    $commentBody += "`n$CLOSE_MARKER"
}

# ---------------------------------------------------------------------------
# Dry-run output
# ---------------------------------------------------------------------------

if ($DryRun) {
    Write-Output "=== DRY RUN ==="
    Write-Output "Target: $(if ($TargetIssue) { "issue #$TargetIssue" } else { "PR #$TargetPR" })"
    Write-Output "Repo: $Repo"
    Write-Output "Comment size: $($commentBody.Length) chars (limit: $MAX_COMMENT_CHARS)"
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
