#!/usr/bin/env node

/**
 * check-planned-issue-quality.js
 *
 * Evaluates planned issue candidates against quality criteria to reject
 * shallow generated issues that lack evidence, boundaries, validation,
 * rollback, or unique conflict groups.
 *
 * This is a deterministic, local-logic script. It reads an issue body
 * (markdown with CONTROL APPENDIX) and produces a gate result conforming
 * to the gate-result-schema with gateType "planned-issue-quality".
 *
 * Gate criteria:
 *   1. Evidence           — issue body has Goal, Scope, Acceptance, Constraints sections
 *   2. File Boundaries    — allowedFiles and forbiddenFiles present and non-empty
 *   3. Validation         — validation commands defined in Acceptance section
 *   4. Conflict Group     — unique conflictGroup present in CONTROL APPENDIX
 *   5. Risk Declaration   — risk field present and valid
 *   6. Rollback Plan      — rollback or follow-up strategy declared
 *   7. Control Appendix   — CONTROL APPENDIX block present with required fields
 *
 * Usage:
 *   node scripts/ai/check-planned-issue-quality.js --help
 *   node scripts/ai/check-planned-issue-quality.js --issue issue-body.md
 *   node scripts/ai/check-planned-issue-quality.js --issue issue-body.md --stdout
 *   cat issue.md | node scripts/ai/check-planned-issue-quality.js --stdin
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
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'planned-issue-quality-result.json');

const SCHEMA_VERSION = 1;
const GATE_TYPE = 'planned-issue-quality';

const VALID_RISKS = ['low', 'medium', 'high'];

const DECISIONS = { PASS: 'pass', BLOCK: 'block', WARN: 'warn', OVERRIDE: 'override' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
check-planned-issue-quality.js — Planned issue quality gate evaluator

USAGE
    node scripts/ai/check-planned-issue-quality.js [options]

OPTIONS
    --issue <path>       Path to issue body markdown file
    --stdin              Read issue body from stdin
    --out <path>         Output path for gate result JSON
                         (default: .github/ai-state/planned-issue-quality-result.json)
    --stdout             Print JSON to stdout instead of writing a file
    --help, -h           Show this help message and exit.

GATE CRITERIA
    1. Evidence            — Goal, Scope, Acceptance, Constraints sections present
    2. File Boundaries     — allowedFiles and forbiddenFiles declared
    3. Validation          — validation commands in Acceptance section
    4. Conflict Group      — unique conflictGroup in CONTROL APPENDIX
    5. Risk Declaration    — risk field present and valid (low/medium/high)
    6. Rollback Plan       — rollback or follow-up strategy declared
    7. Control Appendix    — CONTROL APPENDIX block present with required fields

EXIT CODES
    0   pass or warn (no hard blockers)
    1   block (one or more blockers)
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

function shortHash(input) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    issue: null,
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
    } else if (arg === '--issue') {
      i++;
      if (i >= argv.length) { console.error('Error: --issue requires a path'); process.exit(2); }
      args.issue = argv[i];
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

// ── CONTROL APPENDIX Parser ──────────────────────────────────────────────────

function parseControlAppendix(body) {
  const appendix = {};
  const marker = 'CONTROL APPENDIX';
  const idx = body.indexOf(marker);
  if (idx === -1) return null;

  const block = body.slice(idx + marker.length);
  const lines = block.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('---')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    if (key && value) {
      appendix[key] = value;
    }
  }

  return Object.keys(appendix).length > 0 ? appendix : null;
}

// ── Section Detectors ────────────────────────────────────────────────────────

function hasSection(body, sectionName) {
  const patterns = [
    new RegExp(`^##\\s+${sectionName}\\b`, 'im'),
    new RegExp(`^###\\s+${sectionName}\\b`, 'im'),
  ];
  return patterns.some(re => re.test(body));
}

function extractSection(body, sectionName) {
  const re = new RegExp(`^##\\s+${sectionName}\\b`, 'im');
  const match = re.exec(body);
  if (!match) return '';

  const start = match.index + match[0].length;
  const nextSection = body.slice(start).search(/^##\s+/m);
  const end = nextSection === -1 ? body.length : start + nextSection;

  return body.slice(start, end).trim();
}

// ── Gate Criteria Evaluators ─────────────────────────────────────────────────

/**
 * 1. Evidence — issue body has Goal, Scope, Acceptance, Constraints sections.
 */
function evaluateEvidence(body) {
  const blockers = [];
  const warnings = [];
  const factsRead = [];

  const requiredSections = ['Goal', 'Scope', 'Acceptance', 'Constraints'];
  const missing = [];

  for (const section of requiredSections) {
    if (!hasSection(body, section)) {
      missing.push(section);
    }
  }

  factsRead.push({ source: 'issue-body', summary: `sections present: ${requiredSections.filter(s => hasSection(body, s)).join(', ') || 'none'}` });

  if (missing.length > 0) {
    blockers.push({
      code: 'MISSING_SECTIONS',
      message: `Issue body missing required sections: ${missing.join(', ')}. Every planned issue needs Goal, Scope, Acceptance, and Constraints.`,
    });
  }

  // Check that sections are non-empty
  const emptySections = [];
  for (const section of requiredSections) {
    if (hasSection(body, section)) {
      const content = extractSection(body, section);
      if (content.length < 10) {
        emptySections.push(section);
      }
    }
  }

  if (emptySections.length > 0) {
    warnings.push({
      code: 'THIN_SECTIONS',
      message: `Sections appear too thin: ${emptySections.join(', ')}. Add substantive content to guide workers.`,
    });
  }

  return { blockers, warnings, factsRead };
}

