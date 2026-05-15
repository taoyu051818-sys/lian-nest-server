'use strict';

/**
 * Shared utilities for the issue-production pipeline.
 *
 * Consolidates deduplication, policy gate, candidate shaping, GitHub CLI
 * wrappers, and issue-body rendering that were previously duplicated across
 * propose-self-cycle-issues.js, propose-external-intake-issues.js, and
 * reduce-gaps-to-issues.js.
 *
 * Every issue producer script should import from this module instead of
 * inlining its own copy of these functions.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const { REPO_ROOT } = require('./constants');

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');

const ALLOWED_SCOPES = [
  'docs/**',
  'scripts/ai/**',
  'schemas/**',
  '.github/ai-state/*.example.json',
];

const FORBIDDEN_SCOPES = [
  'src/**',
  'prisma/**',
  'package.json',
  'package-lock.json',
  '.github/ai-policy/seed-constitution.md',
];

const FORBIDDEN_PATTERNS = [/secret/i, /credential/i, /token/i, /password/i];

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'that', 'this', 'be', 'do',
  'add', 'improve', 'update', 'fix', 'create', 'seed', 'implement',
]);

const SCHEMA_VERSION = 1;

// ── File I/O helpers ─────────────────────────────────────────────────────────

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readNdjsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Keyword / title deduplication ────────────────────────────────────────────

function extractKeywords(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function titleOverlap(a, b) {
  const kwA = new Set(extractKeywords(a));
  const kwB = new Set(extractKeywords(b));
  if (kwA.size === 0 || kwB.size === 0) return 0;
  let overlap = 0;
  for (const w of kwA) { if (kwB.has(w)) overlap++; }
  return overlap / Math.max(kwA.size, kwB.size);
}

// ── Conflict group extraction ────────────────────────────────────────────────

function extractConflictGroupFromIssueBody(body) {
  if (!body) return null;
  const match = body.match(/Conflict group:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

// ── File scope checks ────────────────────────────────────────────────────────

function isFileScopeForbidden(allowedFiles) {
  for (const pattern of allowedFiles) {
    for (const forbidden of FORBIDDEN_SCOPES) {
      if (pattern === forbidden || pattern.startsWith(forbidden.replace('**', ''))) return true;
      if (forbidden.endsWith('/**')) {
        const prefix = forbidden.slice(0, -3);
        if (pattern.startsWith(prefix + '/') || pattern === prefix) return true;
      }
    }
    for (const pat of FORBIDDEN_PATTERNS) {
      if (pat.test(pattern)) return true;
    }
  }
  return false;
}

// ── Candidate builder ────────────────────────────────────────────────────────

/**
 * Build a candidate with merged defaults. Each producer script passes its
 * own base defaults so the candidate shape is consistent within that script.
 */
function makeCandidate(overrides, baseDefaults) {
  const defaults = {
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
    rollbackFollowUp: '',
    humanRequired: false,
    classification: 'issue-worthy',
    reasoning: {
      factsObserved: '',
      relevantPattern: '',
      whyThisAction: '',
      riskIfManual: '',
      riskIfOverTooled: '',
      seedBoundary: 'automation-scope',
      selfBootstrapNecessary: true,
    },
    ...baseDefaults,
  };
  return { ...defaults, ...overrides };
}

// ── Deduplication ────────────────────────────────────────────────────────────

/**
 * Deduplicate candidates against open issues, open PRs, and merged PRs.
 * Shared across all issue producers.
 */
function deduplicate(candidates, openIssues, openPRs, mergedPRs) {
  const proposed = [];
  const skipped = [];

  const openIssueList = openIssues || [];
  const openPRList = openPRs || [];
  const mergedPRList = mergedPRs || [];

  const openTitles = openIssueList.map(i => i.title || '');
  const prTitles = openPRList.map(p => p.title || '');
  const mergedTitles = mergedPRList.map(p => p.title || '');
  const allTitles = [...openTitles, ...prTitles, ...mergedTitles];

  const existingConflictGroups = new Set();
  for (const issue of openIssueList) {
    const cg = extractConflictGroupFromIssueBody(issue.body || '');
    if (cg) existingConflictGroups.add(cg.toLowerCase());
  }
  for (const pr of [...openPRList, ...mergedPRList]) {
    const cg = extractConflictGroupFromIssueBody(pr.body || '');
    if (cg) existingConflictGroups.add(cg.toLowerCase());
  }

  for (const candidate of candidates) {
    let isDuplicate = false;
    let reason = '';

    for (const existingTitle of allTitles) {
      if (titleOverlap(candidate.title, existingTitle) > 0.5) {
        isDuplicate = true;
        reason = `title overlap with existing: "${existingTitle}"`;
        break;
      }
    }

    if (!isDuplicate && candidate.conflictGroup && existingConflictGroups.has(candidate.conflictGroup.toLowerCase())) {
      isDuplicate = true;
      reason = `conflictGroup "${candidate.conflictGroup}" already exists in open issues or PRs`;
    }

    if (isDuplicate) {
      skipped.push({ title: candidate.title, conflictGroup: candidate.conflictGroup, reason });
    } else {
      proposed.push(candidate);
    }
  }

  return { proposed, skipped };
}

