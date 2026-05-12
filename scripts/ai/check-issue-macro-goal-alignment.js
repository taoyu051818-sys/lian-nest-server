#!/usr/bin/env node

/**
 * check-issue-macro-goal-alignment.js
 *
 * Evaluates issue candidates against macro-goal alignment criteria before
 * they are promoted to GitHub issues. Rejects issues that do not advance
 * the macro goal of autonomous self-cycle, Codex exit, or reliable value
 * creation.
 *
 * Gate criteria:
 *   1. Lane Alignment      — macroGoal maps to a recognized priority lane
 *   2. Evidence Quality     — required structural fields present (allowedFiles,
 *                             forbiddenFiles, validationCommands, conflictGroup,
 *                             risk, rollbackPlan, followUp)
 *   3. Advancement Rationale — rationale demonstrates self-cycle or Codex-exit
 *                             advancement (not shallow or cosmetic work)
 *
 * Usage:
 *   node scripts/ai/check-issue-macro-goal-alignment.js --help
 *   node scripts/ai/check-issue-macro-goal-alignment.js --candidate issue.json
 *   node scripts/ai/check-issue-macro-goal-alignment.js --candidate issue.json --stdout
 *   cat issue.json | node scripts/ai/check-issue-macro-goal-alignment.js --stdin
 *
 * Exit codes:
 *   0 — pass or warn (no hard blockers)
 *   1 — block (one or more blockers)
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(DEFAULT_STATE_DIR, 'macro-goal-alignment-result.json');
const MACRO_GOAL_PATH = path.join(DEFAULT_STATE_DIR, 'macro-goal.json');

const SCHEMA_VERSION = 1;
const GATE_TYPE = 'macro-goal-alignment';

const DECISIONS = { PASS: 'pass', BLOCK: 'block', WARN: 'warn' };

// Required structural fields on every issue candidate
const REQUIRED_FIELDS = [
  'allowedFiles',
  'forbiddenFiles',
  'validationCommands',
  'conflictGroup',
  'risk',
];

// Keywords that suggest self-cycle or Codex-exit advancement
const ADVANCEMENT_KEYWORDS = [
  'self-cycle',
  'codex exit',
  'codex-exit',
  'autonomous',
  'autonomy',
  'command steward',
  'command-steward',
  'health gate',
  'health-gate',
  'reconcil',
  'telemetry',
  'budget',
  'launch gate',
  'launch-gate',
  'merge gate',
  'merge-gate',
  'issue lifecycle',
  'issue-lifecycle',
  'state reconcil',
  'state-reconcil',
  'control-plane',
  'control plane',
  'priority lane',
  'priority-lane',
  'north star',
  'north-star',
  'lane alignment',
  'lane-alignment',
];

// Shallow-work signals — issues with only these patterns and no depth are blocked
const SHALLOW_PATTERNS = [
  /^add comment/i,
  /^rename \w+$/i,
  /^update readme/i,
  /^fix typo/i,
  /^add logging$/i,
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
check-issue-macro-goal-alignment.js — Macro-goal alignment gate evaluator

USAGE
    node scripts/ai/check-issue-macro-goal-alignment.js [options]

OPTIONS
    --candidate <path>   Path to issue candidate JSON file
    --stdin              Read candidate JSON from stdin
    --state <path>       Path to macro-goal.json
                         (default: .github/ai-state/macro-goal.json)
    --out <path>         Output path for gate result JSON
                         (default: .github/ai-state/macro-goal-alignment-result.json)
    --stdout             Print JSON to stdout instead of writing a file
    --help, -h           Show this help message and exit.

ISSUE CANDIDATE SCHEMA
    {
      "title": "string (required)",
      "macroGoal": "string — freeform label for the macro goal this issue serves",
      "priorityLane": "string — one of macro-goal.json priorityLanes (optional, auto-inferred)",
      "taskType": "string — execution type",
      "risk": "low" | "medium" | "high" | "critical",
      "conflictGroup": "string (required)",
      "allowedFiles": ["path/pattern", ...],
      "forbiddenFiles": ["path/pattern", ...],
      "validationCommands": ["cmd1", ...],
      "rationale": "string — why this issue advances the macro goal",
      "evidence": ["evidence item 1", ...],
      "rollbackPlan": "string — how to revert if this fails",
      "followUp": "string — what to do after this issue is closed"
    }

GATE CRITERIA
    1. Lane Alignment       — macroGoal maps to a recognized priority lane
    2. Evidence Quality      — required structural fields present
    3. Advancement Rationale — rationale demonstrates self-cycle/Codex-exit advancement

EXIT CODES
    0   pass or warn (no hard blockers)
    1   block (one or more blockers)
    2   invalid arguments
`.trimStart();
  process.stdout.write(help);
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return null;
  }
}

function shortHash(input) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    candidate: null,
    stdin: false,
    state: MACRO_GOAL_PATH,
    out: DEFAULT_OUT,
    stdout: false,
    help: false,
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--candidate') {
      i++;
      if (i >= argv.length) { console.error('Error: --candidate requires a path'); process.exit(2); }
      args.candidate = argv[i];
    } else if (arg === '--stdin') {
      args.stdin = true;
    } else if (arg === '--state') {
      i++;
      if (i >= argv.length) { console.error('Error: --state requires a path'); process.exit(2); }
      args.state = argv[i];
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
    } else if (arg === '--stdout') {
      args.stdout = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }

  return args;
}

// ── Gate Criteria Evaluators ─────────────────────────────────────────────────

/**
 * 1. Lane Alignment — candidate's macroGoal maps to a recognized priority lane
 *    from macro-goal.json, or the candidate explicitly declares a priorityLane.
 */
