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
// Explicit allowlist — eligible PRs must pass every gate
// ---------------------------------------------------------------------------

console.log("\nexplicit allowlist — eligible cases:");

(() => {
  const reasons = classifyPR(
    makePR({ reviewDecision: "APPROVED", mergeable: "MERGEABLE" })
  );
  assert(reasons.length === 0, "APPROVED + MERGEABLE is eligible");
})();

(() => {
  const reasons = classifyPR(
    makePR({
      statusCheckRollup: [{ state: "SUCCESS", name: "ci/build" }],
    })
  );
  assert(reasons.length === 0, "passing checks do not exclude");
})();

(() => {
  const reasons = classifyPR(makePR({ statusCheckRollup: [] }));
  assert(reasons.length === 0, "empty checks array is eligible");
})();

(() => {
  const reasons = classifyPR(makePR({ labels: [] }));
  assert(reasons.length === 0, "empty labels array is eligible");
})();

(() => {
  const reasons = classifyPR(
    makePR({ labels: [{ name: "enhancement" }, { name: "ready" }] })
  );
  assert(reasons.length === 0, "non-blocker labels do not exclude");
})();

(() => {
  const reasons = classifyPR(makePR({ reviewDecision: null }));
  assert(reasons.length === 0, "null reviewDecision is eligible");
})();

(() => {
  const reasons = classifyPR(makePR({ reviewDecision: "REVIEW_REQUESTED" }));
  assert(reasons.length === 0, "REVIEW_REQUESTED is not a blocker");
})();

(() => {
  const reasons = classifyPR(
    makePR({
      statusCheckRollup: [
        { state: "SUCCESS", name: "ci/build" },
        { state: "SUCCESS", name: "ci/test" },
      ],
    })
  );
  assert(reasons.length === 0, "all-success checks are eligible");
})();

(() => {
  const reasons = classifyPR(
    makePR({
      reviewDecision: "APPROVED",
      statusCheckRollup: [{ state: "SUCCESS", name: "ci" }],
      labels: [{ name: "ready-to-merge" }],
    })
  );
  assert(reasons.length === 0, "approved + passing + non-blocker label is eligible");
})();

// ---------------------------------------------------------------------------
// Explicit allowlist — blocker label edge cases
// ---------------------------------------------------------------------------

console.log("\nexplicit allowlist — blocker label edge cases:");

(() => {
  const reasons = classifyPR(makePR({ labels: [{ name: "wip" }] }));
  assert(reasons.length === 1, "wip label excludes PR");
  assert(reasons[0].includes("wip"), "wip in reason");
})();

(() => {
  const reasons = classifyPR(makePR({ labels: [{ name: "Blocker" }] }));
  assert(reasons.length === 1, "blocker label (case-insensitive) excludes");
})();

(() => {
  const reasons = classifyPR(makePR({ labels: [{ name: "DO-NOT-MERGE" }] }));
  assert(reasons.length === 1, "DO-NOT-MERGE (uppercase) excludes");
})();

// ---------------------------------------------------------------------------
// Explicit allowlist — no implicit broad merge: PENDING checks exclude
// ---------------------------------------------------------------------------

console.log("\nexplicit allowlist — pending/unknown check states:");

(() => {
  const reasons = classifyPR(
    makePR({ statusCheckRollup: [{ state: "PENDING", name: "ci" }] })
  );
  assert(reasons.length === 0, "PENDING check does not exclude (not a blocker state)");
})();

(() => {
  const reasons = classifyPR(
    makePR({ statusCheckRollup: [{ state: "IN_PROGRESS", name: "ci" }] })
  );
  assert(reasons.length === 0, "IN_PROGRESS check does not exclude");
})();

(() => {
  const reasons = classifyPR(
    makePR({
      statusCheckRollup: [
        { state: "SUCCESS", name: "lint" },
        { state: "FAILURE", name: "deploy" },
      ],
    })
  );
  assert(reasons.length === 1, "one failure among successes excludes");
  assert(reasons[0].includes("deploy"), "failing check name reported");
})();

// ---------------------------------------------------------------------------
// Explicit allowlist — MERGEABLE states
// ---------------------------------------------------------------------------

console.log("\nexplicit allowlist — MERGEABLE states:");

(() => {
  const reasons = classifyPR(makePR({ mergeable: "MERGEABLE" }));
  assert(reasons.length === 0, "MERGEABLE state is eligible");
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
