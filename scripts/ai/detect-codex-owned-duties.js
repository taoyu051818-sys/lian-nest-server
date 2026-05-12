#!/usr/bin/env node

/**
 * detect-codex-owned-duties.js
 *
 * Read-only detector that reports remaining Codex-owned orchestration duties
 * from repo state, PRs, issues, and WebUI control capabilities.
 *
 * Codex-owned duties are manual orchestration tasks that have not yet been
 * fully automated — they require human or Codex intervention to proceed.
 *
 * Duty categories:
 *   - merge-pending:     Open PRs with CLEAN merge state awaiting merge decision
 *   - launch-pending:    Open issues ready for worker dispatch but not yet launched
 *   - issue-close-pending: Issues with merged closing PRs still in open state
 *   - health-gate-manual:  Health gate auto-trigger not yet wired (from ai-state)
 *   - recovery-dispatch-manual: Recovery auto-dispatch not yet wired (from ai-state)
 *
 * This script is read-only. It NEVER merges PRs, launches workers, closes
 * issues, or mutates any external state. Output is sanitized JSON.
 *
 * Usage:
 *   node scripts/ai/detect-codex-owned-duties.js [options]
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
 *   0 — duties reported
 *   2 — invalid arguments / gh CLI failure
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'codex-owned-duties.json');
const SCHEMA_VERSION = 1;

const DUTY_TYPES = [
  'merge-pending',
  'launch-pending',
  'issue-close-pending',
  'health-gate-manual',
  'recovery-dispatch-manual',
];

// Labels that exclude an issue from launch-pending detection
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

const EXCLUDE_TITLE_PATTERNS = [
  /\bumbrella\b/i,
  /\bdiscussion\b/i,
  /\bmeta\b/i,
  /\brfc\b/i,
  /\bproposal\b/i,
];

const CLOSING_REF_PATTERN = /(?:close(?:s)?|fix(?:es)?|resolve(?:s)?)\s*#(\d+)/i;

const HIGH_RISK_PATTERNS = [
  /^src\//i,
  /prisma/i,
  /\.env$/i,
  /auth/i,
  /security/i,
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
detect-codex-owned-duties.js — Codex duty detector (v1)

USAGE
    node scripts/ai/detect-codex-owned-duties.js [options]

OPTIONS
    --fixture <path>  Path to fixture JSON (skip gh CLI fetch).
    --repo <owner/n>  GitHub repository (or set GH_REPO env var).
    --stdout          Print JSON to stdout instead of writing file.
    --out <path>      Output path (default: .github/ai-state/codex-owned-duties.json).
    --self-test       Run built-in assertions and exit.
    --help            Show this help message and exit.

DUTY CATEGORIES
    merge-pending              Open PRs awaiting human merge decision
    launch-pending             Open issues ready for worker dispatch
    issue-close-pending        Issues with merged PRs still open
    health-gate-manual         Health gate auto-trigger not wired
    recovery-dispatch-manual   Recovery auto-dispatch not wired

EXIT CODES
    0   Duties reported
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
  const args = ['issue', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title,body,labels,assignees,createdAt,updatedAt'];
  if (repo) args.push('--repo', repo);
  try {
    const out = execFileSync('gh', args, {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  } catch (err) {
    console.error(`Error: Failed to fetch issues via gh CLI.\n${err.message}`);
    process.exit(2);
  }
}

function fetchOpenPRs(repo) {
  const args = ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title,body,state,isDraft,mergeable,headRefName,baseRefName,labels'];
  if (repo) args.push('--repo', repo);
  try {
    const out = execFileSync('gh', args, {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  } catch {
    return [];
  }
}

function fetchMergedPRs(repo) {
  const args = ['pr', 'list', '--state', 'merged', '--limit', '100', '--json', 'number,title,body,mergedAt'];
  if (repo) args.push('--repo', repo);
  try {
    const out = execFileSync('gh', args, {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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

// ── Duty: merge-pending ──────────────────────────────────────────────────────

function isMergePending(pr) {
  if (pr.state === 'CLOSED' || pr.state === 'MERGED') return false;
  if (pr.isDraft) return false;
  if (pr.mergeable !== 'MERGEABLE') return false;
  // Must have a closing reference to be actionable
  const combined = `${pr.title || ''} ${pr.body || ''}`;
  return CLOSING_REF_PATTERN.test(combined);
}

function detectMergePending(openPRs) {
  return openPRs
    .filter(isMergePending)
    .map(pr => ({
      number: pr.number,
      title: (pr.title || '').slice(0, 200),
      headRefName: (pr.headRefName || '').slice(0, 100),
      mergeable: pr.mergeable,
    }));
}

// ── Duty: launch-pending ─────────────────────────────────────────────────────

function hasExcludeLabel(issue) {
  const labels = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name || '');
  return labels.some(label => EXCLUDE_LABELS.includes(label));
}

function hasExcludeTitlePattern(title) {
  return EXCLUDE_TITLE_PATTERNS.some(p => p.test(title));
}

function hasOpenPR(issue, openPRs) {
  const issueNum = issue.number;
  return openPRs.some(pr => {
    const body = pr.body || '';
    const title = pr.title || '';
    const refPattern = new RegExp(`(?:#|closes|fixes|resolves)\\s*${issueNum}\\b`, 'i');
    return refPattern.test(body) || refPattern.test(title);
  });
}

function isLaunchPending(issue, openPRs) {
  if (hasExcludeLabel(issue)) return false;
  if (hasExcludeTitlePattern(issue.title)) return false;
  if (hasOpenPR(issue, openPRs)) return false;
  return true;
}

function detectLaunchPending(issues, openPRs) {
  return issues
    .filter(issue => isLaunchPending(issue, openPRs))
    .map(issue => ({
      number: issue.number,
      title: (issue.title || '').slice(0, 200),
      labels: (issue.labels || []).map(l => typeof l === 'string' ? l : l.name || ''),
      updatedAt: issue.updatedAt || null,
    }));
}

// ── Duty: issue-close-pending ────────────────────────────────────────────────

function findMergedClosingPR(issue, mergedPRs) {
  const issueNum = issue.number;
  const closingPattern = new RegExp(
    `(?:close(?:s)?|fix(?:es)?|resolve(?:s)?)\\s+#${issueNum}\\b`,
    'i'
  );
  const negationPattern = new RegExp(
    `(?:not|no|never)\\s+(?:close(?:s)?|fix(?:es)?|resolve(?:s)?)\\s+#${issueNum}\\b`,
    'i'
  );
  for (const pr of mergedPRs) {
    const combined = `${pr.title || ''} ${pr.body || ''}`;
    if (closingPattern.test(combined) && !negationPattern.test(combined)) return pr;
  }
  return null;
}

function detectIssueClosePending(issues, mergedPRs) {
  return issues
    .filter(issue => issue.state !== 'closed')
    .map(issue => {
      const mergedPR = findMergedClosingPR(issue, mergedPRs);
      if (!mergedPR) return null;
      return {
        issueNumber: issue.number,
        title: (issue.title || '').slice(0, 200),
        mergedPR: {
          number: mergedPR.number,
          title: (mergedPR.title || '').slice(0, 200),
          mergedAt: mergedPR.mergedAt || mergedPR.merged_at || null,
        },
      };
    })
    .filter(Boolean);
}

// ── Duty: ai-state based duties ──────────────────────────────────────────────

function detectHealthGateManual() {
  const healthPath = path.join(STATE_DIR, 'main-health.json');
  const health = readJsonFile(healthPath);

  // If no health state exists, the gate is definitely not automated
  // If health state exists, check if auto-trigger is wired
  // Per codex-retirement-runbook: "Post-merge health gate auto-trigger (script exists but CI wiring pending)"
  return {
    wired: false,
    reason: 'Post-merge health gate auto-trigger requires CI wiring (codex-retirement-runbook gate-3.3)',
    lastHealthState: health && health.state ? health.state : null,
    lastCapturedAt: health && health.capturedAt ? health.capturedAt : null,
  };
}

function detectRecoveryDispatchManual() {
  const workerTrustPath = path.join(STATE_DIR, 'worker-trust.json');
  const workerTrust = readJsonFile(workerTrustPath);

  const hasFoundationFix = !!(workerTrust && workerTrust.workerClasses &&
    workerTrust.workerClasses['foundation-fix']);

  return {
    wired: false,
    reason: 'Recovery auto-dispatch on red requires wiring (codex-retirement-runbook gate-4.3)',
    recoveryWorkerDefined: hasFoundationFix,
  };
}

// ── Build output ─────────────────────────────────────────────────────────────

function buildOutput(issues, openPRs, mergedPRs) {
  const mergePending = detectMergePending(openPRs);
  const launchPending = detectLaunchPending(issues, openPRs);
  const issueClosePending = detectIssueClosePending(issues, mergedPRs);
  const healthGateManual = detectHealthGateManual();
  const recoveryDispatchManual = detectRecoveryDispatchManual();

  const duties = [];

  for (const item of mergePending) {
    duties.push(sanitizeObject({
      type: 'merge-pending',
      ...item,
    }));
  }

  for (const item of launchPending) {
    duties.push(sanitizeObject({
      type: 'launch-pending',
      ...item,
    }));
  }

  for (const item of issueClosePending) {
    duties.push(sanitizeObject({
      type: 'issue-close-pending',
      ...item,
    }));
  }

  duties.push(sanitizeObject({
    type: 'health-gate-manual',
    ...healthGateManual,
  }));

  duties.push(sanitizeObject({
    type: 'recovery-dispatch-manual',
    ...recoveryDispatchManual,
  }));

  const byType = {};
  for (const dt of DUTY_TYPES) {
    byType[dt] = duties.filter(d => d.type === dt).length;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    summary: {
      totalDuties: duties.length,
      byType,
    },
    duties,
    inputSources: {
      issuesLoaded: issues.length > 0,
      openPRsLoaded: openPRs.length > 0,
      mergedPRsLoaded: mergedPRs.length > 0,
      aiStateDirExists: fs.existsSync(STATE_DIR),
    },
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

  // Test: isMergePending
  const mergeablePR = {
    number: 100, title: 'feat: add feature', body: 'Closes #50',
    state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE',
    headRefName: 'feat/add', baseRefName: 'main',
  };
  assert(isMergePending(mergeablePR), 'MERGEABLE PR with closing ref is merge-pending');

  const draftPR = {
    number: 101, title: 'wip', body: 'Closes #51',
    state: 'OPEN', isDraft: true, mergeable: 'MERGEABLE',
    headRefName: 'wip', baseRefName: 'main',
  };
  assert(!isMergePending(draftPR), 'draft PR is not merge-pending');

  const unknownPR = {
    number: 102, title: 'feat', body: 'Closes #52',
    state: 'OPEN', isDraft: false, mergeable: 'UNKNOWN',
    headRefName: 'feat', baseRefName: 'main',
  };
  assert(!isMergePending(unknownPR), 'UNKNOWN merge state is not merge-pending');

  const noRefPR = {
    number: 103, title: 'feat', body: 'no refs',
    state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE',
    headRefName: 'feat', baseRefName: 'main',
  };
  assert(!isMergePending(noRefPR), 'no closing ref is not merge-pending');

  // Test: hasExcludeLabel
  const discussionIssue = { number: 10, title: 'Talk', body: '', labels: [{ name: 'discussion' }] };
  assert(hasExcludeLabel(discussionIssue), 'discussion label excluded');

  const readyIssue = { number: 11, title: 'Task', body: '', labels: [{ name: 'agent:ready' }] };
  assert(!hasExcludeLabel(readyIssue), 'agent:ready not excluded');

  // Test: hasExcludeTitlePattern
  assert(hasExcludeTitlePattern('Umbrella: refactor'), 'umbrella title excluded');
  assert(hasExcludeTitlePattern('RFC: new design'), 'RFC title excluded');
  assert(!hasExcludeTitlePattern('Add endpoint'), 'normal title not excluded');

  // Test: hasOpenPR
  const issue200 = { number: 200, title: 'Feature', body: '', labels: [] };
  const prs = [{ number: 50, title: 'feat', body: 'Closes #200', headRefName: '' }];
  assert(hasOpenPR(issue200, prs), 'issue with open PR detected');
  assert(!hasOpenPR({ number: 300, title: 'Other', body: '', labels: [] }, prs), 'unrelated issue not detected');

  // Test: detectMergePending
  const mergeResult = detectMergePending([mergeablePR, draftPR, unknownPR, noRefPR]);
  assert(mergeResult.length === 1, `expected 1 merge-pending, got ${mergeResult.length}`);
  assert(mergeResult[0].number === 100, 'merge-pending is PR 100');

  // Test: detectLaunchPending
  const issues = [
    { number: 10, title: 'Talk', body: '', labels: [{ name: 'discussion' }] },
    { number: 200, title: 'Has PR', body: '', labels: [] },
    { number: 300, title: 'Ready task', body: '', labels: [{ name: 'agent:ready' }] },
  ];
  const launchResult = detectLaunchPending(issues, prs);
  assert(launchResult.length === 1, `expected 1 launch-pending, got ${launchResult.length}`);
  assert(launchResult[0].number === 300, 'launch-pending is issue 300');

  // Test: detectIssueClosePending
  const openIssues = [
    { number: 200, title: 'Feature A', state: 'open', labels: [] },
    { number: 300, title: 'Feature B', state: 'open', labels: [] },
  ];
  const mergedPRs = [
    { number: 50, title: 'feat', body: 'Closes #200', mergedAt: '2026-01-01' },
  ];
  const closeResult = detectIssueClosePending(openIssues, mergedPRs);
  assert(closeResult.length === 1, `expected 1 close-pending, got ${closeResult.length}`);
  assert(closeResult[0].issueNumber === 200, 'close-pending is issue 200');
  assert(closeResult[0].mergedPR.number === 50, 'merged PR is 50');

  // Test: detectIssueClosePending with negation pattern
  const negationPRs = [
    { number: 51, title: 'feat', body: 'Does not close #300', mergedAt: '2026-01-01' },
  ];
  const negResult = detectIssueClosePending(openIssues, negationPRs);
  assert(negResult.length === 0, 'negation pattern blocks close detection');

  // Test: buildOutput shape
  const output = buildOutput([], [], []);
  assert(output.schemaVersion === 1, 'schemaVersion is 1');
  assert(typeof output.capturedAt === 'string', 'capturedAt is string');
  assert(typeof output.summary === 'object', 'summary is object');
  assert(typeof output.summary.totalDuties === 'number', 'totalDuties is number');
  assert(typeof output.summary.byType === 'object', 'byType is object');
  assert(Array.isArray(output.duties), 'duties is array');
  assert(typeof output.inputSources === 'object', 'inputSources is object');

  // Test: buildOutput includes ai-state duties even with empty inputs
  assert(output.duties.length === 2, 'always has health-gate-manual and recovery-dispatch-manual');
  assert(output.duties[0].type === 'health-gate-manual', 'first ai-state duty is health-gate-manual');
  assert(output.duties[1].type === 'recovery-dispatch-manual', 'second ai-state duty is recovery-dispatch-manual');

  // Test: buildOutput with real data
  const fullIssues = [
    { number: 300, title: 'Ready task', state: 'open', labels: [{ name: 'agent:ready' }] },
  ];
  const fullMergedPRs = [
    { number: 50, title: 'feat', body: 'Closes #300', mergedAt: '2026-01-01' },
  ];
  const fullOutput = buildOutput(fullIssues, [mergeablePR], fullMergedPRs);
  assert(fullOutput.summary.byType['merge-pending'] === 1, 'merge-pending count correct');
  assert(fullOutput.summary.byType['launch-pending'] === 1, 'launch-pending count correct');
  assert(fullOutput.summary.byType['issue-close-pending'] === 1, 'issue-close-pending count correct');
  assert(fullOutput.summary.byType['health-gate-manual'] === 1, 'health-gate-manual count correct');
  assert(fullOutput.summary.byType['recovery-dispatch-manual'] === 1, 'recovery-dispatch-manual count correct');
  assert(fullOutput.summary.totalDuties === 5, 'total duties is 5');

  // Test: duty shape
  const mergeDuty = fullOutput.duties.find(d => d.type === 'merge-pending');
  assert(typeof mergeDuty.number === 'number', 'merge-pending.number is number');
  assert(typeof mergeDuty.title === 'string', 'merge-pending.title is string');

  // Test: inputSources shape
  assert(typeof output.inputSources.issuesLoaded === 'boolean', 'issuesLoaded is boolean');
  assert(typeof output.inputSources.openPRsLoaded === 'boolean', 'openPRsLoaded is boolean');
  assert(typeof output.inputSources.mergedPRsLoaded === 'boolean', 'mergedPRsLoaded is boolean');
  assert(typeof output.inputSources.aiStateDirExists === 'boolean', 'aiStateDirExists is boolean');

  // Report
  console.log(`\n  detect-codex-owned-duties self-test`);
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
  let mergedPRs;

  if (args.fixture) {
    const fixture = readJsonFile(args.fixture);
    if (!fixture || !Array.isArray(fixture.issues)) {
      console.error('Error: fixture must contain an "issues" array.');
      process.exit(2);
    }
    issues = fixture.issues;
    openPRs = fixture.openPRs || [];
    mergedPRs = fixture.mergedPRs || [];
  } else {
    const repo = args.repo || process.env.GH_REPO;
    issues = fetchIssues(repo);
    openPRs = fetchOpenPRs(repo);
    mergedPRs = fetchMergedPRs(repo);
  }

  const output = buildOutput(issues, openPRs, mergedPRs);
  const json = JSON.stringify(output, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(`Codex-owned duties written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  isMergePending,
  hasExcludeLabel,
  hasExcludeTitlePattern,
  hasOpenPR,
  findMergedClosingPR,
  detectMergePending,
  detectLaunchPending,
  detectIssueClosePending,
  detectHealthGateManual,
  detectRecoveryDispatchManual,
  buildOutput,
  DUTY_TYPES,
  SCHEMA_VERSION,
};
