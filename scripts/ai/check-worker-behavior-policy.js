#!/usr/bin/env node

/**
 * check-worker-behavior-policy.js
 *
 * Evaluates worker PR facts against the worker behavior policy defined in
 * docs/ai-native/worker-behavior-policy.md. Flags broad diffs, forbidden
 * drive-by files, and missing validation evidence.
 *
 * This is a deterministic, local-logic script. It reads PR facts JSON and
 * produces a policy check result. No network calls and no PR mutations.
 *
 * Policy principles checked:
 *   1. Simplest Viable Change — diff size within budgets
 *   2. Surgical Scope — only allowed files touched, no forbidden files
 *   3. Verifiable Evidence — validation commands recorded
 *
 * Usage:
 *   node scripts/ai/check-worker-behavior-policy.js --help
 *   node scripts/ai/check-worker-behavior-policy.js --pr-facts facts.json
 *   node scripts/ai/check-worker-behavior-policy.js --pr-facts facts.json --stdout
 *   cat facts.json | node scripts/ai/check-worker-behavior-policy.js --stdin
 *
 * Exit codes:
 *   0 — pass (no violations)
 *   1 — violation detected
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, readJson } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'worker-behavior-policy-result.json');

const SCHEMA_VERSION = 1;

const BROAD_DIFF_THRESHOLD = 500;       // lines changed
const BROAD_FILE_COUNT = 10;            // files touched
const BROAD_PATTERNS = ['src/**', '**/*', '**', 'src/**/**'];

const FORBIDDEN_PREFIXES = [
  '.env',
  'dist/',
  'node_modules/',
  'prisma/migrations/',
  '.github/ai-policy/seed-constitution.md',
  '.github/ai-state/',
];

