#Requires -Version 7.0
<#
.SYNOPSIS
    Fixture-based tests for merge queue control-loop behavior.
    Validates allowlist resolution, eligibility classification,
    guard checks, and queue ordering without contacting GitHub.

.DESCRIPTION
    Exercises the control-loop functions from merge-clean-pr-batch.ps1
    with controlled fixtures covering:

    - Allowlist file parsing (comments, blanks, whitespace, invalid, empty)
    - PR eligibility classification (draft, closed, not mergeable, failed checks)
    - Task boundary guard (forbidden files, outside allowed)
    - PR handoff guard (missing sections, empty body)
    - Generated Prisma freshness guard (client without schema)
    - Path normalization
    - Queue filtering (eligible vs excluded aggregation)
    - Stop-on-first-failure ordering

    Each test uses fixtures from __fixtures__/merge-queue/allowlist.json
    or inline data. Exit code 0 = all passed, non-zero = at least one failure.

.EXAMPLE
    pwsh ./scripts/ai/merge-clean-pr-batch.queue.test.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Test harness
# ---------------------------------------------------------------------------

$script:pass = 0
$script:fail = 0
$script:total = 0
$script:failures = [System.Collections.Generic.List[string]]::new()

function Assert-True {
    param([bool]$Condition, [string]$Message)
    $script:total++
    if ($Condition) {
        Write-Host "  PASS: $Message"
        $script:pass++
    } else {
        Write-Host "  FAIL: $Message" -ForegroundColor Red
        $script:fail++
        $script:failures.Add($Message)
    }
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    $script:total++
    if ($Expected -eq $Actual) {
        Write-Host "  PASS: $Message"
        $script:pass++
    } else {
        Write-Host "  FAIL: $Message (expected='$Expected', actual='$Actual')" -ForegroundColor Red
        $script:fail++
        $script:failures.Add("$Message (expected='$Expected', actual='$Actual')")
    }
}

function Assert-Contains {
    param([string]$Haystack, [string]$Needle, [string]$Message)
    $script:total++
    if ($Haystack -like "*$Needle*") {
        Write-Host "  PASS: $Message"
        $script:pass++
    } else {
        Write-Host "  FAIL: $Message (did not find '$Needle')" -ForegroundColor Red
        $script:fail++
        $script:failures.Add("$Message (did not find '$Needle')")
    }
}

# ---------------------------------------------------------------------------
# Replicated production functions (from merge-clean-pr-batch.ps1)
# These are pure functions that do not require GitHub or file system state.
# ---------------------------------------------------------------------------

function Normalize-FilePath {
    param([string]$Path)
    return $Path -replace '\\', '/'
}

$script:BLOCKER_CHECK_STATES = @('FAILURE', 'CANCELLED', 'TIMED_OUT')

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
            if ($check.state -in $script:BLOCKER_CHECK_STATES) {
                $name = if ($check.name) { $check.name } else { $check.context }
                $reasons += "check-failed: $name ($($check.state))"
                break
            }
        }
    }

    return $reasons
}

function Test-TaskBoundary {
    param([array]$ChangedFiles, [string]$ManifestPath)

    if (-not (Test-Path $ManifestPath)) {
        return @()
    }

    try {
        $manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
    }
    catch {
        Write-Host "   WARNING: Could not parse manifest: $_"
        return @()
    }

    $allowed = @()
    $forbidden = @()
    if ($manifest.allowedFiles) { $allowed = @($manifest.allowedFiles) }
    if ($manifest.forbiddenFiles) { $forbidden = @($manifest.forbiddenFiles) }

    $failures = @()
    foreach ($file in $ChangedFiles) {
        $normalized = Normalize-FilePath $file
        foreach ($pattern in $forbidden) {
            $regex = '^' + ($pattern -replace '\.', '\.' -replace '\*', '.*' -replace '\?', '.') + '$'
            $regex = $regex -replace '/\.\*\$', '/.*$'
            if ($normalized -match $regex) {
                $failures += "forbidden file: $file"
                break
            }
        }
        if ($allowed.Count -gt 0) {
            $matched = $false
            foreach ($pattern in $allowed) {
                $regex = '^' + ($pattern -replace '\.', '\.' -replace '\*', '.*' -replace '\?', '.') + '$'
                $regex = $regex -replace '/\.\*\$', '/.*$'
                if ($normalized -match $regex) {
                    $matched = $true
                    break
                }
            }
            if (-not $matched) {
                $failures += "outside allowed boundary: $file"
            }
        }
    }
    return $failures
}