function evaluateLaneAlignment(candidate, macroGoalState) {
  const blockers = [];
  const warnings = [];
  const factsRead = [];

  const priorityLanes = (macroGoalState && macroGoalState.priorityLanes) || [];
  factsRead.push({
    source: 'macro-goal.json',
    summary: `priorityLanes=[${priorityLanes.join(', ')}]`,
  });

  // macroGoal field must be present
  if (!candidate.macroGoal || typeof candidate.macroGoal !== 'string' || candidate.macroGoal.trim() === '') {
    blockers.push({
      code: 'NO_MACRO_GOAL',
      message: 'Candidate has no macroGoal field. Every issue must declare which macro goal it serves.',
    });
    return { blockers, warnings, factsRead };
  }

  factsRead.push({
    source: 'candidate.macroGoal',
    summary: `macroGoal=${candidate.macroGoal}`,
  });

  // Check explicit priorityLane first
  if (candidate.priorityLane) {
    if (!priorityLanes.includes(candidate.priorityLane)) {
      blockers.push({
        code: 'UNKNOWN_PRIORITY_LANE',
        message: `priorityLane "${candidate.priorityLane}" is not in macro-goal.json priorityLanes: [${priorityLanes.join(', ')}].`,
      });
    } else {
      factsRead.push({
        source: 'candidate.priorityLane',
        summary: `priorityLane=${candidate.priorityLane} (matched)`,
      });
    }
    return { blockers, warnings, factsRead };
  }

  // Fuzzy match: check if macroGoal contains a priority lane name or vice versa
  const goalLower = candidate.macroGoal.toLowerCase();
  const matchedLane = priorityLanes.find(lane => {
    const laneLower = lane.toLowerCase();
    return goalLower.includes(laneLower) || laneLower.includes(goalLower);
  });

  if (!matchedLane) {
    // Soft block: warn instead of block when lane is unrecognised but macroGoal is present
    warnings.push({
      code: 'UNMATCHED_MACRO_GOAL',
      message: `macroGoal "${candidate.macroGoal}" does not match any priority lane: [${priorityLanes.join(', ')}]. Consider setting priorityLane explicitly or aligning to a recognized lane.`,
    });
  } else {
    factsRead.push({
      source: 'candidate.macroGoal (fuzzy)',
      summary: `matched lane: ${matchedLane}`,
    });
  }

  return { blockers, warnings, factsRead };
}