const DECISIONS = { PASS: 'pass', VIOLATION: 'violation' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
check-worker-behavior-policy.js — Worker behavior policy checker

USAGE
    node scripts/ai/check-worker-behavior-policy.js [options]

OPTIONS
    --pr-facts <path>    Path to PR facts JSON file
    --stdin              Read PR facts JSON from stdin
    --out <path>         Output path for check result JSON
                         (default: .github/ai-state/worker-behavior-policy-result.json)
    --stdout             Print JSON to stdout instead of writing a file
    --help, -h           Show this help message and exit.

PR FACTS SCHEMA
    {
      "prNumber": 123,
      "branch": "claude/wave6-issue-123",
      "filesChanged": ["src/foo.ts", "src/bar.ts"],
      "linesAdded": 50,
      "linesRemoved": 20,
      "allowedFiles": ["src/foo.ts", "src/bar.ts"],
      "forbiddenFiles": [".env", "prisma/migrations/**"],
      "maxFiles": 10,
      "maxLinesChanged": 500,
      "validationCommands": ["npm test"],
      "validationOutput": "all tests passed"
    }

POLICY PRINCIPLES
    1. Simplest Viable Change — diff within budgets (maxFiles, maxLinesChanged)
    2. Surgical Scope — only allowed files touched, no forbidden files
    3. Verifiable Evidence — validation commands and output present

EXIT CODES
    0   pass (no violations)
    1   violation detected
    2   invalid arguments
`.trimStart();
  process.stdout.write(help);
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return null;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    prFacts: null,
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
    } else if (arg === '--pr-facts') {
      i++;
      if (i >= argv.length) { console.error('Error: --pr-facts requires a path'); process.exit(2); }
      args.prFacts = argv[i];
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

// ── Policy Evaluators ────────────────────────────────────────────────────────

/**
 * 1. Simplest Viable Change — diff size within budgets.
 */
function evaluateSimplestViableChange(facts) {
  const violations = [];
  const warnings = [];

  const maxFiles = facts.maxFiles || BROAD_FILE_COUNT;
  const maxLines = facts.maxLinesChanged || BROAD_DIFF_THRESHOLD;

  const filesChanged = facts.filesChanged || [];
  const linesAdded = facts.linesAdded || 0;
  const linesRemoved = facts.linesRemoved || 0;
  const totalLines = linesAdded + linesRemoved;

  // File count check
  if (filesChanged.length > maxFiles) {
    violations.push({
      code: 'TOO_MANY_FILES',
      message: `PR changes ${filesChanged.length} files (max ${maxFiles}). Diff is broader than necessary.`,
    });
  }

  // Diff size check
  if (totalLines > maxLines) {
    violations.push({
      code: 'DIFF_TOO_LARGE',
      message: `PR changes ${totalLines} lines (max ${maxLines}). Consider a smaller, more focused change.`,
    });
  }

  // Broad pattern check
  for (const file of filesChanged) {
    if (BROAD_PATTERNS.includes(file)) {
      violations.push({
        code: 'BROAD_DIFF_PATTERN',
        message: `File pattern "${file}" is overly broad. Use specific module-level paths.`,
      });
    }
  }

  return { violations, warnings };
}

/**
 * 2. Surgical Scope — only allowed files touched, no forbidden files.
 */
function evaluateSurgicalScope(facts) {
  const violations = [];
  const warnings = [];

  const filesChanged = facts.filesChanged || [];
  const allowedFiles = facts.allowedFiles || [];
  const forbiddenFiles = facts.forbiddenFiles || [];

  // Check for drive-by files (files changed that are not in allowedFiles)
  if (allowedFiles.length > 0) {
    for (const file of filesChanged) {
      const normalized = file.replace(/\\/g, '/');
      const isAllowed = allowedFiles.some(pattern => {
        const normalizedPattern = pattern.replace(/\\/g, '/');
        if (normalizedPattern.includes('*')) {
          const regex = new RegExp(
            '^' + normalizedPattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$'
          );
          return regex.test(normalized);
        }
        return normalized === normalizedPattern || normalized.startsWith(normalizedPattern);
      });

      if (!isAllowed) {
        violations.push({
          code: 'DRIVE_BY_FILE',
          message: `File "${file}" is not in allowedFiles. Workers must stay within surgical scope.`,
        });
      }
    }
  }

  // Check for forbidden file violations
  for (const file of filesChanged) {
    const normalized = file.replace(/\\/g, '/');
    for (const forbidden of forbiddenFiles) {
      const normalizedForbidden = forbidden.replace(/\\/g, '/');
      if (normalizedForbidden.includes('*')) {
        const regex = new RegExp(
          '^' + normalizedForbidden.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$'
        );
        if (regex.test(normalized)) {
          violations.push({
            code: 'FORBIDDEN_FILE_TOUCHED',
            message: `File "${file}" matches forbidden pattern "${forbidden}". Never touch forbidden files.`,
          });
        }
      } else if (normalized === normalizedForbidden || normalized.startsWith(normalizedForbidden)) {
        violations.push({
          code: 'FORBIDDEN_FILE_TOUCHED',
          message: `File "${file}" is forbidden. Never touch forbidden files.`,
        });
      }
    }
  }

  // Check against hardcoded forbidden prefixes
  for (const file of filesChanged) {
    const normalized = file.replace(/\\/g, '/');
    for (const prefix of FORBIDDEN_PREFIXES) {
      if (normalized === prefix || normalized.startsWith(prefix)) {
        violations.push({
          code: 'FORBIDDEN_FILE_TOUCHED',
          message: `File "${file}" matches forbidden prefix "${prefix}".`,
        });
      }
    }
  }

  return { violations, warnings };
}

/**
 * 3. Verifiable Evidence — validation commands and output present.
 */
function evaluateVerifiableEvidence(facts) {
  const violations = [];
  const warnings = [];

  const validationCommands = facts.validationCommands || [];
  const validationOutput = facts.validationOutput;

  // Validation commands must be declared
  if (validationCommands.length === 0) {
    violations.push({
      code: 'NO_VALIDATION_COMMANDS',
      message: 'No validationCommands defined. Every PR must declare how it was verified.',
    });
  }

  // Validation output must be present
  if (!validationOutput || (typeof validationOutput === 'string' && validationOutput.trim().length === 0)) {
    violations.push({
      code: 'NO_VALIDATION_EVIDENCE',
      message: 'No validationOutput present. PR body must include validation evidence.',
    });
  }

  return { violations, warnings };
}

// ── Decision Aggregation ─────────────────────────────────────────────────────

function aggregateDecision(results) {
  const allViolations = [];
  const allWarnings = [];

  for (const result of results) {
    allViolations.push(...result.violations);
    allWarnings.push(...result.warnings);
  }

  const decision = allViolations.length > 0 ? DECISIONS.VIOLATION : DECISIONS.PASS;
  const severity = allViolations.length > 0 ? 'error' : (allWarnings.length > 0 ? 'warning' : 'info');

  return { decision, severity, violations: allViolations, warnings: allWarnings };
}

// ── Result Builder ───────────────────────────────────────────────────────────

function buildResult(facts, decision, severity, violations, warnings) {
  return {
    schemaVersion: SCHEMA_VERSION,
    checkType: 'worker-behavior-policy',
    decision,
    severity,
    prNumber: facts.prNumber || null,
    branch: facts.branch || null,
    capturedAt: new Date().toISOString(),
    violations,
    warnings,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Load PR facts
  let raw;
  if (args.stdin) {
    raw = readStdin();
  } else if (args.prFacts) {
    if (!fs.existsSync(args.prFacts)) {
      console.error(`Error: PR facts file not found: ${args.prFacts}`);
      process.exit(2);
    }
    raw = fs.readFileSync(args.prFacts, 'utf8');
  } else {
    console.error('Error: --pr-facts <path> or --stdin is required.');
    process.exit(2);
  }

  let facts;
  try {
    facts = JSON.parse(raw);
  } catch (err) {
    console.error(`Error: Failed to parse PR facts JSON: ${err.message}`);
    process.exit(2);
  }

  // Run all policy evaluators
  const simplestResult = evaluateSimplestViableChange(facts);
  const scopeResult = evaluateSurgicalScope(facts);
  const evidenceResult = evaluateVerifiableEvidence(facts);

  // Aggregate
  const allResults = [simplestResult, scopeResult, evidenceResult];
  const { decision, severity, violations, warnings } = aggregateDecision(allResults);

  // Build output
  const result = buildResult(facts, decision, severity, violations, warnings);
  const json = JSON.stringify(result, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Worker behavior policy result written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }

  // Exit code: 0 for pass, 1 for violation
  process.exit(decision === DECISIONS.VIOLATION ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateSimplestViableChange,
  evaluateSurgicalScope,
  evaluateVerifiableEvidence,
  aggregateDecision,
  buildResult,
};
