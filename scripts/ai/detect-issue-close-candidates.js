#!/usr/bin/env node

/**
 * detect-issue-close-candidates.js
 *
 * Detects issues that are candidates for closing based on merged PR evidence,
 * with discussion safeguards that refuse to propose closing discussion/umbrella
 * or human-required issues.
 *
 * This is a read-only, deterministic script. It never closes issues — it only
 * produces a candidate report. Output is sanitized JSON with no secrets or
 * raw logs.
 *
 * Usage:
 *   node scripts/ai/detect-issue-close-candidates.js --help
 *   node scripts/ai/detect-issue-close-candidates.js --input issues.json
 *   node scripts/ai/detect-issue-close-candidates.js --input issues.json --stdout
 *
 * Exit codes:
 *   0 — report produced (may contain candidates or blockers)
 *   2 — invalid arguments or missing input
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1;

const BLOCK_REASONS = {
  DISCUSSION_ISSUE: 'discussion-issue',
  UMBRELLA_ISSUE: 'umbrella-issue',
  HUMAN_REQUIRED_LABEL: 'human-required-label',
  NO_MERGED_PR: 'no-merged-pr',
  ISSUE_ALREADY_CLOSED: 'issue-already-closed',
  DO_NOT_CLOSE_LABEL: 'do-not-close-label',
};

const DISCUSSION_PATTERNS = [
  /\bdiscussion\b/i,
  /\bumbrella\b/i,
  /\bepic\b/i,
  /\btracking\b/i,
  /\bmeta[- ]issue\b/i,
];

const HUMAN_REQUIRED_LABELS = [
  'do-not-close',
  'wip',
  'blocked',
  'needs-human',
  'needs-discussion',
];

const SAFE_DISCARD_FIELDS = [
  'body', 'author_association', 'node_id', 'html_url', 'url',
  'timeline_url', 'events_url', 'labels_url', 'comments_url',
  'repository_url', 'milestone', 'assignee', 'assignees',
  'pull_request', 'reactions', 'state_reason',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeIssue(issue) {
  const safe = { ...issue };
  for (const field of SAFE_DISCARD_FIELDS) {
    delete safe[field];
  }
  return safe;
}

function hasDiscussionSignals(issue) {
  const title = (issue.title || '').toLowerCase();
  const labels = (issue.labels || []).map((l) =>
    typeof l === 'string' ? l.toLowerCase() : (l.name || '').toLowerCase()
  );
  const labelStr = labels.join(' ');

  for (const pat of DISCUSSION_PATTERNS) {
    if (pat.test(title) || pat.test(labelStr)) return true;
  }
  return false;
}

function hasBlockingLabels(issue) {
  const labels = (issue.labels || []).map((l) =>
    typeof l === 'string' ? l.toLowerCase() : (l.name || '').toLowerCase()
  );
  for (const label of labels) {
    if (HUMAN_REQUIRED_LABELS.includes(label)) return true;
  }
  return false;
}

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

function evaluateIssue(issue, mergedPRs) {
  const result = {
    issueNumber: issue.number,
    title: issue.title || '',
    state: issue.state || 'unknown',
    candidate: false,
    blockers: [],
    mergedPR: null,
  };

  if (issue.state === 'closed') {
    result.blockers.push({
      code: BLOCK_REASONS.ISSUE_ALREADY_CLOSED,
      message: 'Issue is already closed.',
    });
    return result;
  }

  if (hasDiscussionSignals(issue)) {
    result.blockers.push({
      code: BLOCK_REASONS.DISCUSSION_ISSUE,
      message: 'Issue appears to be a discussion/umbrella/tracking issue and must not be auto-closed.',
    });
  }

  if (hasBlockingLabels(issue)) {
    result.blockers.push({
      code: BLOCK_REASONS.HUMAN_REQUIRED_LABEL,
      message: 'Issue has a label that requires human decision before closing.',
    });
  }

  const mergedPR = findMergedClosingPR(issue, mergedPRs);
  if (mergedPR) {
    result.mergedPR = {
      number: mergedPR.number,
      title: mergedPR.title || '',
      mergedAt: mergedPR.merged_at || null,
    };
  } else {
    result.blockers.push({
      code: BLOCK_REASONS.NO_MERGED_PR,
      message: 'No merged PR found that references this issue with a closing keyword.',
    });
  }

  result.candidate = result.blockers.length === 0 && mergedPR !== null;

  return result;
}

function detectCloseCandidates(issues, mergedPRs) {
  const evaluations = issues.map((issue) => evaluateIssue(issue, mergedPRs));
  const candidates = evaluations.filter((e) => e.candidate);
  const blocked = evaluations.filter((e) => !e.candidate);

  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    totalIssues: issues.length,
    candidateCount: candidates.length,
    blockedCount: blocked.length,
    candidates: candidates.map((c) => ({
      issueNumber: c.issueNumber,
      title: c.title,
      mergedPR: c.mergedPR,
    })),
    blocked: blocked.map((b) => ({
      issueNumber: b.issueNumber,
      title: b.title,
      state: b.state,
      blockers: b.blockers,
      mergedPR: b.mergedPR,
    })),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
detect-issue-close-candidates.js — Issue close candidate detector with discussion safeguards

USAGE
    node scripts/ai/detect-issue-close-candidates.js [options]

OPTIONS
    --input <path>   Path to input JSON file containing issues and merged PRs.
    --stdin          Read input JSON from stdin (alternative to --input).
    --stdout         Print JSON result to stdout without banner.
    --help, -h       Show this help message and exit.

INPUT SCHEMA
    {
      "issues": [ { "number": 1, "title": "...", "state": "open", "labels": [...] } ],
      "mergedPRs": [ { "number": 10, "title": "...", "body": "closes #1", "merged_at": "..." } ]
    }

EXIT CODES
    0 — report produced
    2 — invalid arguments or missing input
`;
  process.stdout.write(help);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const useStdin = args.includes('--stdin');
  const useStdout = args.includes('--stdout');
  const inputIdx = args.indexOf('--input');
  const inputPath = inputIdx >= 0 ? args[inputIdx + 1] : null;

  let raw;
  if (useStdin) {
    raw = await readStdin();
  } else if (inputPath) {
    const resolved = path.resolve(inputPath);
    if (!fs.existsSync(resolved)) {
      console.error(`Error: input file not found: ${resolved}`);
      process.exit(2);
    }
    raw = fs.readFileSync(resolved, 'utf8');
  } else {
    console.error('Error: --input <path> or --stdin is required.');
    process.exit(2);
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    console.error('Error: input is not valid JSON.');
    process.exit(2);
  }

  const issues = Array.isArray(input.issues) ? input.issues : [];
  const mergedPRs = Array.isArray(input.mergedPRs) ? input.mergedPRs : [];

  // Sanitize: remove sensitive fields from input before evaluation
  const safeIssues = issues.map(sanitizeIssue);
  const safePRs = mergedPRs.map((pr) => {
    const safe = { ...pr };
    delete safe.author_association;
    delete safe.node_id;
    delete safe.html_url;
    delete safe.url;
    delete safe.diff_url;
    delete safe.patch_url;
    delete safe.issue_url;
    delete safe.user;
    delete safe.head;
    delete safe.base;
    delete safe._links;
    delete safe.auto_merge;
    return safe;
  });

  const result = detectCloseCandidates(safeIssues, safePRs);

  if (useStdout) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log('Issue Close Candidate Report');
    console.log('='.repeat(50));
    console.log(`Total issues scanned: ${result.totalIssues}`);
    console.log(`Candidates for close: ${result.candidateCount}`);
    console.log(`Blocked issues: ${result.blockedCount}`);
    console.log();

    if (result.candidates.length > 0) {
      console.log('CANDIDATES:');
      for (const c of result.candidates) {
        console.log(`  #${c.issueNumber} — ${c.title}`);
        console.log(`    Merged PR: #${c.mergedPR.number} (${c.mergedPR.mergedAt || 'unknown merge date'})`);
      }
      console.log();
    }

    if (result.blocked.length > 0) {
      console.log('BLOCKED:');
      for (const b of result.blocked) {
        console.log(`  #${b.issueNumber} — ${b.title} [${b.state}]`);
        for (const blocker of b.blockers) {
          console.log(`    - ${blocker.code}: ${blocker.message}`);
        }
      }
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(2);
  });
}

// ── Exports for testing ─────────────────────────────────────────────────────

module.exports = {
  evaluateIssue,
  detectCloseCandidates,
  findMergedClosingPR,
  hasDiscussionSignals,
  hasBlockingLabels,
  sanitizeIssue,
  BLOCK_REASONS,
  SCHEMA_VERSION,
};
