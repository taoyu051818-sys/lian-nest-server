<#
.SYNOPSIS
    Suggests migration matrix row updates from PR metadata without mutating by default.
.DESCRIPTION
    Reads legacy-shutdown-matrix.md, parses endpoint rows, and suggests status transitions.
    Valid progression (linear, one-step): CONTRACTED -> IMPLEMENTED -> PARITY_TESTED -> LEGACY_DISABLED.
    Dry-run by default. -Apply prints replacement rows. -Write modifies the file.
.EXAMPLE
    ./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED
    ./scripts/ai/update-migration-matrix.ps1 -PrMetaPath ./pr-meta.json
    ./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED -Apply
    ./scripts/ai/update-migration-matrix.ps1 -Slice A3 -TargetStatus IMPLEMENTED -Write
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$MatrixPath = "docs/migration/legacy-shutdown-matrix.md",

    [Parameter(Mandatory = $false)]
    [string]$Slice,

    [Parameter(Mandatory = $false)]
    [ValidateSet("CONTRACTED", "IMPLEMENTED", "PARITY_TESTED", "LEGACY_DISABLED")]
    [string]$TargetStatus,

    [Parameter(Mandatory = $false)]
    [string]$PrMetaPath,

    [Parameter(Mandatory = $false)]
    [string]$ShutdownBlocker,

    [Parameter(Mandatory = $false)]
    [switch]$Apply,

    [Parameter(Mandatory = $false)]
    [switch]$Write
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- Constants ---------------------------------------------------------------

$VALID_STATUSES = @("NOT_STARTED", "CONTRACTED", "IMPLEMENTED", "PARITY_TESTED", "LEGACY_DISABLED")
$STATUS_INDEX = @{}
for ($i = 0; $i -lt $VALID_STATUSES.Count; $i++) { $STATUS_INDEX[$VALID_STATUSES[$i]] = $i }

$MARKER_BEGIN = "<!-- ai-migration-matrix-updater:begin -->"
$MARKER_END   = "<!-- ai-migration-matrix-updater:end -->"

# --- Helpers -----------------------------------------------------------------

function Write-Step($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   WARN: $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "   FAIL: $msg" -ForegroundColor Red; exit 1 }

function Test-StatusTransition {
    param([string]$From, [string]$To)
    if (-not $STATUS_INDEX.ContainsKey($From) -or -not $STATUS_INDEX.ContainsKey($To)) { return $false }
    return ($STATUS_INDEX[$To] -eq $STATUS_INDEX[$From] + 1)
}

function Get-StatusIndex([string]$Status) {
    if ($STATUS_INDEX.ContainsKey($Status)) { return $STATUS_INDEX[$Status] }
    return -1
}

# --- Matrix parser -----------------------------------------------------------

function Import-MatrixRows {
    param([string]$Path)
    if (-not (Test-Path $Path)) { Write-Fail "Matrix file not found: $Path" }

    $rows = @()
    $family = ""
    foreach ($line in (Get-Content $Path)) {
        if ($line -match "^###\s+(\w+)\s") { $family = $Matches[1]; continue }
        if ($line -match "^\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*(/[^\s|]+)\s*\|\s*(\S+)\s*\|\s*`?(\w+)`?\s*\|\s*(.*?)\s*\|") {
            $rows += [PSCustomObject]@{
                Family = $family; Method = $Matches[1]; Path = $Matches[2]
                Slice = $Matches[3]; Status = $Matches[4]; ShutdownBlocker = $Matches[5].Trim()
            }
        }
    }
    return $rows
}

# --- PR metadata loader ------------------------------------------------------

function Import-PrMeta {
    param([string]$Path)
    if (-not (Test-Path $Path)) { Write-Fail "PR metadata file not found: $Path" }
    $data = Get-Content $Path -Raw | ConvertFrom-Json
    if (-not $data.slice -or -not $data.targetStatus) {
        Write-Fail "PR metadata must include 'slice' and 'targetStatus' fields."
    }
    return @{ Slice = $data.slice; TargetStatus = $data.targetStatus; ShutdownBlocker = $data.shutdownBlocker }
}

# --- Suggestion engine -------------------------------------------------------

function Find-SuggestedUpdates {
    param($Rows, [string]$TargetSlice, [string]$NewStatus, [string]$NewBlocker)
    $suggestions = @()
    foreach ($row in $Rows) {
        if ($row.Slice -ne $TargetSlice) { continue }
        if ($row.Status -eq $NewStatus) { continue }
        if (-not (Test-StatusTransition -From $row.Status -To $NewStatus)) {
            $suggestions += [PSCustomObject]@{
                Family = $row.Family; Method = $row.Method; Path = $row.Path; Slice = $row.Slice
                From = $row.Status; To = $NewStatus; Valid = $false
                Reason = "Invalid: $($row.Status) -> $NewStatus (linear, one-step only)"
                Blocker = $row.ShutdownBlocker
            }
            continue
        }
        $blocker = if ($NewBlocker) { $NewBlocker } else { $row.ShutdownBlocker }
        if ((Get-StatusIndex $NewStatus) -ge (Get-StatusIndex "PARITY_TESTED")) { $blocker = "None" }
        $suggestions += [PSCustomObject]@{
            Family = $row.Family; Method = $row.Method; Path = $row.Path; Slice = $row.Slice
            From = $row.Status; To = $NewStatus; Valid = $true
            Reason = "Advance $($row.Status) -> $NewStatus"; Blocker = $blocker
        }
    }
    return $suggestions
}

