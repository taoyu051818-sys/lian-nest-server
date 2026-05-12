#!/usr/bin/env node
"use strict";

/**
 * health-state.test.js
 *
 * Unit tests for the health-state action module.
 * Uses temporary health files and a mock PowerShell script to avoid
 * touching real .github/ai-state/ files.
 *
 * Run: node tools/provider-pool-webui/actions/health-state.test.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const mod = require("./health-state");

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed += 1;
    console.log("  PASS  " + name);
  } else {
    failed += 1;
    console.error("  FAIL  " + name);
  }
}

function assertDeepEqual(actual, expected, name) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  assert(match, name);
  if (!match) {
    console.error("    expected:", JSON.stringify(expected));
    console.error("    actual:  ", JSON.stringify(actual));
  }
}

function assertThrows(fn, expectedMsg, name) {
  try {
    fn();
    failed += 1;
    console.error("  FAIL  " + name + " (did not throw)");
  } catch (e) {
    const ok = expectedMsg ? e.message.includes(expectedMsg) : true;
    if (ok) {
      passed += 1;
      console.log("  PASS  " + name);
    } else {
      failed += 1;
      console.error("  FAIL  " + name);
      console.error("    expected msg to include:", expectedMsg);
      console.error("    actual msg:", e.message);
    }
  }
}

// --- Fixtures ----------------------------------------------------------------

function makeHealthMarker(overrides) {
  return Object.assign(
    {
      markerVersion: 1,
      state: "green",
      commitSha: "abc1234def56789012345678901234567890",
      capturedAt: "2026-05-12T00:00:00.000Z",
      checks: ["tsc", "build", "test"],
      failedChecks: [],
      allowedWorkerClasses: ["all"],
    },
    overrides || {},
  );
}

function setupTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hs-test-"));
}

function writeHealthFile(dir, marker) {
  const filePath = path.join(dir, "main-health.json");
  fs.writeFileSync(filePath, JSON.stringify(marker, null, 2) + "\n", "utf-8");
  return filePath;
}

function writeMockScript(dir) {
  // Mock PowerShell script that writes a valid marker to -OutputPath.
  // Parses -State, -CommitSha, -OutputPath, -Checks, -FailedChecks,
  // -AllowedWorkerClasses, -Reason, -DryRun from $args.
  const scriptContent = `
param(
    [string]$State = "green",
    [string]$CommitSha = "0000000000000000000000000000000000000000",
    [string]$OutputPath = "",
    [string]$Checks = "",
    [string]$FailedChecks = "",
    [string]$AllowedWorkerClasses = "",
    [string]$Reason = "",
    [switch]$DryRun
)

$checksArray = @()
if ($Checks -ne "") { $checksArray = @($Checks -split "," | ForEach-Object { $_.Trim() }) }

$failedArray = @()
if ($FailedChecks -ne "") { $failedArray = @($FailedChecks -split "," | ForEach-Object { $_.Trim() }) }

$classesArray = @("all")
if ($AllowedWorkerClasses -ne "") { $classesArray = @($AllowedWorkerClasses -split "," | ForEach-Object { $_.Trim() }) }

if ($CommitSha -eq "") { $CommitSha = "0000000000000000000000000000000000000000" }

$marker = [ordered]@{
    markerVersion        = 1
    state                = $State
    commitSha            = $CommitSha
    capturedAt           = ([DateTime]::UtcNow.ToString("o"))
    checks               = $checksArray
    failedChecks         = $failedArray
    allowedWorkerClasses = $classesArray
}
if ($Reason -ne "") { $marker["reason"] = $Reason }

$json = $marker | ConvertTo-Json -Depth 4

if ($DryRun) {
    Write-Host "[ok] Dry-run mode. No files were written."
    exit 0
}

if ($OutputPath -ne "") {
    $dir = Split-Path -Parent $OutputPath
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Set-Content -Path $OutputPath -Value $json -Encoding UTF8
    Write-Host "[ok] Health state marker written to: $OutputPath"
}
exit 0
`;
  const scriptPath = path.join(dir, "mock-write-health.ps1");
  fs.writeFileSync(scriptPath, scriptContent, "utf-8");
  return scriptPath;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// --- Tests -------------------------------------------------------------------

if (require.main !== module) {
  // When loaded by action-modules.test.js via require(), do not execute tests.
  module.exports = {};
} else {

console.log("\nhealth-state.test.js\n");

// Module contract
console.log("Module contract\n");
assert(typeof mod.id === "string" && mod.id.length > 0, "exports id");
assert(mod.id === "health-state", "id is health-state");
assert(typeof mod.label === "string" && mod.label.length > 0, "exports label");
assert(typeof mod.description === "string", "exports description");
assert(mod.dangerous === true, "marked dangerous");
assert(typeof mod.preview === "function", "exports preview");
assert(typeof mod.execute === "function", "exports execute");

// --- Payload validation ------------------------------------------------------

console.log("\nPayload validation\n");

assertThrows(function () { mod.preview(null); }, "payload must be an object", "preview rejects null payload");
assertThrows(function () { mod.execute(null); }, "payload must be an object", "execute rejects null payload");
assertThrows(function () { mod.preview(undefined); }, "payload must be an object", "preview rejects undefined payload");
assertThrows(function () { mod.execute(undefined); }, "payload must be an object", "execute rejects undefined payload");
assertThrows(function () { mod.preview("string"); }, "payload must be an object", "preview rejects string payload");
assertThrows(function () { mod.execute(42); }, "payload must be an object", "execute rejects numeric payload");

// Missing state
assertThrows(function () { mod.preview({}); }, "state is required", "preview rejects missing state");
assertThrows(function () { mod.execute({}); }, "state is required", "execute rejects missing state");

// Invalid state
assertThrows(function () { mod.preview({ state: "blue" }); }, "state must be one of", "preview rejects invalid state");
assertThrows(function () { mod.execute({ state: "unknown" }); }, "state must be one of", "execute rejects invalid state");
assertThrows(function () { mod.preview({ state: "" }); }, "state is required", "preview rejects empty state");
assertThrows(function () { mod.preview({ state: 123 }); }, "state is required", "preview rejects numeric state");

// Valid states accepted (need scriptPath to avoid calling real script)
(function () {
  var dir = setupTmpDir();
  var scriptPath = writeMockScript(dir);
  var healthPath = path.join(dir, "main-health.json");
  try {
    ["green", "yellow", "red", "black"].forEach(function (st) {
      var result = mod.preview({ state: st, _healthPath: healthPath, _scriptPath: scriptPath });
      assert(result.status === "preview", "preview accepts state: " + st);
      assert(result.requestedState === st, "preview requestedState matches: " + st);
    });
  } finally {
    cleanup(dir);
  }
})();

// commitSha validation
assertThrows(function () { mod.preview({ state: "green", commitSha: "abc" }); }, "commitSha must be 7-40 hex characters", "preview rejects short commitSha");
assertThrows(function () { mod.preview({ state: "green", commitSha: "zzzzzzz" }); }, "commitSha must be 7-40 hex characters", "preview rejects non-hex commitSha");
assertThrows(function () { mod.preview({ state: "green", commitSha: 1234567 }); }, "commitSha must be 7-40 hex characters", "preview rejects numeric commitSha");

// checks validation
assertThrows(function () { mod.preview({ state: "green", checks: "not-array" }); }, "checks must be an array", "preview rejects non-array checks");
assertThrows(function () { mod.preview({ state: "green", checks: [123] }); }, "checks entries must be non-empty strings", "preview rejects numeric check entry");
assertThrows(function () { mod.preview({ state: "green", checks: [""] }); }, "checks entries must be non-empty strings", "preview rejects empty check entry");

// failedChecks validation
assertThrows(function () { mod.preview({ state: "green", failedChecks: "not-array" }); }, "failedChecks must be an array", "preview rejects non-array failedChecks");
assertThrows(function () { mod.preview({ state: "green", failedChecks: [123] }); }, "failedChecks entries must be non-empty strings", "preview rejects numeric failedCheck entry");

// failedChecks without checks
assertThrows(function () { mod.preview({ state: "green", failedChecks: ["tsc"] }); }, "failedChecks provided but checks is empty", "preview rejects failedChecks without checks");

// failedChecks entry not in checks
assertThrows(function () {
  mod.preview({ state: "green", checks: ["tsc", "build"], failedChecks: ["tsc", "prisma"] });
}, "failedChecks entry 'prisma' is not in checks list", "preview rejects failedCheck not in checks");

// allowedWorkerClasses validation
assertThrows(function () { mod.preview({ state: "green", allowedWorkerClasses: "not-array" }); }, "allowedWorkerClasses must be an array", "preview rejects non-array allowedWorkerClasses");
assertThrows(function () { mod.preview({ state: "green", allowedWorkerClasses: ["invalid-class"] }); }, "allowedWorkerClasses entry 'invalid-class' is not valid", "preview rejects invalid worker class");

// reason validation
assertThrows(function () { mod.preview({ state: "green", reason: "" }); }, "reason must be a non-empty string", "preview rejects empty reason");
assertThrows(function () { mod.preview({ state: "green", reason: "   " }); }, "reason must be a non-empty string", "preview rejects whitespace-only reason");
assertThrows(function () { mod.preview({ state: "green", reason: 42 }); }, "reason must be a non-empty string", "preview rejects numeric reason");

// --- Preview behavior --------------------------------------------------------

console.log("\nPreview behavior\n");

// Preview with no existing health file
(function () {
  var dir = setupTmpDir();
  var scriptPath = writeMockScript(dir);
  var healthPath = path.join(dir, "main-health.json");
  try {
    var result = mod.preview({ state: "yellow", _healthPath: healthPath, _scriptPath: scriptPath });
    assert(result.status === "preview", "preview with no existing file returns preview status");
    assert(result.dryRun === true, "preview with no existing file is dry-run");
    assert(result.currentState === null, "preview with no existing file has null currentState");
    assert(result.requestedState === "yellow", "preview requestedState is yellow");
    assert(result.scriptValidation === "passed", "preview script validation passed");
  } finally {
    cleanup(dir);
  }
})();

// Preview with existing health file
(function () {
  var dir = setupTmpDir();
  var scriptPath = writeMockScript(dir);
  var marker = makeHealthMarker({ state: "green" });
  var healthPath = writeHealthFile(dir, marker);
  try {
    var result = mod.preview({ state: "red", _healthPath: healthPath, _scriptPath: scriptPath });
    assert(result.status === "preview", "preview with existing file returns preview status");
    assert(result.dryRun === true, "preview with existing file is dry-run");
    assert(result.currentState !== null, "preview with existing file has currentState");
    assert(result.currentState.state === "green", "preview currentState.state is green");
    assert(result.currentState.capturedAt === "2026-05-12T00:00:00.000Z", "preview currentState.capturedAt matches");
    assert(result.requestedState === "red", "preview requestedState is red");
  } finally {
    cleanup(dir);
  }
})();

// Preview passes through checks
(function () {
  var dir = setupTmpDir();
  var scriptPath = writeMockScript(dir);
  var healthPath = path.join(dir, "main-health.json");
  try {
    var result = mod.preview({
      state: "yellow",
      checks: ["tsc", "build", "prisma"],
      failedChecks: ["prisma"],
      _healthPath: healthPath,
      _scriptPath: scriptPath,
    });
    assertDeepEqual(result.checks, ["tsc", "build", "prisma"], "preview passes through checks");
    assertDeepEqual(result.failedChecks, ["prisma"], "preview passes through failedChecks");
  } finally {
    cleanup(dir);
  }
})();

// Preview passes through reason
(function () {
  var dir = setupTmpDir();
  var scriptPath = writeMockScript(dir);
  var healthPath = path.join(dir, "main-health.json");
  try {
    var result = mod.preview({
      state: "red",
      reason: "Prisma schema drift detected",
      _healthPath: healthPath,
      _scriptPath: scriptPath,
    });
    assert(result.reason === "Prisma schema drift detected", "preview passes through reason");
  } finally {
    cleanup(dir);
  }
})();

// Preview passes through allowedWorkerClasses
(function () {
  var dir = setupTmpDir();
  var scriptPath = writeMockScript(dir);
  var healthPath = path.join(dir, "main-health.json");
  try {
    var result = mod.preview({
      state: "yellow",
      allowedWorkerClasses: ["fix-only", "docs"],
      _healthPath: healthPath,
      _scriptPath: scriptPath,
    });
    assertDeepEqual(result.allowedWorkerClasses, ["fix-only", "docs"], "preview passes through allowedWorkerClasses");
  } finally {
    cleanup(dir);
  }
})();

// Preview defaults missing optional arrays to empty
(function () {
  var dir = setupTmpDir();
  var scriptPath = writeMockScript(dir);
  var healthPath = path.join(dir, "main-health.json");
  try {
    var result = mod.preview({ state: "green", _healthPath: healthPath, _scriptPath: scriptPath });
    assertDeepEqual(result.checks, [], "preview defaults checks to empty array");
    assertDeepEqual(result.failedChecks, [], "preview defaults failedChecks to empty array");
    assert(result.reason === null, "preview defaults reason to null");
  } finally {
    cleanup(dir);
  }
})();

// --- Preview has no side effects ---------------------------------------------

console.log("\nPreview has no side effects\n");

(function () {
  var dir = setupTmpDir();
  var scriptPath = writeMockScript(dir);
  var marker = makeHealthMarker({ state: "green" });
  var healthPath = writeHealthFile(dir, marker);
  try {
    var before = fs.readFileSync(healthPath, "utf-8");

    mod.preview({ state: "red", _healthPath: healthPath, _scriptPath: scriptPath });
    mod.preview({ state: "black", checks: ["tsc"], failedChecks: ["tsc"], _healthPath: healthPath, _scriptPath: scriptPath });

    var after = fs.readFileSync(healthPath, "utf-8");
    assert(before === after, "preview calls do not modify health file");
  } finally {
    cleanup(dir);
  }
})();

// --- Execute behavior --------------------------------------------------------

console.log("\nExecute behavior\n");

// Execute writes marker
(function () {
  var dir = setupTmpDir();
  var scriptPath = writeMockScript(dir);
  var healthPath = path.join(dir, "main-health.json");
  try {
    var result = mod.execute({
      state: "yellow",
      commitSha: "abcdef1234567890abcdef1234567890abcdef12",
      checks: ["tsc", "build", "prisma"],
      failedChecks: ["prisma"],
      reason: "Prisma schema drift",
      _healthPath: healthPath,
      _scriptPath: scriptPath,
    });
    assert(result.status === "written", "execute returns written status");
    assert(result.dryRun === false, "execute is not dry-run");
    assert(result.marker !== null, "execute returns marker");
    assert(result.marker.state === "yellow", "execute marker state is yellow");
    assert(result.marker.commitSha === "abcdef12", "execute marker commitSha is truncated to 8 chars");
    assert(Array.isArray(result.marker.checks), "execute marker has checks array");
    assertDeepEqual(result.marker.checks, ["tsc", "build", "prisma"], "execute marker checks match");
    assertDeepEqual(result.marker.failedChecks, ["prisma"], "execute marker failedChecks match");

    // Verify file was actually written
    assert(fs.existsSync(healthPath), "execute creates health file");
    var writtenRaw = fs.readFileSync(healthPath, "utf-8");
    if (writtenRaw.charCodeAt(0) === 0xFEFF) writtenRaw = writtenRaw.slice(1);
    var written = JSON.parse(writtenRaw);
    assert(written.state === "yellow", "written file state is yellow");
    assert(written.markerVersion === 1, "written file markerVersion is 1");
  } finally {
    cleanup(dir);
  }
})();

// Execute overwrites existing marker
(function () {
  var dir = setupTmpDir();
  var scriptPath = writeMockScript(dir);
  var marker = makeHealthMarker({ state: "green" });
  var healthPath = writeHealthFile(dir, marker);
  try {
    var result = mod.execute({
      state: "red",
      checks: ["tsc"],
      failedChecks: ["tsc"],
      reason: "Build broken",
      _healthPath: healthPath,
      _scriptPath: scriptPath,
    });
    assert(result.status === "written", "execute overwrites returns written status");
    assert(result.marker.state === "red", "execute overwrites marker state to red");

    var writtenRaw2 = fs.readFileSync(healthPath, "utf-8");
    if (writtenRaw2.charCodeAt(0) === 0xFEFF) writtenRaw2 = writtenRaw2.slice(1);
    var written2 = JSON.parse(writtenRaw2);
    assert(written2.state === "red", "overwritten file state is red");
  } finally {
    cleanup(dir);
  }
})();

// Execute with minimal payload (only required fields)
(function () {
  var dir = setupTmpDir();
  var scriptPath = writeMockScript(dir);
  var healthPath = path.join(dir, "main-health.json");
  try {
    var result = mod.execute({ state: "green", _healthPath: healthPath, _scriptPath: scriptPath });
    assert(result.status === "written", "execute minimal payload returns written");
    assert(result.marker.state === "green", "execute minimal payload marker state is green");
  } finally {
    cleanup(dir);
  }
})();

// --- Script failure handling -------------------------------------------------

console.log("\nScript failure handling\n");

(function () {
  var dir = setupTmpDir();
  // Write a script that exits with code 1
  var failScript = path.join(dir, "fail-script.ps1");
  fs.writeFileSync(failScript, "Write-Error 'intentional failure'\nexit 1\n", "utf-8");
  var healthPath = path.join(dir, "main-health.json");
  try {
    var result = mod.execute({ state: "green", _healthPath: healthPath, _scriptPath: failScript });
    assert(result.status === "error", "script failure returns error status");
    assert(typeof result.error === "string", "script failure includes error string");
    assert(result.requestedState === "green", "script failure includes requestedState");
  } finally {
    cleanup(dir);
  }
})();

// --- Source hygiene ----------------------------------------------------------

console.log("\nSource hygiene\n");

(function () {
  var modSource = fs.readFileSync(path.join(__dirname, "health-state.js"), "utf-8");
  assert(!/sk-ant-|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9_]+/.test(modSource), "module source contains no literal token patterns");
  assert(!modSource.includes(".env"), "module source does not reference .env directly");
  assert(!modSource.includes("password"), "module source does not contain password");
  assert(!modSource.includes("secret"), "module source does not contain secret");
  assert(!modSource.includes("apikey"), "module source does not contain apikey");
})();

// --- Validation message content ----------------------------------------------

console.log("\nValidation message content\n");

(function () {
  var dir = setupTmpDir();
  var scriptPath = writeMockScript(dir);
  var healthPath = path.join(dir, "main-health.json");
  try {
    var result = mod.preview({ state: "red", _healthPath: healthPath, _scriptPath: scriptPath });
    assert(result.message.includes("red"), "preview success message mentions target state");
    assert(result.message.includes("confirm:true"), "preview success message mentions confirm:true");
  } finally {
    cleanup(dir);
  }
})();

// --- Summary -----------------------------------------------------------------

console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);

} // end require.main === module