/**
 * 2. File Boundaries — allowedFiles and forbiddenFiles present.
 */
function evaluateFileBoundaries(body, appendix) {
  const blockers = [];
  const warnings = [];

  const hasAllowed = /allowed\s*files/i.test(body) || (appendix && /allowed\s*files/i.test(Object.keys(appendix).join(' ')));
  const hasForbidden = /forbidden\s*files/i.test(body) || (appendix && /forbidden\s*files/i.test(Object.keys(appendix).join(' ')));

  // Check appendix for Allowed files / Forbidden files values
  const appendixAllowed = appendix && (appendix['Allowed files'] || appendix['allowedFiles'] || appendix['Allowed files:']);
  const appendixForbidden = appendix && (appendix['Forbidden files'] || appendix['forbiddenFiles'] || appendix['Forbidden files:']);

  if (!hasAllowed && !appendixAllowed) {
    blockers.push({
      code: 'NO_ALLOWED_FILES',
      message: 'No allowedFiles boundary declared. Every planned issue must specify its file scope.',
    });
  }

  if (!hasForbidden && !appendixForbidden) {
    warnings.push({
      code: 'NO_FORBIDDEN_FILES',
      message: 'No forbiddenFiles declared. Consider declaring files that must not be touched.',
    });
  }

  return { blockers, warnings };
}

/**
 * 3. Validation — validation commands defined.
 */
function evaluateValidation(body, appendix) {
  const blockers = [];
  const warnings = [];
  const factsRead = [];

  const hasValidationSection = /validation\s*commands?/i.test(body);
  const hasAcceptanceValidation = hasSection(body, 'Acceptance') && /validation|command|pass|npm\s+run|test/i.test(extractSection(body, 'Acceptance'));

  // Check appendix for Validation commands
  const appendixValidation = appendix && (appendix['Validation commands'] || appendix['validationCommands']);
  const appendixHasValidation = appendixValidation && appendixValidation.trim().length > 0;

  const hasValidation = hasValidationSection || hasAcceptanceValidation || appendixHasValidation;

  factsRead.push({ source: 'issue-body', summary: `validation present: ${hasValidation}` });

  if (!hasValidation) {
    blockers.push({
      code: 'NO_VALIDATION',
      message: 'No validation commands found. Every planned issue must include at least one command to verify the outcome.',
    });
  }

  return { blockers, warnings, factsRead };
}

/**
 * 4. Conflict Group — unique conflictGroup present.
 */
function evaluateConflictGroup(body, appendix) {
  const blockers = [];
  const warnings = [];

  const appendixGroup = appendix && (appendix['Conflict group'] || appendix['conflictGroup']);

  if (!appendixGroup) {
    blockers.push({
      code: 'NO_CONFLICT_GROUP',
      message: 'No conflictGroup in CONTROL APPENDIX. Every planned issue must declare a unique conflict group for deduplication.',
    });
  } else if (appendixGroup.trim().length === 0) {
    blockers.push({
      code: 'EMPTY_CONFLICT_GROUP',
      message: 'conflictGroup is empty. Provide a meaningful group identifier.',
    });
  }

  return { blockers, warnings };
}

/**
 * 5. Risk Declaration — risk field present and valid.
 */
function evaluateRisk(body, appendix) {
  const blockers = [];
  const warnings = [];

  const appendixRisk = appendix && (appendix['Risk'] || appendix['risk']);

  if (!appendixRisk) {
    blockers.push({
      code: 'NO_RISK_DECLARED',
      message: 'No risk field in CONTROL APPENDIX. Every planned issue must declare its risk level.',
    });
  } else {
    const riskLower = appendixRisk.toLowerCase();
    if (!VALID_RISKS.includes(riskLower)) {
      blockers.push({
        code: 'INVALID_RISK',
        message: `Risk "${appendixRisk}" is not valid. Must be one of: ${VALID_RISKS.join(', ')}.`,
      });
    }

    if (riskLower === 'high') {
      warnings.push({
        code: 'HIGH_RISK_ISSUE',
        message: 'High-risk issue detected. Ensure human review before launching workers.',
      });
    }
  }

  return { blockers, warnings };
}

/**
 * 6. Rollback Plan — rollback or follow-up strategy declared.
 */