# --- Output ------------------------------------------------------------------

function Write-SuggestionReport {
    param($Suggestions)
    if ($Suggestions.Count -eq 0) { Write-Output "No matching endpoints found."; return }
    $valid = @($Suggestions | Where-Object { $_.Valid })
    $invalid = @($Suggestions | Where-Object { -not $_.Valid })
    Write-Output "=== MIGRATION MATRIX UPDATE SUGGESTIONS ==="
    Write-Output "Endpoints: $($Suggestions.Count) | Valid: $($valid.Count) | Invalid: $($invalid.Count)"
    Write-Output ""
    foreach ($s in $valid) {
        Write-Output "  [OK]  $($s.Method) $($s.Path): $($s.From) -> $($s.To) (Blocker: $($s.Blocker))"
    }
    foreach ($s in $invalid) {
        Write-Output "  [ERR] $($s.Method) $($s.Path): $($s.Reason)"
    }
    Write-Output ""
    Write-Output "=== END SUGGESTIONS ==="
}

function Build-MarkdownReport {
    param($Suggestions)
    $lines = @($MARKER_BEGIN, "", "### Migration Matrix Updater Report", "")
    $valid = @($Suggestions | Where-Object { $_.Valid })
    if ($valid.Count -gt 0) {
        $lines += "| Method | Path | From | To | Blocker |"
        $lines += "|--------|------|------|----|---------|"
        foreach ($s in $valid) {
            $lines += "| $($s.Method) | $($s.Path) | ``$($s.From)`` | ``$($s.To)`` | $($s.Blocker) |"
        }
    } else { $lines += "No valid transitions to suggest." }
    $lines += ""; $lines += $MARKER_END
    return $lines -join "`n"
}

# --- Main --------------------------------------------------------------------

Write-Output "Migration Matrix Updater (dry-run by default)"
Write-Output "==============================================="
Write-Output ""

# Resolve inputs: CLI args take precedence, then PR metadata
$slice = $Slice; $targetStatus = $TargetStatus; $shutdownBlocker = $ShutdownBlocker
if ($PrMetaPath) {
    Write-Step "Loading PR metadata: $PrMetaPath"
    $meta = Import-PrMeta -Path $PrMetaPath
    if (-not $slice) { $slice = $meta.Slice }
    if (-not $targetStatus) { $targetStatus = $meta.TargetStatus }
    if (-not $shutdownBlocker -and $meta.ShutdownBlocker) { $shutdownBlocker = $meta.ShutdownBlocker }
}
if (-not $slice -or -not $targetStatus) {
    Write-Fail "Both -Slice and -TargetStatus required (or provide -PrMetaPath)."
}

Write-Step "Matrix: $MatrixPath | Slice: $slice -> $targetStatus"
Write-Output ""

# Parse matrix
Write-Step "Parsing migration matrix..."
$rows = Import-MatrixRows -Path $MatrixPath
Write-Ok "Found $($rows.Count) endpoint(s)."

$sliceRows = @($rows | Where-Object { $_.Slice -eq $slice })
if ($sliceRows.Count -eq 0) {
    Write-Warn "No endpoints for slice '$slice'. Available: $(($rows | Where-Object { $_.Slice -ne '---' } | Select-Object -Unique Slice | ForEach-Object { $_.Slice }) -join ', ')"
    exit 0
}
Write-Ok "Matched $($sliceRows.Count) endpoint(s) for slice $slice."
Write-Output ""

# Generate suggestions
$suggestions = Find-SuggestedUpdates -Rows $rows -TargetSlice $slice -NewStatus $targetStatus -NewBlocker $shutdownBlocker
Write-SuggestionReport -Suggestions $suggestions
$null = Build-MarkdownReport -Suggestions $suggestions

# Apply mode: print replacement rows for manual review
if ($Apply) {
    Write-Output ""
    Write-Step "APPLY MODE (suggestions only, no file mutation)"
    foreach ($s in @($suggestions | Where-Object { $_.Valid })) {
        Write-Output "  OLD: | $($s.Method) | $($s.Path) | $($s.Slice) | ``$($s.From)`` | $($s.Blocker) |"
        Write-Output "  NEW: | $($s.Method) | $($s.Path) | $($s.Slice) | ``$($s.To)`` | $($s.Blocker) |"
        Write-Output ""
    }
    Write-Output "No files were modified."
}

# Write mode: update the matrix file
if ($Write) {
    Write-Output ""
    Write-Step "WRITE MODE (modifying matrix file)"
    $valid = @($suggestions | Where-Object { $_.Valid })
    if ($valid.Count -eq 0) {
        Write-Output "Nothing to write."
    } else {
        $content = Get-Content $MatrixPath -Raw
        foreach ($s in $valid) {
            $escapedPath = [regex]::Escape($s.Path)
            $pattern = "(\|\s*$([regex]::Escape($s.Method))\s*\|\s*$escapedPath\s*\|\s*$([regex]::Escape($s.Slice))\s*\|\s*)`?[^`|]+`?(\s*\|\s*)(.*?)(\s*\|)"
            $content = [regex]::Replace($content, $pattern, "`${1}`$($s.To)`$2$($s.Blocker)`${4}")
        }
        Set-Content -Path $MatrixPath -Value $content -NoNewline
        Write-Ok "Updated $($valid.Count) endpoint(s) in $MatrixPath"
    }
}

exit 0
