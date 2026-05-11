#!/usr/bin/env node
/**
 * Merge Queue Assistant
 *
 * Lists eligible PRs and prints copyable `gh pr merge` commands (dry-run default).
 * Use --execute to actually merge (stops on first failure).
 */

const { execSync } = require("child_process");

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`merge-queue-assistant — controlled merge queue helper

Usage:
  node scripts/merge-queue-assistant.js [options]

Options:
  --repo OWNER/NAME   Target repository (required unless MERGE_QUEUE_REPO env is set)
  --dry-run           List eligible PRs and print merge commands (DEFAULT)
  --execute           Actually merge eligible PRs (stops on first failure)
  --help              Show this help message

Environment:
  MERGE_QUEUE_REPO    Default value for --repo

Examples:
  node scripts/merge-queue-assistant.js --repo owner/name --dry-run
  node scripts/merge-queue-assistant.js --repo owner/name --execute

Notes:
  - Dry-run is the default mode. No merges happen unless --execute is passed.
  - Draft PRs, PRs with merge conflicts, and PRs requesting changes are excluded.
  - In --execute mode, the assistant prints the merge plan first, then merges
    sequentially. It stops on the first failure.`);
}

function parseArgs(argv) {
  const args = { repo: null, dryRun: true, execute: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
      args.execute = false;
    } else if (arg === "--execute") {
      args.execute = true;
      args.dryRun = false;
    } else if (arg === "--repo") {
      i++;
      if (i >= argv.length) {
        console.error("Error: --repo requires a value (OWNER/NAME)");
        process.exit(1);
      }
      args.repo = argv[i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  // Fallback to env
  if (!args.repo) {
    args.repo = process.env.MERGE_QUEUE_REPO || null;
  }

  return args;
}

// ---------------------------------------------------------------------------
// GitHub CLI helpers
// ---------------------------------------------------------------------------

function runGh(args, { allowFailure = false } = {}) {
  try {
    const result = execSync(`gh ${args}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });
    return result.trim();
  } catch (err) {
    if (allowFailure) return null;
    throw err;
  }
}

function listOpenPRs(repo) {
  const json = runGh(
    `pr list --repo ${repo} --state open --json number,title,author,isDraft,mergeable,statusCheckRollup,reviewDecision,labels,headRefName`
  );
  return JSON.parse(json);
}

// ---------------------------------------------------------------------------
// Eligibility filtering
// ---------------------------------------------------------------------------

const BLOCKER_DECISIONS = new Set(["CHANGES_REQUESTED"]);
const BLOCKER_CHECK_STATES = new Set(["FAILURE", "CANCELLED"]);
const DIRTY_MERGEABLE = new Set(["DIRTY", "UNKNOWN", "CONFLICTING"]);

function classifyPR(pr) {
  const reasons = [];

  if (pr.isDraft) {
    reasons.push("draft");
  }

  if (DIRTY_MERGEABLE.has(pr.mergeable)) {
    reasons.push(`mergeable=${pr.mergeable}`);
  }

  if (BLOCKER_DECISIONS.has(pr.reviewDecision)) {
    reasons.push(`reviewDecision=${pr.reviewDecision}`);
  }

  // Check individual review states for changes-requested
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    reasons.push("changes-requested");
  }

  // Check status checks
  if (Array.isArray(pr.statusCheckRollup)) {
    for (const check of pr.statusCheckRollup) {
      if (BLOCKER_CHECK_STATES.has(check.state)) {
        reasons.push(`check-failed: ${check.name || check.context || check.state}`);
        break; // one failure is enough
      }
    }
  }

  // Check labels for blocker indicators
  if (Array.isArray(pr.labels)) {
    for (const label of pr.labels) {
      const name = (label.name || "").toLowerCase();
      if (
        name.includes("blocked") ||
        name.includes("blocker") ||
        name.includes("do-not-merge") ||
        name.includes("wip")
      ) {
        reasons.push(`label: ${label.name}`);
        break;
      }
    }
  }

  return reasons;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function printBanner(text) {
  const line = "=".repeat(72);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(`${line}\n`);
}

function printEligiblePR(pr, repo) {
  const cmd = `gh pr merge ${pr.number} --repo ${repo} --squash --delete-branch`;
  console.log(`  #${pr.number}  ${pr.title}`);
  console.log(`         author: ${pr.author?.login || "?"}  branch: ${pr.headRefName || "?"}`);
  console.log(`         $ ${cmd}`);
  console.log();
}

function printExcludedPR(pr, reasons) {
  console.log(`  #${pr.number}  ${pr.title}`);
  console.log(`         EXCLUDED: ${reasons.join(", ")}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Execute mode
// ---------------------------------------------------------------------------

function executeMerges(eligiblePRs, repo) {
  printBanner("EXECUTING MERGES");
  console.log(`Merging ${eligiblePRs.length} PR(s) into ${repo}...\n`);

  for (const pr of eligiblePRs) {
    const cmd = `gh pr merge ${pr.number} --repo ${repo} --squash --delete-branch`;
    console.log(`>> Merging #${pr.number} — ${pr.title}`);
    console.log(`   $ ${cmd}`);

    try {
      const output = runGh(`pr merge ${pr.number} --repo ${repo} --squash --delete-branch`);
      console.log(`   OK: ${output || "merged"}`);
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
      console.error(`   FAILED: ${stderr}`);
      console.error(`\nStopping — merge queue aborted after failure on PR #${pr.number}.`);
      process.exit(1);
    }
    console.log();
  }

  console.log(`All ${eligiblePRs.length} PR(s) merged successfully.`);
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

  if (!args.repo) {
    console.error("Error: --repo is required (or set MERGE_QUEUE_REPO env var).\n");
    printHelp();
    process.exit(1);
  }

  const repo = args.repo;
  const modeLabel = args.execute ? "EXECUTE" : "DRY-RUN";

  printBanner(`Merge Queue Assistant — ${modeLabel}`);
  console.log(`  Repository : ${repo}`);
  console.log(`  Mode       : ${modeLabel}`);
  if (args.execute) {
    console.log(`  WARNING    : --execute mode will perform real merges!`);
  }
  console.log();

  // Fetch PRs
  let prs;
  try {
    prs = listOpenPRs(repo);
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : err.message;
    console.error(`Failed to list PRs for ${repo}:\n${stderr}`);
    process.exit(1);
  }

  if (!prs.length) {
    console.log("No open PRs found.\n");
    process.exit(0);
  }

  // Classify
  const eligible = [];
  const excluded = [];

  for (const pr of prs) {
    const reasons = classifyPR(pr);
    if (reasons.length === 0) {
      eligible.push(pr);
    } else {
      excluded.push({ pr, reasons });
    }
  }

  // Print excluded
  if (excluded.length > 0) {
    printBanner(`Excluded PRs (${excluded.length})`);
    for (const { pr, reasons } of excluded) {
      printExcludedPR(pr, reasons);
    }
  }

  // Print eligible
  if (eligible.length > 0) {
    printBanner(`Eligible PRs (${eligible.length})`);
    for (const pr of eligible) {
      printEligiblePR(pr, repo);
    }

    if (args.execute) {
      executeMerges(eligible, repo);
    } else {
      console.log("DRY-RUN — no merges performed. Use --execute to merge.\n");
    }
  } else {
    printBanner("No Eligible PRs");
    console.log("All open PRs are excluded from merging.\n");
  }
}

// Export for testing
if (require.main === module) {
  main();
} else {
  module.exports = { parseArgs, classifyPR, printHelp };
}
