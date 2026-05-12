#Requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$passed = 0
$failed = 0

function Assert {
    param([bool]$Condition, [string]$Name)
    if ($Condition) { $script:passed++; Write-Host "  PASS  $Name" -ForegroundColor Green }
    else { $script:failed++; Write-Host "  FAIL  $Name" -ForegroundColor Red }
}

function Assert-Contains {
    param([string]$Haystack, [string]$Needle, [string]$Name)
    Assert -Condition ($Haystack -match [regex]::Escape($Needle)) -Name $Name
}

function Assert-NotContains {
    param([string]$Haystack, [string]$Needle, [string]$Name)
    Assert -Condition (-not ($Haystack -match [regex]::Escape($Needle))) -Name $Name
}

function Strip-Ansi {
    param([string]$Text)
    return ($Text -replace '\x1b\[[0-9;]*m', '')
}

# ── Setup ────────────────────────────────────────────────────────────────────

$scriptDir = $PSScriptRoot
$script = Join-Path $scriptDir "seed-and-plan-self-cycle.ps1"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "seed-plan-test-$(Get-Random)"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    # Build an isolated state dir with just enough facts that propose-self-cycle-issues.js
    # produces deterministic candidates without needing live ai-state.
    $stateDir = Join-Path $tempDir "ai-state"
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

    # Stale local-resource → "Refresh resource sampler" candidate (low risk, ready)
    @"
{
  "global": { "capturedAt": "2020-01-01T00:00:00.000Z" },
  "cpu": { "cores": null },
  "memory": { "totalGB": null }
}
"@ | Set-Content (Join-Path $stateDir "local-resource.json") -Encoding UTF8

    # Provider pool with available < globalMaxWorkers → "Expand provider pool capacity" (medium risk, ready)
    @"
{
  "global": { "globalMaxWorkers": 30, "availableProviders": 5 }
}
"@ | Set-Content (Join-Path $stateDir "provider-pool.json") -Encoding UTF8

    # Empty task board → "Seed task board" candidate
    # (omit to trigger the "task-board.json does not exist" branch)

    $previewFile = Join-Path $tempDir "proposed.preview.json"
    $auditFile   = Join-Path $stateDir "issue-seeding-events.ndjson"

    # ── Test 1: Help ──────────────────────────────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Help flag ---"
    $out = & pwsh -NoProfile -File $script -Help 2>&1
    $exit = $LASTEXITCODE
    $text = Strip-Ansi ($out -join "`n")
    Assert -Condition ($exit -eq 0) -Name "Help exits 0"
    Assert-Contains $text "seed-and-plan-self-cycle.ps1" "Help shows script name"
    Assert-Contains $text "SAFETY CONTRACT" "Help shows safety contract"
    Assert-Contains $text "NEVER launched" "Help notes workers are never launched"
    Assert-Contains $text "Dry-run by default" "Help notes dry-run default"

    # ── Test 2: Missing repo ──────────────────────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Missing -Repo fails ---"
    $env:GH_REPO = $null
    $out = & pwsh -NoProfile -File $script 2>&1
    $exit = $LASTEXITCODE
    $text = Strip-Ansi ($out -join "`n")
    Assert -Condition ($exit -ne 0) -Name "Missing repo exits non-zero"
    Assert-Contains $text "Repo is required" "Error mentions repo requirement"

    # ── Test 3: Default preview run — propose + write-preview + audit ────────

    Write-Host ""
    Write-Host "--- Test: Default preview run writes preview + audit ---"
    # Use a bogus repo. propose tolerates gh failure (returns []), and the
    # autopilot run-self-cycle step will fail on gh as well but our script
    # still completes (exit 0) because we only `exit 2` on invocation failure,
    # not on gh's non-zero exit reported via stderr.
    $out = & pwsh -NoProfile -File $script `
        -Repo "test-org/seed-plan-fixture" `
        -IssueLabel "agent:codex-action-needed" `
        -MaxTasks 3 `
        -StateDir $stateDir `
        -PreviewFile $previewFile 2>&1
    $exit = $LASTEXITCODE
    $text = Strip-Ansi ($out -join "`n")

    Assert -Condition ($exit -eq 0) -Name "Preview run exits 0"
    Assert-Contains $text "PREVIEW+PLAN" "Output shows PREVIEW+PLAN mode"
    Assert-Contains $text "propose-self-cycle-issues" "Step 1 invoked propose"
    Assert-Contains $text "Proposal saved to" "Preview file location reported"
    Assert-Contains $text "write-planned-issues" "Step 2 invoked write-planned-issues"
    Assert-Contains $text "DRY RUN" "Step 2 ran in dry-run mode"
    Assert-Contains $text "ExecuteIssueSeeding not set" "Reports no issues seeded"
    Assert-Contains $text "Workers will NOT be launched" "Step 3 gate message present"
    Assert-Contains $text "Workers launched:    NO" "Summary confirms no workers launched"

    Assert -Condition (Test-Path $previewFile) -Name "Preview JSON file written"

    if (Test-Path $previewFile) {
        $previewRaw = Get-Content -Raw $previewFile
        $preview = $null
        try { $preview = $previewRaw | ConvertFrom-Json } catch {}
        Assert -Condition ($null -ne $preview) -Name "Preview JSON parses"
        Assert -Condition ($preview.planVersion -ge 1) -Name "Preview has planVersion >= 1"
        Assert -Condition ($null -ne $preview.candidates) -Name "Preview has candidates array"
    }

    Assert -Condition (Test-Path $auditFile) -Name "Audit ndjson file written"

    if (Test-Path $auditFile) {
        $auditLines = Get-Content $auditFile | Where-Object { $_.Trim() -ne "" }
        Assert -Condition ($auditLines.Count -gt 0) -Name "Audit has at least one event"

        $entries = @($auditLines | ForEach-Object {
            try { $_ | ConvertFrom-Json } catch { $null }
        } | Where-Object { $_ -ne $null })

        $actions = @($entries | ForEach-Object { $_.action })
        Assert -Condition ($actions -contains "run-start") -Name "Audit contains run-start event"
        Assert -Condition ($actions -contains "propose-complete") -Name "Audit contains propose-complete event"
        Assert -Condition ($actions -contains "autopilot-complete") -Name "Audit contains autopilot-complete event"

        $startEntry = $entries | Where-Object { $_.action -eq "run-start" } | Select-Object -First 1
        Assert -Condition ($startEntry.source -eq "seed-and-plan-self-cycle") -Name "Audit entries are tagged with script source"
        Assert -Condition ($startEntry.executeIssueSeeding -eq $false) -Name "run-start records executeIssueSeeding=false"
    }

    # ── Test 4: ExecuteIssueSeeding flag is recorded in audit ────────────────

    Write-Host ""
    Write-Host "--- Test: ExecuteIssueSeeding flag flows to audit ---"
    # Clear audit for clean check; reuse same state dir so propose still works.
    Remove-Item $auditFile -ErrorAction SilentlyContinue
    # Note: this will actually attempt `gh issue create` and fail because the
    # repo does not exist. That's fine — the test only validates that the
    # flag is recorded and that the script still exits cleanly.
    $out = & pwsh -NoProfile -File $script `
        -Repo "test-org/seed-plan-fixture" `
        -IssueLabel "agent:codex-action-needed" `
        -MaxTasks 1 `
        -StateDir $stateDir `
        -PreviewFile $previewFile `
        -ExecuteIssueSeeding 2>&1
    $exit = $LASTEXITCODE
    $text = Strip-Ansi ($out -join "`n")

    Assert -Condition ($exit -eq 0) -Name "ExecuteIssueSeeding run exits 0"
    Assert-Contains $text "SEED+PLAN" "Output shows SEED+PLAN mode"
    Assert-NotContains $text "would launch workers" "No suggestion of worker launch"

    if (Test-Path $auditFile) {
        $entries = @(Get-Content $auditFile | Where-Object { $_.Trim() -ne "" } | ForEach-Object {
            try { $_ | ConvertFrom-Json } catch { $null }
        } | Where-Object { $_ -ne $null })

        $startEntry = $entries | Where-Object { $_.action -eq "run-start" } | Select-Object -First 1
        Assert -Condition ($startEntry.executeIssueSeeding -eq $true) -Name "run-start records executeIssueSeeding=true"
        Assert -Condition ($startEntry.mode -eq "seed+plan") -Name "run-start mode is seed+plan"

        # Either seed-complete or seed-failed must appear (we attempted creation).
        $seedActions = @($entries | Where-Object {
            $_.action -in @("seed-complete", "seed-failed", "seed-skipped")
        })
        Assert -Condition ($seedActions.Count -gt 0) -Name "Audit records a seed outcome event"
    }

    # ── Test 5: Safety — script never references worker Execute ──────────────

    Write-Host ""
    Write-Host "--- Test: Source-level safety review ---"
    $src = Get-Content $script -Raw
    # The script must NOT pass -Execute to run-self-cycle.ps1 or batch-launch.ps1.
    Assert-NotContains $src "run-self-cycle.ps1 -Execute" "Does not invoke run-self-cycle with -Execute"
    Assert-NotContains $src "batch-launch.ps1" "Does not invoke batch-launch directly"
    Assert-Contains $src "-AutopilotPlan" "Uses AutopilotPlan mode"
    Assert-Contains $src "Workers will NOT be launched" "Has launch safety message"

} finally {
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Summary ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "$passed passed, $failed failed"
exit $(if ($failed -gt 0) { 1 } else { 0 })