function Test-PRHandoff {
    param([string]$Body, [string]$FilePath)

    $content = $Body
    if ($FilePath -and (Test-Path $FilePath)) {
        $content = Get-Content $FilePath -Raw
    }

    if (-not $content -or [string]::IsNullOrWhiteSpace($content)) {
        return @('PR body is empty — handoff sections required')
    }

    $requiredSections = @(
        @{ Name = 'summary'; Aliases = @('summary', 'overview') },
        @{ Name = 'changed files'; Aliases = @('changed files', 'files changed', 'changes') },
        @{ Name = 'linked issues'; Aliases = @('linked issues', 'linked issue', 'issue', 'issues') },
        @{ Name = 'validation'; Aliases = @('validation', 'validation commands', 'test plan', 'testing') },
        @{ Name = 'non-goals'; Aliases = @('non-goals', 'non goals', 'nongoals', 'out of scope') },
        @{ Name = 'risk / rollback'; Aliases = @('risk / rollback', 'risk', 'rollback', 'risk/rollback', 'risk & rollback') },
        @{ Name = 'follow-up handoff'; Aliases = @('follow-up handoff', 'follow up handoff', 'handoff', 'follow-up') }
    )

    $headings = @()
    foreach ($line in ($content -split "`n")) {
        $trimmed = $line.Trim()
        if ($trimmed -match '^#{1,6}\s+(.+)$') {
            $headings += $Matches[1].Trim().ToLower()
        }
    }

    $missing = @()
    foreach ($section in $requiredSections) {
        $found = $false
        foreach ($heading in $headings) {
            if ($heading -in $section.Aliases) {
                $found = $true
                break
            }
        }
        if (-not $found) {
            $missing += $section.Name
        }
    }

    if ($missing.Count -gt 0) {
        return @("missing handoff sections: $($missing -join ', ')")
    }
    return @()
}

function Test-GeneratedPrismaFreshness {
    param([array]$ChangedFiles)

    $GENERATED_PREFIX = 'src/generated/prisma/'
    $SCHEMA_PATH = 'prisma/schema.prisma'

    $hasSchema = $false
    $hasGenerated = $false

    foreach ($file in $ChangedFiles) {
        $normalized = Normalize-FilePath $file
        if ($normalized -eq $SCHEMA_PATH) {
            $hasSchema = $true
        }
        if ($normalized.StartsWith($GENERATED_PREFIX)) {
            $hasGenerated = $true
        }
    }

    if ($hasGenerated -and -not $hasSchema) {
        return @('generated Prisma client changed without schema update')
    }
    return @()
}

# ---------------------------------------------------------------------------
# Allowlist parser (replicated from Resolve-Allowlist)
# ---------------------------------------------------------------------------

function Resolve-AllowlistFromFile {
    param([string]$FilePath)

    if (-not (Test-Path $FilePath)) {
        throw "Allowlist file not found: $FilePath"
    }
    $raw = Get-Content $FilePath -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return [int[]]@()
    }
    $lines = $raw -split "`n" | ForEach-Object { $_.Trim() }
    $numbers = @()
    foreach ($line in $lines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line.StartsWith('#')) { continue }
        $parsed = 0
        if ([int]::TryParse($line, [ref]$parsed)) {
            $numbers += $parsed
        }
        else {
            throw "Invalid PR number in allowlist: '$line'"
        }
    }
    return [int[]]$numbers
}

