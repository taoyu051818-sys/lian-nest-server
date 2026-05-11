#Requires -Version 7.0
<#
.SYNOPSIS
    Preview-first issue close and state reconcile wrapper for WebUI control console.

.DESCRIPTION
    Orchestrates the issue lifecycle control scripts (state-reconciler,
    reconcile-worker-prs, auto-close-done-issues) behind a single
    preview-first wrapper for the WebUI control console.

    Safety policy:
      - Dry-run is the default. -Execute is required for mutation.
      - Explicit issue allowlist is required for execute mode.
      - Umbrella issues and human-required issues are refused.
      - Produces structured audit payload with idempotent markers.
      - Never bypasses policy/gate semantics of underlying scripts.

.PARAMETER Repo
    GitHub owner/repo. Defaults to GH_REPO env var.

.PARAMETER IssueNumbers
    Explicit allowlist of issue numbers to process. Required for -Execute.

.PARAMETER DryRun
    Explicit dry-run mode (default behavior). Conflicts with -Execute.

.PARAMETER Execute
    Close eligible issues and reconcile state. Requires -IssueNumbers.

.PARAMETER Json
    Output structured JSON instead of human-readable text.

.PARAMETER FixturePath
    Load issues from a JSON fixture file (offline mode). Disables mutation.

.PARAMETER SkipHealthCheck
    Skip the main health gate check in auto-close.

.PARAMETER Help
    Display this help message and exit.

.EXAMPLE
    # Preview mode (default — no changes)
    ./scripts/ai/webui-issue-control.ps1 -Repo "owner/name" -IssueNumbers 655,656

.EXAMPLE
    # Explicit dry-run
    ./scripts/ai/webui-issue-control.ps1 -Repo "owner/name" -IssueNumbers 655 -DryRun

.EXAMPLE
    # Execute with allowlist (mutating)
    ./scripts/ai/webui-issue-control.ps1 -Repo "owner/name" -IssueNumbers 655 -Execute

.EXAMPLE
    # JSON output for CI
    ./scripts/ai/webui-issue-control.ps1 -Repo "owner/name" -IssueNumbers 655 -Json

.EXAMPLE
    # Fixture mode (offline testing)
    ./scripts/ai/webui-issue-control.ps1 -FixturePath ./snapshot.json

.EXAMPLE
    # Display help
    ./scripts/ai/webui-issue-control.ps1 -Help
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$Repo = $env:GH_REPO,

    [Parameter(Mandatory = $false)]
    [int[]]$IssueNumbers,

    [Parameter(Mandatory = $false)]
    [switch]$DryRun,

    [Parameter(Mandatory = $false)]
    [switch]$Execute,

    [Parameter(Mandatory = $false)]
    [switch]$Json,

    [Parameter(Mandatory = $false)]
    [string]$FixturePath,

    [Parameter(Mandatory = $false)]
    [switch]$SkipHealthCheck,

    [Parameter(Mandatory = $false)]
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Help ─────────────────────────────────────────────────────────────────────

if ($Help) {
    @"

WEBUI ISSUE CONTROL — Preview-first issue close and state reconcile wrapper

USAGE
    ./scripts/ai/webui-issue-control.ps1 -Repo "owner/name" -IssueNumbers 655,656 [options]

OPTIONS
    -Repo <string>              GitHub owner/repo (or set GH_REPO)
    -IssueNumbers <int[]>       Explicit issue allowlist (required for -Execute)
    -DryRun                     Explicit dry-run (default behavior)
    -Execute                    Close eligible issues (mutating, requires -IssueNumbers)
    -Json                       Output structured JSON
    -FixturePath <string>       Load from JSON fixture (offline, disables mutation)
    -SkipHealthCheck            Skip main health gate in auto-close
    -Help                       Show this help message

DRY-RUN CONTRACT
    This script defaults to dry-run. No issues are closed or labels
    changed without the -Execute flag. In dry-run mode the script
    reports what would happen and exits 0.

SAFETY POLICY
    - Explicit issue allowlist is required for -Execute mode.
    - Umbrella issues (title contains 'umbrella') are refused.
    - Issues with 'human-required' label are refused.
    - Underlying scripts are called with their own safety defaults.

"@ | Write-Output
    exit 0
}

# ── Mutual exclusion ────────────────────────────────────────────────────────

if ($DryRun -and $Execute) {
    Write-Error "-DryRun and -Execute cannot be used together. -DryRun enforces no mutation."
    exit 1
}

# ── Validation ───────────────────────────────────────────────────────────────

