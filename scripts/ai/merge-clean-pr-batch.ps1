<#
.SYNOPSIS
    Controlled auto-merge for allowlisted CLEAN, non-draft PRs.

.DESCRIPTION
    Merges an explicit set of PRs after verifying each is non-draft, CLEAN
    (all status checks pass), and mergeable. Uses squash merge with branch
    deletion. Stops on the first failure.

    The script REQUIRES an explicit PR allowlist — either inline numbers
    or a file path. It will never discover or merge unspecified PRs.

.PARAMETER PRs
    One or more PR numbers to merge. Cannot be combined with -AllowlistFile.

.PARAMETER AllowlistFile
    Path to a text file containing one PR number per line (blank lines
    and lines starting with # are ignored). Cannot be combined with -PRs.

.PARAMETER Repo
    Target repository in OWNER/NAME format. Falls back to GH_REPO env var.

.PARAMETER DryRun
    Validate PRs and print the merge plan without performing merges.
    This is the DEFAULT mode. Pass -Execute to perform real merges.

.PARAMETER Execute
    Actually merge the PRs. Without this flag, the script only prints
    what it would do (dry-run).

.PARAMETER RunHealthGate
    After a successful batch, run scripts/post-merge-health-gate.js.

.EXAMPLE
    # Dry-run with inline PR numbers
    .\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42,45 -Repo owner/name

.EXAMPLE
    # Execute merges from an allowlist file
    .\scripts\ai\merge-clean-pr-batch.ps1 -AllowlistFile .\pr-allowlist.txt -Repo owner/name -Execute

.EXAMPLE
    # Execute with post-merge health gate
    .\scripts\ai\merge-clean-pr-batch.ps1 -PRs 42 -Repo owner/name -Execute -RunHealthGate
#>

[CmdletBinding(DefaultParameterSetName = 'InlinePRs')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'InlinePRs', Position = 0)]
    [int[]]$PRs,

    [Parameter(Mandatory = $true, ParameterSetName = 'File')]
    [string]$AllowlistFile,

    [string]$Repo,

    [switch]$DryRun,

    [switch]$Execute,

    [switch]$RunHealthGate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Banner {
    param([string]$Text)
    $line = '=' * 72
    Write-Host ""
    Write-Host $line
    Write-Host "  $Text"
    Write-Host $line
    Write-Host ""
}

function Invoke-Gh {
    param(
        [string]$Args,
        [switch]$AllowFailure
    )
    try {
        $result = & gh @($Args.Split(' ')) 2>&1 | Out-String
        return $result.Trim()
    }
    catch {
        if ($AllowFailure) { return $null }
        throw
    }
}

function Get-PRInfo {
    param([int]$PRNumber, [string]$Repository)
    $json = Invoke-Gh "pr view $PRNumber --repo $Repository --json number,title,isDraft,mergeable,state,statusCheckRollup,headRefName"
    return $json | ConvertFrom-Json
}

# ---------------------------------------------------------------------------
# Allowlist resolution
# ---------------------------------------------------------------------------

function Resolve-Allowlist {
    if ($PSCmdlet.ParameterSetName -eq 'File') {
        if (-not (Test-Path $AllowlistFile)) {
            Write-Error "Allowlist file not found: $AllowlistFile"
            exit 1
        }
        $lines = Get-Content $AllowlistFile | ForEach-Object { $_.Trim() }
        $numbers = @()
        foreach ($line in $lines) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            if ($line.StartsWith('#')) { continue }
            $parsed = 0
            if ([int]::TryParse($line, [ref]$parsed)) {
                $numbers += $parsed
            }
            else {
                Write-Error "Invalid PR number in allowlist: '$line'"
                exit 1
            }
        }
        return $numbers
    }
    return $PRs
}

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

$BLOCKER_CHECK_STATES = @('FAILURE', 'CANCELLED', 'TIMED_OUT')

function Test-PREligible {
    param($PRInfo)

    $reasons = @()

    if ($PRInfo.isDraft) {
        $reasons += 'draft'
    }

    if ($PRInfo.state -ne 'OPEN') {
        $reasons += "state=$($PRInfo.state)"
    }

    if ($PRInfo.mergeable -ne 'MERGEABLE') {
        $reasons += "mergeable=$($PRInfo.mergeable)"
    }

    if ($PRInfo.statusCheckRollup) {
        foreach ($check in $PRInfo.statusCheckRollup) {
            if ($check.state -in $BLOCKER_CHECK_STATES) {
                $name = if ($check.name) { $check.name } else { $check.context }
                $reasons += "check-failed: $name ($($check.state))"
                break
            }
        }
    }

    return $reasons
}

# ---------------------------------------------------------------------------
# Merge execution
# ---------------------------------------------------------------------------