# ---------------------------------------------------------------------------
# Load fixtures
# ---------------------------------------------------------------------------

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$fixturesPath = Join-Path $scriptDir '__fixtures__' 'merge-queue' 'allowlist.json'

if (-not (Test-Path $fixturesPath)) {
    Write-Host "FATAL: Fixture file not found at $fixturesPath"
    exit 1
}

$fixtures = Get-Content $fixturesPath -Raw | ConvertFrom-Json

# Temp dir for allowlist file tests
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "queue-test-$(Get-Date -Format 'yyyyMMddHHmmss')"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

try {

Write-Host ""
Write-Host "merge-clean-pr-batch queue control-loop tests" -ForegroundColor Cyan
Write-Host ""

# ===========================================================================
# SECTION 1: Allowlist file parsing
# ===========================================================================

Write-Host "--- Allowlist file parsing ---" -ForegroundColor Yellow

# Test 1.1: Valid allowlist
Write-Host ""
Write-Host "TEST 1.1: Valid allowlist with 3 PR numbers"
$allowPath = Join-Path $tmpDir "allowlist-valid.txt"
$fixtures.allowlistSamples.valid | Set-Content $allowPath -Encoding UTF8
$nums = @(Resolve-AllowlistFromFile -FilePath $allowPath)
Assert-Equal 3 $nums.Count "valid allowlist has 3 entries"
Assert-Equal 42 $nums[0] "first PR is 42"
Assert-Equal 45 $nums[1] "second PR is 45"
Assert-Equal 51 $nums[2] "third PR is 51"

# Test 1.2: Allowlist with comments and blanks
Write-Host ""
Write-Host "TEST 1.2: Allowlist with comments and blank lines"
$allowPath2 = Join-Path $tmpDir "allowlist-comments.txt"
$fixtures.allowlistSamples.withComments | Set-Content $allowPath2 -Encoding UTF8
$nums2 = @(Resolve-AllowlistFromFile -FilePath $allowPath2)
Assert-Equal 3 $nums2.Count "allowlist with comments has 3 entries"
Assert-Equal 42 $nums2[0] "first PR after comments is 42"
Assert-Equal 45 $nums2[1] "second PR after blank is 45"
Assert-Equal 51 $nums2[2] "third PR after comment is 51"

# Test 1.3: Allowlist with whitespace trimming
Write-Host ""
Write-Host "TEST 1.3: Allowlist with leading/trailing whitespace"
$allowPath3 = Join-Path $tmpDir "allowlist-whitespace.txt"
$fixtures.allowlistSamples.withTrailing | Set-Content $allowPath3 -Encoding UTF8
$nums3 = @(Resolve-AllowlistFromFile -FilePath $allowPath3)
Assert-Equal 2 $nums3.Count "whitespace allowlist has 2 entries"
Assert-Equal 42 $nums3[0] "whitespace-trimmed first PR is 42"
Assert-Equal 45 $nums3[1] "whitespace-trimmed second PR is 45"

# Test 1.4: Invalid entry throws
Write-Host ""
Write-Host "TEST 1.4: Invalid entry throws error"
$allowPath4 = Join-Path $tmpDir "allowlist-invalid.txt"
$fixtures.allowlistSamples.invalidEntry | Set-Content $allowPath4 -Encoding UTF8
$threw = $false
try {
    Resolve-AllowlistFromFile -FilePath $allowPath4
} catch {
    $threw = $true
    Assert-Contains $_.Exception.Message "not-a-number" "error message mentions invalid entry"
}
Assert-True $threw "invalid entry throws exception"

# Test 1.5: Empty allowlist returns empty array
Write-Host ""
Write-Host "TEST 1.5: Empty allowlist returns empty array"
$allowPath5 = Join-Path $tmpDir "allowlist-empty.txt"
$fixtures.allowlistSamples.empty | Set-Content $allowPath5 -Encoding UTF8
$nums5 = @(Resolve-AllowlistFromFile -FilePath $allowPath5)
Assert-Equal 0 $nums5.Count "empty allowlist returns 0 entries"

# Test 1.6: Single PR
Write-Host ""
Write-Host "TEST 1.6: Single PR allowlist"
$allowPath6 = Join-Path $tmpDir "allowlist-single.txt"
$fixtures.allowlistSamples.singlePr | Set-Content $allowPath6 -Encoding UTF8
$nums6 = @(Resolve-AllowlistFromFile -FilePath $allowPath6)
Assert-Equal 1 $nums6.Count "single PR allowlist has 1 entry"
Assert-Equal 99 $nums6[0] "single PR is 99"

# Test 1.7: Duplicates preserved (parser does not deduplicate)
Write-Host ""
Write-Host "TEST 1.7: Duplicate PR numbers preserved"
$allowPath7 = Join-Path $tmpDir "allowlist-dupes.txt"
$fixtures.allowlistSamples.duplicates | Set-Content $allowPath7 -Encoding UTF8
$nums7 = @(Resolve-AllowlistFromFile -FilePath $allowPath7)
Assert-Equal 3 $nums7.Count "duplicate allowlist has 3 entries (no dedup)"

# Test 1.8: Missing file throws
Write-Host ""
Write-Host "TEST 1.8: Missing allowlist file throws"
$threw8 = $false
try {
    Resolve-AllowlistFromFile -FilePath (Join-Path $tmpDir "nonexistent.txt")
} catch {
    $threw8 = $true
}
Assert-True $threw8 "missing allowlist file throws exception"

Write-Host ""

# ===========================================================================
# SECTION 2: PR eligibility classification
# ===========================================================================

Write-Host "--- PR eligibility classification ---" -ForegroundColor Yellow

# Test 2.1: Eligible PR — no reasons
Write-Host ""
Write-Host "TEST 2.1: Eligible PR returns no failure reasons"
$eligible = $fixtures.prInfoSamples.eligible
$reasons = @(Test-PREligible -PRInfo $eligible)
Assert-Equal 0 $reasons.Count "eligible PR has 0 failure reasons"

# Test 2.2: Draft PR
Write-Host ""
Write-Host "TEST 2.2: Draft PR excluded"
$draft = $fixtures.prInfoSamples.draft
$reasons2 = @(Test-PREligible -PRInfo $draft)
Assert-True ($reasons2.Count -ge 1) "draft PR has failure reasons"
Assert-True ($reasons2 -contains 'draft') "draft PR excluded with 'draft' reason"

# Test 2.3: Closed PR
Write-Host ""
Write-Host "TEST 2.3: Closed PR excluded"
$closed = $fixtures.prInfoSamples.closed
$reasons3 = @(Test-PREligible -PRInfo $closed)
Assert-True ($reasons3.Count -ge 1) "closed PR has failure reasons"
Assert-True (@($reasons3 | Where-Object { $_ -like "state=*"}).Count -gt 0) "closed PR excluded with state reason"

# Test 2.4: Not mergeable PR
Write-Host ""
Write-Host "TEST 2.4: Conflicting PR excluded"
$conflict = $fixtures.prInfoSamples.notMergeable
$reasons4 = @(Test-PREligible -PRInfo $conflict)
Assert-True (@($reasons4 | Where-Object { $_ -like "mergeable=*"}).Count -gt 0) "conflicting PR excluded with mergeable reason"

# Test 2.5: Failed check
Write-Host ""
Write-Host "TEST 2.5: Failed status check excluded"
$failedCheck = $fixtures.prInfoSamples.failedCheck
$reasons5 = @(Test-PREligible -PRInfo $failedCheck)
Assert-True (@($reasons5 | Where-Object { $_ -like "check-failed:*"}).Count -gt 0) "failed check PR excluded"
Assert-True (@($reasons5 | Where-Object { $_ -like "*FAILURE*"}).Count -gt 0) "failed check mentions FAILURE"

# Test 2.6: Cancelled check
Write-Host ""
Write-Host "TEST 2.6: Cancelled status check excluded"
$cancelled = $fixtures.prInfoSamples.cancelledCheck
$reasons6 = @(Test-PREligible -PRInfo $cancelled)
Assert-True (@($reasons6 | Where-Object { $_ -like "check-failed:*CANCELLED*"}).Count -gt 0) "cancelled check PR excluded"

# Test 2.7: Timed out check
Write-Host ""
Write-Host "TEST 2.7: Timed-out status check excluded"
$timedOut = $fixtures.prInfoSamples.timedOutCheck
$reasons7 = @(Test-PREligible -PRInfo $timedOut)
Assert-True (@($reasons7 | Where-Object { $_ -like "check-failed:*TIMED_OUT*"}).Count -gt 0) "timed-out check PR excluded"

# Test 2.8: Multiple failures — draft + closed + conflict + failed check
Write-Host ""
Write-Host "TEST 2.8: Multiple failure reasons aggregated"
$multiFail = $fixtures.prInfoSamples.multipleFailures
$reasons8 = @(Test-PREligible -PRInfo $multiFail)
Assert-True ($reasons8.Count -ge 3) "multi-fail PR has at least 3 reasons (got $($reasons8.Count))"
Assert-True ($reasons8 -contains 'draft') "multi-fail includes draft"
Assert-True (@($reasons8 | Where-Object { $_ -like "state=*"}).Count -gt 0) "multi-fail includes state"
Assert-True (@($reasons8 | Where-Object { $_ -like "mergeable=*"}).Count -gt 0) "multi-fail includes mergeable"

Write-Host ""

# ===========================================================================
# SECTION 3: Path normalization
# ===========================================================================

Write-Host "--- Path normalization ---" -ForegroundColor Yellow

# Test 3.1: Backslash to forward slash
Write-Host ""
Write-Host "TEST 3.1: Windows backslashes normalized to forward slashes"
$normalized = Normalize-FilePath "src\modules\auth\auth.module.ts"
Assert-Equal "src/modules/auth/auth.module.ts" $normalized "backslashes converted"

# Test 3.2: Already forward slashes unchanged
Write-Host ""
Write-Host "TEST 3.2: Forward slashes unchanged"
$normalized2 = Normalize-FilePath "scripts/ai/test.ps1"
Assert-Equal "scripts/ai/test.ps1" $normalized2 "forward slashes preserved"

# Test 3.3: Mixed slashes
Write-Host ""
Write-Host "TEST 3.3: Mixed slashes normalized"
$normalized3 = Normalize-FilePath "src\modules/auth.module.ts"
Assert-Equal "src/modules/auth.module.ts" $normalized3 "mixed slashes normalized"

Write-Host ""

# ===========================================================================
# SECTION 4: Task boundary guard
# ===========================================================================

Write-Host "--- Task boundary guard ---" -ForegroundColor Yellow

# Create a temp task manifest from fixture
$taskManifestPath = Join-Path $tmpDir "task-manifest.json"
$fixtures.taskManifest | ConvertTo-Json -Depth 5 | Set-Content $taskManifestPath -Encoding UTF8

# Test 4.1: Safe files pass boundary check
Write-Host ""
Write-Host "TEST 4.1: Safe files within allowed boundary pass"
$safeFiles = @($fixtures.changedFilesSets.safeOnly)
$boundaryFailures = @(Test-TaskBoundary -ChangedFiles $safeFiles -ManifestPath $taskManifestPath)
Assert-Equal 0 $boundaryFailures.Count "safe files have 0 boundary failures"

# Test 4.2: Forbidden src file blocked
Write-Host ""
Write-Host "TEST 4.2: Forbidden src file blocked by boundary guard"
$forbiddenSrc = @($fixtures.changedFilesSets.includesForbiddenSrc)
$boundaryFailures2 = @(Test-TaskBoundary -ChangedFiles $forbiddenSrc -ManifestPath $taskManifestPath)
Assert-True ($boundaryFailures2.Count -ge 1) "forbidden src has boundary failures"
Assert-True (@($boundaryFailures2 | Where-Object { $_ -like "*forbidden*"}).Count -gt 0) "failure mentions forbidden"
Assert-True (@($boundaryFailures2 | Where-Object { $_ -like "*src/modules/auth/auth.module.ts*"}).Count -gt 0) "failure names the file"

# Test 4.3: Forbidden prisma file blocked
Write-Host ""
Write-Host "TEST 4.3: Forbidden prisma file blocked by boundary guard"
$forbiddenPrisma = @($fixtures.changedFilesSets.includesForbiddenPrisma)
$boundaryFailures3 = @(Test-TaskBoundary -ChangedFiles $forbiddenPrisma -ManifestPath $taskManifestPath)
Assert-True (@($boundaryFailures3 | Where-Object { $_ -like "*forbidden*prisma*"}).Count -gt 0) "prisma file blocked"

# Test 4.4: File outside allowed boundary blocked
Write-Host ""
Write-Host "TEST 4.4: File outside allowed boundary blocked"
$outsideFiles = @($fixtures.changedFilesSets.outsideAllowed)
$boundaryFailures4 = @(Test-TaskBoundary -ChangedFiles $outsideFiles -ManifestPath $taskManifestPath)
Assert-True (@($boundaryFailures4 | Where-Object { $_ -like "*outside allowed*"}).Count -gt 0) "outside-allowed file blocked"
Assert-True (@($boundaryFailures4 | Where-Object { $_ -like "*docs/unexpected.md*"}).Count -gt 0) "names the outside file"

# Test 4.5: Missing manifest passes (no guard)
Write-Host ""
Write-Host "TEST 4.5: Missing manifest file returns no failures"
$boundaryFailures5 = @(Test-TaskBoundary -ChangedFiles @("src/app.ts") -ManifestPath (Join-Path $tmpDir "nonexistent.json"))
Assert-Equal 0 $boundaryFailures5.Count "missing manifest returns no failures"

# Test 4.6: Empty changed files pass
Write-Host ""
Write-Host "TEST 4.6: Empty changed files pass boundary check"
$boundaryFailures6 = @(Test-TaskBoundary -ChangedFiles @() -ManifestPath $taskManifestPath)
Assert-Equal 0 $boundaryFailures6.Count "empty changed files pass"

Write-Host ""

# ===========================================================================
# SECTION 5: PR handoff guard
# ===========================================================================

Write-Host "--- PR handoff guard ---" -ForegroundColor Yellow

# Test 5.1: Complete PR body passes
Write-Host ""
Write-Host "TEST 5.1: Complete PR body passes handoff guard"
$completeBody = $fixtures.prBodies.complete
$handoffFailures = @(Test-PRHandoff -Body $completeBody)
Assert-Equal 0 $handoffFailures.Count "complete body has 0 handoff failures"

# Test 5.2: Missing summary section
Write-Host ""
Write-Host "TEST 5.2: Missing summary section detected"
$missingSummary = $fixtures.prBodies.missingSummary
$handoffFailures2 = @(Test-PRHandoff -Body $missingSummary)
Assert-True ($handoffFailures2.Count -ge 1) "missing summary has failures"
Assert-True (@($handoffFailures2 | Where-Object { $_ -like "*summary*"}).Count -gt 0) "failure mentions summary"

# Test 5.3: Missing follow-up handoff section
Write-Host ""
Write-Host "TEST 5.3: Missing follow-up handoff section detected"
$missingHandoff = $fixtures.prBodies.missingHandoff
$handoffFailures3 = @(Test-PRHandoff -Body $missingHandoff)
Assert-True (@($handoffFailures3 | Where-Object { $_ -like "*follow-up*"}).Count -gt 0) "failure mentions follow-up"

# Test 5.4: Empty body
Write-Host ""
Write-Host "TEST 5.4: Empty body detected"
$emptyBody = $fixtures.prBodies.empty
$handoffFailures4 = @(Test-PRHandoff -Body $emptyBody)
Assert-True ($handoffFailures4.Count -ge 1) "empty body has failures"
Assert-True (@($handoffFailures4 | Where-Object { $_ -like "*empty*"}).Count -gt 0) "failure mentions empty"

# Test 5.5: Whitespace-only body
Write-Host ""
Write-Host "TEST 5.5: Whitespace-only body detected"
$wsBody = $fixtures.prBodies.whitespaceOnly
$handoffFailures5 = @(Test-PRHandoff -Body $wsBody)
Assert-True (@($handoffFailures5 | Where-Object { $_ -like "*empty*"}).Count -gt 0) "whitespace body treated as empty"

Write-Host ""

# ===========================================================================
# SECTION 6: Generated Prisma freshness guard
# ===========================================================================

Write-Host "--- Generated Prisma freshness guard ---" -ForegroundColor Yellow

# Test 6.1: Generated client without schema — blocked
Write-Host ""
Write-Host "TEST 6.1: Generated Prisma client without schema update blocked"
$genOnly = @($fixtures.changedFilesSets.generatedPrismaOnly)
$prismaFailures = @(Test-GeneratedPrismaFreshness -ChangedFiles $genOnly)
Assert-Equal 1 $prismaFailures.Count "generated-only has 1 failure"
Assert-Contains $prismaFailures[0] "without schema" "failure mentions missing schema"

# Test 6.2: Schema and generated together — allowed
Write-Host ""
Write-Host "TEST 6.2: Schema and generated client together pass"
$both = @($fixtures.changedFilesSets.schemaAndGenerated)
$prismaFailures2 = @(Test-GeneratedPrismaFreshness -ChangedFiles $both)
Assert-Equal 0 $prismaFailures2.Count "schema+generated has 0 failures"

# Test 6.3: No prisma files — pass
Write-Host ""
Write-Host "TEST 6.3: No prisma files passes freshness check"
$noPrisma = @($fixtures.changedFilesSets.safeOnly)
$prismaFailures3 = @(Test-GeneratedPrismaFreshness -ChangedFiles $noPrisma)
Assert-Equal 0 $prismaFailures3.Count "no prisma files has 0 failures"

# Test 6.4: Empty changed files — pass
Write-Host ""
Write-Host "TEST 6.4: Empty changed files passes freshness check"
$prismaFailures4 = @(Test-GeneratedPrismaFreshness -ChangedFiles @())
Assert-Equal 0 $prismaFailures4.Count "empty files has 0 failures"

Write-Host ""

# ===========================================================================
# SECTION 7: Queue control-loop integration
# ===========================================================================

Write-Host "--- Queue control-loop integration ---" -ForegroundColor Yellow

# Test 7.1: Eligible/excluded filtering
Write-Host ""
Write-Host "TEST 7.1: Eligible and excluded PRs correctly separated"

$allPRs = @(
    $fixtures.prInfoSamples.eligible,      # 42 — eligible
    $fixtures.prInfoSamples.draft,          # 43 — draft
    $fixtures.prInfoSamples.closed,         # 44 — closed
    $fixtures.prInfoSamples.eligible,       # 42 duplicate — eligible
    $fixtures.prInfoSamples.failedCheck     # 46 — failed check
)

$eligibleList = @()
$excludedList = @()

foreach ($pr in $allPRs) {
    $reasons = @(Test-PREligible -PRInfo $pr)
    if ($reasons.Count -eq 0) {
        $eligibleList += $pr
    } else {
        $excludedList += @{ PR = $pr; Reasons = $reasons }
    }
}

Assert-Equal 2 $eligibleList.Count "2 eligible PRs in mixed batch"
Assert-Equal 3 $excludedList.Count "3 excluded PRs in mixed batch"

# Test 7.2: Stop-on-first-failure ordering
Write-Host ""
Write-Host "TEST 7.2: Stop-on-first-failure — first failure blocks batch"

$queue = @(
    @{ number = 50; title = "feat: ok"; status = 'merged' },
    @{ number = 51; title = "feat: fail"; status = 'failed'; failureReason = "Not mergeable" },
    @{ number = 52; title = "feat: unmerged"; status = 'pending' }
)

# Simulate stop-on-first-failure: iterate until a failure is found
$processed = @()
$batchFailed = $false
$failureReason = $null

foreach ($item in $queue) {
    if ($item.status -eq 'failed') {
        $batchFailed = $true
        $failureReason = $item.failureReason
        $processed += $item
        break
    }
    $processed += $item
}

Assert-True $batchFailed "batch fails when a merge fails"
Assert-Equal "Not mergeable" $failureReason "failure reason captured"
Assert-Equal 2 $processed.Count "only 2 of 3 items processed before stop"
Assert-Equal 50 $processed[0].number "first processed is PR 50"
Assert-Equal 51 $processed[1].number "second processed is failing PR 51"

# Test 7.3: Guard failure blocks entire batch
Write-Host ""
Write-Host "TEST 7.3: Guard failure blocks entire batch (no partial merge)"

$guardBlockedPR = $fixtures.taskManifest
$changedFilesGuarded = @($fixtures.changedFilesSets.includesForbiddenSrc)
$guardFailures = @(Test-TaskBoundary -ChangedFiles $changedFilesGuarded -ManifestPath $taskManifestPath)

$batchAborted = $guardFailures.Count -gt 0
Assert-True $batchAborted "batch aborts on guard failure"
Assert-True (@($guardFailures | Where-Object { $_ -like "*forbidden*"}).Count -gt 0) "guard failure is about forbidden files"

# Test 7.4: All-eligible batch proceeds
Write-Host ""
Write-Host "TEST 7.4: All-eligible batch with no guard failures proceeds"

$allEligiblePRs = @(
    $fixtures.prInfoSamples.eligible,
    $fixtures.prInfoSamples.eligible
)
$allPass = $true
foreach ($pr in $allEligiblePRs) {
    $r = @(Test-PREligible -PRInfo $pr)
    if ($r.Count -gt 0) { $allPass = $false; break }
}
Assert-True $allPass "all-eligible batch passes eligibility"

# Test 7.5: Boundary guard with safe files — batch proceeds
Write-Host ""
Write-Host "TEST 7.5: Safe boundary guard allows batch to proceed"
$safeBoundary = @(Test-TaskBoundary -ChangedFiles @($fixtures.changedFilesSets.safeOnly) -ManifestPath $taskManifestPath)
Assert-Equal 0 $safeBoundary.Count "safe boundary has 0 failures — batch can proceed"

# Test 7.6: Combined guard + eligibility — full pipeline
Write-Host ""
Write-Host "TEST 7.6: Combined eligibility + boundary guard pipeline"

$pipelinePR = $fixtures.prInfoSamples.eligible
$pipelineChanged = @($fixtures.changedFilesSets.includesForbiddenSrc)

$eligibilityReasons = @(Test-PREligible -PRInfo $pipelinePR)
Assert-Equal 0 $eligibilityReasons.Count "pipeline PR passes eligibility"

$boundaryCheck = @(Test-TaskBoundary -ChangedFiles $pipelineChanged -ManifestPath $taskManifestPath)
Assert-True ($boundaryCheck.Count -ge 1) "pipeline PR fails boundary guard"
Assert-True (@($boundaryCheck | Where-Object { $_ -like "*forbidden*"}).Count -gt 0) "pipeline failure is forbidden file"

Write-Host ""

} finally {
    Remove-Item -Path $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host ("=" * 50)
Write-Host "  Results: $($script:pass) passed, $($script:fail) failed ($($script:total) total)"
Write-Host ("=" * 50)

if ($script:failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Failures:" -ForegroundColor Red
    foreach ($f in $script:failures) {
        Write-Host "  - $f"
    }
    exit 1
}

Write-Host "All tests passed." -ForegroundColor Green
exit 0