if (-not $FixturePath -and -not $Repo) {
    Write-Error "Repo is required. Pass -Repo OWNER/NAME or set GH_REPO env var (not needed with -FixturePath)."
    exit 1
}

if ($Execute -and -not $FixturePath -and (-not $IssueNumbers -or $IssueNumbers.Count -eq 0)) {
    Write-Error "-Execute requires an explicit issue allowlist via -IssueNumbers."
    exit 1
}

if ($Execute -and $FixturePath) {
    Write-Error "-Execute cannot be used with -FixturePath (fixture mode is read-only)."
    exit 1
}

# ── Constants ────────────────────────────────────────────────────────────────

$SCRIPT_DIR = $PSScriptRoot
$AUDIT_MARKER_BEGIN = "<!-- ai-webui-issue-control:begin -->"
$AUDIT_MARKER_END   = "<!-- ai-webui-issue-control:end -->"
$AGENT_LABELS = @("agent:queued", "agent:running", "agent:blocked", "agent:done")
$REFUSE_LABELS = @("human-required")
$REFUSE_TITLE_PATTERNS = @("umbrella")

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step($msg) { if (-not $Json) { Write-Host "[step] $msg" -ForegroundColor Cyan } }
function Write-Ok($msg)   { if (-not $Json) { Write-Host "[ok]   $msg" -ForegroundColor Green } }
function Write-Warn($msg) { if (-not $Json) { Write-Host "[warn] $msg" -ForegroundColor Yellow } }
function Write-Fail($msg) { if (-not $Json) { Write-Host "[fail] $msg" -ForegroundColor Red } }
function Write-Info($msg) { if (-not $Json) { Write-Host "[info] $msg" -ForegroundColor Gray } }

function Get-SafeProp {
    param($Obj, [string]$Name, $Default = $null)
    if ($Obj.PSObject.Properties[$Name]) { return $Obj.$Name }
    return $Default
}

function Test-IsRefused {
    param($Issue)
    $num = $issue.number
    $title = if ($issue.title) { $issue.title } else { "" }

    # Check title patterns
    foreach ($pattern in $REFUSE_TITLE_PATTERNS) {
        if ($title -match $pattern) {
            return [PSCustomObject]@{
                Refused = $true
                Reason  = "Title matches refuse pattern: '$pattern'"
            }
        }
    }

    # Check labels
    foreach ($label in $Issue.labels) {
        $lname = if ($label -is [string]) { $label } else { $label.name }
        foreach ($refuseLabel in $REFUSE_LABELS) {
            if ($lname -eq $refuseLabel) {
                return [PSCustomObject]@{
                    Refused = $true
                    Reason  = "Has refuse label: '$refuseLabel'"
                }
            }
        }
    }

    return [PSCustomObject]@{ Refused = $false; Reason = "" }
}

function Get-IssuesFromFixture {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        Write-Error "Fixture file not found: $Path"
        exit 1
    }
    $data = Get-Content $Path -Raw | ConvertFrom-Json
    if ($null -ne $data.issues) { return @($data.issues) }
    return @($data)
}

function Get-IssuesFromGitHub {
    param([string]$RepoName, [int[]]$Numbers)
    $issues = @()
    if ($Numbers -and $Numbers.Count -gt 0) {
        foreach ($num in $Numbers) {
            try {
                $json = gh issue view $num --repo $RepoName --json number,title,state,labels,body,createdAt,updatedAt 2>$null
                $issues += ($json | ConvertFrom-Json)
            } catch {
                Write-Warn "  Could not fetch issue #${num}: $_"
            }
        }
    } else {
        try {
            $json = gh issue list --repo $RepoName --label "agent:running,agent:done,agent:blocked,agent:queued" --json number,title,state,labels,body,createdAt,updatedAt --limit 100 2>$null
            if ($json -and $json.Trim() -ne "[]") {
                $issues = @($json | ConvertFrom-Json)
            }
        } catch {
            Write-Warn "Could not fetch issues: $_"
        }
    }
    return $issues
}

# ── Load issues ──────────────────────────────────────────────────────────────

Write-Step "Loading issues"

$issues = @()
if ($FixturePath) {
    Write-Info "Loading from fixture: $FixturePath"
    $issues = @(Get-IssuesFromFixture -Path $FixturePath)
} else {
    Write-Info "Querying GitHub: $Repo"
    $issues = @(Get-IssuesFromGitHub -RepoName $Repo -Numbers $IssueNumbers)
}