/**
 * 2. Evidence Quality — required structural fields present.
 */
function evaluateEvidenceQuality(candidate) {
  const blockers = [];
  const warnings = [];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    const value = candidate[field];
    if (value === undefined || value === null) {
      blockers.push({
        code: 'MISSING_REQUIRED_FIELD',
        message: `Required field "${field}" is missing from candidate.`,
      });
    } else if (Array.isArray(value) && value.length === 0) {
      blockers.push({
        code: 'EMPTY_REQUIRED_FIELD',
        message: `Required field "${field}" is an empty array. At least one entry is required.`,
      });
    } else if (typeof value === 'string' && value.trim() === '') {
      blockers.push({
        code: 'EMPTY_REQUIRED_FIELD',
        message: `Required field "${field}" is an empty string.`,
      });
    }
  }

  // allowedFiles should not be overly broad
  const allowedFiles = candidate.allowedFiles || [];
  const broadPatterns = ['src/**', '**/*', '**', 'src/**/**'];
  for (const pattern of allowedFiles) {
    if (broadPatterns.includes(pattern)) {
      blockers.push({
        code: 'SCOPE_TOO_BROAD',
        message: `allowedFiles contains overly broad pattern "${pattern}". Use module-level patterns.`,
      });
    }
  }

  // Evidence should be present
  const evidence = candidate.evidence || [];
  if (evidence.length === 0) {
    warnings.push({
      code: 'NO_EVIDENCE',
      message: 'No evidence provided. Include at least one evidence item justifying this issue.',
    });
  }

  // Rollback plan should be present
  if (!candidate.rollbackPlan || (typeof candidate.rollbackPlan === 'string' && candidate.rollbackPlan.trim() === '')) {
    warnings.push({
      code: 'NO_ROLLBACK_PLAN',
      message: 'No rollbackPlan provided. Include a plan for reverting if this change fails.',
    });
  }

  // Follow-up should be present
  if (!candidate.followUp || (typeof candidate.followUp === 'string' && candidate.followUp.trim() === '')) {
    warnings.push({
      code: 'NO_FOLLOW_UP',
      message: 'No followUp provided. Describe what should happen after this issue is closed.',
    });
  }

  return { blockers, warnings };
}

/**
 * 3. Advancement Rationale — rationale demonstrates self-cycle or Codex-exit
 *    advancement. Blocks shallow cosmetic work that does not move the needle.
 */
function evaluateAdvancementRationale(candidate) {
  const blockers = [];
  const warnings = [];
  const factsRead = [];

  const rationale = candidate.rationale || '';
  const title = candidate.title || '';

  if (!rationale || rationale.trim() === '') {
    blockers.push({
      code: 'NO_RATIONALE',
      message: 'Candidate has no rationale. Every issue must explain how it advances the macro goal.',
    });
    return { blockers, warnings, factsRead };
  }

  factsRead.push({
    source: 'candidate.rationale',
    summary: `rationale length=${rationale.length}`,
  });

  // Check for advancement keywords in rationale + title
  const combinedText = `${title} ${rationale}`.toLowerCase();
  const hasAdvancementSignal = ADVANCEMENT_KEYWORDS.some(kw => combinedText.includes(kw));

  if (!hasAdvancementSignal) {
    warnings.push({
      code: 'WEAK_ADVANCEMENT_SIGNAL',
      message: 'Rationale does not mention self-cycle, Codex exit, or control-plane concepts. Consider connecting this work to macro goals.',
    });
  }

  // Check for shallow work patterns
  const isShallow = SHALLOW_PATTERNS.some(re => re.test(title));
  if (isShallow && !hasAdvancementSignal) {
    blockers.push({
      code: 'SHALLOW_WORK',
      message: `Title "${title}" matches a shallow-work pattern and rationale lacks advancement signals. Issues must create structural value, not cosmetic changes.`,
    });
  }

  // Rationale must be substantive (not just restating the title)
  if (rationale.length < 20) {
    blockers.push({
      code: 'RATIONALE_TOO_SHORT',
      message: 'Rationale is too short (< 20 chars). Provide a substantive explanation of how this issue advances the macro goal.',
    });
  }

  return { blockers, warnings, factsRead };
}

