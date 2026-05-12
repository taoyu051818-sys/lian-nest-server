#!/usr/bin/env node

/**
 * classify-self-cycle-failure.js
 *
 * Deterministic recovery classifier for self-cycle execution failures.
 * Reads failure text (stdout+stderr) from stdin, a file, or --text argument,
 * plus an optional --step flag indicating which pipeline step failed.
 *
 * Error classes:
 *   TASK_CONTRACT_INVALID         — Task JSON missing required fields or invalid schema
 *   ISSUE_BODY_PARSE_BLEED        — Regex extraction picked up wrong content from issue body
 *   RUNNER_STRICT_MODE_VARIABLE   — PowerShell strict mode hit an uninitialized variable
 *   BATCH_SINGLE_TASK_MISMATCH    — Batch file passed where single task expected, or issue# mismatch
 *   PROVIDER_UNAVAILABLE          — All API providers exhausted, disabled, or at capacity
 *   DISK_PRESSURE                 — Disk, memory, or CPU resource pressure detected
 *   WORKTREE_STALE                — Git worktree is stale, locked, or corrupted
 *   HUMAN_REQUIRED                — Gate or policy requires human decision
 *   UNKNOWN_CONTROL_PLANE_FAILURE — No pattern matched
 *
 * Usage:
 *   node scripts/ai/classify-self-cycle-failure.js --step batch-launch < failure-output.txt
 *   node scripts/ai/classify-self-cycle-failure.js --step run-claude-print --file failure.txt
 *   node scripts/ai/classify-self-cycle-failure.js --text "error here" --step launch-gate
 *   node scripts/ai/classify-self-cycle-failure.js --help
 *
 * Exit codes:
 *   0 — classification produced
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');

// ── Error class definitions ──────────────────────────────────────────────────

const ERROR_CLASSES = {
  TASK_CONTRACT_INVALID: {
    humanSummary: 'The task JSON file is missing required fields or has invalid values.',
    likelyCause: 'compile-issue-to-task-json.ps1 produced an incomplete contract, or the task file was hand-edited.',
    recommendedAction: 'Re-compile the issue with compile-issue-to-task-json.ps1 or fix the missing fields manually.',
    safeToRetry: false,
  },
  ISSUE_BODY_PARSE_BLEED: {
    humanSummary: 'The issue body parser extracted incorrect content — likely picked up adjacent markdown sections.',
    likelyCause: 'Regex for allowedFiles/forbiddenFiles/validationCommands matched content from a different section of the issue body.',
    recommendedAction: 'Check the issue body format. Ensure CONTROL APPENDIX sections are clearly delimited.',
    safeToRetry: false,
  },
  RUNNER_STRICT_MODE_VARIABLE: {
    humanSummary: 'A PowerShell script crashed because a variable was not initialized before use under strict mode.',
    likelyCause: 'An optional task field (targetPR, attentionAreas, budgets, etc.) was accessed without a null guard.',
    recommendedAction: 'This is a control-plane script bug. File an issue with the error text. The script needs a Has-Prop / Get-OptionalField guard.',
    safeToRetry: false,
  },
  BATCH_SINGLE_TASK_MISMATCH: {
    humanSummary: 'The batch launcher passed a multi-task file to a worker that expects a single task, or the branch issue# did not match any task.',
    likelyCause: 'batch-launch.ps1 forwarded the batch file directly instead of extracting the individual task, or the branch name issue number is wrong.',
    recommendedAction: 'Check that batch-launch.ps1 writes a single-task temp file per worker. Verify branch naming convention.',
    safeToRetry: false,
  },
  PROVIDER_UNAVAILABLE: {
    humanSummary: 'No API providers are available to run workers — all are exhausted, disabled, or at capacity.',
    likelyCause: 'Provider cooldown has not expired, credentials are invalid, or concurrency limits are too low.',
    recommendedAction: 'Check provider-pool.json status. Wait for cooldown, fix credentials, or increase concurrency limits.',
    safeToRetry: true,
  },
  DISK_PRESSURE: {
    humanSummary: 'Local disk, memory, or CPU resources are critically low.',
    likelyCause: 'Too many concurrent workers, large worktrees, or disk space exhausted.',
    recommendedAction: 'Clean up stale worktrees (worktree-janitor.ps1), reduce batch size, or free disk space.',
    safeToRetry: true,
  },
  WORKTREE_STALE: {
    humanSummary: 'A git worktree is stale, locked, or has diverged from its expected base branch.',
    likelyCause: 'A previous worker run left a worktree that was not cleaned up, or the worktree lock file is present.',
    recommendedAction: 'Run worktree-janitor.ps1 to clean stale worktrees, or manually remove the worktree directory.',
    safeToRetry: true,
  },
  HUMAN_REQUIRED: {
    humanSummary: 'A gate or policy check requires a human decision before the cycle can proceed.',
    likelyCause: 'High-risk task, main branch health is red/black, or a human-required label is present.',
    recommendedAction: 'Review the gate report and make the required decision (approve, override, or skip).',
    safeToRetry: false,
  },
  UNKNOWN_CONTROL_PLANE_FAILURE: {
    humanSummary: 'The self-cycle failed but the error does not match any known pattern.',
    likelyCause: 'A new failure mode that the classifier does not yet recognize.',
    recommendedAction: 'Review the full error output. If this is a new pattern, add it to classify-self-cycle-failure.js.',
    safeToRetry: false,
  },
};

// ── Pattern definitions ──────────────────────────────────────────────────────

const PATTERNS = {
  TASK_CONTRACT_INVALID: [
    /missing required field/i,
    /invalid taskType/i,
    /invalid risk/i,
    /rolePacket\.actorRole is required/i,
    /allowedFiles must not be empty/i,
    /Task file contains no tasks/i,
    /Invalid JSON/i,
    /does not conform to/i,
    /schema validation failed/i,
  ],
  ISSUE_BODY_PARSE_BLEED: [
    /parse bleed/i,
    /extracted.*incorrect/i,
    /CONTROL APPENDIX/i,
    /issue body.*malformed/i,
    /regex.*matched.*wrong/i,
    /allowedFiles.*from.*wrong section/i,
  ],
  RUNNER_STRICT_MODE_VARIABLE: [
    /The variable '\$.*' cannot be retrieved because it has not been set/i,
    /strict mode/i,
    /Property.*cannot be found on this object/i,
    /You cannot call a method on a null-valued expression/i,
    /Cannot index into a null array/i,
    /Index was outside the bounds of the array/i,
    /targetPrText/i,
  ],
  BATCH_SINGLE_TASK_MISMATCH: [
    /BATCH_SINGLE_TASK_MISMATCH/i,
    /Cannot select task from batch/i,
    /batch.*single.*task/i,
    /expects a single task/i,
    /does not contain an issue number/i,
    /No matching task found/i,
  ],
  PROVIDER_UNAVAILABLE: [
    /All providers exhausted/i,
    /No available providers/i,
    /provider.*disabled/i,
    /at max concurrency/i,
    /cooldown/i,
    /PROVIDER_UNAVAILABLE/i,
    /No capacity for new workers/i,
    /blocked-by-provider-pool/i,
  ],
  DISK_PRESSURE: [
    /ENOSPC/i,
    /disk.*full/i,
    /no space left/i,
    /out of memory/i,
    /heap.*limit/i,
    /ENOMEM/i,
    /resource.*critical/i,
    /DISK_PRESSURE/i,
    /disk pressure/i,
  ],
  WORKTREE_STALE: [
    /worktree.*stale/i,
    /worktree.*locked/i,
    /worktree.*corrupt/i,
    /is a missing but already registered worktree/i,
    /fatal:.*already exists/i,
    /WORKTREE_STALE/i,
    /Failed to create worktree/i,
    /branch may already exist/i,
  ],
  HUMAN_REQUIRED: [
    /HUMAN DECISION REQUIRED/i,
    /human-required/i,
    /requires human/i,
    /blocked by health/i,
    /blocked-by-health/i,
    /blocked-by-gate/i,
    /human gate/i,
    /HUMAN_REQUIRED/i,
    /high-risk/i,
  ],
};

// ── Step-based hints ─────────────────────────────────────────────────────────
// When the step is known, we can add weight to certain classifications.

const STEP_HINTS = {
  'compile': ['TASK_CONTRACT_INVALID', 'ISSUE_BODY_PARSE_BLEED'],
  'batch-launch': ['BATCH_SINGLE_TASK_MISMATCH', 'WORKTREE_STALE', 'DISK_PRESSURE'],
  'run-claude-print': ['RUNNER_STRICT_MODE_VARIABLE', 'BATCH_SINGLE_TASK_MISMATCH'],
  'launch-gate': ['HUMAN_REQUIRED', 'PROVIDER_UNAVAILABLE'],
  'health-gate': ['HUMAN_REQUIRED'],
  'provider-pool-preflight': ['PROVIDER_UNAVAILABLE'],
  'reconcile': ['ISSUE_BODY_PARSE_BLEED'],
};

// ── Classification logic ─────────────────────────────────────────────────────

function classify(text, step) {
  if (!text || !text.trim()) {
    const errorClass = 'UNKNOWN_CONTROL_PLANE_FAILURE';
    return {
      failedStep: step || 'unknown',
      errorClass,
      ...ERROR_CLASSES[errorClass],
      matchedPatterns: [],
      confidence: 'none',
    };
  }

  const matches = {};

  for (const [errorClass, patterns] of Object.entries(PATTERNS)) {
    const matched = [];
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        matched.push(pattern.source);
      }
    }
    if (matched.length > 0) {
      matches[errorClass] = matched;
    }
  }

  if (Object.keys(matches).length === 0) {
    const errorClass = 'UNKNOWN_CONTROL_PLANE_FAILURE';
    return {
      failedStep: step || 'unknown',
      errorClass,
      ...ERROR_CLASSES[errorClass],
      matchedPatterns: [],
      confidence: 'none',
    };
  }

  // Score each category: base score = match count, +2 bonus if step hints align
  let bestClass = null;
  let bestScore = 0;
  const stepHints = step ? (STEP_HINTS[step] || []) : [];

  for (const [errorClass, matched] of Object.entries(matches)) {
    let score = matched.length;
    if (stepHints.includes(errorClass)) {
      score += 2;
    }
    if (score > bestScore) {
      bestClass = errorClass;
      bestScore = score;
    }
  }

  const rawMatchCount = matches[bestClass].length;
  const confidence = rawMatchCount >= 3 ? 'high' : rawMatchCount >= 2 ? 'medium' : 'low';

  return {
    failedStep: step || 'unknown',
    errorClass: bestClass,
    ...ERROR_CLASSES[bestClass],
    matchedPatterns: matches[bestClass],
    confidence,
    allMatches: matches,
  };
}

// ── Suggested follow-up fields ───────────────────────────────────────────────

function enrichWithSuggestions(result) {
  const suggestions = {
    suggestedIssueTitle: null,
    suggestedAllowedFiles: null,
  };

  switch (result.errorClass) {
    case 'RUNNER_STRICT_MODE_VARIABLE':
      suggestions.suggestedIssueTitle = 'fix(ai): add null guard for optional task field in run-claude-print.ps1';
      suggestions.suggestedAllowedFiles = ['scripts/ai/run-claude-print.ps1'];
      break;
    case 'BATCH_SINGLE_TASK_MISMATCH':
      suggestions.suggestedIssueTitle = 'fix(ai): batch-launch.ps1 must extract single task before dispatching to worker';
      suggestions.suggestedAllowedFiles = ['scripts/ai/batch-launch.ps1', 'scripts/ai/run-claude-print.ps1'];
      break;
    case 'TASK_CONTRACT_INVALID':
      suggestions.suggestedIssueTitle = 'fix(ai): compile-issue-to-task-json.ps1 produces incomplete task contract';
      suggestions.suggestedAllowedFiles = ['scripts/ai/compile-issue-to-task-json.ps1'];
      break;
    case 'ISSUE_BODY_PARSE_BLEED':
      suggestions.suggestedIssueTitle = 'fix(ai): issue body parser bleeds across CONTROL APPENDIX sections';
      suggestions.suggestedAllowedFiles = ['scripts/ai/run-self-cycle.ps1', 'scripts/ai/compile-issue-to-task-json.ps1'];
      break;
    case 'PROVIDER_UNAVAILABLE':
      suggestions.suggestedIssueTitle = 'ops: provider pool exhausted — review cooldown and concurrency limits';
      suggestions.suggestedAllowedFiles = ['scripts/ai/update-provider-pool-state.ps1', '.github/ai-state/provider-pool.json'];
      break;
    case 'WORKTREE_STALE':
      suggestions.suggestedIssueTitle = 'fix(ai): worktree janitor not running — stale worktrees blocking launches';
      suggestions.suggestedAllowedFiles = ['scripts/ai/worktree-janitor.ps1'];
      break;
    default:
      break;
  }

  return { ...result, ...suggestions };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
classify-self-cycle-failure.js — Recovery classifier for self-cycle failures (v1)

Usage:
  node scripts/ai/classify-self-cycle-failure.js [options]

Options:
  --step <name>   Pipeline step that failed (compile, batch-launch, run-claude-print,
                  launch-gate, health-gate, provider-pool-preflight, reconcile)
  --file <path>   Read failure text from a file
  --text <string> Classify the given string directly
  --help          Show this help message

With no --file/--text, reads from stdin.

Error classes:
  TASK_CONTRACT_INVALID         Missing/invalid task JSON fields
  ISSUE_BODY_PARSE_BLEED        Issue body regex extracted wrong content
  RUNNER_STRICT_MODE_VARIABLE   PowerShell strict mode uninitialized variable
  BATCH_SINGLE_TASK_MISMATCH    Batch/single task dispatch contract mismatch
  PROVIDER_UNAVAILABLE          All API providers exhausted or disabled
  DISK_PRESSURE                 Disk/memory/CPU resource pressure
  WORKTREE_STALE                Git worktree stale, locked, or corrupted
  HUMAN_REQUIRED                Gate requires human decision
  UNKNOWN_CONTROL_PLANE_FAILURE No pattern matched

Output:
  JSON object with: failedStep, errorClass, humanSummary, likelyCause,
  recommendedAction, safeToRetry, suggestedIssueTitle, suggestedAllowedFiles,
  matchedPatterns, confidence

Exit codes:
  0  Classification produced
  2  Invalid arguments
`.trim();
  console.log(help);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  let text = '';
  let step = null;

  const stepIdx = args.indexOf('--step');
  if (stepIdx !== -1) {
    step = args[stepIdx + 1] || null;
  }

  const fileIdx = args.indexOf('--file');
  const textIdx = args.indexOf('--text');

  if (fileIdx !== -1) {
    const filePath = args[fileIdx + 1];
    if (!filePath) {
      console.error('Error: --file requires a path argument');
      process.exit(2);
    }
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(2);
    }
    text = fs.readFileSync(filePath, 'utf8');
  } else if (textIdx !== -1) {
    text = args[textIdx + 1] || '';
  } else if (!process.stdin.isTTY) {
    text = await readStdin();
  } else {
    printHelp();
    process.exit(0);
  }

  const result = classify(text, step);
  const enriched = enrichWithSuggestions(result);
  console.log(JSON.stringify(enriched, null, 2));
}

main().catch(err => {
  console.error(err.message);
  process.exit(2);
});