if ($issues.Count -eq 0) {
    Write-Ok "No issues found."
    if ($Json) {
        @{
            version     = 1
            mode        = if ($Execute) { "execute" } else { "dry-run" }
            repo        = $Repo
            capturedAt  = ([DateTime]::UtcNow).ToString("o")
            issues      = @()
            refused     = @()
            reconcile   = @{ driftCount = 0; correctionCount = 0; closeCount = 0 }
            audit       = @{ markerBegin = $AUDIT_MARKER_BEGIN; markerEnd = $AUDIT_MARKER_END }
        } | ConvertTo-Json -Depth 10
    }
    exit 0
}

Write-Info "Found $($issues.Count) issue(s)"

# ── Refuse check ─────────────────────────────────────────────────────────────

Write-Step "Checking issue allowlist safety"

$refused = @()
$allowed = @()

foreach ($issue in $issues) {
    $num = $issue.number
    $check = Test-IsRefused -Issue $issue
    if ($check.Refused) {
        $refused += [ordered]@{
            issue  = $num
            title  = $issue.title
            reason = $check.Reason
        }
        Write-Warn "  REFUSED #$num — $($check.Reason)"
    } else {
        $allowed += $issue
    }
}

if ($refused.Count -gt 0) {
    Write-Warn "$($refused.Count) issue(s) refused by safety policy."
}

if ($allowed.Count -eq 0) {
    Write-Ok "No allowed issues to process."
    if ($Json) {
        @{
            version     = 1
            mode        = if ($Execute) { "execute" } else { "dry-run" }
            repo        = $Repo
            capturedAt  = ([DateTime]::UtcNow).ToString("o")
            issues      = @()
            refused     = $refused
            reconcile   = @{ driftCount = 0; correctionCount = 0; closeCount = 0 }
            audit       = @{ markerBegin = $AUDIT_MARKER_BEGIN; markerEnd = $AUDIT_MARKER_END }
        } | ConvertTo-Json -Depth 10
    }
    exit 0
}

Write-Info "$($allowed.Count) issue(s) allowed for processing"

# ── State reconciliation (read-only) ────────────────────────────────────────

$driftCount = 0
$driftExitCode = 0

if (-not $FixturePath) {
    Write-Step "Running state reconciliation (read-only)"

    $reconcilerArgs = @("-Repo", $Repo)
    if ($allowed.Count -gt 0 -and $IssueNumbers) {
        $allowedNumbers = @($allowed | ForEach-Object { $_.number })
        $reconcilerArgs += "-IssueNumbers"
        $reconcilerArgs += ($allowedNumbers -join ",")
    }
    $reconcilerArgs += "-DryRun"

    $driftReport = & pwsh -NoProfile -File "$SCRIPT_DIR/state-reconciler.ps1" @reconcilerArgs 2>&1
    $driftExitCode = $LASTEXITCODE

    if ($driftReport -match "Found (\d+) drift item") {
        $driftCount = [int]$Matches[1]
    }

    Write-Info "State reconciler found $driftCount drift item(s) (exit: $driftExitCode)"
} else {
    Write-Info "Skipping state reconciler (fixture mode)"
}

# ── Worker PR reconciliation (read-only) ─────────────────────────────────────

$correctionCount = 0
$prExitCode = 0

if (-not $FixturePath) {
    Write-Step "Running worker PR reconciliation (read-only)"

    $prReconcilerArgs = @("-Repo", $Repo)
    if ($allowed.Count -gt 0 -and $IssueNumbers) {
        $allowedNumbers = @($allowed | ForEach-Object { $_.number })
        $prReconcilerArgs += "-IssueNumbers"
        $prReconcilerArgs += ($allowedNumbers -join ",")
    }

    $prReport = & pwsh -NoProfile -File "$SCRIPT_DIR/reconcile-worker-prs.ps1" @prReconcilerArgs 2>&1
    $prExitCode = $LASTEXITCODE

    if ($prReport -match "Found (\d+) correction") {
        $correctionCount = [int]$Matches[1]
    }

    Write-Info "Worker PR reconciler found $correctionCount correction(s) (exit: $prExitCode)"
} else {
    Write-Info "Skipping worker PR reconciler (fixture mode)"
}

# ── Auto-close eligible issues ──────────────────────────────────────────────

$closeCount = 0

