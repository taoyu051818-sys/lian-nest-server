#!/usr/bin/env node

/**
 * reduce-gaps-to-issues.js
 *
 * Gap-to-issue reducer: reads gap ledger entries, meta-signals, task board
 * gaps, and provider state to produce deduplicated issue proposals with
 * full evidence and CONTROL APPENDIX.
 *
 * Combines multiple signal sources into a single proposal set, deduplicates
 * against open issues/PRs/merged PRs, and applies a risk policy gate.
 *
 * Dry-run by default. Pass --execute to auto-create only low/medium-risk
 * issues within strict file-scope boundaries.
 *
 * Usage:
 *   node scripts/ai/reduce-gaps-to-issues.js --help
 *   node scripts/ai/reduce-gaps-to-issues.js --stdout
 *   node scripts/ai/reduce-gaps-to-issues.js --execute --repo owner/name --stdout
 *
 * Exit codes:
 *   0 — proposals produced
 *   2 — invalid arguments / gh CLI failure
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(DEFAULT_STATE_DIR, 'gap-reduced-issues.json');
const SCHEMA_VERSION = 1;
const DEFAULT_MAX = 10;

// Allowed auto-create file scopes
const ALLOWED_SCOPES = [
  'docs/**',
  'scripts/ai/**',
  'schemas/**',
  '.github/ai-state/*.example.json',
];

// Forbidden scopes
const FORBIDDEN_SCOPES = [
  'src/**',
  'prisma/**',
  'package.json',
  'package-lock.json',
];

// Stopwords for title deduplication
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'that', 'this', 'be', 'do',
  'add', 'improve', 'update', 'fix', 'create', 'seed', 'implement',
]);

// Gap type to candidate template mapping
const GAP_TYPE_TEMPLATES = {
  'worker-failed': {
    titlePrefix: 'Investigate and recover from worker failure',
    risk: 'high',
    conflictGroup: 'worker-recovery',
    allowedFiles: ['scripts/ai/**', 'docs/ai-native/**', '.github/ai-state/*.example.json'],
    macroGoal: 'worker-failure-recovery',
    taskType: 'execution',
  },
  'worker-stale': {
    titlePrefix: 'Recover stale worker and improve heartbeat monitoring',
    risk: 'high',
    conflictGroup: 'worker-recovery',
    allowedFiles: ['scripts/ai/**', 'docs/ai-native/**', '.github/ai-state/*.example.json'],
    macroGoal: 'worker-stale-recovery',
    taskType: 'execution',
  },
  'health-gate-fail': {
    titlePrefix: 'Fix health gate failure',
    risk: 'high',
    conflictGroup: 'health-gate-repair',
    allowedFiles: ['scripts/ai/**', 'docs/ai-native/**', '.github/ai-state/*.example.json'],
    macroGoal: 'health-gate-repair',
    taskType: 'execution',
  },
  'launch-blocked': {
    titlePrefix: 'Resolve launch block',
    risk: 'medium',
    conflictGroup: 'launch-block-resolution',
    allowedFiles: ['scripts/ai/**', 'docs/ai-native/**', '.github/ai-state/*.example.json'],
    macroGoal: 'launch-block-resolution',
    taskType: 'execution',
  },
  'plan-drift': {
    titlePrefix: 'Address plan drift',
    risk: 'low',
    conflictGroup: 'plan-drift-correction',
    allowedFiles: ['docs/ai-native/**', 'scripts/ai/**'],
    macroGoal: 'plan-drift-correction',
    taskType: 'docs',
  },
  'stale-row': {
    titlePrefix: 'Refresh stale migration matrix row',
    risk: 'low',
    conflictGroup: 'stale-row-refresh',
    allowedFiles: ['scripts/ai/**', 'docs/ai-native/**'],
    macroGoal: 'stale-row-refresh',
    taskType: 'docs',
  },
};

// Task board gap signal to candidate template mapping
const TASK_BOARD_GAP_TEMPLATES = {
  'blocked-lane': {
    titlePrefix: 'Resolve blocked task lane',
    risk: 'medium',
    conflictGroup: 'blocked-lane-resolution',
    allowedFiles: ['scripts/ai/**', 'docs/ai-native/**', '.github/ai-state/*.example.json'],
    macroGoal: 'blocked-lane-resolution',
    taskType: 'execution',
  },
  'empty-ready': {
    titlePrefix: 'Fill empty ready lane deficit',
    risk: 'low',
    conflictGroup: 'ready-lane-deficit',
    allowedFiles: ['docs/ai-native/**', 'scripts/ai/**'],
    macroGoal: 'ready-lane-deficit',
    taskType: 'docs',
  },
  'stale-running': {
    titlePrefix: 'Recover stale running task',
    risk: 'medium',
    conflictGroup: 'stale-running-recovery',
    allowedFiles: ['scripts/ai/**', 'docs/ai-native/**', '.github/ai-state/*.example.json'],
    macroGoal: 'stale-running-recovery',
    taskType: 'execution',
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function extractConflictGroupFromIssueBody(body) {
  if (!body) return null;
  const match = body.match(/Conflict group:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

function isFileScopeForbidden(allowedFiles) {
  for (const pattern of allowedFiles) {
    for (const forbidden of FORBIDDEN_SCOPES) {
      if (pattern === forbidden || pattern.startsWith(forbidden.replace('**', ''))) return true;
      if (forbidden.endsWith('/**')) {
        const prefix = forbidden.slice(0, -3);
        if (pattern.startsWith(prefix + '/') || pattern === prefix) return true;
      }
    }
  }
  return false;
}

function formatTimestamp(isoStr) {
  if (!isoStr) return 'unknown time';
  try {
    return new Date(isoStr).toISOString();
  } catch {
    return isoStr;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
reduce-gaps-to-issues.js — Gap-to-issue reducer (v1)

USAGE
    node scripts/ai/reduce-gaps-to-issues.js [options]

OPTIONS
    --repo <owner/n>  GitHub repository (or set GH_REPO env var).
                      When provided, fetches open issues/PRs and recently
                      merged PRs for dedup (title overlap + conflictGroup).
    --max <n>         Maximum proposals. Default: ${DEFAULT_MAX}.
    --execute         Auto-create low/medium-risk issues on GitHub.
                      Default: dry-run (preview only).
    --stdout          Print JSON to stdout instead of writing a file.
    --out <path>      Output path for reduced issues JSON.
                      Default: .github/ai-state/gap-reduced-issues.json
    --state-dir <path> Path to ai-state directory.
                      Default: .github/ai-state
    --help            Show this help message and exit.

DRY-RUN SAFETY
    By default this script NEVER creates GitHub issues. It outputs a
    proposed-issues JSON compatible with write-planned-issues.ps1.
    Pass --execute to auto-create only policy-allowed low/medium-risk issues.

EXIT CODES
    0   Proposals produced
    2   Invalid arguments / gh CLI failure
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    repo: process.env.GH_REPO || null,
    max: DEFAULT_MAX,
    execute: false,
    stdout: false,
    out: DEFAULT_OUT,
    stateDir: DEFAULT_STATE_DIR,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--repo') {
      i++;
      if (i >= argv.length) { console.error('Error: --repo requires a value'); process.exit(2); }
      args.repo = argv[i];
    } else if (arg === '--max') {
      i++;
      if (i >= argv.length) { console.error('Error: --max requires a number'); process.exit(2); }
      args.max = parseInt(argv[i], 10);
      if (isNaN(args.max) || args.max < 1) { console.error('Error: --max must be >= 1'); process.exit(2); }
    } else if (arg === '--execute') {
      args.execute = true;
    } else if (arg === '--stdout') {
      args.stdout = true;
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
    } else if (arg === '--state-dir') {
      i++;
      if (i >= argv.length) { console.error('Error: --state-dir requires a path'); process.exit(2); }
      args.stateDir = argv[i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }
  return args;
}

// ── Facts reader ─────────────────────────────────────────────────────────────

function readFacts(stateDir) {
  const join = (...p) => path.join(stateDir, ...p);
  const gapLedger = readNdjsonFile(join('gap-ledger.ndjson'));
  const metaSignals = readJsonFile(join('meta-signals.json'));
  const taskBoard = readJsonFile(join('task-board.json'));
  const providerPool = readJsonFile(join('provider-pool.json'));

  return {
    gapLedger,
    metaSignals,
    taskBoard,
    providerPool,
    stateDir,
  };
}

// ── GitHub CLI ───────────────────────────────────────────────────────────────

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

// ── Candidate builder ────────────────────────────────────────────────────────

function makeCandidate(overrides) {
  return {
    issueNumber: null,
    title: '',
    taskType: 'execution',
    risk: 'low',
    conflictGroup: 'ai-auto',
    actorRole: 'issue-production-worker',
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
    ...overrides,
  };
}

// ── Gap-to-candidate mapping ─────────────────────────────────────────────────

function buildEvidenceFromGapEntry(entry) {
  const parts = [];
  parts.push(`Gap type: ${entry.gapType}`);
  parts.push(`Severity: ${entry.severity}`);
  parts.push(`Description: ${entry.description}`);
  parts.push(`Recorded at: ${formatTimestamp(entry.recordedAt)}`);
  if (entry.issue != null) parts.push(`Related issue: #${entry.issue}`);
  if (entry.pr != null) parts.push(`Related PR: #${entry.pr}`);
  if (entry.branch) parts.push(`Branch: ${entry.branch}`);
  if (entry.commit) parts.push(`Commit: ${entry.commit}`);
  if (entry.meta) {
    const metaKeys = Object.keys(entry.meta);
    if (metaKeys.length > 0) {
      parts.push(`Metadata: ${JSON.stringify(entry.meta)}`);
    }
  }
  return parts.join('. ');
}

function buildRationaleFromGapEntry(entry) {
  const rationaleMap = {
    'worker-failed': `A worker failed (${entry.description}). This gap must be investigated to prevent recurrence and recover any in-progress work.`,
    'worker-stale': `A worker went stale (${entry.description}). Stale workers block the task lane and consume resources without progress.`,
    'health-gate-fail': `The health gate failed (${entry.description}). This indicates main branch breakage that must be resolved before new workers can launch.`,
    'launch-blocked': `A launch was blocked (${entry.description}). The task cannot proceed until the blocking condition is resolved.`,
    'plan-drift': `Plan drift detected (${entry.description}). The planned task deviated from expectations and needs correction.`,
    'stale-row': `A stale row was detected (${entry.description}). The migration matrix entry needs refreshing to stay accurate.`,
  };
  return rationaleMap[entry.gapType] || `Gap detected: ${entry.description}`;
}

function buildRollbackFromGapEntry(entry) {
  const rollbackMap = {
    'worker-failed': 'If the worker failure recurs after recovery, escalate to human review. Follow up by verifying the worker completes its task successfully.',
    'worker-stale': 'If stale worker recovery terminates a legitimately slow worker, re-add it to active workers. Follow up by checking heartbeat monitoring.',
    'health-gate-fail': 'If the health gate fix causes regressions, revert the change and escalate. Follow up by verifying tsc and build pass on main.',
    'launch-blocked': 'If the block resolution causes conflicts, revert and re-evaluate the blocking condition. Follow up by verifying the task launches successfully.',
    'plan-drift': 'If the drift correction changes scope inappropriately, revert to the original plan. Follow up by verifying the task meets its original acceptance criteria.',
    'stale-row': 'If the refreshed row is inaccurate, revert to the previous state. Follow up by verifying the migration matrix reflects current state.',
  };
  return rollbackMap[entry.gapType] || 'Revert changes if they cause issues. Follow up by verifying the gap is resolved.';
}

function mapGapEntryToCandidate(entry) {
  const template = GAP_TYPE_TEMPLATES[entry.gapType];
  if (!template) return null;

  // Build a descriptive title
  let title = template.titlePrefix;
  if (entry.issue != null) {
    title += ` (issue #${entry.issue})`;
  }

  return makeCandidate({
    title,
    taskType: template.taskType,
    risk: template.risk,
    conflictGroup: template.conflictGroup,
    allowedFiles: template.allowedFiles,
    macroGoal: template.macroGoal,
    rationale: buildRationaleFromGapEntry(entry),
    evidence: buildEvidenceFromGapEntry(entry),
    rollbackFollowUp: buildRollbackFromGapEntry(entry),
    readinessNote: `Gap ledger entry: ${entry.gapType} at ${formatTimestamp(entry.recordedAt)}`,
  });
}

// ── Task board gap candidates ────────────────────────────────────────────────

function discoverTaskBoardGaps(taskBoard) {
  if (!taskBoard || !taskBoard.tasks) return [];

  const tasks = taskBoard.tasks;
  const signals = [];

  // Blocked lanes
  const blocked = tasks.filter(t => t.state === 'blocked');
  for (const t of blocked) {
    signals.push({
      type: 'blocked-lane',
      issue: t.issue,
      reason: t.blockedReason || 'unknown',
      conflictGroup: t.conflictGroup,
    });
  }

  // Empty-ready lane
  const readyCount = tasks.filter(t => t.state === 'ready').length;
  const readyThreshold = 3;
  if (readyCount < readyThreshold) {
    signals.push({
      type: 'empty-ready',
      readyCount,
      threshold: readyThreshold,
      deficit: readyThreshold - readyCount,
    });
  }

  // Stale-running lanes
  const running = tasks.filter(t => t.state === 'running');
  const staleThresholdMs = 10 * 60 * 1000; // 10 minutes
  for (const t of running) {
    if (!t.worker || !t.worker.lastHeartbeat) {
      signals.push({
        type: 'stale-running',
        issue: t.issue,
        conflictGroup: t.conflictGroup,
        reason: 'no-heartbeat',
      });
      continue;
    }
    const heartbeatTime = new Date(t.worker.lastHeartbeat).getTime();
    if (!isNaN(heartbeatTime) && (Date.now() - heartbeatTime) > staleThresholdMs) {
      signals.push({
        type: 'stale-running',
        issue: t.issue,
        conflictGroup: t.conflictGroup,
        reason: 'heartbeat-stale',
        ageMinutes: Math.round((Date.now() - heartbeatTime) / 60000),
      });
    }
  }

  return signals;
}

function mapTaskBoardGapToCandidate(signal) {
  const template = TASK_BOARD_GAP_TEMPLATES[signal.type];
  if (!template) return null;

  let title = template.titlePrefix;
  if (signal.issue != null) {
    title += ` (issue #${signal.issue})`;
  }

  const evidenceParts = [`Task board gap: ${signal.type}`];
  if (signal.reason) evidenceParts.push(`Reason: ${signal.reason}`);
  if (signal.conflictGroup) evidenceParts.push(`Conflict group: ${signal.conflictGroup}`);
  if (signal.deficit != null) evidenceParts.push(`Ready deficit: ${signal.deficit}`);
  if (signal.ageMinutes != null) evidenceParts.push(`Stale for ${signal.ageMinutes} minutes`);

  return makeCandidate({
    title,
    taskType: template.taskType,
    risk: template.risk,
    conflictGroup: signal.conflictGroup || template.conflictGroup,
    allowedFiles: template.allowedFiles,
    macroGoal: template.macroGoal,
    rationale: `Task board gap detected: ${signal.type}. ${signal.reason || ''}`.trim(),
    evidence: evidenceParts.join('. '),
    rollbackFollowUp: `If resolving this gap causes issues, revert and re-evaluate. Follow up by verifying the task board gap is resolved.`,
    readinessNote: `Task board gap: ${signal.type}`,
  });
}

// ── Provider capacity candidate ──────────────────────────────────────────────

function generateProviderCapacityCandidate(providerPool) {
  if (!providerPool || !providerPool.global) return null;

  const totalMax = providerPool.global.globalMaxWorkers || 0;
  const available = providerPool.global.availableProviders || 0;

  if (available < totalMax) {
    return makeCandidate({
      title: 'Expand provider pool capacity projection',
      conflictGroup: 'provider-pool-capacity',
      risk: 'medium',
      allowedFiles: ['scripts/ai/**', 'docs/ai-native/**', '.github/ai-state/*.example.json'],
      taskType: 'execution',
      macroGoal: 'provider-pool-capacity-projection',
      rationale: `Provider pool has ${available} available slot(s) but globalMaxWorkers is ${totalMax}. Capacity projection should account for scaling.`,
      evidence: `provider-pool.json shows availableProviders=${available} but globalMaxWorkers=${totalMax}. Gap of ${totalMax - available} slot(s) not projected.`,
      rollbackFollowUp: 'If capacity projection changes cause over-scheduling, revert the projection doc and reduce globalMaxWorkers. Follow up by re-running a dry-run cycle to verify slot allocation.',
      readinessNote: `Available providers (${available}) < globalMaxWorkers (${totalMax}).`,
    });
  }

  return null;
}

// ── Meta-signal enrichment ───────────────────────────────────────────────────

function enrichCandidateWithMetaSignals(candidate, metaSignals) {
  if (!metaSignals) return candidate;

  const parts = [];
  if (metaSignals.failureScore != null && metaSignals.failureScore > 0.5) {
    parts.push(`High failure score: ${metaSignals.failureScore}`);
  }
  if (metaSignals.frictionScore != null && metaSignals.frictionScore > 0.5) {
    parts.push(`High friction score: ${metaSignals.frictionScore}`);
  }
  if (metaSignals.riskScore != null && metaSignals.riskScore > 0.7) {
    parts.push(`Elevated risk score: ${metaSignals.riskScore}`);
  }
  if (metaSignals.topPain) {
    parts.push(`Top pain: ${metaSignals.topPain}`);
  }

  if (parts.length > 0) {
    candidate.evidence = candidate.evidence
      ? `${candidate.evidence}. Meta-signals: ${parts.join('; ')}`
      : `Meta-signals: ${parts.join('; ')}`;
  }

  return candidate;
}

// ── Core logic ───────────────────────────────────────────────────────────────

function generateAllCandidates(facts) {
  const candidates = [];

  // 1. Map gap ledger entries to candidates
  const seenGapTypes = new Set();
  for (const entry of facts.gapLedger) {
    const candidate = mapGapEntryToCandidate(entry);
    if (candidate) {
      // Deduplicate within the same gap type to avoid multiple issues for the same type
      const dedupeKey = `${entry.gapType}:${entry.issue || 'none'}`;
      if (!seenGapTypes.has(dedupeKey)) {
        seenGapTypes.add(dedupeKey);
        candidates.push(candidate);
      }
    }
  }

  // 2. Map task board gaps to candidates
  const taskBoardGaps = discoverTaskBoardGaps(facts.taskBoard);
  for (const signal of taskBoardGaps) {
    const candidate = mapTaskBoardGapToCandidate(signal);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  // 3. Provider capacity candidate
  const providerCandidate = generateProviderCapacityCandidate(facts.providerPool);
  if (providerCandidate) {
    candidates.push(providerCandidate);
  }

  // 4. Enrich all candidates with meta-signals
  for (const candidate of candidates) {
    enrichCandidateWithMetaSignals(candidate, facts.metaSignals);
  }

  return candidates;
}

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

function applyPolicyGate(candidates) {
  const autoCreatable = [];
  const humanRequired = [];

  for (const candidate of candidates) {
    if (candidate.risk === 'high') {
      candidate.readiness = 'blocked';
      candidate.readinessNote = (candidate.readinessNote ? candidate.readinessNote + ' ' : '') + 'High-risk: requires human approval.';
      candidate.humanRequired = true;
      humanRequired.push(candidate);
      continue;
    }

    if (candidate.humanRequired) {
      candidate.readiness = 'human-required';
      humanRequired.push(candidate);
      continue;
    }

    if (isFileScopeForbidden(candidate.allowedFiles)) {
      candidate.readiness = 'blocked';
      candidate.readinessNote = (candidate.readinessNote ? candidate.readinessNote + ' ' : '') + 'Touches forbidden file scope.';
      candidate.humanRequired = true;
      humanRequired.push(candidate);
      continue;
    }

    candidate.readiness = 'ready';
    autoCreatable.push(candidate);
  }

  return { autoCreatable, humanRequired };
}

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
  lines.push('');
  lines.push('---');
  lines.push('CONTROL APPENDIX (launcher generated)');
  lines.push(`Task type: ${candidate.taskType}`);
  lines.push(`Risk: ${candidate.risk}`);
  lines.push(`Conflict group: ${candidate.conflictGroup}`);
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

// ── Execute mode ─────────────────────────────────────────────────────────────

function executeAutoCreate(repo, autoCreatable, humanRequired, max) {
  const created = [];
  const failed = [];
  const blocked = [];

  for (const candidate of humanRequired) {
    blocked.push(candidate);
  }

  const toCreate = autoCreatable.slice(0, max);
  for (const candidate of toCreate) {
    const body = buildIssueBody(candidate);
    const result = createGitHubIssue(repo, candidate.title, body, 'agent:codex-action-needed');

    if (result.error) {
      failed.push({ title: candidate.title, error: result.error });
    } else {
      created.push({ title: candidate.title, url: result.url });
    }
  }

  return { created, failed, blocked };
}

// ── Exports (for testing) ────────────────────────────────────────────────────

module.exports = {
  readFacts,
  generateAllCandidates,
  discoverTaskBoardGaps,
  mapGapEntryToCandidate,
  mapTaskBoardGapToCandidate,
  generateProviderCapacityCandidate,
  enrichCandidateWithMetaSignals,
  deduplicate,
  applyPolicyGate,
  buildOutput,
  buildIssueBody,
  extractKeywords,
  titleOverlap,
  isFileScopeForbidden,
  extractConflictGroupFromIssueBody,
  makeCandidate,
  buildEvidenceFromGapEntry,
  buildRationaleFromGapEntry,
  GAP_TYPE_TEMPLATES,
  TASK_BOARD_GAP_TEMPLATES,
};

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const facts = readFacts(args.stateDir);

  const openIssues = args.repo ? fetchOpenIssues(args.repo) : [];
  const openPRs = args.repo ? fetchOpenPRs(args.repo) : [];
  const mergedPRs = args.repo ? fetchMergedPRs(args.repo, 50) : [];

  const allCandidates = generateAllCandidates(facts);

  const { proposed, skipped } = deduplicate(allCandidates, openIssues, openPRs, mergedPRs);

  const { autoCreatable, humanRequired } = applyPolicyGate(proposed);

  const mode = args.execute ? 'execute' : 'dry-run';
  const allProposed = [...autoCreatable, ...humanRequired];
  const output = buildOutput(allProposed, skipped, mode, args.max);

  if (args.execute) {
    if (!args.repo) {
      console.error('Error: --repo is required with --execute. Set GH_REPO or pass --repo OWNER/NAME.');
      process.exit(2);
    }
    const result = executeAutoCreate(args.repo, autoCreatable, humanRequired, args.max);
    output.executionResult = result;
  }

  const json = JSON.stringify(output, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Gap-reduced issues written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }
}

if (require.main === module) {
  main();
}
