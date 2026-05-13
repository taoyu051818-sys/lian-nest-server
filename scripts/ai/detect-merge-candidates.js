#!/usr/bin/env node

/**
 * detect-merge-candidates.js
 *
 * Reads open PR data from GitHub (via `gh`) or a fixture JSON file and
 * classifies each PR into one of three groups: mergeable, blocked, or
 * humanRequired. Never merges — detection only.
 *
 * Classification rules:
 *   - mergeable:    non-draft, CLEAN merge state, low-risk files only, has closing references
 *   - blocked:      UNKNOWN or DIRTY merge state
 *   - humanRequired: touches high-risk patterns (src/**, prisma/**, .env, auth, security)
 *
 * Usage:
 *   node scripts/ai/detect-merge-candidates.js [--live] [--stdout] [--self-test] [--help]
 *       [--input <path>] [--out <path>]
 *
 * Exit codes: 0 — candidates produced, 1 — self-test failure, 2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { REPO_ROOT } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────

const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'merge-candidates.json');

const SCHEMA_VERSION = 1;

const HIGH_RISK_PATTERNS = [
  /^src\//i,
  /prisma/i,
  /\.env$/i,
  /auth/i,
  /security/i,
  /seeding/i,
  /migration/i,
];

const CLOSING_REF_PATTERN = /(?:closes|fixes|resolves)\s*#\d+/i;

const PR_JSON_FIELDS = 'number,title,body,state,isDraft,mergeable,headRefName,baseRefName,url,labels,author';

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
detect-merge-candidates.js — Merge candidate detector for Command Steward (v1)

USAGE
    node scripts/ai/detect-merge-candidates.js [options]

OPTIONS
    --input <path>  Read PR data from a JSON file instead of querying GitHub.
    --live          Write the result to the output file (default: dry-run).
    --out <path>    Output path (default: .github/ai-state/merge-candidates.json).
    --stdout        Print JSON to stdout without banner.
    --self-test     Run built-in assertions and exit.
    --help          Show this help message and exit.

OUTPUT SECTIONS
    mergeable, blocked, humanRequired, summary, inputSources

EXIT CODES
    0   Candidates produced
    1   Self-test failure
    2   Invalid arguments
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    live: false,
    out: DEFAULT_OUT,
    stdout: false,
    help: false,
    selfTest: false,
    input: null,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--live') {
      args.live = true;
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
    } else if (arg === '--input') {
      i++;
      if (i >= argv.length) { console.error('Error: --input requires a path'); process.exit(2); }
      args.input = argv[i];
    } else if (arg === '--stdout') {
      args.stdout = true;
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

// ── Sanitization ─────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /credential/i,
];

function sanitizePr(pr) {
  return {
    number: pr.number,
    title: typeof pr.title === 'string' ? pr.title.slice(0, 200) : '',
    isDraft: !!pr.isDraft,
    mergeable: pr.mergeable,
    headRefName: typeof pr.headRefName === 'string' ? pr.headRefName.slice(0, 100) : '',
    baseRefName: typeof pr.baseRefName === 'string' ? pr.baseRefName.slice(0, 100) : '',
    url: typeof pr.url === 'string' ? pr.url : '',
    author: pr.author && typeof pr.author === 'object' && typeof pr.author.login === 'string'
      ? { login: pr.author.login }
      : null,
    labels: Array.isArray(pr.labels)
      ? pr.labels.map(l => typeof l === 'object' ? { name: String(l.name || '').slice(0, 50) } : { name: String(l).slice(0, 50) })
      : [],
  };
}

// ── GitHub PR fetching ───────────────────────────────────────────────────────

function fetchOpenPRs() {
  try {
    const out = execFileSync('gh', [
      'pr', 'list',
      '--state', 'open',
      '--limit', '100',
      '--json', PR_JSON_FIELDS,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  } catch (err) {
    console.error(`Error: Failed to fetch PRs from GitHub: ${err.stderr ? err.stderr.trim() : err.message}`);
    process.exit(2);
  }
}

// ── Classification ───────────────────────────────────────────────────────────

function touchesHighRiskFiles(pr) {
  // We check title, branch name, and labels for high-risk signals
  // since file-level data is not available via the basic gh pr list --json
  const headRef = pr.headRefName || '';
  const title = pr.title || '';
  const combined = `${headRef} ${title}`;
  const labelNames = Array.isArray(pr.labels)
    ? pr.labels.map(l => typeof l === 'object' ? l.name : String(l)).join(' ')
    : '';
  const checkStr = `${combined} ${labelNames}`;

  return HIGH_RISK_PATTERNS.some(pattern => pattern.test(checkStr));
}

function hasClosingReferences(pr) {
  const body = pr.body || '';
  const title = pr.title || '';
  return CLOSING_REF_PATTERN.test(body) || CLOSING_REF_PATTERN.test(title);
}

function classifyPR(pr) {
  // Blocked: merge state unknown or dirty
  if (pr.mergeable === 'UNKNOWN' || pr.mergeable === 'DIRTY') {
    return 'blocked';
  }

  // Blocked: closed PRs that are still listed (shouldn't happen but guard)
  if (pr.state === 'CLOSED' || pr.state === 'MERGED') {
    return 'blocked';
  }

  // Human required: high-risk patterns
  if (touchesHighRiskFiles(pr)) {
    return 'humanRequired';
  }

  // Human required: draft PRs
  if (pr.isDraft) {
    return 'humanRequired';
  }

  // Mergeable: CLEAN merge state, non-draft, has closing references
  if (pr.mergeable === 'MERGEABLE' && hasClosingReferences(pr)) {
    return 'mergeable';
  }

  // Human required: everything else needs human review
  return 'humanRequired';
}

// ── Build result ─────────────────────────────────────────────────────────────

function buildResult(prs) {
  const mergeable = [];
  const blocked = [];
  const humanRequired = [];

  for (const pr of prs) {
    const group = classifyPR(pr);
    const entry = sanitizePr(pr);

    if (group === 'mergeable') {
      mergeable.push(entry);
    } else if (group === 'blocked') {
      blocked.push(entry);
    } else {
      humanRequired.push(entry);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    summary: {
      total: prs.length,
      mergeable: mergeable.length,
      blocked: blocked.length,
      humanRequired: humanRequired.length,
    },
    mergeable,
    blocked,
    humanRequired,
    inputSources: {
      githubLoaded: prs.length > 0,
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

  // Test: classifyPR with CLEAN mergeable PR + closing ref
  const cleanPR = {
    number: 100,
    title: 'feat: add feature',
    body: 'Closes #50',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefName: 'feat/add-feature',
    baseRefName: 'main',
  };
  assert(classifyPR(cleanPR) === 'mergeable', 'CLEAN PR with closing ref is mergeable');

  // Test: classifyPR with UNKNOWN merge state
  const unknownPR = {
    number: 101,
    title: 'fix: something',
    body: '',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'UNKNOWN',
    headRefName: 'fix/something',
    baseRefName: 'main',
  };
  assert(classifyPR(unknownPR) === 'blocked', 'UNKNOWN merge state is blocked');

  // Test: classifyPR with DIRTY merge state
  const dirtyPR = {
    number: 102,
    title: 'fix: conflict',
    body: '',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'DIRTY',
    headRefName: 'fix/conflict',
    baseRefName: 'main',
  };
  assert(classifyPR(dirtyPR) === 'blocked', 'DIRTY merge state is blocked');

  // Test: classifyPR with high-risk branch name
  const highRiskPR = {
    number: 103,
    title: 'fix: auth middleware',
    body: '',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefName: 'fix/auth-middleware',
    baseRefName: 'main',
  };
  assert(classifyPR(highRiskPR) === 'humanRequired', 'high-risk branch is humanRequired');

  // Test: classifyPR with draft PR
  const draftPR = {
    number: 104,
    title: 'wip: new feature',
    body: '',
    state: 'OPEN',
    isDraft: true,
    mergeable: 'MERGEABLE',
    headRefName: 'feat/wip',
    baseRefName: 'main',
  };
  assert(classifyPR(draftPR) === 'humanRequired', 'draft PR is humanRequired');

  // Test: classifyPR with src/ in branch name
  const srcPR = {
    number: 105,
    title: 'refactor module',
    body: '',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefName: 'refactor/src/module',
    baseRefName: 'main',
  };
  assert(classifyPR(srcPR) === 'humanRequired', 'src/ branch is humanRequired');

  // Test: classifyPR without closing ref is humanRequired
  const noRefPR = {
    number: 106,
    title: 'chore: update deps',
    body: 'Just updating some dependencies.',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefName: 'chore/deps',
    baseRefName: 'main',
  };
  assert(classifyPR(noRefPR) === 'humanRequired', 'no closing ref is humanRequired');

  // Test: buildResult with empty array
  const emptyResult = buildResult([]);
  assert(emptyResult.schemaVersion === 1, 'schemaVersion is 1');
  assert(typeof emptyResult.capturedAt === 'string', 'capturedAt is string');
  assert(emptyResult.summary.total === 0, 'total is 0');
  assert(emptyResult.mergeable.length === 0, 'mergeable empty');
  assert(emptyResult.blocked.length === 0, 'blocked empty');
  assert(emptyResult.humanRequired.length === 0, 'humanRequired empty');

  // Test: buildResult with mixed PRs
  const mixedResult = buildResult([cleanPR, unknownPR, dirtyPR, highRiskPR, draftPR]);
  assert(mixedResult.summary.total === 5, 'total is 5');
  assert(mixedResult.summary.mergeable === 1, 'one mergeable');
  assert(mixedResult.summary.blocked === 2, 'two blocked');
  assert(mixedResult.summary.humanRequired === 2, 'two humanRequired');
  assert(mixedResult.mergeable[0].number === 100, 'mergeable has PR 100');

  // Test: sanitizePr strips secrets and truncates
  const messyPr = {
    number: 200,
    title: 'x'.repeat(300),
    body: 'secret token here',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    headRefName: 'feat/messy',
    baseRefName: 'main',
    author: { login: 'testuser', token: 'should-not-appear' },
    labels: [{ name: 'bug' }],
  };
  const sanitized = sanitizePr(messyPr);
  assert(sanitized.title.length <= 200, 'title truncated');
  assert(!('token' in sanitized), 'no token key in sanitized');
  assert(sanitized.author.login === 'testuser', 'author login preserved');

  // Test: all top-level keys present
  const keys = ['schemaVersion', 'capturedAt', 'summary', 'mergeable', 'blocked', 'humanRequired', 'inputSources'];
  for (const key of keys) {
    assert(key in emptyResult, `key ${key} present`);
  }

  // Test: summary fields
  assert(typeof emptyResult.summary.mergeable === 'number', 'summary.mergeable is number');
  assert(typeof emptyResult.summary.blocked === 'number', 'summary.blocked is number');
  assert(typeof emptyResult.summary.humanRequired === 'number', 'summary.humanRequired is number');

  // Test: inputSources has githubLoaded
  assert(typeof emptyResult.inputSources.githubLoaded === 'boolean', 'githubLoaded is boolean');

  // Test: each mergeable PR has required fields
  for (const pr of mixedResult.mergeable) {
    assert(typeof pr.number === 'number', 'pr.number');
    assert(typeof pr.title === 'string', 'pr.title');
    assert(typeof pr.isDraft === 'boolean', 'pr.isDraft');
    assert(typeof pr.url === 'string' || pr.url === '', 'pr.url');
  }

  // Report
  console.log(`\n  detect-merge-candidates self-test`);
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

  // Read PRs from input file or GitHub
  let prs;
  if (args.input) {
    const inputPath = path.resolve(args.input);
    const data = readJsonFile(inputPath);
    if (!data) {
      console.error(`Error: Could not read input file: ${inputPath}`);
      process.exit(2);
    }
    prs = Array.isArray(data) ? data : (Array.isArray(data.prs) ? data.prs : []);
  } else {
    prs = fetchOpenPRs();
  }

  const result = buildResult(prs);
  const json = JSON.stringify(result, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  if (!args.live) {
    // Dry-run mode
    const banner = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║                     DRY RUN                                ║',
      '╚══════════════════════════════════════════════════════════════╝',
    ].join('\n');
    process.stdout.write(`${banner}\n`);
    process.stdout.write(`Target: ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n\n`);
    process.stdout.write(json);
    return;
  }

  // Live mode — write the file
  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(`Merge candidates written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

main();