function evaluateRollback(body, appendix) {
  const blockers = [];
  const warnings = [];

  // Check for rollback keywords in body
  const hasRollbackInBody = /rollback|revert|follow[- ]up|mitigation/i.test(body);

  // Check appendix for rollback-related fields
  const hasRollbackInAppendix = appendix && (
    appendix['rollbackPlan'] ||
    appendix['Rollback'] ||
    /rollback|revert|follow[- ]up/i.test(JSON.stringify(appendix))
  );

  if (!hasRollbackInBody && !hasRollbackInAppendix) {
    blockers.push({
      code: 'NO_ROLLBACK_PLAN',
      message: 'No rollback or follow-up strategy found. Every planned issue must describe how to recover if something goes wrong.',
    });
  }

  return { blockers, warnings };
}

/**
 * 7. Control Appendix — CONTROL APPENDIX block present with required fields.
 */
function evaluateControlAppendix(body, appendix) {
  const blockers = [];
  const warnings = [];
  const factsRead = [];

  if (!appendix) {
    blockers.push({
      code: 'NO_CONTROL_APPENDIX',
      message: 'No CONTROL APPENDIX block found. Every planned issue must include a machine-readable CONTROL APPENDIX.',
    });
    return { blockers, warnings, factsRead };
  }

  factsRead.push({ source: 'CONTROL APPENDIX', summary: `fields: ${Object.keys(appendix).join(', ')}` });

  const requiredFields = ['Task type', 'Risk', 'Conflict group'];
  const missingFields = [];

  for (const field of requiredFields) {
    const found = Object.keys(appendix).some(k =>
      k.toLowerCase().replace(/\s+/g, ' ') === field.toLowerCase()
    );
    if (!found) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    blockers.push({
      code: 'INCOMPLETE_APPENDIX',
      message: `CONTROL APPENDIX missing required fields: ${missingFields.join(', ')}.`,
    });
  }

  return { blockers, warnings, factsRead };
}

// ── Decision Aggregation ─────────────────────────────────────────────────────

function aggregateDecision(criteriaResults) {
  const allBlockers = [];
  const allWarnings = [];
  const allFactsRead = [];

  for (const result of criteriaResults) {
    allBlockers.push(...result.blockers);
    allWarnings.push(...result.warnings);
    if (result.factsRead) allFactsRead.push(...result.factsRead);
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

  return { decision, severity, blockers: allBlockers, warnings: allWarnings, factsRead: allFactsRead };
}

// ── Gate Result Builder ──────────────────────────────────────────────────────

function buildGateResult(targetIssue, decision, severity, blockers, warnings, factsRead) {
  const markerId = `issue-${targetIssue || 'unknown'}-planned-quality`;

  return {
    schemaVersion: SCHEMA_VERSION,
    gateType: GATE_TYPE,
    decision,
    severity,
    markerId,
    capturedAt: new Date().toISOString(),
    targetIssue: targetIssue || null,
    targetPR: null,
    factsRead,
    blockers,
    warnings,
    producedFacts: [],
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Load issue body
  let raw;
  if (args.stdin) {
    raw = readStdin();
  } else if (args.issue) {
    if (!fs.existsSync(args.issue)) {
      console.error(`Error: Issue file not found: ${args.issue}`);
      process.exit(2);
    }
    raw = fs.readFileSync(args.issue, 'utf8');
  } else {
    console.error('Error: --issue <path> or --stdin is required.');
    process.exit(2);
  }

  if (!raw || raw.trim().length === 0) {
    console.error('Error: Issue body is empty.');
    process.exit(2);
  }

  const body = raw;
  const appendix = parseControlAppendix(body);

  // Extract target issue number from appendix if present
  const targetIssue = appendix && (appendix['Target issue'] || appendix['targetIssue'])
    ? parseInt(appendix['Target issue'] || appendix['targetIssue'], 10) || null
    : null;

  // Run all gate criteria
  const evidenceResult = evaluateEvidence(body);
  const boundaryResult = evaluateFileBoundaries(body, appendix);
  const validationResult = evaluateValidation(body, appendix);
  const conflictResult = evaluateConflictGroup(body, appendix);
  const riskResult = evaluateRisk(body, appendix);
  const rollbackResult = evaluateRollback(body, appendix);
  const appendixResult = evaluateControlAppendix(body, appendix);

  // Aggregate
  const allResults = [evidenceResult, boundaryResult, validationResult, conflictResult, riskResult, rollbackResult, appendixResult];
  const { decision, severity, blockers, warnings, factsRead } = aggregateDecision(allResults);

  // Build output
  const gateResult = buildGateResult(targetIssue, decision, severity, blockers, warnings, factsRead);
  const json = JSON.stringify(gateResult, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Planned issue quality gate result written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }

  // Exit code: 0 for pass/warn, 1 for block
  process.exit(decision === DECISIONS.BLOCK ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseControlAppendix,
  hasSection,
  extractSection,
  evaluateEvidence,
  evaluateFileBoundaries,
  evaluateValidation,
  evaluateConflictGroup,
  evaluateRisk,
  evaluateRollback,
  evaluateControlAppendix,
  aggregateDecision,
  buildGateResult,
  shortHash,
};
