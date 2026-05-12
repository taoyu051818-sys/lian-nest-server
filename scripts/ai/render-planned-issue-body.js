#!/usr/bin/env node

/**
 * render-planned-issue-body.js
 *
 * Single-source issue body renderer for the autonomous issue-production system.
 * Produces the canonical markdown template consumed by downstream parsers
 * (plan-next-batch.ps1, compile-issue-to-task-json.ps1).
 *
 * Sections: Goal, Scope, Evidence, Acceptance, Rollback, Constraints, CONTROL APPENDIX.
 *
 * Usage:
 *   const { renderIssueBody, renderControlAppendix } = require('./render-planned-issue-body');
 *   const body = renderIssueBody(candidate);
 *
 * This module is the single source of truth for issue body rendering.
 * Callers (write-planned-issues.ps1, propose-self-cycle-issues.js, create-issues.js)
 * should delegate to this module instead of inlining their own template logic.
 */

'use strict';

// ── Renderer ──────────────────────────────────────────────────────────────────

/**
 * Render a complete issue body from a candidate/proposal object.
 *
 * @param {object} candidate
 * @param {string} candidate.title - Issue title (used as Goal text)
 * @param {string} candidate.taskType - e.g. 'execution', 'infra', 'docs'
 * @param {string} candidate.risk - 'low' | 'medium' | 'high'
 * @param {string} candidate.conflictGroup - Conflict group identifier
 * @param {string} candidate.actorRole - Actor role for the role packet
 * @param {string[]} candidate.allowedFiles - File globs the worker may touch
 * @param {string[]} candidate.forbiddenFiles - File globs the worker must not touch
 * @param {string[]} candidate.validationCommands - Commands to validate the PR
 * @param {string} [candidate.rationale] - Why this issue exists
 * @param {string} [candidate.readinessNote] - Readiness status note
 * @param {string} [candidate.sliceRef] - Reference to the architecture slice
 * @param {string} [candidate.evidence] - Evidence supporting this issue
 * @param {string} [candidate.rollback] - Rollback plan if the change fails
 * @param {string} [candidate.macroGoal] - High-level goal for the role packet
 * @param {string} [candidate.sliceStatus] - Slice status for the role packet
 * @param {number|string} [candidate.compositeScore] - Composite score for the role packet
 * @param {number|string} [candidate.issueNumber] - Issue number (if known)
 * @returns {string} Complete issue body markdown
 */
function renderIssueBody(candidate) {
  const lines = [];

  // ── Goal ──
  lines.push('## Goal');
  lines.push('');
  lines.push(candidate.title || '');
  lines.push('');

  // ── Scope ──
  lines.push('## Scope');
  lines.push('');
  lines.push(`Task type: ${candidate.taskType || 'execution'}`);
  if (candidate.rationale) {
    lines.push('');
    lines.push(`Rationale: ${candidate.rationale}`);
  }
  if (candidate.readinessNote) {
    lines.push('');
    lines.push(`Readiness: ${candidate.readinessNote}`);
  }
  if (candidate.sliceRef) {
    lines.push('');
    lines.push(`Slice: ${candidate.sliceRef}`);
  }
  lines.push('');

  // ── Evidence (optional) ──
  if (candidate.evidence) {
    lines.push('## Evidence');
    lines.push('');
    lines.push(candidate.evidence);
    lines.push('');
  }

  // ── Acceptance ──
  lines.push('## Acceptance');
  lines.push('');
  const commands = candidate.validationCommands && candidate.validationCommands.length > 0
    ? candidate.validationCommands
    : ['npm run check'];
  for (const vc of commands) {
    lines.push(`- \`${vc}\` passes`);
  }
  lines.push('');

  // ── Rollback (optional) ──
  if (candidate.rollback) {
    lines.push('## Rollback');
    lines.push('');
    lines.push(candidate.rollback);
    lines.push('');
  }

  // ── Constraints ──
  lines.push('## Constraints');
  lines.push('');
  lines.push('- Stay within allowed files.');
  lines.push('- Do not edit forbidden files.');
  lines.push('');

  // ── CONTROL APPENDIX ──
  lines.push(renderControlAppendix(candidate));

  return lines.join('\n');
}

/**
 * Render only the CONTROL APPENDIX block.
 * Downstream parsers (plan-next-batch.ps1, compile-issue-to-task-json.ps1)
 * depend on the exact field labels and line structure.
 *
 * @param {object} candidate - Same shape as renderIssueBody
 * @returns {string} CONTROL APPENDIX markdown block
 */
