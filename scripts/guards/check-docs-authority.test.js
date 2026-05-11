#!/usr/bin/env node

/**
 * check-docs-authority.test.js
 *
 * Self-contained tests for the docs authority guard.
 * Run: node scripts/guards/check-docs-authority.test.js
 *
 * Exit codes:
 *   0 -- All tests passed
 *   1 -- One or more tests failed
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  parseFrontmatter,
  extractH1,
  checkDuplicateBasenames,
  checkDuplicateTitles,
  checkDuplicateTopics,
  checkMissingFrontmatter,
  checkStaleStatus,
  checkLegacySourceOfTruthDrift,
  isCurrentStatus,
} = require('./check-docs-authority');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.error(`  FAIL: ${message}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    const detail = `${message}\n    expected: ${e}\n    actual:   ${a}`;
    failures.push(detail);
    console.error(`  FAIL: ${detail}`);
  }
}

// --- Temp fixture helpers ---

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docs-authority-test-'));
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Tests ---

console.log('Running docs-authority guard tests...\n');

// parseFrontmatter
console.log('parseFrontmatter');
{
  const fm = parseFrontmatter('---\nowner: alice\nstatus: draft\ntopic: auth\n---\n# Title');
  assertDeepEqual(fm, { owner: 'alice', status: 'draft', topic: 'auth' }, 'parses basic frontmatter');
}
{
  const fm = parseFrontmatter('---\nowner: bob\n---\n# Title');
  assertDeepEqual(fm, { owner: 'bob' }, 'parses partial frontmatter');
}
{
  const fm = parseFrontmatter('# No frontmatter\nContent');
  assert(fm === null, 'returns null for no frontmatter');
}
{
  const fm = parseFrontmatter('---\n---\n# Empty frontmatter');
  assertDeepEqual(fm, {}, 'handles empty frontmatter block');
}

// extractH1
console.log('extractH1');
{
  const title = extractH1('# Hello World\nContent');
  assert(title === 'Hello World', 'extracts H1 from plain markdown');
}
{
  const title = extractH1('---\nowner: a\n---\n# After Frontmatter\nBody');
  assert(title === 'After Frontmatter', 'extracts H1 after frontmatter');
}
{
  const title = extractH1('No heading here\n## Only H2');
  assert(title === null, 'returns null when no H1');
}
{
  const title = extractH1('---\nfoo: bar\n---\n\n# Spaced Title\nBody');
  assert(title === 'Spaced Title', 'handles blank line between frontmatter and H1');
}

// checkDuplicateBasenames
console.log('checkDuplicateBasenames');
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/readme.md', '# A Readme');
    writeFile(tmp, 'docs/b/readme.md', '# B Readme');
    writeFile(tmp, 'docs/c/unique.md', '# Unique');

    const files = [
      path.join(tmp, 'docs/a/readme.md'),
      path.join(tmp, 'docs/b/readme.md'),
      path.join(tmp, 'docs/c/unique.md'),
    ];
    const dups = checkDuplicateBasenames(files);
    assert(dups.length === 1, 'finds one duplicate basename group');
    assert(dups[0].basename === 'readme', 'correct basename flagged');
    assert(dups[0].files.length === 2, 'two files in duplicate group');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/alpha.md', '# Alpha');
    writeFile(tmp, 'docs/b/beta.md', '# Beta');

    const files = [
      path.join(tmp, 'docs/a/alpha.md'),
      path.join(tmp, 'docs/b/beta.md'),
    ];
    const dups = checkDuplicateBasenames(files);
    assert(dups.length === 0, 'no duplicates when basenames differ');
  } finally {
    cleanup(tmp);
  }
}

// checkDuplicateTitles
console.log('checkDuplicateTitles');
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/guide.md', '# User Guide\nContent');
    writeFile(tmp, 'docs/b/guide-v2.md', '# User Guide\nUpdated');
    writeFile(tmp, 'docs/c/other.md', '# Other Guide');

    const files = [
      path.join(tmp, 'docs/a/guide.md'),
      path.join(tmp, 'docs/b/guide-v2.md'),
      path.join(tmp, 'docs/c/other.md'),
    ];
    const dups = checkDuplicateTitles(files);
    assert(dups.length === 1, 'finds one duplicate title group');
    assert(dups[0].title === 'User Guide', 'correct title flagged');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/one.md', '# One');
    writeFile(tmp, 'docs/b/two.md', '# Two');

    const files = [
      path.join(tmp, 'docs/a/one.md'),
      path.join(tmp, 'docs/b/two.md'),
    ];
    const dups = checkDuplicateTitles(files);
    assert(dups.length === 0, 'no duplicates when titles differ');
  } finally {
    cleanup(tmp);
  }
}

// checkMissingFrontmatter
console.log('checkMissingFrontmatter');
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/full.md', '---\nowner: alice\nstatus: draft\ntopic: auth\n---\n# Full');
    writeFile(tmp, 'docs/b/partial.md', '---\nowner: bob\n---\n# Partial');
    writeFile(tmp, 'docs/c/none.md', '# No Frontmatter');

    const files = [
      path.join(tmp, 'docs/a/full.md'),
      path.join(tmp, 'docs/b/partial.md'),
      path.join(tmp, 'docs/c/none.md'),
    ];
    const missing = checkMissingFrontmatter(files);
    // Only files with frontmatter get checked
    assert(missing.length === 1, 'flags one file with partial frontmatter');
    assert(missing[0].missing.includes('status'), 'reports missing status');
    assert(missing[0].missing.includes('topic'), 'reports missing topic');
    assert(!missing[0].missing.includes('owner'), 'does not report present field');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/no-fm.md', '# Plain doc\nNo frontmatter here');
    const files = [path.join(tmp, 'docs/a/no-fm.md')];
    const missing = checkMissingFrontmatter(files);
    assert(missing.length === 0, 'skips docs without frontmatter');
  } finally {
    cleanup(tmp);
  }
}

// isCurrentStatus
console.log('isCurrentStatus');
{
  assert(isCurrentStatus(null) === true, 'null frontmatter is current');
  assert(isCurrentStatus({}) === true, 'no status is current');
  assert(isCurrentStatus({ status: 'current' }) === true, 'status current is current');
  assert(isCurrentStatus({ status: 'active' }) === true, 'status active is current');
  assert(isCurrentStatus({ status: 'Current' }) === true, 'case-insensitive current');
  assert(isCurrentStatus({ status: 'superseded' }) === false, 'superseded is not current');
  assert(isCurrentStatus({ status: 'archived' }) === false, 'archived is not current');
  assert(isCurrentStatus({ status: 'draft' }) === false, 'draft is not current');
  assert(isCurrentStatus({ status: 'retired' }) === false, 'retired is not current');
}

// checkDuplicateTopics
console.log('checkDuplicateTopics');
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/auth.md', '---\ntopic: auth\n---\n# Auth Plan A');
    writeFile(tmp, 'docs/b/auth-v2.md', '---\ntopic: auth\n---\n# Auth Plan B');
    writeFile(tmp, 'docs/c/other.md', '---\ntopic: migration\n---\n# Migration');

    const files = [
      path.join(tmp, 'docs/a/auth.md'),
      path.join(tmp, 'docs/b/auth-v2.md'),
      path.join(tmp, 'docs/c/other.md'),
    ];
    const dups = checkDuplicateTopics(files);
    assert(dups.length === 1, 'finds one duplicate topic group');
    assert(dups[0].topic === 'auth', 'correct topic flagged');
    assert(dups[0].files.length === 2, 'two files in duplicate topic group');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/one.md', '---\ntopic: auth\n---\n# Auth');
    writeFile(tmp, 'docs/b/two.md', '---\ntopic: migration\n---\n# Migration');

    const files = [
      path.join(tmp, 'docs/a/one.md'),
      path.join(tmp, 'docs/b/two.md'),
    ];
    const dups = checkDuplicateTopics(files);
    assert(dups.length === 0, 'no duplicates when topics differ');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/no-fm.md', '# Plain doc\nNo frontmatter');
    writeFile(tmp, 'docs/b/no-topic.md', '---\nowner: alice\n---\n# No Topic');

    const files = [
      path.join(tmp, 'docs/a/no-fm.md'),
      path.join(tmp, 'docs/b/no-topic.md'),
    ];
    const dups = checkDuplicateTopics(files);
    assert(dups.length === 0, 'skips files without topic frontmatter');
  } finally {
    cleanup(tmp);
  }
}

// --- Regression: superseded-current topic conflict ---

console.log('checkDuplicateTopics (superseded-current regression)');

// Two current docs with same topic → should flag
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/auth-a.md', '---\ntopic: auth\nstatus: current\n---\n# Auth A');
    writeFile(tmp, 'docs/b/auth-b.md', '---\ntopic: auth\nstatus: current\n---\n# Auth B');

    const files = [
      path.join(tmp, 'docs/a/auth-a.md'),
      path.join(tmp, 'docs/b/auth-b.md'),
    ];
    const dups = checkDuplicateTopics(files);
    assert(dups.length === 1, 'flags duplicate topic between two current docs');
    assert(dups[0].topic === 'auth', 'correct topic for two current docs');
  } finally {
    cleanup(tmp);
  }
}

// Current + active docs with same topic → should flag
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/auth-cur.md', '---\ntopic: auth\nstatus: current\n---\n# Auth Current');
    writeFile(tmp, 'docs/b/auth-act.md', '---\ntopic: auth\nstatus: active\n---\n# Auth Active');

    const files = [
      path.join(tmp, 'docs/a/auth-cur.md'),
      path.join(tmp, 'docs/b/auth-act.md'),
    ];
    const dups = checkDuplicateTopics(files);
    assert(dups.length === 1, 'flags duplicate topic between current and active docs');
  } finally {
    cleanup(tmp);
  }
}

// Current + superseded same topic → should NOT flag (superseded is not current)
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/auth-cur.md', '---\ntopic: auth\nstatus: current\n---\n# Auth Current');
    writeFile(tmp, 'docs/b/auth-old.md', '---\ntopic: auth\nstatus: superseded\n---\n# Auth Superseded');

    const files = [
      path.join(tmp, 'docs/a/auth-cur.md'),
      path.join(tmp, 'docs/b/auth-old.md'),
    ];
    const dups = checkDuplicateTopics(files);
    assert(dups.length === 0, 'does not flag topic conflict between current and superseded');
  } finally {
    cleanup(tmp);
  }
}

// Current + archived same topic → should NOT flag
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/auth-cur.md', '---\ntopic: auth\nstatus: current\n---\n# Auth Current');
    writeFile(tmp, 'docs/b/auth-arc.md', '---\ntopic: auth\nstatus: archived\n---\n# Auth Archived');

    const files = [
      path.join(tmp, 'docs/a/auth-cur.md'),
      path.join(tmp, 'docs/b/auth-arc.md'),
    ];
    const dups = checkDuplicateTopics(files);
    assert(dups.length === 0, 'does not flag topic conflict between current and archived');
  } finally {
    cleanup(tmp);
  }
}

// Two superseded docs same topic → should NOT flag (neither is current)
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/auth-old1.md', '---\ntopic: auth\nstatus: superseded\n---\n# Auth Old 1');
    writeFile(tmp, 'docs/b/auth-old2.md', '---\ntopic: auth\nstatus: superseded\n---\n# Auth Old 2');

    const files = [
      path.join(tmp, 'docs/a/auth-old1.md'),
      path.join(tmp, 'docs/b/auth-old2.md'),
    ];
    const dups = checkDuplicateTopics(files);
    assert(dups.length === 0, 'does not flag topic conflict between two superseded docs');
  } finally {
    cleanup(tmp);
  }
}

// No-status + superseded same topic → should NOT flag (superseded excluded, only one current)
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/auth.md', '---\ntopic: auth\n---\n# Auth');
    writeFile(tmp, 'docs/b/auth-old.md', '---\ntopic: auth\nstatus: superseded\n---\n# Auth Old');

    const files = [
      path.join(tmp, 'docs/a/auth.md'),
      path.join(tmp, 'docs/b/auth-old.md'),
    ];
    const dups = checkDuplicateTopics(files);
    assert(dups.length === 0, 'does not flag when only one doc is current (other is superseded)');
  } finally {
    cleanup(tmp);
  }
}

// Three current docs same topic → should flag all three
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/auth1.md', '---\ntopic: auth\nstatus: current\n---\n# Auth 1');
    writeFile(tmp, 'docs/b/auth2.md', '---\ntopic: auth\nstatus: active\n---\n# Auth 2');
    writeFile(tmp, 'docs/c/auth3.md', '---\ntopic: auth\n---\n# Auth 3');

    const files = [
      path.join(tmp, 'docs/a/auth1.md'),
      path.join(tmp, 'docs/b/auth2.md'),
      path.join(tmp, 'docs/c/auth3.md'),
    ];
    const dups = checkDuplicateTopics(files);
    assert(dups.length === 1, 'one duplicate group for three current docs');
    assert(dups[0].files.length === 3, 'all three current docs reported');
  } finally {
    cleanup(tmp);
  }
}

// checkStaleStatus
console.log('checkStaleStatus');
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/active.md', '---\nstatus: active\n---\n# Active');
    writeFile(tmp, 'docs/b/superseded.md', '---\nstatus: superseded\n---\n# Old');
    writeFile(tmp, 'docs/c/archived.md', '---\nstatus: archived\n---\n# Ancient');

    const files = [
      path.join(tmp, 'docs/a/active.md'),
      path.join(tmp, 'docs/b/superseded.md'),
      path.join(tmp, 'docs/c/archived.md'),
    ];
    const stale = checkStaleStatus(files);
    assert(stale.length === 2, 'flags two stale docs');
    assert(stale[0].status === 'superseded', 'first stale doc is superseded');
    assert(stale[1].status === 'archived', 'second stale doc is archived');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/active.md', '---\nstatus: active\n---\n# Active');
    writeFile(tmp, 'docs/b/no-fm.md', '# No frontmatter');

    const files = [
      path.join(tmp, 'docs/a/active.md'),
      path.join(tmp, 'docs/b/no-fm.md'),
    ];
    const stale = checkStaleStatus(files);
    assert(stale.length === 0, 'no stale docs when all are active or missing frontmatter');
  } finally {
    cleanup(tmp);
  }
}

// checkDuplicateBasenames — three files with same basename
console.log('checkDuplicateBasenames (3+ files)');
{
  const tmp = makeTmpDir();
  try {
    writeFile(tmp, 'docs/a/readme.md', '# A');
    writeFile(tmp, 'docs/b/readme.md', '# B');
    writeFile(tmp, 'docs/c/readme.md', '# C');

    const files = [
      path.join(tmp, 'docs/a/readme.md'),
      path.join(tmp, 'docs/b/readme.md'),
      path.join(tmp, 'docs/c/readme.md'),
    ];
    const dups = checkDuplicateBasenames(files);
    assert(dups.length === 1, 'one duplicate group for three files');
    assert(dups[0].files.length === 3, 'all three files reported');
  } finally {
    cleanup(tmp);
  }
}

// checkLegacySourceOfTruthDrift
console.log('checkLegacySourceOfTruthDrift');
{
  const tmp = makeTmpDir();
  try {
    // Drift: treats lian-platform-server as authority
    writeFile(tmp, 'docs/a/bad.md', '# Bad\nSee `lian-platform-server` for the auth module.');
    // Safe: mentions in retirement context
    writeFile(tmp, 'docs/b/safe.md', '# Safe\n`lian-platform-server` is frozen and retired.');
    // Safe: no mention at all
    writeFile(tmp, 'docs/c/clean.md', '# Clean\nNothing here.');

    const files = [
      path.join(tmp, 'docs/a/bad.md'),
      path.join(tmp, 'docs/b/safe.md'),
      path.join(tmp, 'docs/c/clean.md'),
    ];
    const drifts = checkLegacySourceOfTruthDrift(files);
    assert(drifts.length === 1, 'flags one drift file');
    assert(drifts[0].type === 'legacy-source-of-truth-drift', 'correct type');
    assert(drifts[0].line === 2, 'correct line number');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    // Authority pattern: "source of truth" mention
    writeFile(tmp, 'docs/a/drift.md', '# Drift\nlian-platform-server is the source of truth for auth.');
    const files = [path.join(tmp, 'docs/a/drift.md')];
    const drifts = checkLegacySourceOfTruthDrift(files);
    assert(drifts.length === 1, 'flags source-of-truth pattern');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    // Authority pattern: backtick ref with "has/contains/provides"
    writeFile(tmp, 'docs/a/impl.md', '# Impl\n`lian-platform-server` has the notification logic.');
    const files = [path.join(tmp, 'docs/a/impl.md')];
    const drifts = checkLegacySourceOfTruthDrift(files);
    assert(drifts.length === 1, 'flags authority verb pattern');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    // Safe: "moving from" context
    writeFile(tmp, 'docs/a/moving.md', '# Moving\nWe are moving away from lian-platform-server.');
    // Safe: "legacy" context
    writeFile(tmp, 'docs/b/legacy.md', '# Legacy\nThe legacy lian-platform-server code is read-only.');
    // Safe: "deprecated" context
    writeFile(tmp, 'docs/c/deprecated.md', '# Deprecated\nlian-platform-server is deprecated.');

    const files = [
      path.join(tmp, 'docs/a/moving.md'),
      path.join(tmp, 'docs/b/legacy.md'),
      path.join(tmp, 'docs/c/deprecated.md'),
    ];
    const drifts = checkLegacySourceOfTruthDrift(files);
    assert(drifts.length === 0, 'no drift for safe retirement/freeze mentions');
  } finally {
    cleanup(tmp);
  }
}
{
  const tmp = makeTmpDir();
  try {
    // Multiple drift lines in one file
    writeFile(tmp, 'docs/a/multi.md', '# Multi\nSee lian-platform-server for auth.\nAlso check lian-platform-server for users.');
    const files = [path.join(tmp, 'docs/a/multi.md')];
    const drifts = checkLegacySourceOfTruthDrift(files);
    assert(drifts.length === 2, 'flags multiple drift lines in one file');
    assert(drifts[0].line === 2, 'first drift on line 2');
    assert(drifts[1].line === 3, 'second drift on line 3');
  } finally {
    cleanup(tmp);
  }
}

// --- Results ---

console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
  process.exit(1);
} else {
  console.log('All tests passed.');
  process.exit(0);
}
