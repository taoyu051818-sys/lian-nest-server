/**
 * Tests for merge-queue-assistant.js
 *
 * Pure-function tests only — no gh CLI calls required.
 */

const { parseArgs, classifyPR } = require("./merge-queue-assistant");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}`);
  }
}

// ---------------------------------------------------------------------------
// parseArgs tests
// ---------------------------------------------------------------------------

console.log("\nparseArgs:");

(() => {
  const args = parseArgs(["node", "script", "--repo", "owner/name"]);
  assert(args.repo === "owner/name", "--repo sets repo");
  assert(args.dryRun === true, "default is dry-run");
  assert(args.execute === false, "default is not execute");
})();

(() => {
  const args = parseArgs(["node", "script", "--repo", "o/n", "--execute"]);
  assert(args.execute === true, "--execute sets execute");
  assert(args.dryRun === false, "--execute disables dry-run");
})();

(() => {
  const args = parseArgs(["node", "script", "--repo", "o/n", "--execute", "--dry-run"]);
  assert(args.dryRun === true, "--dry-run after --execute re-enables dry-run");
  assert(args.execute === false, "--dry-run after --execute disables execute");
})();

(() => {
  const args = parseArgs(["node", "script", "--help"]);
  assert(args.help === true, "--help flag");
})();

(() => {
  const saved = process.env.MERGE_QUEUE_REPO;
  process.env.MERGE_QUEUE_REPO = "env/repo";
  const args = parseArgs(["node", "script"]);
  assert(args.repo === "env/repo", "falls back to MERGE_QUEUE_REPO env");
  process.env.MERGE_QUEUE_REPO = saved || "";
})();

// ---------------------------------------------------------------------------
// classifyPR tests
// ---------------------------------------------------------------------------

console.log("\nclassifyPR:");

function makePR(overrides = {}) {
  return {
    number: 1,
    title: "Test PR",
    author: { login: "user" },
    isDraft: false,
    mergeable: "MERGEABLE",
    reviewDecision: "APPROVED",
    statusCheckRollup: [],
    labels: [],
    headRefName: "feature",
    ...overrides,
  };
}

(() => {
  const reasons = classifyPR(makePR());
  assert(reasons.length === 0, "clean PR is eligible");
})();

(() => {
  const reasons = classifyPR(makePR({ isDraft: true }));
  assert(reasons.length === 1, "draft PR is excluded");
  assert(reasons[0] === "draft", "draft reason");
})();

(() => {
  const reasons = classifyPR(makePR({ mergeable: "DIRTY" }));
  assert(reasons.length === 1, "dirty mergeable is excluded");
  assert(reasons[0] === "mergeable=DIRTY", "dirty reason");
})();

(() => {
  const reasons = classifyPR(makePR({ mergeable: "CONFLICTING" }));
  assert(reasons.length === 1, "conflicting PR is excluded");
  assert(reasons[0] === "mergeable=CONFLICTING", "conflict reason");
})();

(() => {
  const reasons = classifyPR(makePR({ mergeable: "UNKNOWN" }));
  assert(reasons.length === 1, "unknown mergeable is excluded");
})();

(() => {
  const reasons = classifyPR(makePR({ reviewDecision: "CHANGES_REQUESTED" }));
  assert(reasons.length >= 1, "changes-requested is excluded");
})();

(() => {
  const reasons = classifyPR(
    makePR({
      statusCheckRollup: [{ state: "FAILURE", name: "ci/build" }],
    })
  );
  assert(reasons.length === 1, "failing check is excluded");
  assert(reasons[0].includes("ci/build"), "check name in reason");
})();

(() => {
  const reasons = classifyPR(
    makePR({
      statusCheckRollup: [{ state: "CANCELLED", name: "ci/test" }],
    })
  );
  assert(reasons.length === 1, "cancelled check is excluded");
})();

(() => {
  const reasons = classifyPR(
    makePR({
      labels: [{ name: "blocked" }],
    })
  );
  assert(reasons.length === 1, "blocked label excludes PR");
  assert(reasons[0].includes("blocked"), "blocked label in reason");
})();

(() => {
  const reasons = classifyPR(
    makePR({
      labels: [{ name: "do-not-merge" }],
    })
  );
  assert(reasons.length === 1, "do-not-merge label excludes PR");
})();

(() => {
  const reasons = classifyPR(
    makePR({
      labels: [{ name: "enhancement" }],
    })
  );
  assert(reasons.length === 0, "non-blocker label does not exclude");
})();

(() => {
  const reasons = classifyPR(
    makePR({
      isDraft: true,
      mergeable: "DIRTY",
      reviewDecision: "CHANGES_REQUESTED",
      labels: [{ name: "blocked" }],
      statusCheckRollup: [{ state: "FAILURE", name: "ci" }],
    })
  );
  assert(reasons.length >= 4, "multiple blockers all reported");
})();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${"=".repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(40)}\n`);

if (failed > 0) {
  process.exit(1);
}