function renderControlAppendix(candidate) {
  const lines = [];

  lines.push('---');
  lines.push('CONTROL APPENDIX (launcher generated)');
  lines.push(`Task type: ${candidate.taskType || 'execution'}`);
  lines.push(`Risk: ${candidate.risk || 'low'}`);
  lines.push(`Conflict group: ${candidate.conflictGroup || 'ai-auto'}`);
  lines.push(`Target issue: ${candidate.issueNumber || ''}`);
  lines.push('Target PR: ');
  lines.push(`Issues: ${candidate.issueNumber || ''}`);
  lines.push('Expected PR: True');
  lines.push('Allowed files:');
  const allowed = candidate.allowedFiles && candidate.allowedFiles.length > 0
    ? candidate.allowedFiles
    : ['docs/**', 'scripts/ai/**'];
  for (const af of allowed) {
    lines.push(`- ${af}`);
  }
  lines.push('Forbidden files:');
  if (candidate.forbiddenFiles && candidate.forbiddenFiles.length > 0) {
    for (const ff of candidate.forbiddenFiles) {
      lines.push(`- ${ff}`);
    }
  } else {
    lines.push('- (none specified)');
  }
  lines.push('Validation commands:');
  const vcs = candidate.validationCommands && candidate.validationCommands.length > 0
    ? candidate.validationCommands
    : ['npm run check'];
  for (const vc of vcs) {
    lines.push(`- ${vc}`);
  }
  lines.push('Use these boundaries as hard constraints. If the requested fix requires files outside allowedFiles, stop and explain the blocker instead of making an unbounded change.');
  lines.push('Do NOT output secrets, tokens, auth output, credentials, .env contents, local transcript contents, or llm_io_logs contents.');
  lines.push('');
  lines.push('Role packet:');
  lines.push(`Actor role: ${candidate.actorRole || 'automation-cycle-worker'}`);
  if (candidate.macroGoal) {
    lines.push(`Macro goal: ${candidate.macroGoal}`);
  }
  if (candidate.sliceStatus) {
    lines.push(`Slice status: ${candidate.sliceStatus}`);
  }
  if (candidate.compositeScore !== undefined && candidate.compositeScore !== '') {
    lines.push(`Composite score: ${candidate.compositeScore}`);
  }

  return lines.join('\n');
}

/**
 * Build a candidate object with default values.
 *
 * @param {object} overrides - Fields to override
 * @returns {object} Complete candidate with defaults
 */
function makeCandidate(overrides) {
  return {
    issueNumber: null,
    title: '',
    taskType: 'execution',
    risk: 'low',
    conflictGroup: 'ai-auto',
    actorRole: 'automation-cycle-worker',
    allowedFiles: ['docs/**', 'scripts/ai/**'],
    forbiddenFiles: ['src/**', 'prisma/**', 'package.json'],
    validationCommands: ['npm run check'],
    readiness: 'ready',
    readinessNote: '',
    macroGoal: '',
    rationale: '',
    evidence: '',
    rollback: '',
    sliceRef: '',
    sliceStatus: '',
    compositeScore: '',
    humanRequired: false,
    ...overrides,
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`Usage:
  node render-planned-issue-body.js --help
  node render-planned-issue-body.js --candidate <json-file>
  node render-planned-issue-body.js --stdin
  echo '{"title":"..."}' | node render-planned-issue-body.js --stdin

Renders an issue body from a candidate JSON object.

Options:
  --candidate <file>  Read candidate JSON from file
  --stdin             Read candidate JSON from stdin
  --control-only      Render only the CONTROL APPENDIX block
  --help              Show this help message`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  let input = null;
  const controlOnly = args.includes('--control-only');

  if (args.includes('--stdin')) {
    const fs = require('fs');
    input = fs.readFileSync(0, 'utf8');
  } else if (args.includes('--candidate')) {
    const fs = require('fs');
    const path = require('path');
    const idx = args.indexOf('--candidate');
    const filePath = path.resolve(args[idx + 1]);
    input = fs.readFileSync(filePath, 'utf8');
  }

  if (!input) {
    console.error('Error: No input provided. Use --candidate <file> or --stdin.');
    process.exit(1);
  }

  let candidate;
  try {
    candidate = JSON.parse(input);
  } catch (err) {
    console.error(`Error: Invalid JSON input: ${err.message}`);
    process.exit(1);
  }

  const body = controlOnly
    ? renderControlAppendix(candidate)
    : renderIssueBody(candidate);

  process.stdout.write(body + '\n');
}

if (require.main === module) {
  main();
}

module.exports = {
  renderIssueBody,
  renderControlAppendix,
  makeCandidate,
};
