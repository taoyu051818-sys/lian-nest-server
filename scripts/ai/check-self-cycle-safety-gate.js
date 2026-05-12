#!/usr/bin/env node

/**
 * check-self-cycle-safety-gate.js
 *
 * Evaluates planned self-cycle actions against safety gate criteria before
 * the autopilot executes merge, close, or launch operations.
 *
 * This is a deterministic, local-logic script. It reads a self-cycle plan
 * JSON file and produces a gate result. No network calls — external state
 * (main health marker) is provided by the caller.
 *
 * Gate criteria:
 *   1. Main Health Gate  — blocks merge/close/launch when main is red or black
 *   2. Risk Gate         — blocks high-risk and critical-risk actions
 *   3. Allowlist Gate    — blocks actions missing explicit allowedFiles
 *   4. Human Gate        — blocks actions requiring human approval
 *
 * Usage:
 *   node scripts/ai/check-self-cycle-safety-gate.js --help
 *   node scripts/ai/check-self-cycle-safety-gate.js --plan plan.json
 *   node scripts/ai/check-self-cycle-safety-gate.js --plan plan.json --stdout
 *   cat plan.json | node scripts/ai/check-self-cycle-safety-gate.js --stdin
 *
 * Exit codes:
 *   0 — all actions cleared (no blockers)
 *   1 — one or more actions blocked
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'self-cycle-safety-gate-result.json');

const SCHEMA_VERSION = 1;
const CHECK_TYPE = 'self-cycle-safety-gate';

const VALID_HEALTH_STATES = ['green', 'yellow', 'red', 'black'];
const BLOCKED_HEALTH_STATES = ['red', 'black'];

const HIGH_RISK_LEVELS = ['high', 'critical'];

const SIDE_EFFECT_ACTIONS = ['merge', 'close', 'launch', 'execute'];

const DECISIONS = { PASS: 'pass', BLOCKED: 'blocked' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
check-self-cycle-safety-gate.js — Self-cycle safety gate checker

USAGE
    node scripts/ai/check-self-cycle-safety-gate.js [options]

OPTIONS
    --plan <path>    Path to self-cycle plan JSON file
    --stdin          Read plan JSON from stdin
    --out <path>     Output path for gate result JSON
                     (default: .github/ai-state/self-cycle-safety-gate-result.json)
    --stdout         Print JSON to stdout instead of writing a file
    --help, -h       Show this help message and exit.

PLAN SCHEMA
    {
      "mainHealth": "green" | "yellow" | "red" | "black",
      "actions": [
        {
          "actionType": "merge" | "close" | "launch" | "execute" | "preview" | "read",
          "targetIssue": 123,
          "risk": "low" | "medium" | "high" | "critical",
          "allowedFiles": ["path/pattern", ...],
          "requiresHumanApproval": false,
          "conflictGroup": "string"
        }
      ]
    }

GATE CRITERIA
    1. Main Health Gate  — blocks merge/close/launch when main is red or black
    2. Risk Gate         — blocks high-risk and critical-risk actions
    3. Allowlist Gate    — blocks actions missing explicit allowedFiles
    4. Human Gate        — blocks actions requiring human approval

EXIT CODES
    0   all actions cleared (no blockers)
    1   one or more actions blocked
    2   invalid arguments
`.trimStart();
  process.stdout.write(help);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    plan: null,
    stdin: false,
    out: DEFAULT_OUT,
    stdout: false,
    help: false,
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--plan') {
      i++;
      if (i >= argv.length) { console.error('Error: --plan requires a path'); process.exit(2); }
      args.plan = argv[i];
    } else if (arg === '--stdin') {
      args.stdin = true;
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
 * 1. Main Health Gate — blocks merge/close/launch when main is red or black.
 */
function evaluateMainHealth(plan, action) {
  const blockers = [];
  const warnings = [];

  const mainHealth = plan.mainHealth;
  if (!mainHealth || !VALID_HEALTH_STATES.includes(mainHealth)) {
    blockers.push({
      code: 'INVALID_HEALTH_STATE',
      message: `mainHealth "${mainHealth || ''}" is not a valid state. Must be one of: ${VALID_HEALTH_STATES.join(', ')}.`,
    });
    return { blockers, warnings };
  }

  const isSideEffect = SIDE_EFFECT_ACTIONS.includes(action.actionType);
  if (isSideEffect && BLOCKED_HEALTH_STATES.includes(mainHealth)) {
    blockers.push({
      code: 'MAIN_UNHEALTHY',
      message: `Action "${action.actionType}" on issue #${action.targetIssue} blocked: main is ${mainHealth}. Only recovery actions permitted.`,
    });
  }

  if (mainHealth === 'yellow' && isSideEffect) {
    warnings.push({
      code: 'MAIN_YELLOW',
      message: `Action "${action.actionType}" on issue #${action.targetIssue} proceeds with caution: main is yellow.`,
    });
  }

  return { blockers, warnings };
}

/**
 * 2. Risk Gate — blocks high-risk and critical-risk actions.
 */
