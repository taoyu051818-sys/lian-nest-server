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
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "webui-issue-control-test-$(Get-Random)"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    # ── Fixture 1: Normal issues (allowed) ──────────────────────────────────

    @"
{
  "description": "Normal issues that should be allowed",
  "issues": [
    {
      "number": 655,
      "title": "Add preview-first issue close wrapper",
      "state": "OPEN",
      "labels": [{"name": "agent:running"}],
      "body": "Implement the WebUI control console wrapper.",
      "createdAt": "2026-05-11T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z",
      "linkedPRs": []
    },
    {
      "number": 656,
      "title": "Add state reconcile wrapper",
      "state": "OPEN",
      "labels": [{"name": "agent:done"}],
      "body": "Implement the state reconcile wrapper.",
      "createdAt": "2026-05-11T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z",
      "linkedPRs": []
    }
  ]
}
"@ | Set-Content (Join-Path $tempDir "normal-issues.json") -Encoding UTF8

    # ── Fixture 2: Umbrella issue (should be refused) ───────────────────────

    @"
{
  "description": "Umbrella issue that should be refused",
  "issues": [
    {
      "number": 700,
      "title": "Umbrella: refactor all modules",
      "state": "OPEN",
      "labels": [{"name": "agent:running"}],
      "body": "This is an umbrella issue.",
      "createdAt": "2026-05-11T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z",
      "linkedPRs": []
    }
  ]
}
"@ | Set-Content (Join-Path $tempDir "umbrella-issue.json") -Encoding UTF8

    # ── Fixture 3: Human-required issue (should be refused) ─────────────────

    @"
{
  "description": "Human-required issue that should be refused",
  "issues": [
    {
      "number": 701,
      "title": "Add new feature",
      "state": "OPEN",
      "labels": [{"name": "human-required"}, {"name": "agent:running"}],
      "body": "This needs human review.",
      "createdAt": "2026-05-11T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z",
      "linkedPRs": []
    }
  ]
}
"@ | Set-Content (Join-Path $tempDir "human-required-issue.json") -Encoding UTF8

    # ── Fixture 4: Mixed issues (some allowed, some refused) ────────────────

    @"
{
  "description": "Mixed issues — some allowed, some refused",
  "issues": [
    {
      "number": 655,
      "title": "Add preview-first issue close wrapper",
      "state": "OPEN",
      "labels": [{"name": "agent:running"}],
      "body": "Normal issue.",
      "createdAt": "2026-05-11T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z",
      "linkedPRs": []
    },
    {
      "number": 700,
      "title": "Umbrella: refactor all modules",
      "state": "OPEN",
      "labels": [{"name": "agent:running"}],
      "body": "Umbrella issue.",
      "createdAt": "2026-05-11T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z",
      "linkedPRs": []
    },
    {
      "number": 701,
      "title": "Add new feature",
      "state": "OPEN",
      "labels": [{"name": "human-required"}],
      "body": "Human-required issue.",
      "createdAt": "2026-05-11T10:00:00Z",
      "updatedAt": "2026-05-11T12:00:00Z",
      "linkedPRs": []
    }
  ]
}
"@ | Set-Content (Join-Path $tempDir "mixed-issues.json") -Encoding UTF8

    # ── Fixture 5: Empty issues ─────────────────────────────────────────────

    @"
{
  "description": "Empty issue list",
  "issues": []
}
"@ | Set-Content (Join-Path $tempDir "empty-issues.json") -Encoding UTF8

    # ── Test 1: Help flag ───────────────────────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Help flag ---"
    $helpOutput = & pwsh -NoProfile -File "$scriptDir/webui-issue-control.ps1" -Help 2>&1
    $helpExit = $LASTEXITCODE
    $helpText = Strip-Ansi ($helpOutput -join "`n")
    Assert -Condition ($helpExit -eq 0) -Name "Help exits 0"
    Assert-Contains $helpText "WEBUI ISSUE CONTROL" "Help contains script name"
    Assert-Contains $helpText "DRY-RUN CONTRACT" "Help contains dry-run contract"

    # ── Test 2: Mutual exclusion ────────────────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Mutual exclusion ---"
    $mutexOutput = & pwsh -NoProfile -File "$scriptDir/webui-issue-control.ps1" -Repo "test/repo" -IssueNumbers 655 -DryRun -Execute 2>&1
    $mutexExit = $LASTEXITCODE
    $mutexText = Strip-Ansi ($mutexOutput -join "`n")
    Assert -Condition ($mutexExit -ne 0) -Name "DryRun+Execute fails"
    Assert-Contains $mutexText "cannot be used together" "Error mentions mutual exclusion"

    # ── Test 3: Execute requires IssueNumbers ───────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Execute requires IssueNumbers ---"
    $noNumOutput = & pwsh -NoProfile -File "$scriptDir/webui-issue-control.ps1" -Repo "test/repo" -Execute 2>&1
    $noNumExit = $LASTEXITCODE
    $noNumText = Strip-Ansi ($noNumOutput -join "`n")
    Assert -Condition ($noNumExit -ne 0) -Name "Execute without IssueNumbers fails"
    Assert-Contains $noNumText "explicit issue allowlist" "Error mentions allowlist requirement"

    # ── Test 4: Fixture mode — normal issues ────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Fixture mode (normal issues) ---"
    $normalOutput = & pwsh -NoProfile -File "$scriptDir/webui-issue-control.ps1" -FixturePath (Join-Path $tempDir "normal-issues.json") 2>&1
    $normalExit = $LASTEXITCODE
    $normalText = Strip-Ansi ($normalOutput -join "`n")
    Assert -Condition ($normalExit -eq 0 -or $normalExit -eq 1) -Name "Normal issues exits cleanly"
    Assert-Contains $normalText "Loading issues" "Output mentions loading"
    Assert-NotContains $normalText "REFUSED" "No issues refused"

    # ── Test 5: Fixture mode — umbrella refused ─────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Umbrella issue refused ---"
    $umbrellaOutput = & pwsh -NoProfile -File "$scriptDir/webui-issue-control.ps1" -FixturePath (Join-Path $tempDir "umbrella-issue.json") 2>&1
    $umbrellaExit = $LASTEXITCODE
    $umbrellaText = Strip-Ansi ($umbrellaOutput -join "`n")
    Assert-Contains $umbrellaText "REFUSED" "Umbrella issue refused"
    Assert-Contains $umbrellaText "umbrella" "Refusal mentions umbrella pattern"

    # ── Test 6: Fixture mode — human-required refused ───────────────────────

    Write-Host ""
    Write-Host "--- Test: Human-required issue refused ---"
    $humanOutput = & pwsh -NoProfile -File "$scriptDir/webui-issue-control.ps1" -FixturePath (Join-Path $tempDir "human-required-issue.json") 2>&1
    $humanExit = $LASTEXITCODE
    $humanText = Strip-Ansi ($humanOutput -join "`n")
    Assert-Contains $humanText "REFUSED" "Human-required issue refused"
    Assert-Contains $humanText "human-required" "Refusal mentions human-required label"

    # ── Test 7: Fixture mode — mixed issues ─────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Mixed issues (some allowed, some refused) ---"
    $mixedOutput = & pwsh -NoProfile -File "$scriptDir/webui-issue-control.ps1" -FixturePath (Join-Path $tempDir "mixed-issues.json") 2>&1
    $mixedExit = $LASTEXITCODE
    $mixedText = Strip-Ansi ($mixedOutput -join "`n")
    Assert-Contains $mixedText "REFUSED" "Some issues refused"
    Assert-Contains $mixedText "#655" "Allowed issue present"
    Assert-Contains $mixedText "#700" "Umbrella issue listed in refused"

    # ── Test 8: Fixture mode — empty issues ─────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Empty issue list ---"
    $emptyOutput = & pwsh -NoProfile -File "$scriptDir/webui-issue-control.ps1" -FixturePath (Join-Path $tempDir "empty-issues.json") 2>&1
    $emptyExit = $LASTEXITCODE
    $emptyText = Strip-Ansi ($emptyOutput -join "`n")
    Assert -Condition ($emptyExit -eq 0) -Name "Empty issues exits 0"
    Assert-Contains $emptyText "No issues found" "Output mentions no issues"

    # ── Test 9: JSON output format ──────────────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: JSON output format ---"
    $jsonOutput = & pwsh -NoProfile -File "$scriptDir/webui-issue-control.ps1" -FixturePath (Join-Path $tempDir "normal-issues.json") -Json 2>&1
    $jsonExit = $LASTEXITCODE
    $jsonText = ($jsonOutput -join "`n")
    # Validate it's valid JSON
    $parsed = $null
    try {
        $parsed = $jsonText | ConvertFrom-Json
        Assert -Condition $true -Name "JSON output is valid"
    } catch {
        Assert -Condition $false -Name "JSON output is valid"
    }
    if ($parsed) {
        Assert -Condition ($parsed.version -eq 1) -Name "JSON has version 1"
        Assert-Contains $parsed.mode "dry-run" "JSON mode is dry-run"
        Assert -Condition ($null -ne $parsed.issues) -Name "JSON has issues array"
        Assert -Condition ($null -ne $parsed.refused) -Name "JSON has refused array"
        Assert -Condition ($null -ne $parsed.reconcile) -Name "JSON has reconcile object"
        Assert -Condition ($null -ne $parsed.audit) -Name "JSON has audit object"
        Assert-Contains $parsed.audit.markerBegin "ai-webui-issue-control" "Audit has begin marker"
        Assert-Contains $parsed.audit.markerEnd "ai-webui-issue-control" "Audit has end marker"
    }

    # ── Test 10: JSON output with refused issues ────────────────────────────

    Write-Host ""
    Write-Host "--- Test: JSON output with refused issues ---"
    $jsonRefusedOutput = & pwsh -NoProfile -File "$scriptDir/webui-issue-control.ps1" -FixturePath (Join-Path $tempDir "mixed-issues.json") -Json 2>&1
    $jsonRefusedText = ($jsonRefusedOutput -join "`n")
    $parsedRefused = $null
    try {
        $parsedRefused = $jsonRefusedText | ConvertFrom-Json
        Assert -Condition $true -Name "JSON with refused is valid"
    } catch {
        Assert -Condition $false -Name "JSON with refused is valid"
    }
    if ($parsedRefused) {
        Assert -Condition ($parsedRefused.refused.Count -gt 0) -Name "JSON has refused entries"
        Assert -Condition ($parsedRefused.issues.Count -gt 0) -Name "JSON has allowed entries"
    }

    # ── Test 11: Execute+FixturePath blocked ────────────────────────────────

    Write-Host ""
    Write-Host "--- Test: Execute+FixturePath blocked ---"
    $execFixOutput = & pwsh -NoProfile -File "$scriptDir/webui-issue-control.ps1" -FixturePath (Join-Path $tempDir "normal-issues.json") -Execute 2>&1
    $execFixExit = $LASTEXITCODE
    $execFixText = Strip-Ansi ($execFixOutput -join "`n")
    Assert -Condition ($execFixExit -ne 0) -Name "Execute+FixturePath fails"
    Assert-Contains $execFixText "cannot be used with" "Error mentions conflict"

    # ── Test 12: Repo required without FixturePath ──────────────────────────

    Write-Host ""
    Write-Host "--- Test: Repo required without FixturePath ---"
    $noRepoOutput = & pwsh -NoProfile -File "$scriptDir/webui-issue-control.ps1" -IssueNumbers 655 2>&1
    $noRepoExit = $LASTEXITCODE
    $noRepoText = Strip-Ansi ($noRepoOutput -join "`n")
    Assert -Condition ($noRepoExit -ne 0) -Name "Missing repo fails"
    Assert-Contains $noRepoText "Repo is required" "Error mentions repo requirement"

} finally {
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Summary ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "$passed passed, $failed failed"
exit $(if ($failed -gt 0) { 1 } else { 0 })