// ── Decision Aggregation ─────────────────────────────────────────────────────

function aggregateDecision(criteriaResults) {
  const allBlockers = [];
  const allWarnings = [];

  for (const result of criteriaResults) {
    allBlockers.push(...result.blockers);
    allWarnings.push(...result.warnings);
  }

  let decision;
  let severity;

  if (allBlockers.length > 0) {
    decision = DECISIONS.BLOCK;
    severity = 'error';
  } else if (allWarnings.length > 0) {
    decision = DECISIONS.WARN;
    severity = 'warning';
  } else {
    decision = DECISIONS.PASS;
    severity = 'info';
  }

  return { decision, severity, blockers: allBlockers, warnings: allWarnings };
}

// ── Gate Result Builder ──────────────────────────────────────────────────────

function buildGateResult(candidate, decision, severity, blockers, warnings, allFactsRead) {
  const hashInput = (candidate.title || '') + (candidate.conflictGroup || '');
  const markerId = `macro-goal-${shortHash(hashInput)}-alignment`;

  const producedFacts = [];
  if (candidate.macroGoal) producedFacts.push({ key: 'macro-goal', value: candidate.macroGoal });
  if (candidate.priorityLane) producedFacts.push({ key: 'priority-lane', value: candidate.priorityLane });
  if (candidate.conflictGroup) producedFacts.push({ key: 'conflict-group', value: candidate.conflictGroup });
  if (candidate.risk) producedFacts.push({ key: 'risk', value: candidate.risk });

  return {
    schemaVersion: SCHEMA_VERSION,
    gateType: GATE_TYPE,
    decision,
    severity,
    markerId,
    capturedAt: new Date().toISOString(),
    targetIssue: null,
    targetPR: null,
    factsRead: allFactsRead,
    blockers,
    warnings,
    producedFacts,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Load candidate
  let raw;
  if (args.stdin) {
    raw = readStdin();
  } else if (args.candidate) {
    if (!fs.existsSync(args.candidate)) {
      console.error(`Error: Candidate file not found: ${args.candidate}`);
      process.exit(2);
    }
    raw = fs.readFileSync(args.candidate, 'utf8');
  } else {
    console.error('Error: --candidate <path> or --stdin is required.');
    process.exit(2);
  }

  let candidate;
  try {
    candidate = JSON.parse(raw);
  } catch (err) {
    console.error(`Error: Failed to parse candidate JSON: ${err.message}`);
    process.exit(2);
  }

  // Load macro-goal state
  const macroGoalState = readJson(args.state);
  if (!macroGoalState) {
    console.error(`Warning: Could not load macro-goal state from ${args.state}. Lane alignment will be lenient.`);
  }

  // Run all three gate criteria
  const factsRead = [];

  const laneResult = evaluateLaneAlignment(candidate, macroGoalState);
  factsRead.push(...laneResult.factsRead);

  const evidenceResult = evaluateEvidenceQuality(candidate);

  const rationaleResult = evaluateAdvancementRationale(candidate);
  factsRead.push(...rationaleResult.factsRead);

  // Aggregate
  const allResults = [laneResult, evidenceResult, rationaleResult];
  const { decision, severity, blockers, warnings } = aggregateDecision(allResults);

  // Build output
  const gateResult = buildGateResult(candidate, decision, severity, blockers, warnings, factsRead);
  const json = JSON.stringify(gateResult, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Macro-goal alignment gate result written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }

  // Exit code: 0 for pass/warn, 1 for block
  process.exit(decision === DECISIONS.BLOCK ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateLaneAlignment,
  evaluateEvidenceQuality,
  evaluateAdvancementRationale,
  aggregateDecision,
  buildGateResult,
  shortHash,
};