function Invoke-PRMerge {
    param([int]$PRNumber, [string]$Repository)

    Invoke-Gh "pr merge $PRNumber --repo $Repository --squash --delete-branch"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

function Main {
    # Resolve repository
    if (-not $Repo) {
        $Repo = $env:GH_REPO
    }
    if (-not $Repo) {
        Write-Error "Error: -Repo is required (or set GH_REPO env var)."
        exit 1
    }

    # Resolve mode
    $isExecute = $Execute.IsPresent
    $modeLabel = if ($isExecute) { 'EXECUTE' } else { 'DRY-RUN' }

    # Resolve allowlist
    $prNumbers = Resolve-Allowlist
    if ($prNumbers.Count -eq 0) {
        Write-Error "Error: No PR numbers provided. Specify -PRs or -AllowlistFile."
        exit 1
    }

    Write-Banner "Controlled Auto-Merge — $modeLabel"
    Write-Host "  Repository  : $Repo"
    Write-Host "  Mode        : $modeLabel"
    Write-Host "  PR count    : $($prNumbers.Count)"
    Write-Host "  Health gate : $($RunHealthGate.IsPresent)"
    if ($isExecute) {
        Write-Host "  WARNING     : -Execute mode will perform real merges!"
    }
    Write-Host ""

    # Validate and collect eligible PRs
    $eligible = @()
    $excluded = @()

    foreach ($prNum in $prNumbers) {
        Write-Host ">> Checking PR #$prNum ..."
        try {
            $info = Get-PRInfo -PRNumber $prNum -Repository $Repo
        }
        catch {
            Write-Host "   ERROR: Could not fetch PR #$prNum — $_"
            Write-Host ""
            Write-Host "Stopping — cannot verify PR #$prNum."
            exit 1
        }

        $reasons = Test-PREligible -PRInfo $info
        if ($reasons.Count -eq 0) {
            Write-Host "   ELIGIBLE: #$prNum — $($info.title)"
            Write-Host "            branch: $($info.headRefName)"
            $eligible += $info
        }
        else {
            Write-Host "   EXCLUDED: #$prNum — $($info.title)"
            Write-Host "            reasons: $($reasons -join ', ')"
            $excluded += @{ PR = $info; Reasons = $reasons }
        }
        Write-Host ""
    }

    # Report excluded
    if ($excluded.Count -gt 0) {
        Write-Banner "Excluded PRs ($($excluded.Count))"
        foreach ($item in $excluded) {
            $pr = $item.PR
            $reasons = $item.Reasons
            Write-Host "  #$($pr.number)  $($pr.title)"
            Write-Host "         EXCLUDED: $($reasons -join ', ')"
            Write-Host ""
        }
    }

    # Report eligible
    if ($eligible.Count -gt 0) {
        Write-Banner "Eligible PRs ($($eligible.Count))"
        foreach ($pr in $eligible) {
            $cmd = "gh pr merge $($pr.number) --repo $Repo --squash --delete-branch"
            Write-Host "  #$($pr.number)  $($pr.title)"
            Write-Host "         branch: $($pr.headRefName)"
            Write-Host "         $ $cmd"
            Write-Host ""
        }
    }
    else {
        Write-Banner "No Eligible PRs"
        Write-Host "All specified PRs are excluded from merging."
        exit 1
    }

    # If any excluded, stop — do not partially merge
    if ($excluded.Count -gt 0) {
        Write-Host "ABORT: $($excluded.Count) PR(s) excluded. Fix exclusions or remove from allowlist."
        Write-Host "No merges performed."
        exit 1
    }

    # Dry-run stops here
    if (-not $isExecute) {
        Write-Host "DRY-RUN — no merges performed. Use -Execute to merge."
        exit 0
    }

    # Execute merges
    Write-Banner "EXECUTING MERGES"
    Write-Host "Merging $($eligible.Count) PR(s) into $Repo ..."
    Write-Host ""

    $merged = @()
    foreach ($pr in $eligible) {
        Write-Host ">> Merging #$($pr.number) — $($pr.title)"
        $cmd = "gh pr merge $($pr.number) --repo $Repo --squash --delete-branch"
        Write-Host "   $ $cmd"

        try {
            $output = Invoke-PRMerge -PRNumber $pr.number -Repository $Repo
            Write-Host "   OK: $(if ($output) { $output } else { 'merged' })"
            $merged += $pr
        }
        catch {
            $errMsg = $_.Exception.Message
            Write-Host "   FAILED: $errMsg"
            Write-Host ""
            Write-Host "Stopping — merge batch aborted after failure on PR #$($pr.number)."
            Write-Host "Merged so far: $($merged.Count) of $($eligible.Count)"
            exit 1
        }
        Write-Host ""
    }

    Write-Host "All $($eligible.Count) PR(s) merged successfully."

    # Optional health gate
    if ($RunHealthGate.IsPresent) {
        Write-Host ""
        Write-Banner "Post-Merge Health Gate"
        $healthGatePath = Join-Path $PSScriptRoot '..' '..' 'scripts' 'post-merge-health-gate.js'
        if (Test-Path $healthGatePath) {
            Write-Host "Running post-merge health gate ..."
            & node $healthGatePath --quick
            $exitCode = $LASTEXITCODE
            if ($exitCode -ne 0) {
                Write-Host ""
                Write-Host "WARNING: Post-merge health gate FAILED (exit code $exitCode)."
                Write-Host "Do not launch the next wave until main is healthy."
                exit $exitCode
            }
            Write-Host "Health gate PASSED."
        }
        else {
            Write-Host "Health gate script not found at: $healthGatePath"
            Write-Host "Run manually: node scripts/post-merge-health-gate.js --quick"
        }
    }
}

Main
