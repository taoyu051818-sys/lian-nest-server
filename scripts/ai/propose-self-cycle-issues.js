#!/usr/bin/env node

/**
 * propose-self-cycle-issues.js
 *
 * Policy-gated autonomous issue seeding for the AI self-cycle.
 * Reads current system facts (health, resources, provider pool, macro goal,
 * task board, active workers, ledgers) and generates proposed GitHub issues
 * to fill control-plane gaps.
 *
 * Dry-run by default. Pass --execute to auto-create only low/medium-risk
 * issues within strict file-scope boundaries. High-risk items are always
 * emitted as humanRequired and never auto-created.
 *
 * Output JSON is compatible with write-planned-issues.ps1.
 *
 * Usage:
 *   node scripts/ai/propose-self-cycle-issues.js --help
 *   node scripts/ai/propose-self-cycle-issues.js --stdout
 *   node scripts/ai/propose-self-cycle-issues.js --execute --repo owner/name --stdout
 *
 * Exit codes:
 *   0 — proposals produced
 *   2 — invalid arguments / gh CLI failure
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(DEFAULT_STATE_DIR, 'proposed-issues.json');
const AUDIT_FILE = 'issue-seeding-events.ndjson';
const SCHEMA_VERSION = 1;
const DEFAULT_MAX = 10;
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// Allowed auto-create file scopes
const ALLOWED_SCOPES = [
  'docs/**',
  'scripts/ai/**',
  'schemas/**',
  'tools/provider-pool-webui/**',
  '.github/ai-state/*.example.json',
];

// Forbidden scopes (any candidate touching these is human-required)
const FORBIDDEN_SCOPES = [
  'src/**',
  'prisma/**',
  'package.json',
  'package-lock.json',
  '.github/ai-policy/seed-constitution.md',
];

const FORBIDDEN_PATTERNS = [/secret/i, /credential/i, /token/i, /password/i];

// Keywords for title deduplication (stopwords removed)
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'that', 'this', 'be', 'do',
  'add', 'improve', 'update', 'fix', 'create', 'seed', 'implement',
]);

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
      // Simple glob: src/** matches src/anything
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

function generateEventId() {
  return crypto.randomUUID();
}

function printHelp() {
  const help = `
propose-self-cycle-issues.js — Policy-gated autonomous issue seeding (v1)

USAGE
    node scripts/ai/propose-self-cycle-issues.js [options]

OPTIONS
    --repo <owner/n>  GitHub repository (or set GH_REPO env var).
                      When provided, fetches open issues/PRs and recently
                      merged PRs for dedup (title overlap + conflictGroup).
    --max <n>         Maximum proposals. Default: ${DEFAULT_MAX}.
    --execute         Auto-create low/medium-risk issues on GitHub.
                      Default: dry-run (preview only).
    --stdout          Print JSON to stdout instead of writing a file.
    --out <path>      Output path for proposed-issues JSON.
                      Default: .github/ai-state/proposed-issues.json
    --state-dir <path> Path to ai-state directory.
                      Default: .github/ai-state
    --self-test       Run built-in assertions and exit.
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

// ── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    repo: process.env.GH_REPO || null,
    max: DEFAULT_MAX,
    execute: false,
    stdout: false,
    out: DEFAULT_OUT,
    stateDir: DEFAULT_STATE_DIR,
    selfTest: false,
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

// ── Facts reader ─────────────────────────────────────────────────────────────

function readFacts(stateDir) {
  const join = (...p) => path.join(stateDir, ...p);

  const health = readJsonFile(join('main-health.json'));
  const localResource = readJsonFile(join('local-resource.json'));
  const providerPool = readJsonFile(join('provider-pool.json'));
  const taskBoard = readJsonFile(join('task-board.json'));
  const activeWorkers = readJsonFile(join('active-workers.json'));
  const macroGoal = readJsonFile(join('macro-goal.json'));
  const legacyRetirement = readJsonFile(join('legacy-orchestration-retirement.json'));
  const metaSignals = readJsonFile(join('meta-signals.json'));
  const spendingLedger = readNdjsonFile(join('spending-ledger.ndjson'));
  const contributionLedger = readNdjsonFile(join('contribution-ledger.ndjson'));

  return {
    health,
    localResource,
    providerPool,
    taskBoard,
    activeWorkers,
    macroGoal,
    legacyRetirement,
    metaSignals,
    spendingLedger,
    contributionLedger,
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

// ── Gap generators ───────────────────────────────────────────────────────────

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
    humanRequired: false,
    ...overrides,
  };
}

function generateResourceSamplerFreshnessCandidates(facts) {
  const lr = facts.localResource;
  if (!lr) {
    return [makeCandidate({
      title: 'Refresh resource sampler state for local machine',
      conflictGroup: 'resource-sampler',
      risk: 'low',
      allowedFiles: ['scripts/ai/**', '.github/ai-state/*.example.json'],
      rationale: 'local-resource.json is missing. Resource pressure detection cannot function without current sampler state.',
      macroGoal: 'resource-sampler-freshness',
      readinessNote: 'No local-resource.json found. Create or refresh the resource sampler.',
    })];
  }

  const allNull = lr.cpu && lr.cpu.cores === null && lr.memory && lr.memory.totalGB === null;
  const capturedAt = lr.global && lr.global.capturedAt;
  const stale = capturedAt && (Date.now() - new Date(capturedAt).getTime()) > STALE_THRESHOLD_MS;

  if (allNull || stale) {
    return [makeCandidate({
      title: 'Refresh resource sampler state for local machine',
      conflictGroup: 'resource-sampler',
      risk: 'low',
      allowedFiles: ['scripts/ai/**', '.github/ai-state/*.example.json'],
      rationale: allNull
        ? 'local-resource.json has all null metrics. Sampler has never collected real data.'
        : `local-resource.json capturedAt is ${capturedAt}, exceeding 5min TTL.`,
      macroGoal: 'resource-sampler-freshness',
      readinessNote: 'Resource sampler data is stale or empty.',
    })];
  }

  return [];
}

function generateProviderCapacityCandidates(facts) {
  const pp = facts.providerPool;
  if (!pp) return [];

  const totalMax = pp.global ? pp.global.globalMaxWorkers || 0 : 0;
  const available = pp.global ? pp.global.availableProviders || 0 : 0;

  if (available < totalMax) {
    return [makeCandidate({
      title: 'Expand provider pool capacity projection',
      conflictGroup: 'provider-pool-capacity',
      risk: 'medium',
      allowedFiles: ['scripts/ai/**', 'docs/ai-native/**', '.github/ai-state/*.example.json'],
      rationale: `Provider pool has ${available} available slot(s) but globalMaxWorkers is ${totalMax}. Capacity projection should account for scaling.`,
      macroGoal: 'provider-pool-capacity-projection',
      readinessNote: `Available providers (${available}) < globalMaxWorkers (${totalMax}).`,
    })];
  }

  return [];
}

function generateTaskBoardCandidates(facts) {
  if (!facts.taskBoard) {
    return [makeCandidate({
      title: 'Seed task board from open labeled issues',
      conflictGroup: 'task-board-completeness',
      risk: 'low',
      allowedFiles: ['scripts/ai/**', 'docs/ai-native/**', '.github/ai-state/*.example.json'],
      rationale: 'task-board.json does not exist. The self-cycle cannot project task state without a task board.',
      macroGoal: 'task-board-completeness',
      readinessNote: 'No task-board.json found.',
    })];
  }

  const tasks = facts.taskBoard.tasks || [];
  const noConflict = tasks.filter(t => !t.conflictGroup);
  if (noConflict.length > 0) {
    return [makeCandidate({
      title: 'Backfill conflictGroup for task board entries missing it',
      conflictGroup: 'task-board-completeness',
      risk: 'low',
      allowedFiles: ['scripts/ai/**', '.github/ai-state/*.example.json'],
      rationale: `${noConflict.length} task board entry/entries missing conflictGroup. Conflict-safe dispatch requires this field.`,
      macroGoal: 'task-board-completeness',
      readinessNote: `${noConflict.length} tasks missing conflictGroup.`,
    })];
  }

  return [];
}

function generateCommandStewardRecoveryCandidates(facts) {
  const lr = facts.legacyRetirement;
  if (!lr || !lr.duties) return [];

  // duties is an object keyed by duty-id, each with { name, status }
  const dutyEntries = Object.entries(lr.duties);
  const incomplete = dutyEntries.filter(([, d]) => d.status !== 'met');
  if (incomplete.length > 0) {
    return [makeCandidate({
      title: 'Complete Command Steward duty handoff for remaining duties',
      conflictGroup: 'command-steward-recovery',
      risk: 'medium',
      allowedFiles: ['docs/ai-native/**', 'scripts/ai/**', 'schemas/**'],
      rationale: `${incomplete.length} Command Steward duty/duties still incomplete: ${incomplete.map(([, d]) => d.name).join(', ')}.`,
      macroGoal: 'command-steward-recovery',
      readinessNote: `Incomplete duties: ${incomplete.map(([, d]) => `${d.name} (${d.status})`).join(', ')}.`,
    })];
  }

  return [];
}

function generateBoundedParallelRehearsalCandidates(facts) {
  // Check if bounded parallel infrastructure exists but no rehearsal test
  const testScript = path.join(REPO_ROOT, 'scripts', 'ai', 'self-cycle-dry-run-smoke.test.js');
  const hasSmokeTest = fs.existsSync(testScript);

  // Check if #1306 is mentioned in recent commits or if bounded parallel docs exist
  const bpDoc = path.join(REPO_ROOT, 'docs', 'ai-native', 'bounded-parallel-worker-execution.md');
  const hasBpDoc = fs.existsSync(bpDoc);

  if (hasBpDoc && !hasSmokeTest) {
    return [makeCandidate({
      title: 'Add bounded parallel rehearsal smoke test',
      conflictGroup: 'bounded-parallel-rehearsal',
      risk: 'low',
      allowedFiles: ['scripts/ai/**', 'docs/ai-native/**'],
      rationale: 'Bounded parallel worker execution spec exists but no rehearsal smoke test validates the dispatch path end-to-end.',
      macroGoal: 'bounded-parallel-rehearsal',
      readinessNote: 'No self-cycle-dry-run-smoke.test.js found.',
    })];
  }

  return [];
}

function generateActiveWorkerMonitoringCandidates(facts) {
  const aw = facts.activeWorkers;
  if (!aw) return [];

  const workers = aw.workers || [];
  const stale = workers.filter(w => {
    if (!w.startedAt) return false;
    const age = Date.now() - new Date(w.startedAt).getTime();
    return age > 30 * 60 * 1000 && (!w.endedAt);
  });

  if (stale.length > 0) {
    return [makeCandidate({
      title: 'Improve active worker heartbeat monitoring for stale workers',
      conflictGroup: 'active-worker-monitoring',
      risk: 'medium',
      allowedFiles: ['scripts/ai/**', 'docs/ai-native/**', '.github/ai-state/*.example.json'],
      rationale: `${stale.length} active worker(s) have been running >30min without ending. Heartbeat monitoring should detect and recover stale workers.`,
      macroGoal: 'active-worker-monitoring',
      readinessNote: `Stale workers: ${stale.map(w => w.issueNumber || w.issue).join(', ')}.`,
    })];
  }

  return [];
}

function generateIssueCloseCandidateDetectionCandidates(facts) {
  const detectScript = path.join(REPO_ROOT, 'scripts', 'ai', 'detect-issue-close-candidates.js');
  if (!fs.existsSync(detectScript)) {
    return [makeCandidate({
      title: 'Add issue close candidate detection script',
      conflictGroup: 'issue-close-detection',
      risk: 'low',
      allowedFiles: ['scripts/ai/**', 'docs/ai-native/**'],
      rationale: 'detect-issue-close-candidates.js does not exist. The self-cycle cannot identify issues ready to close.',
      macroGoal: 'issue-close-candidate-detection',
      readinessNote: 'No detect-issue-close-candidates.js found.',
    })];
  }

  return [];
}

function generateLedgerIntegrationCandidates(facts) {
  const candidates = [];

  if (facts.spendingLedger.length === 0) {
    candidates.push(makeCandidate({
      title: 'Seed spending ledger integration for cost tracking',
      conflictGroup: 'ledger-integration',
      risk: 'low',
      allowedFiles: ['scripts/ai/**', 'schemas/**', 'docs/ai-native/**', '.github/ai-state/*.example.json'],
      rationale: 'spending-ledger.ndjson is empty or missing. Worker cost tracking requires ledger entries.',
      macroGoal: 'spending-ledger-integration',
      readinessNote: 'No spending ledger entries found.',
    }));
  }

  if (facts.contributionLedger.length === 0) {
    candidates.push(makeCandidate({
      title: 'Seed contribution ledger integration for audit trail',
      conflictGroup: 'ledger-integration',
      risk: 'low',
      allowedFiles: ['scripts/ai/**', 'schemas/**', 'docs/ai-native/**', '.github/ai-state/*.example.json'],
      rationale: 'contribution-ledger.ndjson is empty or missing. Worker contribution tracking requires ledger entries.',
      macroGoal: 'contribution-ledger-integration',
      readinessNote: 'No contribution ledger entries found.',
    }));
  }

  return candidates;
}

function generateFailureClassificationCandidates(facts) {
  const classScript = path.join(REPO_ROOT, 'scripts', 'ai', 'classify-self-cycle-failure.js');
  if (!fs.existsSync(classScript)) {
    return [makeCandidate({
      title: 'Add self-cycle failure classification script',
      conflictGroup: 'failure-classification',
      risk: 'low',
      allowedFiles: ['scripts/ai/**', 'docs/ai-native/**'],
      rationale: 'classify-self-cycle-failure.js does not exist. Failure recovery requires classification to route failures appropriately.',
      macroGoal: 'self-cycle-failure-classification',
      readinessNote: 'No classify-self-cycle-failure.js found.',
    })];
  }

  return [];
}

function generateSelfSeedingCandidates() {
  return [makeCandidate({
    title: 'Improve self-cycle issue proposal generator coverage and gap detection',
    conflictGroup: 'issue-seeding-meta',
    risk: 'medium',
    taskType: 'research',
    allowedFiles: ['scripts/ai/**', 'docs/ai-native/**'],
    rationale: 'This meta-issue tracks improvements to the issue proposal generator itself. Always human-reviewed.',
    macroGoal: 'issue-seeding-improvement',
    humanRequired: true,
    readiness: 'human-required',
    readinessNote: 'Meta-issue for issue seeding improvements. Requires human review.',
  })];
}

// ── Core logic ───────────────────────────────────────────────────────────────

function generateAllCandidates(facts) {
  return [
    ...generateResourceSamplerFreshnessCandidates(facts),
    ...generateProviderCapacityCandidates(facts),
    ...generateTaskBoardCandidates(facts),
    ...generateCommandStewardRecoveryCandidates(facts),
    ...generateBoundedParallelRehearsalCandidates(facts),
    ...generateActiveWorkerMonitoringCandidates(facts),
    ...generateIssueCloseCandidateDetectionCandidates(facts),
    ...generateLedgerIntegrationCandidates(facts),
    ...generateFailureClassificationCandidates(facts),
    ...generateSelfSeedingCandidates(facts),
  ];
}

function deduplicate(candidates, openIssues, openPRs, mergedPRs) {
  const proposed = [];
  const skipped = [];

  const openIssueList = openIssues || [];
  const openPRList = openPRs || [];
  const mergedPRList = mergedPRs || [];

  // Build title lists for overlap check
  const openTitles = openIssueList.map(i => i.title || '');
  const prTitles = openPRList.map(p => p.title || '');
  const mergedTitles = mergedPRList.map(p => p.title || '');
  const allTitles = [...openTitles, ...prTitles, ...mergedTitles];

  // Build conflict group set from issues AND PRs (open + merged)
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

    // Check title overlap against all existing titles (issues + open PRs + merged PRs)
    for (const existingTitle of allTitles) {
      if (titleOverlap(candidate.title, existingTitle) > 0.5) {
        isDuplicate = true;
        reason = `title overlap with existing: "${existingTitle}"`;
        break;
      }
    }

    // Check conflictGroup against issues and PRs (open + merged)
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
    // High-risk always human-required
    if (candidate.risk === 'high') {
      candidate.readiness = 'blocked';
      candidate.readinessNote = (candidate.readinessNote ? candidate.readinessNote + ' ' : '') + 'High-risk: requires human approval.';
      candidate.humanRequired = true;
      humanRequired.push(candidate);
      continue;
    }

    // Already marked human-required
    if (candidate.humanRequired) {
      candidate.readiness = 'human-required';
      humanRequired.push(candidate);
      continue;
    }

    // Check if allowed files touch forbidden scopes
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

// ── Audit logging ────────────────────────────────────────────────────────────

function writeAuditEvent(stateDir, event) {
  const auditPath = path.join(stateDir, AUDIT_FILE);
  const entry = {
    schemaVersion: SCHEMA_VERSION,
    eventId: generateEventId(),
    recordedAt: new Date().toISOString(),
    ...event,
  };
  fs.appendFileSync(auditPath, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

// ── Execute mode ─────────────────────────────────────────────────────────────

function executeAutoCreate(repo, autoCreatable, humanRequired, max, stateDir) {
  const created = [];
  const failed = [];
  const blocked = [];

  // Record human-required items as blocked
  for (const candidate of humanRequired) {
    writeAuditEvent(stateDir, {
      mode: 'execute',
      action: 'block-high-risk',
      title: candidate.title,
      conflictGroup: candidate.conflictGroup,
      risk: candidate.risk,
      humanRequired: true,
      issueUrl: null,
      reason: candidate.readinessNote || 'Policy gate: high-risk or forbidden scope.',
    });
    blocked.push(candidate);
  }

  // Auto-create eligible candidates
  const toCreate = autoCreatable.slice(0, max);
  for (const candidate of toCreate) {
    const body = buildIssueBody(candidate);
    const result = createGitHubIssue(repo, candidate.title, body, 'agent:codex-action-needed');

    if (result.error) {
      writeAuditEvent(stateDir, {
        mode: 'execute',
        action: 'create-failed',
        title: candidate.title,
        conflictGroup: candidate.conflictGroup,
        risk: candidate.risk,
        humanRequired: false,
        issueUrl: null,
        reason: result.error,
      });
      failed.push({ title: candidate.title, error: result.error });
    } else {
      writeAuditEvent(stateDir, {
        mode: 'execute',
        action: 'create',
        title: candidate.title,
        conflictGroup: candidate.conflictGroup,
        risk: candidate.risk,
        humanRequired: false,
        issueUrl: result.url,
        reason: 'Auto-created by policy-gated issue seeding.',
      });
      created.push({ title: candidate.title, url: result.url });
    }
  }

  return { created, failed, blocked };
}

function buildIssueBody(candidate) {
  const lines = [];
  lines.push('## Goal');
  lines.push('');
  lines.push(candidate.title);
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

  // Test: extractKeywords
  const kw = extractKeywords('Add bounded parallel rehearsal smoke test');
  assert(kw.includes('bounded'), 'extractKeywords: bounded');
  assert(kw.includes('parallel'), 'extractKeywords: parallel');
  assert(kw.includes('rehearsal'), 'extractKeywords: rehearsal');
  assert(kw.includes('smoke'), 'extractKeywords: smoke');
  assert(!kw.includes('add'), 'extractKeywords: stopwords removed');

  // Test: titleOverlap
  assert(titleOverlap('Add bounded parallel rehearsal', 'Add bounded parallel test') > 0.5, 'titleOverlap: similar titles');
  assert(titleOverlap('Refresh resource sampler', 'Add bounded parallel rehearsal') < 0.5, 'titleOverlap: different titles');
  assert(titleOverlap('', 'something') === 0, 'titleOverlap: empty string');

  // Test: isFileScopeForbidden
  assert(isFileScopeForbidden(['src/**']), 'isFileScopeForbidden: src/**');
  assert(isFileScopeForbidden(['prisma/migrations']), 'isFileScopeForbidden: prisma');
  assert(isFileScopeForbidden(['package.json']), 'isFileScopeForbidden: package.json');
  assert(!isFileScopeForbidden(['docs/**']), 'isFileScopeForbidden: docs/** is allowed');
  assert(!isFileScopeForbidden(['scripts/ai/**']), 'isFileScopeForbidden: scripts/ai/** is allowed');

  // Test: makeCandidate defaults
  const c = makeCandidate({ title: 'test' });
  assert(c.risk === 'low', 'makeCandidate: default risk is low');
  assert(c.readiness === 'ready', 'makeCandidate: default readiness is ready');
  assert(c.humanRequired === false, 'makeCandidate: default humanRequired is false');
  assert(c.issueNumber === null, 'makeCandidate: default issueNumber is null');

  // Test: deduplicate removes title overlap
  const candidates = [
    makeCandidate({ title: 'Add bounded parallel rehearsal smoke test' }),
    makeCandidate({ title: 'Refresh resource sampler' }),
  ];
  const openIssues = [{ title: 'Add bounded parallel rehearsal test', body: '', labels: [] }];
  const dedupResult = deduplicate(candidates, openIssues, []);
  assert(dedupResult.proposed.length === 1, 'deduplicate: 1 proposed after removing overlap');
  assert(dedupResult.skipped.length === 1, 'deduplicate: 1 skipped');
  assert(dedupResult.skipped[0].reason.includes('title overlap'), 'deduplicate: reason mentions title overlap');

  // Test: deduplicate by conflictGroup (all candidates with same CG are skipped)
  const cgCandidates = [
    makeCandidate({ title: 'Unique title A', conflictGroup: 'resource-sampler' }),
    makeCandidate({ title: 'Unique title B', conflictGroup: 'resource-sampler' }),
  ];
  const cgIssues = [{ title: 'Old resource issue', body: 'Conflict group: resource-sampler\nCONTROL APPENDIX', labels: [] }];
  const cgDedup = deduplicate(cgCandidates, cgIssues, []);
  assert(cgDedup.proposed.length === 0, 'deduplicate by conflictGroup: 0 proposed (both collide)');
  assert(cgDedup.skipped.length === 2, 'deduplicate by conflictGroup: 2 skipped');

  // Test: deduplicate by conflictGroup in PR body (open PR)
  const prCgCandidates = [makeCandidate({ title: 'Unique title C', conflictGroup: 'auth-core' })];
  const prCgOpenPRs = [{ title: 'Auth refactor PR', body: 'Conflict group: auth-core\nCONTROL APPENDIX', headRefName: 'auth-refactor' }];
  const prCgDedup = deduplicate(prCgCandidates, [], prCgOpenPRs);
  assert(prCgDedup.proposed.length === 0, 'deduplicate by PR conflictGroup: 0 proposed');
  assert(prCgDedup.skipped.length === 1, 'deduplicate by PR conflictGroup: 1 skipped');

  // Test: deduplicate by conflictGroup in merged PR body
  const mergedCgCandidates = [makeCandidate({ title: 'Unique title D', conflictGroup: 'feed' })];
  const mergedPRs = [{ title: 'Feed optimization PR', body: 'Conflict group: feed\nCONTROL APPENDIX', headRefName: 'feed-opt' }];
  const mergedDedup = deduplicate(mergedCgCandidates, [], [], mergedPRs);
  assert(mergedDedup.proposed.length === 0, 'deduplicate by merged PR conflictGroup: 0 proposed');
  assert(mergedDedup.skipped.length === 1, 'deduplicate by merged PR conflictGroup: 1 skipped');

  // Test: deduplicate by title overlap with merged PR
  const mergedTitleCandidates = [makeCandidate({ title: 'Feed optimization for performance' })];
  const mergedTitlePRs = [{ title: 'Feed optimization for speed', body: '', headRefName: 'feed-speed' }];
  const mergedTitleDedup = deduplicate(mergedTitleCandidates, [], [], mergedTitlePRs);
  assert(mergedTitleDedup.proposed.length === 0, 'deduplicate by merged PR title: 0 proposed');
  assert(mergedTitleDedup.skipped.length === 1, 'deduplicate by merged PR title: 1 skipped');

  // Test: applyPolicyGate blocks high-risk
  const highRisk = [makeCandidate({ title: 'Dangerous change', risk: 'high' })];
  const gateResult = applyPolicyGate(highRisk);
  assert(gateResult.autoCreatable.length === 0, 'applyPolicyGate: high-risk not auto-creatable');
  assert(gateResult.humanRequired.length === 1, 'applyPolicyGate: high-risk is human-required');
  assert(gateResult.humanRequired[0].readiness === 'blocked', 'applyPolicyGate: high-risk readiness is blocked');

  // Test: applyPolicyGate allows low-risk
  const lowRisk = [makeCandidate({ title: 'Safe docs change', risk: 'low' })];
  const lowGate = applyPolicyGate(lowRisk);
  assert(lowGate.autoCreatable.length === 1, 'applyPolicyGate: low-risk is auto-creatable');
  assert(lowGate.humanRequired.length === 0, 'applyPolicyGate: low-risk not human-required');

  // Test: buildOutput shape
  const output = buildOutput([makeCandidate({ title: 'test' })], [], 'dry-run', 10);
  assert(output.planVersion === 1, 'buildOutput: planVersion is 1');
  assert(typeof output.capturedAt === 'string', 'buildOutput: capturedAt is string');
  assert(Array.isArray(output.candidates), 'buildOutput: candidates is array');
  assert(Array.isArray(output.skippedDuplicates), 'buildOutput: skippedDuplicates is array');
  assert(output.mode === 'dry-run', 'buildOutput: mode is dry-run');

  // Test: buildOutput caps at max
  const manyCandidates = Array.from({ length: 15 }, (_, i) => makeCandidate({ title: `Issue ${i}` }));
  const cappedOutput = buildOutput(manyCandidates, [], 'dry-run', 5);
  assert(cappedOutput.candidates.length === 5, 'buildOutput: caps at max=5');
  assert(cappedOutput.totalProposed === 15, 'buildOutput: totalProposed is 15');

  // Test: candidate shape has CONTROL APPENDIX fields
  const cand = makeCandidate({ title: 'Test issue' });
  assert(typeof cand.taskType === 'string', 'candidate has taskType');
  assert(typeof cand.risk === 'string', 'candidate has risk');
  assert(typeof cand.conflictGroup === 'string', 'candidate has conflictGroup');
  assert(typeof cand.actorRole === 'string', 'candidate has actorRole');
  assert(Array.isArray(cand.allowedFiles), 'candidate has allowedFiles');
  assert(Array.isArray(cand.forbiddenFiles), 'candidate has forbiddenFiles');
  assert(Array.isArray(cand.validationCommands), 'candidate has validationCommands');
  assert(typeof cand.readiness === 'string', 'candidate has readiness');
  assert(typeof cand.macroGoal === 'string', 'candidate has macroGoal');
  assert(typeof cand.rationale === 'string', 'candidate has rationale');

  // Test: buildIssueBody contains CONTROL APPENDIX
  const body = buildIssueBody(makeCandidate({ title: 'Test', conflictGroup: 'test-group' }));
  assert(body.includes('CONTROL APPENDIX'), 'buildIssueBody: contains CONTROL APPENDIX');
  assert(body.includes('Conflict group: test-group'), 'buildIssueBody: contains conflict group');
  assert(body.includes('Role packet:'), 'buildIssueBody: contains role packet');

  // Report
  console.log(`\n  propose-self-cycle-issues self-test`);
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

  // Read facts
  const facts = readFacts(args.stateDir);

  // Fetch open issues/PRs and recently merged PRs for dedup (only when repo is provided)
  const openIssues = args.repo ? fetchOpenIssues(args.repo) : [];
  const openPRs = args.repo ? fetchOpenPRs(args.repo) : [];
  const mergedPRs = args.repo ? fetchMergedPRs(args.repo, 50) : [];

  // Generate candidates from gaps
  const allCandidates = generateAllCandidates(facts);

  // Deduplicate
  const { proposed, skipped } = deduplicate(allCandidates, openIssues, openPRs, mergedPRs);

  // Apply policy gate
  const { autoCreatable, humanRequired } = applyPolicyGate(proposed);

  const mode = args.execute ? 'execute' : 'dry-run';

  // Log audit events for all candidates
  for (const c of autoCreatable) {
    writeAuditEvent(args.stateDir, {
      mode,
      action: 'propose',
      title: c.title,
      conflictGroup: c.conflictGroup,
      risk: c.risk,
      humanRequired: false,
      issueUrl: null,
      reason: 'Auto-creatable: low/medium risk within allowed scopes.',
    });
  }
  for (const c of humanRequired) {
    writeAuditEvent(args.stateDir, {
      mode,
      action: 'block-high-risk',
      title: c.title,
      conflictGroup: c.conflictGroup,
      risk: c.risk,
      humanRequired: true,
      issueUrl: null,
      reason: c.readinessNote || 'Policy gate: requires human approval.',
    });
  }
  for (const s of skipped) {
    writeAuditEvent(args.stateDir, {
      mode,
      action: 'skip-duplicate',
      title: s.title,
      conflictGroup: s.conflictGroup,
      risk: null,
      humanRequired: null,
      issueUrl: null,
      reason: s.reason,
    });
  }

  // Build combined candidate list for output (all proposed, with policy applied)
  const allProposed = [...autoCreatable, ...humanRequired];
  const output = buildOutput(allProposed, skipped, mode, args.max);

  // Execute mode: auto-create eligible issues
  if (args.execute) {
    if (!args.repo) {
      console.error('Error: --repo is required with --execute. Set GH_REPO or pass --repo OWNER/NAME.');
      process.exit(2);
    }
    const result = executeAutoCreate(args.repo, autoCreatable, humanRequired, args.max, args.stateDir);
    output.executionResult = result;
  }

  const json = JSON.stringify(output, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
  } else {
    const outDir = path.dirname(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    process.stdout.write(`Proposed issues written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  readFacts,
  generateAllCandidates,
  generateResourceSamplerFreshnessCandidates,
  generateProviderCapacityCandidates,
  generateTaskBoardCandidates,
  generateCommandStewardRecoveryCandidates,
  generateBoundedParallelRehearsalCandidates,
  generateActiveWorkerMonitoringCandidates,
  generateIssueCloseCandidateDetectionCandidates,
  generateLedgerIntegrationCandidates,
  generateFailureClassificationCandidates,
  generateSelfSeedingCandidates,
  deduplicate,
  applyPolicyGate,
  buildOutput,
  buildIssueBody,
  extractKeywords,
  titleOverlap,
  isFileScopeForbidden,
  extractConflictGroupFromIssueBody,
  makeCandidate,
  writeAuditEvent,
  fetchMergedPRs,
};
