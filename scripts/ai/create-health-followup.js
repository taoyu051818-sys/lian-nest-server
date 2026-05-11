#!/usr/bin/env node
"use strict";

/**
 * create-health-followup.js
 *
 * Generates dry-run output for health follow-up issues based on classified
 * health failures from the main-health marker. This is a skeleton — live
 * issue creation is NOT wired into validation.
 *
 * Usage:
 *   node scripts/ai/create-health-followup.js [--dry-run] [--help]
 *   node scripts/ai/create-health-followup.js --state-file .github/ai-state/main-health.json
 *
 * Exit codes:
 *   0 — Success (dry-run output printed or no failures to report)
 *   1 — Error (missing state file, invalid JSON, etc.)
 *   2 — Invalid arguments
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FAILURE_CATEGORIES = {
  "runtime compile": {
    severity: "critical",
    recoveryWorkerType: "foundation-fix",
    template: "Fix runtime compilation failure: {reason}",
  },
  "dependency/generate": {
    severity: "critical",
    recoveryWorkerType: "foundation-fix",
    template: "Resolve dependency/generate failure: {reason}",
  },
  "database foundation": {
    severity: "critical",
    recoveryWorkerType: "foundation-fix",
    template: "Fix database foundation issue: {reason}",
  },
  "conflict refresh": {
    severity: "critical",
    recoveryWorkerType: "foundation-fix",
    template: "Resolve merge conflict refresh: {reason}",
  },
  "boundary guard": {
    severity: "warning",
    recoveryWorkerType: "docs",
    template: "Fix boundary guard violation: {reason}",
  },
  "test env": {
    severity: "warning",
    recoveryWorkerType: "test-only",
    template: "Fix test environment issue: {reason}",
  },
};

// Maps health gate check names (as stored in main-health.json failedChecks)
// to failure categories. The health gate runs checks like "tsc", "build",
// "prisma", "test:boundary", "test" and classifies them into the categories
// above. This mapping lets the follow-up creator resolve check names when the
// state marker doesn't include explicit failureCategories.
const CHECK_TO_CATEGORY = {
  tsc: "runtime compile",
  build: "runtime compile",
  prisma: "database foundation",
  "test:boundary": "boundary guard",
  test: "test env",
};

const DEFAULT_STATE_FILE = path.join(
  process.cwd(),
  ".github",
  "ai-state",
  "main-health.json"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitize(text) {
  if (!text) return "(no detail)";
  return text
    .replace(/[A-Za-z0-9+/=]{40,}/g, "[redacted-token]")
    .replace(/ghp_[A-Za-z0-9]+/g, "[redacted-gh-token]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/password[=:]\s*\S+/gi, "password=[redacted]")
    .replace(/secret[=:]\s*\S+/gi, "secret=[redacted]")
    .replace(/token[=:]\s*\S+/gi, "token=[redacted]")
    .slice(0, 200);
}

function parseArgs(argv) {
  const args = {
    dryRun: true,
    help: false,
    stateFile: DEFAULT_STATE_FILE,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--live":
        args.dryRun = false;
        break;
      case "--state-file":
        i++;
        if (i >= argv.length) {
          console.error("[fail] --state-file requires a value");
          process.exit(2);
        }
        args.stateFile = path.resolve(argv[i]);
        break;
      default:
        console.error(`[fail] Unknown argument: ${arg}`);
        process.exit(2);
    }
  }

  return args;
}

function printHelp() {
  const help = `
create-health-followup.js — Health follow-up issue creator (dry-run skeleton)

USAGE
  node scripts/ai/create-health-followup.js [OPTIONS]

OPTIONS
  --dry-run           Print issue proposals without creating them (default)
  --live              Actually create GitHub issues (NOT available in validation)
  --state-file PATH   Path to main-health.json marker (default: .github/ai-state/main-health.json)
  --help, -h          Show this help message

DESCRIPTION
  Reads the main health state marker and generates follow-up issue proposals
  for classified health failures. Each failure category maps to a recovery
  worker type and issue template.

  In dry-run mode (default), outputs structured JSON showing what issues
  would be created. No GitHub API calls are made.

FAILURE CATEGORIES
  runtime compile      — Build or compilation errors (critical)
  dependency/generate  — Missing/stale dependencies (critical)
  database foundation  — Prisma schema/migration issues (critical)
  conflict refresh     — TypeScript conflicts after merge (critical)
  boundary guard       — Repository boundary violations (warning)
  test env             — Test failures or missing env vars (warning)

EXIT CODES
  0 — Success
  1 — Error (missing state file, invalid JSON)
  2 — Invalid arguments

EXAMPLES
  # Dry-run from default state file
  node scripts/ai/create-health-followup.js

  # Dry-run from custom state file
  node scripts/ai/create-health-followup.js --state-file ./tmp/health.json
`.trim();

  console.log(help);
}

function loadState(stateFile) {
  if (!fs.existsSync(stateFile)) {
    console.error(`[fail] Health state file not found: ${stateFile}`);
    console.error(
      "       Run write-main-health-state.ps1 first to create the marker."
    );
    process.exit(1);
  }

  let raw;
  try {
    raw = fs.readFileSync(stateFile, "utf8");
  } catch (err) {
    console.error(`[fail] Cannot read state file: ${err.message}`);
    process.exit(1);
  }

  let state;
  try {
    state = JSON.parse(raw);
  } catch (err) {
    console.error(`[fail] Invalid JSON in state file: ${err.message}`);
    process.exit(1);
  }

  return state;
}

function resolveCategory(check, state) {
  // Prefer explicit failureCategories from the state marker if present
  const explicit = (state.failureCategories || []).find(
    (fc) => fc.check === check
  );
  if (explicit && FAILURE_CATEGORIES[explicit.category]) {
    return explicit.category;
  }
  // Fall back to check-name mapping
  return CHECK_TO_CATEGORY[check] || null;
}

function classifyFailures(state) {
  const failed = state.failedChecks || [];
  const reason = sanitize(state.reason);

  return failed.map((check) => {
    const categoryName = resolveCategory(check, state);
    const category = categoryName ? FAILURE_CATEGORIES[categoryName] : null;
    const fallback = {
      severity: "unknown",
      recoveryWorkerType: "foundation-fix",
      template: "Investigate health failure ({check}): {reason}",
    };
    const resolved = category || fallback;

    return {
      check,
      category: categoryName || "unclassified",
      severity: resolved.severity,
      recoveryWorkerType: resolved.recoveryWorkerType,
      title: resolved.template
        .replace("{check}", check)
        .replace("{reason}", reason),
      reason,
    };
  });
}

function buildIssueProposals(state, classifications) {
  const commitShort = (state.commitSha || "unknown").slice(0, 8);
  const capturedAt = state.capturedAt || new Date().toISOString();

  return classifications.map((c) => ({
    title: `[health-recovery] ${c.title}`,
    category: c.category,
    labels: [
      "ai-native",
      "type:infra",
      `severity:${c.severity}`,
      "agent:queued",
    ],
    body: [
      "## Goal",
      `Recover from health gate failure: \`${c.check}\` (category: ${c.category})`,
      "",
      "## Context",
      `- **Health state:** ${state.state}`,
      `- **Commit:** ${commitShort}`,
      `- **Captured at:** ${capturedAt}`,
      `- **Failed check:** ${c.check}`,
      `- **Failure category:** ${c.category}`,
      `- **Severity:** ${c.severity}`,
      `- **Reason:** ${c.reason}`,
      "",
      "## Scope",
      `- Fix the \`${c.check}\` failure to restore main to green/yellow.`,
      `- Recovery worker type: \`${c.recoveryWorkerType}\``,
      "",
      "## Acceptance",
      "- [ ] Health gate passes after fix",
      "- [ ] No new failures introduced",
      "- [ ] Health state returns to green or yellow",
      "",
      "## Constraints",
      "- Do not modify unrelated files",
      "- Follow allowed-files boundaries for the recovery worker type",
    ].join("\n"),
    recoveryWorkerType: c.recoveryWorkerType,
    severity: c.severity,
  }));
}

function printDryRun(state, proposals) {
  console.log("=".repeat(50));
  console.log("HEALTH FOLLOW-UP ISSUE CREATOR — DRY RUN");
  console.log("=".repeat(50));
  console.log();
  console.log(`Health state: ${state.state}`);
  console.log(`Commit:       ${(state.commitSha || "unknown").slice(0, 8)}`);
  console.log(
    `Failed checks: ${(state.failedChecks || []).join(", ") || "(none)"}`
  );
  console.log();

  if (proposals.length === 0) {
    console.log("[ok] No failures to report. Main is healthy.");
    return;
  }

  console.log(`Would create ${proposals.length} follow-up issue(s):`);
  console.log();

  proposals.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.title}`);
    console.log(`      Category: ${p.category}`);
    console.log(`      Labels: ${p.labels.join(", ")}`);
    console.log(`      Recovery worker: ${p.recoveryWorkerType}`);
    console.log(`      Severity: ${p.severity}`);
    console.log();
  });

  console.log("-".repeat(50));
  console.log("DRY RUN — No issues were created.");
  console.log("Use --live to create issues (not available in validation).");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.dryRun) {
    console.error("[fail] Live issue creation is not available in validation.");
    console.error("       Use --dry-run (default) to preview issue proposals.");
    process.exit(1);
  }

  const state = loadState(args.stateFile);
  const classifications = classifyFailures(state);
  const proposals = buildIssueProposals(state, classifications);

  printDryRun(state, proposals);
  process.exit(0);
}

main();
