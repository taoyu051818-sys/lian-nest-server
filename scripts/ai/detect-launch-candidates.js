#!/usr/bin/env node

/**
 * detect-launch-candidates.js
 *
 * Scans open GitHub issues and identifies which ones can become bounded
 * worker tasks for Command Steward. Excludes discussion, human-required,
 * umbrella, and already-linked-PR issues.
 *
 * This script is read-only. It NEVER creates issues, launches workers,
 * or mutates any external state. Output is sanitized JSON safe for
 * task compiler preview.
 *
 * Usage:
 *   node scripts/ai/detect-launch-candidates.js [options]
 *
 * Options:
 *   --fixture <path>  Path to fixture JSON (skip gh CLI fetch)
 *   --repo <owner/n>  GitHub repo (or set GH_REPO env var)
 *   --stdout          Print JSON to stdout
 *   --out <path>      Output file path
 *   --self-test       Run built-in assertions and exit
 *   --help            Show usage
 *
 * Exit codes:
 *   0 — candidates produced
 *   2 — invalid arguments / gh CLI failure
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Constants ────────────────────────────────────────────────────────────────

const { REPO_ROOT } = require('./lib');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'launch-candidates.json');
const SCHEMA_VERSION = 1;

// Labels that mark an issue as NOT a launch candidate
const EXCLUDE_LABELS = [
  'discussion',
  'human-required',
  'umbrella',
  'agent:done',
  'agent:running',
  'agent:blocked',
  'agent:merged',
  'wontfix',
  'duplicate',
  'invalid',
];

// Title patterns that indicate discussion / non-actionable issues
const EXCLUDE_TITLE_PATTERNS = [
  /\bumbrella\b/i,
  /\bdiscussion\b/i,
  /\bmeta\b/i,
  /\brfc\b/i,
  /\bproposal\b/i,
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function printHelp() {
  const help = `
detect-launch-candidates.js — Launch candidate detector for Command Steward (v1)

USAGE
    node scripts/ai/detect-launch-candidates.js [options]

OPTIONS
    --fixture <path>  Path to fixture JSON (skip gh CLI fetch).
    --repo <owner/n>  GitHub repository (or set GH_REPO env var).
    --stdout          Print JSON to stdout instead of writing file.
    --out <path>      Output path (default: .github/ai-state/launch-candidates.json).
    --self-test       Run built-in assertions and exit.
    --help            Show this help message and exit.

WHAT GETS EXCLUDED
    - Issues with discussion/human-required/umbrella/done/running/blocked labels
    - Issues whose title matches umbrella/discussion/meta/rfc/proposal patterns
    - Issues that already have an open PR linked
    - Issues that are closed or not actionable

OUTPUT
    Sanitized JSON with candidate issues, recommended workerClass, risk,
    and exclusion reasons for non-candidates.

EXIT CODES
    0   Candidates produced
    2   Invalid arguments / gh CLI failure
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    fixture: null,
    repo: null,
    stdout: false,
    out: DEFAULT_OUT,
    selfTest: false,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--fixture') {
      i++;
      if (i >= argv.length) { console.error('Error: --fixture requires a path'); process.exit(2); }
      args.fixture = argv[i];
    } else if (arg === '--repo') {
      i++;
      if (i >= argv.length) { console.error('Error: --repo requires a value'); process.exit(2); }
      args.repo = argv[i];
    } else if (arg === '--stdout') {
      args.stdout = true;
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
    } else if (arg === '--self-test') {
      args.selfTest = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }
  return args;
}

// ── GitHub CLI ───────────────────────────────────────────────────────────────

function fetchIssues(repo) {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const cmd = `gh issue list --state open --limit 200 ${repoFlag} --json number,title,body,labels,assignees,createdAt,updatedAt`;
  try {
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } catch (err) {
    console.error(`Error: Failed to fetch issues via gh CLI.\n${err.message}`);
    process.exit(2);
  }
}

function fetchOpenPRs(repo) {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const cmd = `gh pr list --state open --limit 200 ${repoFlag} --json number,title,headRefName,body`;
  try {
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } catch {
    return [];
  }
}

// ── Sanitization ─────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /token/i,
  /secret/i,
  /key/i,
  /password/i,
  /credential/i,
  /bearer/i,
];

function sanitizeValue(value) {
  if (typeof value === 'string') {
    if (value.length > 500) return value.slice(0, 500) + '…';
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === 'object') return sanitizeObject(value);
  return value;
}

function sanitizeObject(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SECRET_PATTERNS.some(p => p.test(key))) continue;
    result[key] = sanitizeValue(value);
  }
  return result;
}

// ── Exclusion logic ──────────────────────────────────────────────────────────

function hasExcludeLabel(issue) {
  const labels = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name || '');
  return labels.some(label => EXCLUDE_LABELS.includes(label));
}

function hasExcludeTitlePattern(title) {
  return EXCLUDE_TITLE_PATTERNS.some(p => p.test(title));
}

function hasOpenPR(issue, openPRs) {
  // Check if any open PR references this issue number in its body or title
  const issueNum = issue.number;
  return openPRs.some(pr => {
    const body = pr.body || '';
    const title = pr.title || '';
    const refPattern = new RegExp(`(?:#|closes|fixes|resolves)\\s*${issueNum}\\b`, 'i');
    return refPattern.test(body) || refPattern.test(title);
  });
}

function getExclusionReason(issue, openPRs) {
  if (hasExcludeLabel(issue)) {
    const labels = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name || '');
    const matched = labels.filter(l => EXCLUDE_LABELS.includes(l));
    return `excluded-label: ${matched.join(', ')}`;
  }
  if (hasExcludeTitlePattern(issue.title)) {
    return 'excluded-title-pattern';
  }
  if (hasOpenPR(issue, openPRs)) {
    return 'has-open-pr';
  }
  return null;
}

// ── Worker class / risk recommendation ───────────────────────────────────────

function inferWorkerClass(issue) {
  const body = (issue.body || '').toLowerCase();
  const title = (issue.title || '').toLowerCase();
  const combined = `${title} ${body}`;

  // Check for CONTROL APPENDIX metadata
  if (body.includes('control appendix')) {
    if (combined.includes('execution')) return 'runtime-feature';
    if (combined.includes('research')) return 'research';
    if (combined.includes('review')) return 'review';
  }

  // Infer from keywords
  if (combined.includes('docs') || combined.includes('documentation') || combined.includes('readme')) {
    return 'docs';
  }
  if (combined.includes('test') || combined.includes('spec') || combined.includes('coverage')) {
    return 'test';
  }
  if (combined.includes('fix') || combined.includes('bug') || combined.includes('broken')) {
    return 'bugfix';
  }
  if (combined.includes('refactor') || combined.includes('cleanup') || combined.includes('clean up')) {
    return 'refactor';
  }
  if (combined.includes('feat') || combined.includes('add') || combined.includes('implement') || combined.includes('new')) {
    return 'runtime-feature';
  }

  return 'runtime-feature'; // default
}

function inferRisk(issue) {
  const body = (issue.body || '').toLowerCase();
  const title = (issue.title || '').toLowerCase();
  const combined = `${title} ${body}`;

  // Check CONTROL APPENDIX for explicit risk
  const riskMatch = body.match(/risk:\s*(low|medium|high)/i);
  if (riskMatch) return riskMatch[1].toLowerCase();

  // Infer from content
  if (combined.includes('src/') || combined.includes('prisma/') || combined.includes('auth') || combined.includes('security')) {
    return 'high';
  }
  if (combined.includes('scripts/') || combined.includes('docs/') || combined.includes('test')) {
    return 'low';
  }

  return 'medium'; // default
}

// ── Candidate detection ──────────────────────────────────────────────────────

function detectCandidates(issues, openPRs) {
  const candidates = [];
  const excluded = [];

  for (const issue of issues) {
    const reason = getExclusionReason(issue, openPRs);
    if (reason) {
      excluded.push({
        number: issue.number,
        title: issue.title,
        reason,
      });
      continue;
    }

    candidates.push({
      number: issue.number,
      title: issue.title,
      workerClass: inferWorkerClass(issue),
      risk: inferRisk(issue),
      labels: (issue.labels || []).map(l => typeof l === 'string' ? l : l.name || ''),
      updatedAt: issue.updatedAt || null,
    });
  }

  // Sort by number ascending
  candidates.sort((a, b) => a.number - b.number);

  return { candidates, excluded };
}

// ── Build output ─────────────────────────────────────────────────────────────

function buildOutput(issues, openPRs, result) {
  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    mode: 'dry-run',
    summary: {
      totalOpen: issues.length,
      candidateCount: result.candidates.length,
      excludedCount: result.excluded.length,
    },
    candidates: result.candidates.map(sanitizeObject),
    excluded: result.excluded.map(sanitizeObject),
  };
}

// ── Self-test ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let passed = 0;
  let failed = 0;

  function assert(condition, msg) {
    if (!condition) {
      failed++;
      console.error(`  FAIL: ${msg}`);
    } else {
      passed++;
    }
  }

  // Test: exclude labels
  const discussionIssue = { number: 96, title: 'Some discussion', body: '', labels: [{ name: 'discussion' }] };
  const emptyPRs = [];
  assert(hasExcludeLabel(discussionIssue), 'discussion label excluded');
  assert(getExclusionReason(discussionIssue, emptyPRs) === 'excluded-label: discussion', 'discussion reason correct');

  // Test: exclude umbrella title
  const umbrellaIssue = { number: 100, title: 'Umbrella: refactor auth', body: '', labels: [] };
  assert(hasExcludeTitlePattern(umbrellaIssue.title), 'umbrella title excluded');
  assert(getExclusionReason(umbrellaIssue, emptyPRs) === 'excluded-title-pattern', 'umbrella reason correct');

  // Test: exclude issues with open PR
  const normalIssue = { number: 200, title: 'Add feature X', body: '', labels: [] };
  const prs = [{ number: 50, title: 'feat: Add feature X', body: 'Closes #200', headRefName: 'claude/issue-200' }];
  assert(hasOpenPR(normalIssue, prs), 'issue with open PR detected');
  assert(getExclusionReason(normalIssue, prs) === 'has-open-pr', 'open-pr reason correct');

  // Test: valid candidate passes
  const validIssue = { number: 300, title: 'Add new endpoint', body: '', labels: [{ name: 'agent:ready' }] };
  assert(getExclusionReason(validIssue, emptyPRs) === null, 'valid issue passes');

  // Test: infer workerClass
  const docsIssue = { number: 400, title: 'Update README', body: '', labels: [] };
  assert(inferWorkerClass(docsIssue) === 'docs', 'docs inferred from title');

  const fixIssue = { number: 401, title: 'Fix broken auth flow', body: '', labels: [] };
  assert(inferWorkerClass(fixIssue) === 'bugfix', 'bugfix inferred from title');

  const featIssue = { number: 402, title: 'Add user profiles', body: '', labels: [] };
  assert(inferWorkerClass(featIssue) === 'runtime-feature', 'runtime-feature inferred from title');

  // Test: infer risk
  const highRiskIssue = { number: 500, title: 'Update auth module', body: 'Changes in src/modules/auth', labels: [] };
  assert(inferRisk(highRiskIssue) === 'high', 'high risk from auth');

  const lowRiskIssue = { number: 501, title: 'Add test', body: 'New test file in scripts/', labels: [] };
  assert(inferRisk(lowRiskIssue) === 'low', 'low risk from scripts');

  const explicitRiskIssue = { number: 502, title: 'Task', body: 'Risk: high\nCONTROL APPENDIX', labels: [] };
  assert(inferRisk(explicitRiskIssue) === 'high', 'explicit risk from appendix');

  // Test: detectCandidates with mixed issues
  const testIssues = [
    { number: 96, title: 'Discussion: roadmap', body: '', labels: [{ name: 'discussion' }] },
    { number: 100, title: 'Umbrella: refactor', body: '', labels: [] },
    { number: 200, title: 'Feature A', body: '', labels: [] },
    { number: 300, title: 'Feature B', body: '', labels: [{ name: 'agent:ready' }] },
    { number: 400, title: 'Done feature', body: '', labels: [{ name: 'agent:done' }] },
  ];
  const testPRs = [{ number: 50, title: 'feat: Feature A', body: 'Closes #200', headRefName: '' }];
  const result = detectCandidates(testIssues, testPRs);
  assert(result.candidates.length === 1, `expected 1 candidate, got ${result.candidates.length}`);
  assert(result.candidates[0].number === 300, 'candidate is #300');
  assert(result.excluded.length === 4, `expected 4 excluded, got ${result.excluded.length}`);

  // Test: buildOutput shape
  const output = buildOutput(testIssues, testPRs, result);
  assert(output.schemaVersion === 1, 'schemaVersion is 1');
  assert(typeof output.capturedAt === 'string', 'capturedAt is string');
  assert(output.summary.totalOpen === 5, 'totalOpen is 5');
  assert(output.summary.candidateCount === 1, 'candidateCount is 1');
  assert(output.summary.excludedCount === 4, 'excludedCount is 4');
  assert(Array.isArray(output.candidates), 'candidates is array');
  assert(Array.isArray(output.excluded), 'excluded is array');

  // Test: candidate shape
  const cand = output.candidates[0];
  assert(typeof cand.number === 'number', 'candidate.number is number');
  assert(typeof cand.title === 'string', 'candidate.title is string');
  assert(typeof cand.workerClass === 'string', 'candidate.workerClass is string');
  assert(typeof cand.risk === 'string', 'candidate.risk is string');
  assert(Array.isArray(cand.labels), 'candidate.labels is array');

  // Report
  console.log(`\n  detect-launch-candidates self-test`);
  console.log(`  ${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`\n  Some self-tests failed.\n`);
    process.exit(1);
  } else {
    console.log(`\n  All self-tests passed.\n`);
    process.exit(0);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.selfTest) {
    runSelfTest();
    return;
  }

  let issues;
  let openPRs;

  if (args.fixture) {
    const fixture = readJsonFile(args.fixture);
    if (!fixture || !Array.isArray(fixture.issues)) {
      console.error('Error: fixture must contain an "issues" array.');
      process.exit(2);
    }
    issues = fixture.issues;
    openPRs = fixture.openPRs || [];
  } else {
    const repo = args.repo || process.env.GH_REPO;
    issues = fetchIssues(repo);
    openPRs = fetchOpenPRs(repo);
  }

  const result = detectCandidates(issues, openPRs);
  const output = buildOutput(issues, openPRs, result);
  const json = JSON.stringify(output, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(`Launch candidates written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  hasExcludeLabel,
  hasExcludeTitlePattern,
  hasOpenPR,
  getExclusionReason,
  inferWorkerClass,
  inferRisk,
  detectCandidates,
  buildOutput,
};
