#!/usr/bin/env node

/**
 * action-runner.test.js
 *
 * Tests for the safe action runner module.
 * Self-contained, no external test framework.
 *
 * Run: node tools/provider-pool-webui/action-runner.test.js
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { ALLOWED_ACTIONS, runAction, applyChanges, sanitizeParams } = require("./lib/action-runner");

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log("  PASS  " + name);
  } else {
    failed++;
    console.error("  FAIL  " + name);
  }
}

// --- Fixtures ----------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "action-runner-test-"));
}

function fixtureState(overrides) {
  const base = {
    stateVersion: 1,
    providers: [
      {
        id: "provider-default",
        status: "available",
        currentConcurrency: 0,
        maxConcurrency: 1,
        cooldownExpiresAt: null,
        consecutiveFailures: 0,
        lastFailureClass: null,
      },
    ],
    global: {
      globalMaxWorkers: 3,
      totalActiveWorkers: 0,
      capturedAt: "2026-05-11T12:00:00Z",
    },
  };
  if (!overrides) return base;
  return JSON.parse(JSON.stringify({ ...base, ...overrides }));
}

function writeFixtureState(dir, state) {
  const p = path.join(dir, "provider-pool.json");
  fs.writeFileSync(p, JSON.stringify(state, null, 2), "utf-8");
  return p;
}

function readFixtureState(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function readAuditLines(filePath) {
  try {
    return fs
      .readFileSync(filePath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

// --- Allowlist tests ---------------------------------------------------------

console.log("\naction-runner allowlist tests\n");

(async () => {
  {
    assert(ALLOWED_ACTIONS.size === 5, "allowlist has 5 actions");
    assert(ALLOWED_ACTIONS.has("disable-provider"), "allows disable-provider");
    assert(ALLOWED_ACTIONS.has("enable-provider"), "allows enable-provider");
    assert(ALLOWED_ACTIONS.has("reset-cooldown"), "allows reset-cooldown");
    assert(ALLOWED_ACTIONS.has("adjust-max-concurrency"), "allows adjust-max-concurrency");
    assert(ALLOWED_ACTIONS.has("adjust-global-max-workers"), "allows adjust-global-max-workers");
  }

  {
    const res = await runAction("set-secret", { params: {} });
    assert(res.ok === false, "rejects forbidden action set-secret");
    assert(res.mode === "rejected", "set-secret mode is rejected");
    assert(res.error.includes("not allowlisted"), "error mentions allowlist");
  }

  {
    const res = await runAction("add-provider", { params: {} });
    assert(res.ok === false, "rejects forbidden action add-provider");
  }

  {
    const res = await runAction("rm -rf /", { params: {} });
    assert(res.ok === false, "rejects arbitrary action");
  }

  // --- Default dry-run mode --------------------------------------------------

  console.log("\ndry-run / preview mode tests\n");

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const auditPath = path.join(dir, "audit.ndjson");
    const res = await runAction("disable-provider", {
      params: { providerId: "provider-default" },
      statePath,
      auditPath,
    });
    assert(res.ok === true, "disable-provider preview ok");
    assert(res.mode === "preview", "default mode is preview");
    assert(res.changes.length === 1, "preview has 1 change");
    assert(res.changes[0].field === "status", "change targets status");
    assert(res.changes[0].to === "disabled", "change would set disabled");
    assert(typeof res.summary === "string", "summary is a string");
    assert(!res.summary.includes("secret"), "summary has no secrets");
    // State file should NOT be modified
    const after = readFixtureState(statePath);
    assert(after.providers[0].status === "available", "state unchanged in preview");
    // Audit file should NOT exist (no writes in preview)
    assert(!fs.existsSync(auditPath), "no audit file in preview mode");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Execute mode ----------------------------------------------------------

  console.log("\nexecute mode tests\n");

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const auditPath = path.join(dir, "audit.ndjson");
    const res = await runAction("disable-provider", {
      dryRun: false,
      confirm: true,
      params: { providerId: "provider-default" },
      statePath,
      auditPath,
      actor: "test-operator",
    });
    assert(res.ok === true, "disable-provider execute ok");
    assert(res.mode === "execute", "mode is execute");
    // State file SHOULD be modified
    const after = readFixtureState(statePath);
    assert(after.providers[0].status === "disabled", "state updated to disabled");
    // Audit file SHOULD exist
    const entries = readAuditLines(auditPath);
    assert(entries.length === 1, "audit has 1 entry");
    assert(entries[0].action === "disable-provider", "audit action matches");
    assert(entries[0].actor === "test-operator", "audit actor matches");
    assert(entries[0].mode === "execute", "audit mode is execute");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Execute mode without confirm ------------------------------------------

  console.log("\nconfirmation requirement tests\n");

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("disable-provider", {
      dryRun: false,
      params: { providerId: "provider-default" },
      statePath,
    });
    assert(res.ok === false, "execute without confirm fails");
    assert(res.mode === "confirmation-required", "mode is confirmation-required");
    const after = readFixtureState(statePath);
    assert(after.providers[0].status === "available", "state unchanged without confirm");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Param validation ------------------------------------------------------

  console.log("\nparam validation tests\n");

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("disable-provider", { statePath });
    assert(res.ok === false, "missing params fails");
    assert(res.error.includes("params"), "error mentions params");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("disable-provider", { params: {}, statePath });
    assert(res.ok === false, "missing providerId fails");
    assert(res.error.includes("providerId"), "error mentions providerId");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("adjust-max-concurrency", {
      params: { providerId: "provider-default" },
      statePath,
    });
    assert(res.ok === false, "missing value for adjust-max-concurrency fails");
    assert(res.error.includes("value"), "error mentions value");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Action: enable-provider -----------------------------------------------

  console.log("\nenable-provider tests\n");

  {
    const dir = tmpDir();
    const state = fixtureState();
    state.providers[0].status = "disabled";
    const statePath = writeFixtureState(dir, state);
    const res = await runAction("enable-provider", {
      params: { providerId: "provider-default" },
      statePath,
    });
    assert(res.ok === true, "enable disabled provider preview ok");
    assert(res.changes[0].to === "available", "would set to available");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("enable-provider", {
      params: { providerId: "provider-default" },
      statePath,
    });
    assert(res.ok === false, "enable already-available provider fails");
    assert(res.error.includes("not disabled"), "error explains provider is not disabled");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Action: reset-cooldown ------------------------------------------------

  console.log("\nreset-cooldown tests\n");

  {
    const dir = tmpDir();
    const state = fixtureState();
    state.providers[0].cooldownExpiresAt = "2026-05-11T15:00:00Z";
    state.providers[0].status = "exhausted";
    const statePath = writeFixtureState(dir, state);
    const res = await runAction("reset-cooldown", {
      params: { providerId: "provider-default" },
      statePath,
    });
    assert(res.ok === true, "reset active cooldown preview ok");
    assert(res.changes.length === 2, "cooldown reset has 2 changes");
    assert(res.changes[0].field === "cooldownExpiresAt", "clears cooldownExpiresAt");
    assert(res.changes[0].to === null, "cooldownExpiresAt set to null");
    assert(res.changes[1].field === "status", "also resets status");
    assert(res.changes[1].to === "available", "status set to available");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("reset-cooldown", {
      params: { providerId: "provider-default" },
      statePath,
    });
    assert(res.ok === false, "reset cooldown when none active fails");
    assert(res.error.includes("no active cooldown"), "error explains no cooldown");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Action: adjust-max-concurrency ----------------------------------------

  console.log("\nadjust-max-concurrency tests\n");

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("adjust-max-concurrency", {
      params: { providerId: "provider-default", value: 3 },
      statePath,
    });
    assert(res.ok === true, "adjust-max-concurrency to 3 preview ok");
    assert(res.changes[0].from === 1, "from current maxConcurrency");
    assert(res.changes[0].to === 3, "to requested value");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("adjust-max-concurrency", {
      params: { providerId: "provider-default", value: 10 },
      statePath,
    });
    assert(res.ok === false, "adjust-max-concurrency exceeding globalMax fails");
    assert(res.error.includes("globalMaxWorkers"), "error mentions globalMaxWorkers");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("adjust-max-concurrency", {
      params: { providerId: "provider-default", value: 0 },
      statePath,
    });
    assert(res.ok === false, "adjust-max-concurrency to 0 fails");
    assert(res.error.includes("positive integer"), "error mentions positive integer");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("adjust-max-concurrency", {
      params: { providerId: "provider-default", value: -1 },
      statePath,
    });
    assert(res.ok === false, "adjust-max-concurrency to -1 fails");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Action: adjust-global-max-workers -------------------------------------

  console.log("\nadjust-global-max-workers tests\n");

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("adjust-global-max-workers", {
      params: { value: 5 },
      statePath,
    });
    assert(res.ok === true, "adjust-global-max-workers preview ok");
    assert(res.changes[0].field === "globalMaxWorkers", "targets globalMaxWorkers");
    assert(res.changes[0].from === 3, "from current value");
    assert(res.changes[0].to === 5, "to requested value");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("adjust-global-max-workers", {
      params: { value: 0 },
      statePath,
    });
    assert(res.ok === false, "adjust-global-max-workers to 0 fails");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Provider not found ----------------------------------------------------

  console.log("\nprovider not found tests\n");

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("disable-provider", {
      params: { providerId: "nonexistent" },
      statePath,
    });
    assert(res.ok === false, "nonexistent provider fails");
    assert(res.error.includes("not found"), "error mentions not found");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- State file missing ----------------------------------------------------

  console.log("\nstate file missing tests\n");

  {
    const res = await runAction("disable-provider", {
      params: { providerId: "provider-default" },
      statePath: "/nonexistent/path/state.json",
    });
    assert(res.ok === false, "missing state file fails");
    assert(res.error.includes("Cannot read"), "error explains cannot read state");
  }

  // --- Timeout ---------------------------------------------------------------

  console.log("\ntimeout tests\n");

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const res = await runAction("disable-provider", {
      params: { providerId: "provider-default" },
      statePath,
      timeoutMs: 1,
    });
    // With 1ms timeout, it may or may not succeed depending on speed.
    // Just verify it doesn't hang.
    assert(typeof res === "object", "1ms timeout returns result (not hang)");
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Sanitize params -------------------------------------------------------

  console.log("\nparam sanitization tests\n");

  {
    const clean = sanitizeParams({ providerId: "test", value: 3 });
    assert(clean.providerId === "test", "sanitizeParams keeps safe keys");
    assert(clean.value === 3, "sanitizeParams keeps numeric values");
  }

  {
    const clean = sanitizeParams({ secret: "abc", token: "xyz", apiKey: "123", providerId: "test" });
    assert(clean.secret === undefined, "sanitizeParams strips secret");
    assert(clean.token === undefined, "sanitizeParams strips token");
    assert(clean.apiKey === undefined, "sanitizeParams strips apiKey");
    assert(clean.providerId === "test", "sanitizeParams keeps providerId");
  }

  {
    const clean = sanitizeParams(null);
    assert(typeof clean === "object", "sanitizeParams handles null");
  }

  // --- applyChanges helper ---------------------------------------------------

  console.log("\napplyChanges tests\n");

  {
    const state = fixtureState();
    const changes = [{ target: "provider-default", field: "status", from: "available", to: "disabled" }];
    const next = applyChanges(state, changes);
    assert(next.providers[0].status === "disabled", "applyChanges sets provider field");
    assert(state.providers[0].status === "available", "applyChanges does not mutate original");
  }

  {
    const state = fixtureState();
    const changes = [{ target: "global", field: "globalMaxWorkers", from: 3, to: 10 }];
    const next = applyChanges(state, changes);
    assert(next.global.globalMaxWorkers === 10, "applyChanges sets global field");
    assert(state.global.globalMaxWorkers === 3, "applyChanges does not mutate original global");
  }

  // --- Execute mode audit trail ----------------------------------------------

  console.log("\naudit trail tests\n");

  {
    const dir = tmpDir();
    const statePath = writeFixtureState(dir, fixtureState());
    const auditPath = path.join(dir, "audit.ndjson");

    // First action
    await runAction("disable-provider", {
      dryRun: false,
      confirm: true,
      params: { providerId: "provider-default" },
      statePath,
      auditPath,
      actor: "operator-1",
    });

    // Re-enable
    await runAction("enable-provider", {
      dryRun: false,
      confirm: true,
      params: { providerId: "provider-default" },
      statePath,
      auditPath,
      actor: "operator-2",
    });

    const entries = readAuditLines(auditPath);
    assert(entries.length === 2, "audit has 2 entries after two actions");
    assert(entries[0].action === "disable-provider", "first entry is disable");
    assert(entries[1].action === "enable-provider", "second entry is enable");
    assert(entries[0].actor === "operator-1", "first actor correct");
    assert(entries[1].actor === "operator-2", "second actor correct");

    // Verify no secrets in audit
    const raw = fs.readFileSync(auditPath, "utf-8");
    assert(!raw.includes("secret"), "audit log has no secrets");
    assert(!raw.includes("token"), "audit log has no tokens");

    fs.rmSync(dir, { recursive: true, force: true });
  }

  // --- Summary ---------------------------------------------------------------

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed > 0 ? 1 : 0);
})();