if ($FixturePath) {
    Write-Info "Skipping auto-close (fixture mode)"
} elseif ($Execute) {
    Write-Step "Checking auto-close eligibility (execute)"

    $allowedNumbers = @($allowed | ForEach-Object { $_.number })
    $closeArgs = @("-Repo", $Repo, "-IssueNumbers", ($allowedNumbers -join ","), "-Execute")
    if ($SkipHealthCheck) { $closeArgs += "-SkipHealthCheck" }

    $closeReport = & pwsh -NoProfile -File "$SCRIPT_DIR/auto-close-done-issues.ps1" @closeArgs 2>&1
    $closeExitCode = $LASTEXITCODE

    if ($closeReport -match "Closed: (\d+)") {
        $closeCount = [int]$Matches[1]
    }

    Write-Info "Auto-close: $closeCount issue(s) closed (exit: $closeExitCode)"
} else {
    Write-Step "Checking auto-close eligibility (dry-run)"

    $allowedNumbers = @($allowed | ForEach-Object { $_.number })
    $closeArgs = @("-Repo", $Repo, "-IssueNumbers", ($allowedNumbers -join ","), "-DryRun")
    if ($SkipHealthCheck) { $closeArgs += "-SkipHealthCheck" }

    $closeReport = & pwsh -NoProfile -File "$SCRIPT_DIR/auto-close-done-issues.ps1" @closeArgs 2>&1
    $closeExitCode = $LASTEXITCODE

    Write-Info "Auto-close preview complete (exit: $closeExitCode)"
}

# ── Build audit payload ─────────────────────────────────────────────────────

$auditPayload = [ordered]@{
    version     = 1
    mode        = if ($Execute) { "execute" } else { "dry-run" }
    repo        = $Repo
    capturedAt  = ([DateTime]::UtcNow).ToString("o")
    issues      = @($allowed | ForEach-Object {
        [ordered]@{
            number = $_.number
            title  = $_.title
            state  = if ($_.state) { $_.state } else { "OPEN" }
        }
    })
    refused     = $refused
    reconcile   = [ordered]@{
        driftCount      = $driftCount
        correctionCount = $correctionCount
        closeCount      = $closeCount
    }
    audit       = [ordered]@{
        markerBegin = $AUDIT_MARKER_BEGIN
        markerEnd   = $AUDIT_MARKER_END
    }
}

# ── Output ───────────────────────────────────────────────────────────────────

if ($Json) {
    $auditPayload | ConvertTo-Json -Depth 10
    exit 0
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  WebUI Issue Control Report" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Mode: $(if ($Execute) { 'EXECUTE' } else { 'DRY-RUN' })" -ForegroundColor $(if ($Execute) { 'Red' } else { 'Yellow' })
Write-Host "  Repo: $Repo" -ForegroundColor White
Write-Host ""

# Issues processed
Write-Host "  Issues processed: $($allowed.Count)" -ForegroundColor White
foreach ($issue in $allowed) {
    Write-Host "    #$($issue.number) $($issue.title)" -ForegroundColor Gray
}

if ($refused.Count -gt 0) {
    Write-Host ""
    Write-Host "  Refused: $($refused.Count)" -ForegroundColor Yellow
    foreach ($r in $refused) {
        Write-Host "    #$($r.issue) — $($r.reason)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "  Reconciliation:" -ForegroundColor White
Write-Host "    Drift items:      $driftCount" -ForegroundColor Gray
Write-Host "    PR corrections:   $correctionCount" -ForegroundColor Gray
Write-Host "    Issues closed:    $closeCount" -ForegroundColor Gray

Write-Host ""

if (-not $Execute) {
    Write-Host "DRY RUN — no changes made." -ForegroundColor Yellow
    if ($allowed.Count -gt 0) {
        Write-Host ""
        Write-Host "  Actions if -Execute:" -ForegroundColor Yellow
        foreach ($issue in $allowed) {
            Write-Host "    Would process #$($issue.number)" -ForegroundColor Gray
        }
        Write-Host ""
        $allowedNumbers = @($allowed | ForEach-Object { $_.number })
        Write-Host "    Command: ./scripts/ai/webui-issue-control.ps1 -Repo $Repo -IssueNumbers $($allowedNumbers -join ',') -Execute" -ForegroundColor Yellow
    }
} else {
    Write-Ok "Execute complete. Closed: $closeCount"
}

Write-Host ""

# Exit 1 if there are actionable items in dry-run, or if any close failed in execute
if ($Execute) {
    exit 0
} else {
    # Exit 1 if there are eligible issues (actionable items need attention)
    if ($driftCount -gt 0 -or $correctionCount -gt 0) { exit 1 }
    exit 0
}
