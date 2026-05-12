#!/usr/bin/env node

/**
 * check-agent-idea-gate.js
 *
 * Evaluates agent-generated idea candidates against the five gate criteria
 * defined in docs/ai-native/agent-idea-review-gate.md before they become
 * GitHub issues.
 *
 * This is a deterministic, local-logic script. It reads a candidate idea
 * JSON file and produces a gate result conforming to the gate-result-schema
 * with gateType "idea-review". No network calls — external checks (duplicate
 * issues, in-flight workers) are deferred to the caller.
 *
 * Gate criteria:
 *   1. Signal Quality     — source signal exists, is current, severity justifies action
 *   2. Novelty Check      — no duplicate issue or in-flight worker (local flags only)
 *   3. Scope Feasibility  — bounded files, single responsibility, acceptance criteria
 *   4. Architectural Fit  — no forbidden patterns, file scope reasonable
 *   5. Resource Availability — conflict group present, capacity hints
 *
 * Usage:
 *   node scripts/ai/check-agent-idea-gate.js --help
 *   node scripts/ai/check-agent-idea-gate.js --candidate idea.json
 *   node scripts/ai/check-agent-idea-gate.js --candidate idea.json --stdout
 *   cat idea.json | node scripts/ai/check-agent-idea-gate.js --stdin
 *
 * Exit codes:
 *   0 — promote or warn (no hard blockers)
 *   1 — reject (one or more blockers)
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'agent-idea-gate-result.json');

const SCHEMA_VERSION = 1;
const GATE_TYPE = 'idea-review';

const SIGNAL_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ALLOWED_FILES = 10;
const BROAD_PATTERNS = ['src/**', '**/*', '**', 'src/**/**'];

const FORBIDDEN_PREFIXES = ['.env', 'dist/', 'node_modules/', 'prisma/migrations/'];

