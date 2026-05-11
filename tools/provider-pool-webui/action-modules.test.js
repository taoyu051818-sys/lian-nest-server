#!/usr/bin/env node

/**
 * action-modules.test.js
 *
 * Tests for WebUI action modules (merge-prs).
 * No external test framework — uses a simple assert helper.
 * Does NOT perform real merges; validates module shape and
 * payload validation only.
 *
 * Run: node tools/provider-pool-webui/action-modules.test.js
 */

const path = require("path");
const fs = require("fs");

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

// --- Module loading ---------------------------------------------------------

console.log("\nModule loading\n");

const ACTIONS_DIR = path.resolve(__dirname, "actions");

assert(fs.existsSync(ACTIONS_DIR), "actions/ directory exists");

const mergePrsPath = path.join(ACTIONS_DIR, "merge-prs.js");
assert(fs.existsSync(mergePrsPath), "actions/merge-prs.js exists");

const mergePrs = require(mergePrsPath);

// --- Module shape -----------------------------------------------------------

console.log("\nModule shape\n");

assert(typeof mergePrs.id === "string", "module exports id as string");
assert(mergePrs.id === "merge-prs", "module id is 'merge-prs'");
assert(typeof mergePrs.label === "string", "module exports label as string");
assert(mergePrs.label === "Merge PRs", "label is 'Merge PRs'");
assert(
  typeof mergePrs.description === "string",
  "module exports description as string"
);
assert(
  mergePrs.description.length > 0,
  "description is non-empty"
);
assert(
  mergePrs.dangerous === true,
  "module is marked dangerous (requires confirm:true)"
);
assert(
  typeof mergePrs.preview === "function",
  "module exports preview function"
);
assert(
  typeof mergePrs.execute === "function",
  "module exports execute function"
);

// --- Payload validation: preview --------------------------------------------

console.log("\nPayload validation (preview)\n");

{
  let threw = false;
  try {
    mergePrs.preview(null);
  } catch (e) {
    threw = true;
    assert(
      e.message.includes("Payload must be an object"),
      "preview(null) throws 'Payload must be an object'"
    );
  }
  assert(threw, "preview(null) throws");
}

{
  let threw = false;
  try {
    mergePrs.preview({});
  } catch (e) {
    threw = true;
    assert(
      e.message.includes("prNumbers"),
      "preview({}) throws about prNumbers"
    );
  }
  assert(threw, "preview({}) throws");
}

{
  let threw = false;
  try {
    mergePrs.preview({ prNumbers: [] });
  } catch (e) {
    threw = true;
    assert(
      e.message.includes("non-empty"),
      "preview with empty prNumbers throws about non-empty"
    );
  }
  assert(threw, "preview with empty prNumbers throws");
}

{
  let threw = false;
  try {
    mergePrs.preview({ prNumbers: ["abc"] });
  } catch (e) {
    threw = true;
    assert(
      e.message.includes("positive integer"),
      "preview with string PR throws about positive integer"
    );
  }
  assert(threw, "preview with string PR throws");
}

{
  let threw = false;
  try {
    mergePrs.preview({ prNumbers: [-1] });
  } catch (e) {
    threw = true;
    assert(
      e.message.includes("positive integer"),
      "preview with negative PR throws about positive integer"
    );
  }
  assert(threw, "preview with negative PR throws");
}

{
  let threw = false;
  try {
    mergePrs.preview({ prNumbers: [1.5] });
  } catch (e) {
    threw = true;
    assert(
      e.message.includes("positive integer"),
      "preview with float PR throws about positive integer"
    );
  }
  assert(threw, "preview with float PR throws");
}

// --- Payload validation: execute --------------------------------------------

console.log("\nPayload validation (execute)\n");

{
  let threw = false;
  try {
    mergePrs.execute(null);
  } catch (e) {
    threw = true;
    assert(
      e.message.includes("Payload must be an object"),
      "execute(null) throws 'Payload must be an object'"
    );
  }
  assert(threw, "execute(null) throws");
}

{
  let threw = false;
  try {
    mergePrs.execute({});
  } catch (e) {
    threw = true;
    assert(
      e.message.includes("prNumbers"),
      "execute({}) throws about prNumbers"
    );
  }
  assert(threw, "execute({}) throws");
}

{
  let threw = false;
  try {
    mergePrs.execute({ prNumbers: [42] });
  } catch (e) {
    threw = true;
    // Should throw about missing repo (no payload.repo and no GH_REPO env)
    assert(
      e.message.includes("Repository") || e.message.includes("repo"),
      "execute with valid PRs but no repo throws about repository"
    );
  }
  assert(threw, "execute with valid PRs but no repo throws");
}

// --- Repo validation --------------------------------------------------------

console.log("\nRepo validation\n");

{
  let threw = false;
  try {
    mergePrs.preview({ prNumbers: [42], repo: "not-a-valid-repo" });
  } catch (e) {
    threw = true;
    assert(
      e.message.includes("OWNER/NAME"),
      "invalid repo format throws about OWNER/NAME"
    );
  }
  assert(threw, "invalid repo format throws");
}

{
  let threw = false;
  try {
    mergePrs.preview({ prNumbers: [42], repo: "" });
  } catch (e) {
    threw = true;
    assert(
      e.message.includes("Repository not specified"),
      "empty repo throws about not specified"
    );
  }
  assert(threw, "empty repo throws");
}

// --- Module integration with server loading ---------------------------------

console.log("\nServer integration\n");

// Simulate how server.js loads modules
const serverPath = path.resolve(__dirname, "server.js");
assert(fs.existsSync(serverPath), "server.js exists for integration reference");

// Verify the module would be accepted by loadActionModules validation
assert(
  typeof mergePrs.id === "string" && typeof mergePrs.label === "string",
  "module passes server loadActionModules shape check"
);

// Verify dangerous flag is coerced correctly (server does !!mod.dangerous)
assert(
  !!mergePrs.dangerous === true,
  "module dangerous flag coerces to true"
);

// --- No secrets in module ---------------------------------------------------

console.log("\nNo secrets in module\n");

const moduleSource = fs.readFileSync(mergePrsPath, "utf-8");
assert(
  !/sk-ant-/.test(moduleSource),
  "module source contains no API key patterns"
);
assert(
  !/ghp_/.test(moduleSource),
  "module source contains no GitHub token patterns"
);
assert(
  !/process\.env\.(?!GH_REPO)/.test(moduleSource),
  "module only reads GH_REPO from env (no secret env vars)"
);

// --- No raw stdout/stderr in module ----------------------------------------

console.log("\nNo raw stdout/stderr exposure\n");

// The module should never return raw stderr to the caller
assert(
  !moduleSource.includes("err.stderr"),
  "module does not expose raw stderr"
);
// The module sanitizes stdout through extractManifest only
assert(
  moduleSource.includes("extractManifest"),
  "module uses extractManifest to sanitize output"
);

// --- Summary ----------------------------------------------------------------

console.log("\n" + passed + " passed, " + failed + " failed\n");
process.exit(failed > 0 ? 1 : 0);
