#!/usr/bin/env node

/**
 * classify-self-cycle-failure.js
 *
 * Deterministic recovery classifier for self-cycle execution failures.
 * Reads failure text (stdout+stderr) from stdin, a file, or --text argument,
 * plus an optional --step flag indicating which pipeline step failed.
 *
 * Each classification includes a selfCritique block (Reflexion-style) with
 * rootCause, lessonLearned, preventionCheck, and repeatRiskSignal so that
 * downstream consumers can store actionable reflections and avoid repeating
 * the same mistakes.
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
 * Reflection:
 *   Each classification includes a reflexion-style self-critique with a
 *   rootCause, lesson, actionable guidance, prevention check, repeat-prevention
 *   signal, and repeat-risk signal. Pass --reflectionLog <path.ndjson> to
 *   persist reflections for downstream consumption by the planning loop.
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

// ── Reflection templates ────────────────────────────────────────────────────
// Reflexion-style self-critiques: each error class maps to an actionable
// lesson, concrete fix guidance, and a repeat-prevention signal.

const REFLECTIONS = {
  TASK_CONTRACT_INVALID: {
    rootCause: 'The task contract produced by the compiler did not satisfy the schema required by the runner.',
    lesson: 'Schema validation must happen at compile time, not at dispatch time. The compiler should reject invalid contracts before they reach the launcher.',
    actionableGuidance: 'Add a schema validation gate after compile-issue-to-task-json.ps1. Reject tasks missing allowedFiles, risk, or rolePacket.actorRole before they reach the launcher.',
    preventionCheck: 'Run schema validation in compile-issue-to-task-json.ps1 before writing the task file. Add a --validate flag that exits non-zero on schema violations.',
    repeatPreventionSignal: 'check-task-contract-schema',
    repeatRiskSignal: 'elevated',
    severity: 'high',
  },
  ISSUE_BODY_PARSE_BLEED: {
    rootCause: 'The regex-based parser extracted fields from the wrong markdown section, producing a corrupted control plane input.',
    lesson: 'Regex parsing of structured markdown is fragile. The parser needs stricter section delimiters or a structured format to avoid cross-section bleed.',
    actionableGuidance: 'Use a stricter delimiter (e.g., triple-backline fences) around CONTROL APPENDIX. Add a post-extraction sanity check that allowedFiles does not contain markdown prose.',
    preventionCheck: 'Add a post-parse sanity check: verify that extracted allowedFiles paths exist in the repository and that forbiddenFiles does not overlap.',
    repeatPreventionSignal: 'check-issue-body-delimiter',
    repeatRiskSignal: 'elevated',
    severity: 'medium',
  },
  RUNNER_STRICT_MODE_VARIABLE: {
    rootCause: 'An optional field was accessed without a null guard, crashing under PowerShell strict mode.',
    lesson: 'Every optional task field must go through a Has-Prop / Get-OptionalField accessor. Direct property access on optional fields is a latent bug.',
    actionableGuidance: 'Audit all optional field accesses in run-claude-print.ps1. Add Has-Prop / Get-OptionalField guards for targetPR, attentionAreas, budgets, and similar optional fields.',
    preventionCheck: 'Audit all scripts that read task JSON for direct property access on optional fields (targetPR, attentionAreas, budgets). Replace with guarded accessors.',
    repeatPreventionSignal: 'check-ps-strict-mode-null-guard',
    repeatRiskSignal: 'elevated',
    severity: 'medium',
  },
  BATCH_SINGLE_TASK_MISMATCH: {
    rootCause: 'The launcher dispatched a batch file to a worker that expects a single task, or the branch issue number did not match any task in the batch.',
    lesson: 'Batch and single-task dispatch paths must be clearly separated. The launcher should extract individual tasks before dispatch and verify issue number alignment.',
    actionableGuidance: 'Ensure batch-launch.ps1 extracts a single-task temp file per worker. Add a post-extraction check that the file contains exactly one task and the issue number matches the branch name.',
    preventionCheck: 'Add a dispatch contract assertion in batch-launch.ps1: verify the temp file contains exactly one task and that its targetIssue matches the branch name.',
    repeatPreventionSignal: 'check-batch-single-task-extraction',
    repeatRiskSignal: 'normal',
    severity: 'high',
  },
  PROVIDER_UNAVAILABLE: {
    rootCause: 'All API providers were exhausted, disabled, or at capacity when the worker attempted to launch.',
    lesson: 'Provider pool health should be checked before task compilation, not after. Launching tasks when no providers are available wastes compilation effort.',
    actionableGuidance: 'Monitor provider pool utilization. Add a pre-launch capacity check that verifies at least one provider has available slots before queuing tasks. Consider adding provider cooldown alerts.',
    preventionCheck: 'Move provider-pool-preflight gate before task compilation in the pipeline. Fail fast with a clear message instead of compiling tasks that cannot run.',
    repeatPreventionSignal: 'check-provider-capacity-before-launch',
    repeatRiskSignal: 'normal',
    severity: 'low',
  },
  DISK_PRESSURE: {
    rootCause: 'Local resources (disk, memory, or CPU) were critically low, preventing worker execution.',
    lesson: 'Resource pressure is a systemic issue that affects all workers. The batch launcher should monitor resource thresholds and pause before launching new workers.',
    actionableGuidance: 'Run worktree-janitor.ps1 before each batch. Add a pre-launch disk space check. Reduce concurrent worker count when disk usage exceeds 80%.',
    preventionCheck: 'Add a pre-launch resource check in batch-launch.ps1: verify free disk > 2GB and available memory > 1GB before dispatching the next worker.',
    repeatPreventionSignal: 'check-disk-pressure-pre-launch',
    repeatRiskSignal: 'normal',
    severity: 'low',
  },
  WORKTREE_STALE: {
    rootCause: 'A previous worker left behind a stale, locked, or corrupted worktree that blocked the current run.',
    lesson: 'Worktree cleanup must be automatic, not manual. The janitor should run as a pre-launch gate, not as a remediation step after failures.',
    actionableGuidance: 'Run worktree-janitor.ps1 as a pre-launch gate. Add automatic cleanup of worktrees older than 2 hours. Check for lock files before creating new worktrees.',
    preventionCheck: 'Run worktree-janitor.ps1 as a mandatory gate before batch-launch. Reject launches if any stale worktrees are detected after cleanup.',
    repeatPreventionSignal: 'check-worktree-freshness',
    repeatRiskSignal: 'elevated',
    severity: 'medium',
  },
  HUMAN_REQUIRED: {
    rootCause: 'A gate or policy check determined that a human decision is required before the cycle can proceed.',
    lesson: 'Human-required gates are intentional safeguards. The system should surface the decision context clearly and not retry automatically.',
    actionableGuidance: 'Review the gate report promptly. For recurring human-required blocks on low-risk tasks, consider relaxing the gate criteria or adding an auto-approve path.',
    preventionCheck: 'Ensure human-required gates produce structured decision objects with all context needed for a fast human review. Reduce gate frequency by tightening auto-approve criteria.',
    repeatPreventionSignal: 'check-human-decision-pending',
    repeatRiskSignal: 'normal',
    severity: 'low',
  },
  UNKNOWN_CONTROL_PLANE_FAILURE: {
    rootCause: 'The failure did not match any known pattern, indicating a new or unclassified failure mode.',
    lesson: 'Unknown failures are the highest-priority signal for classifier improvement. Each unknown failure should be triaged and added as a new pattern.',
    actionableGuidance: 'Review the full error output and add the new pattern to classify-self-cycle-failure.js. Classify the failure text and file a follow-up issue with the error class.',
    preventionCheck: 'After triaging an unknown failure, add its pattern to classify-self-cycle-failure.js and file an issue to track the root cause fix.',
    repeatPreventionSignal: 'check-unknown-failure-pattern',
    repeatRiskSignal: 'elevated',
    severity: 'high',
  },
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

// ── Reflection generator ─────────────────────────────────────────────────────

function generateReflection(result, failureText, step) {
  const template = REFLECTIONS[result.errorClass] || REFLECTIONS.UNKNOWN_CONTROL_PLANE_FAILURE;
  const snippet = failureText
    ? failureText.trim().slice(0, 200).replace(/\s+/g, ' ')
    : '';

  return {
    errorClass: result.errorClass,
    failedStep: step || 'unknown',
    rootCause: template.rootCause,
    lesson: template.lesson,
    actionableGuidance: template.actionableGuidance,
    preventionCheck: template.preventionCheck,
    repeatPreventionSignal: template.repeatPreventionSignal,
    repeatRiskSignal: template.repeatRiskSignal,
    severity: template.severity,
    failureSnippet: snippet || null,
    capturedAt: new Date().toISOString(),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
classify-self-cycle-failure.js — Recovery classifier for self-cycle failures (v1)

Usage:
  node scripts/ai/classify-self-cycle-failure.js [options]

Options:
  --step <name>           Pipeline step that failed (compile, batch-launch, run-claude-print,
                          launch-gate, health-gate, provider-pool-preflight, reconcile)
  --file <path>           Read failure text from a file
  --text <string>         Classify the given string directly
  --reflectionLog <path>  Append reflection entry to an NDJSON log file
  --help                  Show this help message

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
  matchedPatterns, confidence, reflection (includes rootCause, lesson,
  actionableGuidance, preventionCheck, repeatPreventionSignal)

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
  let reflectionLog = null;

  const stepIdx = args.indexOf('--step');
  if (stepIdx !== -1) {
    step = args[stepIdx + 1] || null;
  }

  const reflectionLogIdx = args.indexOf('--reflectionLog');
  if (reflectionLogIdx !== -1) {
    reflectionLog = args[reflectionLogIdx + 1] || null;
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
  const reflection = generateReflection(result, text, step);
  enriched.reflection = reflection;

  if (reflectionLog) {
    const logDir = require('path').dirname(reflectionLog);
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(reflectionLog, JSON.stringify(reflection) + '\n', 'utf8');
  }

  console.log(JSON.stringify(enriched, null, 2));
}

main().catch(err => {
  console.error(err.message);
  process.exit(2);
});
