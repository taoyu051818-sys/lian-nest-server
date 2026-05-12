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
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "auto-close-test-$(Get-Random)"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    # ── Fixture 1: Eligible issues with merged PR ────────────────────────────

    @"
{
  "issues": [
    {
      "number": 100,
      "title": "Add feature X",
      "state": "OPEN",
      "labels": [{"name": "agent:done"}],
      "body": "Implement feature X.",
      "createdAt": "2026-05-10T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z"
    }
  ],
  "mergedPRs": [
    {
      "number": 101,
      "title": "feat: add feature X (#100)",
      "state": "MERGED",
      "body": "Closes #100",
      "mergedAt": "2026-05-11T11:00:00Z"
    }
  ],
  "openPRs": []
}
"@ | Set-Content (Join-Path $tempDir "eligible.json") -Encoding UTF8

    # ── Fixture 2: Umbrella issue (should be refused) ────────────────────────

    @"
{
  "issues": [
    {
      "number": 200,
      "title": "Umbrella: refactor all modules",
      "state": "OPEN",
      "labels": [{"name": "agent:done"}],
      "body": "This is an umbrella issue.",
      "createdAt": "2026-05-10T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z"
    }
  ],
  "mergedPRs": [],
  "openPRs": []
}
"@ | Set-Content (Join-Path $tempDir "umbrella.json") -Encoding UTF8

    # ── Fixture 3: Human-required issue (should be refused) ──────────────────

    @"
{
  "issues": [
    {
      "number": 300,
      "title": "Add new feature",
      "state": "OPEN",
      "labels": [{"name": "agent:done"}, {"name": "human-required"}],
      "body": "This needs human review.",
      "createdAt": "2026-05-10T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z"
    }
  ],
  "mergedPRs": [],
  "openPRs": []
}
"@ | Set-Content (Join-Path $tempDir "human-required.json") -Encoding UTF8

    # ── Fixture 4: Issue with open PR (should be skipped) ────────────────────

    @"
{
  "issues": [
    {
      "number": 400,
      "title": "Add feature Y",
      "state": "OPEN",
      "labels": [{"name": "agent:done"}],
      "body": "Implement feature Y.",
      "createdAt": "2026-05-10T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z"
    }
  ],
  "mergedPRs": [],
  "openPRs": [
    {
      "number": 401,
      "title": "feat: add feature Y (#400)",
      "state": "OPEN",
      "body": "Closes #400"
    }
  ]
}
"@ | Set-Content (Join-Path $tempDir "open-pr.json") -Encoding UTF8

    # ── Fixture 5: Mixed issues ──────────────────────────────────────────────

    @"
{
  "issues": [
    {
      "number": 500,
      "title": "Normal issue",
      "state": "OPEN",
      "labels": [{"name": "agent:done"}],
      "body": "Normal issue.",
      "createdAt": "2026-05-10T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z"
    },
    {
      "number": 501,
      "title": "Umbrella: big refactor",
      "state": "OPEN",
      "labels": [{"name": "agent:done"}],
      "body": "Umbrella issue.",
      "createdAt": "2026-05-10T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z"
    },
    {
      "number": 502,
      "title": "Human review needed",
      "state": "OPEN",
      "labels": [{"name": "agent:done"}, {"name": "human-required"}],
      "body": "Human-required issue.",
      "createdAt": "2026-05-10T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z"
    }
  ],
  "mergedPRs": [
    {
      "number": 510,
      "title": "feat: normal issue (#500)",
      "state": "MERGED",
      "body": "Closes #500",
      "mergedAt": "2026-05-11T11:00:00Z"
    }
  ],
  "openPRs": []
}
"@ | Set-Content (Join-Path $tempDir "mixed.json") -Encoding UTF8

    # ── Fixture 6: Empty issues ──────────────────────────────────────────────

    @"
{
  "issues": [],
  "mergedPRs": [],
  "openPRs": []
}
"@ | Set-Content (Join-Path $tempDir "empty.json") -Encoding UTF8

    # ── Test 1: Help flag ────────────────────────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Help flag ---"
    $helpOutput = & pwsh -NoProfile -File "$scriptDir/auto-close-done-issues.ps1" -Help 2>&1
    $helpExit = $LASTEXITCODE
    $helpText = Strip-Ansi ($helpOutput -join "`n")
    Assert -Condition ($helpExit -eq 0) -Name "Help exits 0"
    Assert-Contains $helpText "AUTO-CLOSE DONE ISSUES" "Help contains script name"
    Assert-Contains $helpText "DRY-RUN CONTRACT" "Help contains dry-run contract"

    # ── Test 2: Mutual exclusion ─────────────────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Mutual exclusion ---"
    $mutexOutput = & pwsh -NoProfile -File "$scriptDir/auto-close-done-issues.ps1" -Repo "test/repo" -DryRun -Execute 2>&1
    $mutexExit = $LASTEXITCODE
    $mutexText = Strip-Ansi ($mutexOutput -join "`n")
    Assert -Condition ($mutexExit -ne 0) -Name "DryRun+Execute fails"
    Assert-Contains $mutexText "cannot be used together" "Error mentions mutual exclusion"

    # ── Test 3: Execute+FixturePath blocked ──────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Execute+FixturePath blocked ---"
    $execFixOutput = & pwsh -NoProfile -File "$scriptDir/auto-close-done-issues.ps1" -FixturePath (Join-Path $tempDir "eligible.json") -Execute 2>&1
    $execFixExit = $LASTEXITCODE
    $execFixText = Strip-Ansi ($execFixOutput -join "`n")
    Assert -Condition ($execFixExit -ne 0) -Name "Execute+FixturePath fails"
    Assert-Contains $execFixText "cannot be used with" "Error mentions conflict"

    # ── Test 4: Repo required without FixturePath ────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Repo required without FixturePath ---"
    $noRepoOutput = & pwsh -NoProfile -File "$scriptDir/auto-close-done-issues.ps1" 2>&1
    $noRepoExit = $LASTEXITCODE
    $noRepoText = Strip-Ansi ($noRepoOutput -join "`n")
    Assert -Condition ($noRepoExit -ne 0) -Name "Missing repo fails"
    Assert-Contains $noRepoText "Repo is required" "Error mentions repo requirement"

    # ── Test 5: Eligible issue with merged PR ────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Eligible issue with merged PR ---"
    $eligibleOutput = & pwsh -NoProfile -File "$scriptDir/auto-close-done-issues.ps1" -FixturePath (Join-Path $tempDir "eligible.json") -SkipHealthCheck 2>&1
    $eligibleExit = $LASTEXITCODE
    $eligibleText = Strip-Ansi ($eligibleOutput -join "`n")
    Assert-Contains $eligibleText "eligible" "Eligible issue reported"
    Assert-NotContains $eligibleText "REFUSED #" "No issues refused"
    Assert-Contains $eligibleText "DRY RUN" "Dry run mode"

    # ── Test 6: Umbrella issue refused ───────────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Umbrella issue refused ---"
    $umbrellaOutput = & pwsh -NoProfile -File "$scriptDir/auto-close-done-issues.ps1" -FixturePath (Join-Path $tempDir "umbrella.json") -SkipHealthCheck 2>&1
    $umbrellaExit = $LASTEXITCODE
    $umbrellaText = Strip-Ansi ($umbrellaOutput -join "`n")
    Assert-Contains $umbrellaText "REFUSED" "Umbrella issue refused"
    Assert-Contains $umbrellaText "umbrella" "Refusal mentions umbrella pattern"

    # ── Test 7: Human-required issue refused ─────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Human-required issue refused ---"
    $humanOutput = & pwsh -NoProfile -File "$scriptDir/auto-close-done-issues.ps1" -FixturePath (Join-Path $tempDir "human-required.json") -SkipHealthCheck 2>&1
    $humanExit = $LASTEXITCODE
    $humanText = Strip-Ansi ($humanOutput -join "`n")
    Assert-Contains $humanText "REFUSED" "Human-required issue refused"
    Assert-Contains $humanText "human-required" "Refusal mentions human-required label"

    # ── Test 8: Issue with open PR skipped ────────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Issue with open PR skipped ---"
    $openPrOutput = & pwsh -NoProfile -File "$scriptDir/auto-close-done-issues.ps1" -FixturePath (Join-Path $tempDir "open-pr.json") -SkipHealthCheck 2>&1
    $openPrExit = $LASTEXITCODE
    $openPrText = Strip-Ansi ($openPrOutput -join "`n")
    Assert-Contains $openPrText "has open PR" "Open PR issue skipped"
    Assert-NotContains $openPrText "would-close" "Open PR issue not eligible for close"

    # ── Test 9: Mixed issues ─────────────────────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Mixed issues ---"
    $mixedOutput = & pwsh -NoProfile -File "$scriptDir/auto-close-done-issues.ps1" -FixturePath (Join-Path $tempDir "mixed.json") -SkipHealthCheck 2>&1
    $mixedExit = $LASTEXITCODE
    $mixedText = Strip-Ansi ($mixedOutput -join "`n")
    Assert-Contains $mixedText "REFUSED" "Some issues refused"
    Assert-Contains $mixedText "#500" "Normal issue present"
    Assert-Contains $mixedText "#501" "Umbrella issue listed in refused"
    Assert-Contains $mixedText "#502" "Human-required issue listed in refused"

    # ── Test 10: Empty issues ────────────────────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Empty issues ---"
    $emptyOutput = & pwsh -NoProfile -File "$scriptDir/auto-close-done-issues.ps1" -FixturePath (Join-Path $tempDir "empty.json") -SkipHealthCheck 2>&1
    $emptyExit = $LASTEXITCODE
    $emptyText = Strip-Ansi ($emptyOutput -join "`n")
    Assert -Condition ($emptyExit -eq 0) -Name "Empty issues exits 0"
    Assert-Contains $emptyText "No agent:done issues found" "Output mentions no issues"

    # ── Test 11: JSON output format ──────────────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: JSON output format ---"
    $jsonOutput = & pwsh -NoProfile -File "$scriptDir/auto-close-done-issues.ps1" -FixturePath (Join-Path $tempDir "eligible.json") -SkipHealthCheck -Json 2>&1
    $jsonExit = $LASTEXITCODE
    $jsonText = ($jsonOutput -join "`n")
    $parsed = $null
    try {
        $parsed = $jsonText | ConvertFrom-Json
        Assert -Condition $true -Name "JSON output is valid"
    } catch {
        Assert -Condition $false -Name "JSON output is valid"
    }
    if ($parsed) {
        Assert -Condition ($parsed.dryRun -eq $true) -Name "JSON dryRun is true"
        Assert -Condition ($null -ne $parsed.results) -Name "JSON has results array"
        Assert -Condition ($null -ne $parsed.refusedIssues) -Name "JSON has refusedIssues array"
        Assert -Condition ($null -ne $parsed.hasOpenPr) -Name "JSON has hasOpenPr count"
        Assert -Condition ($null -ne $parsed.refused) -Name "JSON has refused count"
    }

    # ── Test 12: JSON output with refused issues ─────────────────────────────

    Write-Host ""
    Write-Host "--- Test: JSON output with refused issues ---"
    $jsonRefusedOutput = & pwsh -NoProfile -File "$scriptDir/auto-close-done-issues.ps1" -FixturePath (Join-Path $tempDir "mixed.json") -SkipHealthCheck -Json 2>&1
    $jsonRefusedText = ($jsonRefusedOutput -join "`n")
    $parsedRefused = $null
    try {
        $parsedRefused = $jsonRefusedText | ConvertFrom-Json
        Assert -Condition $true -Name "JSON with refused is valid"
    } catch {
        Assert -Condition $false -Name "JSON with refused is valid"
    }
    if ($parsedRefused) {
        Assert -Condition ($parsedRefused.refused -gt 0) -Name "JSON has refused count > 0"
        Assert -Condition ($parsedRefused.refusedIssues.Count -gt 0) -Name "JSON has refusedIssues entries"
        Assert -Condition ($parsedRefused.results.Count -gt 0) -Name "JSON has results entries"
    }

} finally {
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Summary ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "$passed passed, $failed failed"
exit $(if ($failed -gt 0) { 1 } else { 0 })