function evaluateRisk(action) {
  const blockers = [];
  const warnings = [];

  const risk = action.risk;
  if (risk && HIGH_RISK_LEVELS.includes(risk)) {
    blockers.push({
      code: 'HIGH_RISK_ACTION',
      message: `Action on issue #${action.targetIssue} has risk "${risk}" — requires human approval before execution.`,
    });
  }

  if (risk === 'medium') {
    warnings.push({
      code: 'MEDIUM_RISK',
      message: `Action on issue #${action.targetIssue} has medium risk. Review recommended.`,
    });
  }

  return { blockers, warnings };
}

/**
 * 3. Allowlist Gate — blocks actions missing explicit allowedFiles.
 */
function evaluateAllowlist(action) {
  const blockers = [];
  const warnings = [];

  const allowedFiles = action.allowedFiles;
  if (!Array.isArray(allowedFiles) || allowedFiles.length === 0) {
    blockers.push({
      code: 'NO_ALLOWLIST',
      message: `Action on issue #${action.targetIssue} has no explicit allowedFiles. All actions must declare a bounded file scope.`,
    });
  }

  return { blockers, warnings };
}

/**
 * 4. Human Gate — blocks actions requiring human approval.
 */
function evaluateHumanGate(action) {
  const blockers = [];
  const warnings = [];

  if (action.requiresHumanApproval) {
    blockers.push({
      code: 'HUMAN_APPROVAL_REQUIRED',
      message: `Action on issue #${action.targetIssue} requires human approval. Autopilot cannot proceed.`,
    });
  }

  return { blockers, warnings };
}

// ── Decision Aggregation ─────────────────────────────────────────────────────

function aggregateDecision(results) {
  const allBlockers = [];
  const allWarnings = [];

  for (const result of results) {
    allBlockers.push(...result.blockers);
    allWarnings.push(...result.warnings);
  }

  const decision = allBlockers.length > 0 ? DECISIONS.BLOCKED : DECISIONS.PASS;
  const severity = allBlockers.length > 0 ? 'error' : (allWarnings.length > 0 ? 'warning' : 'info');

  return { decision, severity, blockers: allBlockers, warnings: allWarnings };
}

// ── Result Builder ───────────────────────────────────────────────────────────

function buildResult(plan, actionResults) {
  const allBlockers = [];
  const allWarnings = [];
  const actionReports = [];

  for (const { action, decision, severity, blockers, warnings } of actionResults) {
    allBlockers.push(...blockers);
    allWarnings.push(...warnings);
    actionReports.push({
      actionType: action.actionType,
      targetIssue: action.targetIssue || null,
      conflictGroup: action.conflictGroup || null,
      risk: action.risk || 'low',
      decision,
      severity,
      blockers,
      warnings,
    });
  }

  const overallDecision = allBlockers.length > 0 ? DECISIONS.BLOCKED : DECISIONS.PASS;
  const overallSeverity = allBlockers.length > 0 ? 'error' : (allWarnings.length > 0 ? 'warning' : 'info');

  return {
    schemaVersion: SCHEMA_VERSION,
    checkType: CHECK_TYPE,
    decision: overallDecision,
    severity: overallSeverity,
    mainHealth: plan.mainHealth || null,
    actionCount: actionResults.length,
    capturedAt: new Date().toISOString(),
    actions: actionReports,
    blockers: allBlockers,
    warnings: allWarnings,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function checkPlan(plan) {
  const actions = plan.actions || [];
  const actionResults = [];

  for (const action of actions) {
    const healthResult = evaluateMainHealth(plan, action);
    const riskResult = evaluateRisk(action);
    const allowlistResult = evaluateAllowlist(action);
    const humanResult = evaluateHumanGate(action);

    const allResults = [healthResult, riskResult, allowlistResult, humanResult];
    const { decision, severity, blockers, warnings } = aggregateDecision(allResults);

    actionResults.push({ action, decision, severity, blockers, warnings });
  }

  return buildResult(plan, actionResults);
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Load plan
  let raw;
  if (args.stdin) {
    try {
      raw = fs.readFileSync(0, 'utf8');
    } catch {
      console.error('Error: Failed to read from stdin.');
      process.exit(2);
    }
  } else if (args.plan) {
    if (!fs.existsSync(args.plan)) {
      console.error(`Error: Plan file not found: ${args.plan}`);
      process.exit(2);
    }
    raw = fs.readFileSync(args.plan, 'utf8');
  } else {
    console.error('Error: --plan <path> or --stdin is required.');
    process.exit(2);
  }

  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (err) {
    console.error(`Error: Failed to parse plan JSON: ${err.message}`);
    process.exit(2);
  }

  const result = checkPlan(plan);
  const json = JSON.stringify(result, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Self-cycle safety gate result written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }

  process.exit(result.decision === DECISIONS.BLOCKED ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateMainHealth,
  evaluateRisk,
  evaluateAllowlist,
  evaluateHumanGate,
  aggregateDecision,
  buildResult,
  checkPlan,
};