const DECISIONS = { PROMOTE: 'promote', DEFER: 'defer', REJECT: 'reject', WARN: 'warn' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
check-agent-idea-gate.js — Agent idea review gate evaluator

USAGE
    node scripts/ai/check-agent-idea-gate.js [options]

OPTIONS
    --candidate <path>   Path to idea candidate JSON file
    --stdin              Read candidate JSON from stdin
    --out <path>         Output path for gate result JSON
                         (default: .github/ai-state/agent-idea-gate-result.json)
    --stdout             Print JSON to stdout instead of writing a file
    --help, -h           Show this help message and exit.

IDEA CANDIDATE SCHEMA
    {
      "source": "meta-signal" | "stale-row" | "gap-ledger" | "human-request",
      "title": "string (required)",
      "reason": "string",
      "confidence": 0-100,
      "priority": "critical" | "high" | "medium" | "low" | "info",
      "signalValues": { "failureScore": 0, "frictionScore": 0, ... },
      "signalCapturedAt": "ISO-8601 (optional)",
      "actionHint": "string",
      "suggestedConflictGroup": "string",
      "suggestedAllowedFiles": ["path/pattern", ...],
      "suggestedWorkerType": "string",
      "acceptanceCriteria": ["criterion 1", ...],
      "validationCommands": ["cmd1", ...]
    }

GATE CRITERIA
    1. Signal Quality      — source signal exists and is current
    2. Novelty Check       — no duplicate (local flags; network checks deferred)
    3. Scope Feasibility   — bounded files, acceptance criteria exist
    4. Architectural Fit   — no forbidden file patterns
    5. Resource Availability — conflict group and worker type present

EXIT CODES
    0   promote or warn (no hard blockers)
    1   reject (one or more blockers)
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
 * 1. Signal Quality — source signal exists, is current, severity justifies action.
 */
function evaluateSignalQuality(candidate) {
  const blockers = [];
  const warnings = [];
  const factsRead = [];

  // Source must be declared
  const validSources = ['meta-signal', 'stale-row', 'gap-ledger', 'human-request'];
  if (!candidate.source || !validSources.includes(candidate.source)) {
    blockers.push({
      code: 'NO_SOURCE_SIGNAL',
      message: `Idea has no traceable origin. source must be one of: ${validSources.join(', ')}. Got: "${candidate.source || ''}"`,
    });
    return { blockers, warnings, factsRead };
  }

  factsRead.push({ source: 'candidate.source', summary: `source=${candidate.source}` });

  // Freshness check: signal must be within 7 days
  if (candidate.signalCapturedAt) {
    const capturedMs = new Date(candidate.signalCapturedAt).getTime();
    if (isNaN(capturedMs)) {
      warnings.push({
        code: 'UNPARSEABLE_SIGNAL_DATE',
        message: `signalCapturedAt "${candidate.signalCapturedAt}" is not a valid ISO-8601 date.`,
      });
    } else {
      const ageMs = Date.now() - capturedMs;
      factsRead.push({ source: 'candidate.signalCapturedAt', summary: `age=${Math.round(ageMs / 3600000)}h` });
      if (ageMs > SIGNAL_STALE_MS) {
        blockers.push({
          code: 'STALE_SIGNAL',
          message: `Source signal is ${Math.round(ageMs / 86400000)} days old (max 7 days).`,
        });
      }
    }
  }

  // Severity check: at least one signal value must justify action
  const sv = candidate.signalValues || {};
  const humanRequest = candidate.source === 'human-request';
  const severityMet = humanRequest
    || (sv.failureScore != null && sv.failureScore > 0)
    || (sv.frictionScore != null && sv.frictionScore > 30)
    || (sv.riskScore != null && sv.riskScore > 40);

  if (!severityMet) {
    blockers.push({
      code: 'INSUFFICIENT_SEVERITY',
      message: 'No signal value meets severity threshold (failureScore>0, frictionScore>30, riskScore>40, or human-request).',
    });
  }

  return { blockers, warnings, factsRead };
}

/**
 * 2. Novelty Check — local-only flags. Network-based duplicate/in-flight checks
 *    are deferred to the caller (this script does not call gh CLI).
 */
function evaluateNovelty(candidate) {
  const blockers = [];
  const warnings = [];

  // This script performs local-only checks. If the caller has pre-populated
  // duplicate or in-flight flags, honor them.
  if (candidate.duplicateIssueNumber) {
    blockers.push({
      code: 'DUPLICATE_ISSUE',
      message: `Open issue #${candidate.duplicateIssueNumber} already covers this scope.`,
    });
  }

  if (candidate.workerInFlight) {
    blockers.push({
      code: 'WORKER_IN_FLIGHT',
      message: 'A worker is actively implementing overlapping scope.',
    });
  }

  if (candidate.recentlyCompletedPR) {
    warnings.push({
      code: 'RECENTLY_COMPLETED',
      message: `PR #${candidate.recentlyCompletedPR} addressed similar scope within 30 days. May be regression or different angle.`,
    });
  }

  return { blockers, warnings };
}

/**
 * 3. Scope Feasibility — bounded files, single responsibility, acceptance criteria.
 */
function evaluateScopeFeasibility(candidate) {
  const blockers = [];
  const warnings = [];

  const allowedFiles = candidate.suggestedAllowedFiles || [];

  // File scope must be bounded
  if (allowedFiles.length === 0) {
    blockers.push({
      code: 'NO_ALLOWED_FILES',
      message: 'suggestedAllowedFiles is empty. Idea must specify at least one target file.',
    });
  } else if (allowedFiles.length > MAX_ALLOWED_FILES) {
    blockers.push({
      code: 'SCOPE_TOO_BROAD',
      message: `suggestedAllowedFiles has ${allowedFiles.length} entries (max ${MAX_ALLOWED_FILES}).`,
    });
  }

  // Check for overly broad patterns
  for (const pattern of allowedFiles) {
    if (BROAD_PATTERNS.includes(pattern)) {
      blockers.push({
        code: 'SCOPE_TOO_BROAD',
        message: `Pattern "${pattern}" is overly broad. Use module-level patterns like src/modules/<name>/**.`,
      });
    }
  }

  // Acceptance criteria must exist
  const criteria = candidate.acceptanceCriteria || [];
  if (criteria.length === 0) {
    blockers.push({
      code: 'NO_ACCEPTANCE_CRITERIA',
      message: 'No acceptance criteria defined. Idea must include at least one verifiable criterion.',
    });
  }

  // Validation commands should exist
  const cmds = candidate.validationCommands || [];
  if (cmds.length === 0) {
    warnings.push({
      code: 'NO_VALIDATION_COMMANDS',
      message: 'No validation commands defined. At least one command should verify the outcome.',
    });
  }

  // Single responsibility — warn if title suggests mixed concerns
  if (candidate.title) {
    const concernMarkers = ['and', 'also', 'refactor', 'document'];
    const titleLower = candidate.title.toLowerCase();
    const mixedMarkers = concernMarkers.filter(m => titleLower.includes(m));
    if (mixedMarkers.length > 0) {
      warnings.push({
        code: 'MULTI_CONCERN',
        message: `Title contains "${mixedMarkers.join('", "')}" suggesting mixed concerns. Consider splitting.`,
      });
    }
  }

  return { blockers, warnings };
}

/**
 * 4. Architectural Fit — no forbidden patterns, reasonable file scope.
 */
function evaluateArchitecturalFit(candidate) {
  const blockers = [];
  const warnings = [];

  const allowedFiles = candidate.suggestedAllowedFiles || [];

  // Check against forbidden prefixes
  for (const pattern of allowedFiles) {
    const normalized = pattern.replace(/\\/g, '/');
    for (const forbidden of FORBIDDEN_PREFIXES) {
      if (normalized === forbidden || normalized.startsWith(forbidden)) {
        blockers.push({
          code: 'FORBIDDEN_FILE_PATTERN',
          message: `Pattern "${pattern}" targets forbidden path "${forbidden}".`,
        });
      }
    }
  }

  return { blockers, warnings };
}

/**
 * 5. Resource Availability — conflict group and worker type present.
 */
function evaluateResourceAvailability(candidate) {
  const blockers = [];
  const warnings = [];

  // Conflict group should be present for dedup
  if (!candidate.suggestedConflictGroup) {
    warnings.push({
      code: 'NO_CONFLICT_GROUP',
      message: 'No suggestedConflictGroup defined. Deduplication may be impaired.',
    });
  }

  // Worker type should be specified
  if (!candidate.suggestedWorkerType) {
    warnings.push({
      code: 'NO_WORKER_TYPE',
      message: 'No suggestedWorkerType defined. Launch gate may reject without it.',
    });
  }

  // Check pre-populated collision flag
  if (candidate.conflictGroupCollision) {
    blockers.push({
      code: 'CONFLICT_GROUP_COLLISION',
      message: `Conflict group "${candidate.suggestedConflictGroup}" collides with an active worker.`,
    });
  }

  // Check pre-populated batch capacity flag
  if (candidate.batchFull) {
    // This is a defer, not a reject
    return { blockers: [], warnings: [], defer: true, deferReason: 'BATCH_FULL' };
  }

  return { blockers, warnings, defer: false };
}

// ── Decision Aggregation ─────────────────────────────────────────────────────

function aggregateDecision(criteriaResults) {
  const allBlockers = [];
  const allWarnings = [];
  let hasDefer = false;

  for (const result of criteriaResults) {
    allBlockers.push(...result.blockers);
    allWarnings.push(...result.warnings);
    if (result.defer) hasDefer = true;
  }

  let decision;
  let severity;

  if (allBlockers.length > 0) {
    decision = DECISIONS.REJECT;
    severity = 'error';
  } else if (hasDefer) {
    decision = DECISIONS.DEFER;
    severity = 'warning';
  } else if (allWarnings.length > 0) {
    decision = DECISIONS.WARN;
    severity = 'warning';
  } else {
    decision = DECISIONS.PROMOTE;
    severity = 'info';
  }

  return { decision, severity, blockers: allBlockers, warnings: allWarnings };
}

// ── Gate Result Builder ──────────────────────────────────────────────────────

function buildGateResult(candidate, decision, severity, blockers, warnings, allFactsRead) {
  const hashInput = (candidate.title || '') + (candidate.suggestedConflictGroup || '');
  const markerId = `idea-${shortHash(hashInput)}-review`;

  const producedFacts = [];
  if (candidate.source) producedFacts.push({ key: 'idea-source', value: candidate.source });
  if (candidate.suggestedConflictGroup) producedFacts.push({ key: 'conflict-group', value: candidate.suggestedConflictGroup });
  if (candidate.suggestedWorkerType) producedFacts.push({ key: 'worker-type', value: candidate.suggestedWorkerType });

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

  // Run all five gate criteria
  const factsRead = [];

  const signalResult = evaluateSignalQuality(candidate);
  factsRead.push(...signalResult.factsRead);

  const noveltyResult = evaluateNovelty(candidate);

  const scopeResult = evaluateScopeFeasibility(candidate);

  const archResult = evaluateArchitecturalFit(candidate);

  const resourceResult = evaluateResourceAvailability(candidate);

  // Aggregate
  const allResults = [signalResult, noveltyResult, scopeResult, archResult, resourceResult];
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
    process.stdout.write(`Agent idea gate result written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }

  // Exit code: 0 for promote/warn, 1 for reject
  process.exit(decision === DECISIONS.REJECT ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateSignalQuality,
  evaluateNovelty,
  evaluateScopeFeasibility,
  evaluateArchitecturalFit,
  evaluateResourceAvailability,
  aggregateDecision,
  buildGateResult,
  shortHash,
};