// ── Policy gate ──────────────────────────────────────────────────────────────

/**
 * Apply risk-based policy gate. High-risk and forbidden-scope candidates
 * are marked humanRequired. Shared across all issue producers.
 */
function applyPolicyGate(candidates) {
  const autoCreatable = [];
  const humanRequired = [];

  for (const candidate of candidates) {
    if (candidate.risk === 'high') {
      candidate.readiness = 'blocked';
      candidate.readinessNote = (candidate.readinessNote ? candidate.readinessNote + ' ' : '') + 'High-risk: requires human approval.';
      candidate.humanRequired = true;
      candidate.classification = 'gate-worthy';
      humanRequired.push(candidate);
      continue;
    }

    if (candidate.humanRequired) {
      candidate.readiness = 'human-required';
      candidate.classification = candidate.classification || 'gate-worthy';
      humanRequired.push(candidate);
      continue;
    }

    if (isFileScopeForbidden(candidate.allowedFiles)) {
      candidate.readiness = 'blocked';
      candidate.readinessNote = (candidate.readinessNote ? candidate.readinessNote + ' ' : '') + 'Touches forbidden file scope.';
      candidate.humanRequired = true;
      candidate.classification = 'gate-worthy';
      humanRequired.push(candidate);
      continue;
    }

    candidate.readiness = 'ready';
    autoCreatable.push(candidate);
  }

  return { autoCreatable, humanRequired };
}

// ── Output builder ───────────────────────────────────────────────────────────

function buildOutput(candidates, skipped, mode, max) {
  const capped = candidates.slice(0, max);
  return {
    planVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    label: 'agent:codex-action-needed',
    mode,
    totalProposed: candidates.length,
    totalCapped: capped.length,
    totalSkipped: skipped.length,
    candidates: capped,
    skippedDuplicates: skipped,
    policy: {
      allowedScopes: ALLOWED_SCOPES,
      forbiddenScopes: FORBIDDEN_SCOPES,
      maxAutoCreate: max,
    },
  };
}

// ── Issue body builder ───────────────────────────────────────────────────────

/**
 * Build a full issue body with CONTROL APPENDIX. Shared across all producers.
 */
function buildIssueBody(candidate) {
  const lines = [];
  lines.push('## Goal');
  lines.push('');
  lines.push(candidate.title);
  lines.push('');
  lines.push('## Evidence');
  lines.push('');
  lines.push(candidate.evidence || 'No evidence recorded.');
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  lines.push(`Task type: ${candidate.taskType}`);
  if (candidate.rationale) {
    lines.push('');
    lines.push(`Rationale: ${candidate.rationale}`);
  }
  if (candidate.readinessNote) {
    lines.push('');
    lines.push(`Readiness: ${candidate.readinessNote}`);
  }
  lines.push('');
  lines.push('## Acceptance');
  lines.push('');
  for (const vc of candidate.validationCommands) {
    lines.push(`- \`${vc}\` passes`);
  }
  lines.push('');
  lines.push('## Constraints');
  lines.push('');
  lines.push('- Stay within allowed files.');
  lines.push('- Do not edit forbidden files.');
  lines.push('');
  lines.push('## Rollback / Follow-up');
  lines.push('');
  lines.push(candidate.rollbackFollowUp || 'No rollback or follow-up steps specified.');

  const reasoning = candidate.reasoning;
  if (reasoning && reasoning.factsObserved) {
    lines.push('');
    lines.push('## Evidence-Based Reasoning');
    lines.push('');
    lines.push(`1. **Facts observed:** ${reasoning.factsObserved}`);
    lines.push(`2. **Relevant pattern:** ${reasoning.relevantPattern || 'Not specified.'}`);
    lines.push(`3. **Why this action:** ${reasoning.whyThisAction || 'Not specified.'}`);
    lines.push(`4. **Risk if manual:** ${reasoning.riskIfManual || 'Not specified.'}`);
    lines.push(`5. **Risk if over-tooled:** ${reasoning.riskIfOverTooled || 'Not specified.'}`);
    lines.push(`6. **Seed boundary:** ${reasoning.seedBoundary || 'automation-scope'}`);
    lines.push(`7. **Self-bootstrap necessary:** ${reasoning.selfBootstrapNecessary !== false ? 'Yes' : 'No'}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('CONTROL APPENDIX (launcher generated)');
  lines.push(`Task type: ${candidate.taskType}`);
  lines.push(`Risk: ${candidate.risk}`);
  lines.push(`Conflict group: ${candidate.conflictGroup}`);
  if (candidate.classification) {
    lines.push(`Classification: ${candidate.classification}`);
  }
  lines.push('Target issue: ');
  lines.push('Target PR: ');
  lines.push('Issues: ');
  lines.push('Expected PR: True');
  lines.push('Allowed files:');
  for (const af of candidate.allowedFiles) {
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
  for (const vc of candidate.validationCommands) {
    lines.push(`- ${vc}`);
  }
  lines.push('Use these boundaries as hard constraints. If the requested fix requires files outside allowedFiles, stop and explain the blocker instead of making an unbounded change.');
  lines.push('Do NOT output secrets, tokens, auth output, credentials, .env contents, local transcript contents, or llm_io_logs contents.');
  lines.push('');
  lines.push('Role packet:');
  lines.push(`Actor role: ${candidate.actorRole}`);
  if (candidate.macroGoal) {
    lines.push(`Macro goal: ${candidate.macroGoal}`);
  }
  return lines.join('\n');
}

// ── GitHub CLI helpers ───────────────────────────────────────────────────────

function fetchOpenIssues(repo) {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const cmd = `gh issue list --state open --limit 200 ${repoFlag} --json number,title,body,labels`;
  try {
    return JSON.parse(execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }));
  } catch {
    return [];
  }
}

function fetchOpenPRs(repo) {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const cmd = `gh pr list --state open --limit 200 ${repoFlag} --json number,title,body,headRefName`;
  try {
    return JSON.parse(execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }));
  } catch {
    return [];
  }
}

function fetchMergedPRs(repo, limit) {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const cmd = `gh pr list --state merged --limit ${limit} ${repoFlag} --json number,title,body,headRefName,mergedAt`;
  try {
    return JSON.parse(execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }));
  } catch {
    return [];
  }
}

function createGitHubIssue(repo, title, body, label) {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const cmd = `gh issue create ${repoFlag} --title "${title.replace(/"/g, '\\"')}" --label "${label}" --body-file -`;
  try {
    const result = execSync(cmd, {
      encoding: 'utf-8',
      input: body,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { url: result.trim(), error: null };
  } catch (err) {
    return { url: null, error: err.message };
  }
}

// ── Audit logging ────────────────────────────────────────────────────────────

function generateEventId() {
  return crypto.randomUUID();
}

function writeAuditEvent(stateDir, event) {
  const auditPath = path.join(stateDir, 'issue-seeding-events.ndjson');
  const entry = {
    schemaVersion: SCHEMA_VERSION,
    eventId: generateEventId(),
    recordedAt: new Date().toISOString(),
    ...event,
  };
  fs.appendFileSync(auditPath, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Constants
  REPO_ROOT,
  DEFAULT_STATE_DIR,
  ALLOWED_SCOPES,
  FORBIDDEN_SCOPES,
  FORBIDDEN_PATTERNS,
  STOP_WORDS,
  SCHEMA_VERSION,

  // File I/O
  readJsonFile,
  readNdjsonFile,

  // Deduplication
  extractKeywords,
  titleOverlap,
  extractConflictGroupFromIssueBody,

  // File scope
  isFileScopeForbidden,

  // Candidate
  makeCandidate,

  // Pipeline stages
  deduplicate,
  applyPolicyGate,
  buildOutput,
  buildIssueBody,

  // GitHub CLI
  fetchOpenIssues,
  fetchOpenPRs,
  fetchMergedPRs,
  createGitHubIssue,

  // Audit
  generateEventId,
  writeAuditEvent,
};
