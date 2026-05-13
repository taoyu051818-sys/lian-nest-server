#!/usr/bin/env node

/**
 * constitution-checks.js
 *
 * Reusable library of constitution and runtime health check functions.
 * Extracted from check-constitution-health.js for use by the self-cycle
 * runner as an in-loop pre-flight phase (replacing the external cron approach).
 *
 * Usage:
 *   const checks = require('./lib/constitution-checks');
 *   const result = checks.runAllChecks();
 *   const runtime = checks.runRuntimeHealthChecks();
 *   const constitution = checks.runConstitutionChecks();
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const AI_POLICY_DIR = path.join(REPO_ROOT, '.github', 'ai-policy');
const AI_STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const SRC_DIR = path.join(REPO_ROOT, 'src');

const SCHEMA_VERSION = 1;
const CHECK_TYPE = 'constitution-health';

const DECISIONS = { PASS: 'pass', VIOLATION: 'violation', WARNING: 'warning' };

// High-risk files that automation must not modify (Constitution Rule 1)
const HIGH_RISK_PATHS = [
  '.env',
  '.env.*',
  'package.json',
  'package-lock.json',
  '.github/ai-policy/',
  '.github/ai-state/main-health.json',
  'prisma/schema.prisma',
];

// Protected policy files (Constitution Rule 1 + Governed Recursion)
const PROTECTED_POLICY_FILES = [
  'seed-constitution.md',
  'constitution-steward-policy.json',
  'amendment-policy.json',
];

// Legacy read-only paths (Constitution Rule 4)
const LEGACY_PATHS = [
  'src/legacy/',
  'backend/',
];

// Control-plane scripts that must not be modified by workers
const CONTROL_PLANE_SCRIPTS = [
  'scripts/ai/check-launch-gate.ps1',
  'scripts/ai/auto-trigger-health-gate.js',
  'scripts/ai/batch-launch.ps1',
  'scripts/ai/check-constitution-health.js',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readNdjson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const entries = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

function collectTsFiles(dir, results) {
  if (!fs.existsSync(dir)) return results || [];
  results = results || [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'generated') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(fullPath, results);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

function relPath(filePath) {
  return path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

function matchesGlob(filePath, globs) {
  const rel = relPath(filePath);
  return globs.some(glob => {
    const pattern = glob.replace(/\*\*/g, '___DOUBLESTAR___').replace(/\*/g, '[^/]*').replace(/___DOUBLESTAR___/g, '.*');
    return new RegExp(`^${pattern}$`).test(rel) || rel.startsWith(glob.replace(/\*/g, ''));
  });
}

// ── Check: Three Law 1 — Reality before judgment ─────────────────────────────

function checkRealityBeforeJudgment() {
  const findings = [];

  const amendmentPolicy = readJson(path.join(AI_POLICY_DIR, 'amendment-policy.json'));
  if (!amendmentPolicy) {
    findings.push({
      decision: DECISIONS.VIOLATION,
      law: 'reality-before-judgment',
      message: 'amendment-policy.json not found — cannot verify evidence requirements',
    });
    return findings;
  }

  if (!amendmentPolicy.threeLaws) {
    findings.push({
      decision: DECISIONS.VIOLATION,
      law: 'reality-before-judgment',
      message: 'amendment-policy.json missing threeLaws section',
    });
    return findings;
  }

  const reality = amendmentPolicy.threeLaws.reality;
  if (!reality) {
    findings.push({
      decision: DECISIONS.VIOLATION,
      law: 'reality-before-judgment',
      message: 'threeLaws missing "reality" entry',
    });
    return findings;
  }

  if (!reality.enforcement) {
    findings.push({
      decision: DECISIONS.VIOLATION,
      law: 'reality-before-judgment',
      message: 'reality-before-judgment has no enforcement defined',
    });
  } else {
    findings.push({
      decision: DECISIONS.PASS,
      law: 'reality-before-judgment',
      message: `enforcement defined: ${reality.enforcement.slice(0, 80)}...`,
    });
  }

  try {
    const { execSync } = require('child_process');
    const recentChanges = execSync(
      'git log --oneline --since="7 days ago" -- ".github/ai-policy/" 2>/dev/null',
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 10000 }
    ).trim();

    if (recentChanges) {
      const commits = recentChanges.split('\n').filter(Boolean);
      for (const commit of commits) {
        const hash = commit.split(' ')[0];
        try {
          const body = execSync(`git log -1 --format=%b ${hash}`, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim();
          if (!body || (!body.includes('#') && !body.includes('evidence') && !body.includes('issue') && !body.includes('incident'))) {
            findings.push({
              decision: DECISIONS.WARNING,
              law: 'reality-before-judgment',
              message: `Policy commit ${hash} may lack evidence citation in body`,
              commit: hash,
            });
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* git not available */ }

  return findings;
}

// ── Check: Three Law 2 — Selection before memory ─────────────────────────────

function checkSelectionBeforeMemory() {
  const findings = [];

  const stewardPolicy = readJson(path.join(AI_POLICY_DIR, 'constitution-steward-policy.json'));
  if (!stewardPolicy) {
    findings.push({
      decision: DECISIONS.VIOLATION,
      law: 'selection-before-memory',
      message: 'constitution-steward-policy.json not found',
    });
    return findings;
  }

  if (!stewardPolicy.protectedConstitutionalRules || !Array.isArray(stewardPolicy.protectedConstitutionalRules)) {
    findings.push({
      decision: DECISIONS.VIOLATION,
      law: 'selection-before-memory',
      message: 'constitution-steward-policy.json missing protectedConstitutionalRules',
    });
    return findings;
  }

  const nonImmutable = stewardPolicy.protectedConstitutionalRules.filter(r => r.immutable !== true);
  if (nonImmutable.length > 0) {
    findings.push({
      decision: DECISIONS.VIOLATION,
      law: 'selection-before-memory',
      message: `Found ${nonImmutable.length} constitutional rules NOT marked immutable: ${nonImmutable.map(r => r.ruleId || r.id).join(', ')}`,
    });
  } else {
    findings.push({
      decision: DECISIONS.PASS,
      law: 'selection-before-memory',
      message: `All ${stewardPolicy.protectedConstitutionalRules.length} constitutional rules marked immutable`,
    });
  }

  const constitutionPath = path.join(AI_POLICY_DIR, 'seed-constitution.md');
  if (!fs.existsSync(constitutionPath)) {
    findings.push({
      decision: DECISIONS.VIOLATION,
      law: 'selection-before-memory',
      message: 'seed-constitution.md not found — constitution may have been deleted',
    });
  } else {
    const content = fs.readFileSync(constitutionPath, 'utf8');
    const ruleCount = (content.match(/## \d+\./g) || []).length;
    if (ruleCount < 5) {
      findings.push({
        decision: DECISIONS.VIOLATION,
        law: 'selection-before-memory',
        message: `seed-constitution.md has only ${ruleCount} rules — expected 5`,
      });
    } else {
      findings.push({
        decision: DECISIONS.PASS,
        law: 'selection-before-memory',
        message: `seed-constitution.md contains all ${ruleCount} rules`,
      });
    }
  }

  return findings;
}

// ── Check: Three Law 3 — Governed recursion ──────────────────────────────────

function checkGovernedRecursion() {
  const findings = [];

  const amendmentPolicy = readJson(path.join(AI_POLICY_DIR, 'amendment-policy.json'));
  if (!amendmentPolicy) {
    findings.push({
      decision: DECISIONS.VIOLATION,
      law: 'governed-recursion',
      message: 'amendment-policy.json not found',
    });
    return findings;
  }

  if (amendmentPolicy.amendmentClasses) {
    for (const cls of amendmentPolicy.amendmentClasses) {
      if (cls.maySelfApprove === true) {
        findings.push({
          decision: DECISIONS.VIOLATION,
          law: 'governed-recursion',
          message: `Amendment class "${cls.id}" grants maySelfApprove=true — violates governed recursion`,
        });
      }
    }
  }

  const stewardPolicy = readJson(path.join(AI_POLICY_DIR, 'constitution-steward-policy.json'));
  if (stewardPolicy && stewardPolicy.agentConstraints) {
    const ac = stewardPolicy.agentConstraints;
    if (ac.maySelfApproveConstitutional !== false) {
      findings.push({
        decision: DECISIONS.VIOLATION,
        law: 'governed-recursion',
        message: 'agentConstraints.maySelfApproveConstitutional is not false',
      });
    }
    if (ac.maySelfApproveHighRisk !== false) {
      findings.push({
        decision: DECISIONS.VIOLATION,
        law: 'governed-recursion',
        message: 'agentConstraints.maySelfApproveHighRisk is not false',
      });
    }
    if (ac.mayModifyOwnAllowedFiles !== false) {
      findings.push({
        decision: DECISIONS.VIOLATION,
        law: 'governed-recursion',
        message: 'agentConstraints.mayModifyOwnAllowedFiles is not false',
      });
    }
    if (ac.mayExpandOwnScope !== false) {
      findings.push({
        decision: DECISIONS.VIOLATION,
        law: 'governed-recursion',
        message: 'agentConstraints.mayExpandOwnScope is not false',
      });
    }

    const allFalse = ac.maySelfApproveConstitutional === false
      && ac.maySelfApproveHighRisk === false
      && ac.mayModifyOwnAllowedFiles === false
      && ac.mayExpandOwnScope === false;

    if (allFalse) {
      findings.push({
        decision: DECISIONS.PASS,
        law: 'governed-recursion',
        message: 'All self-approval and self-expansion constraints correctly set to false',
      });
    }
  }

  for (const file of PROTECTED_POLICY_FILES) {
    const filePath = path.join(AI_POLICY_DIR, file);
    if (!fs.existsSync(filePath)) {
      findings.push({
        decision: DECISIONS.VIOLATION,
        law: 'governed-recursion',
        message: `Protected policy file missing: .github/ai-policy/${file}`,
      });
    }
  }

  return findings;
}

// ── Check: Constitution Rule 1 — High-risk boundaries ────────────────────────

function checkHighRiskBoundaries() {
  const findings = [];

  const activeWorkers = readJson(path.join(AI_STATE_DIR, 'active-workers.json'));
  if (activeWorkers && activeWorkers.workers) {
    for (const worker of activeWorkers.workers) {
      if (!worker.allowedFiles) continue;
      for (const allowed of worker.allowedFiles) {
        for (const highRisk of HIGH_RISK_PATHS) {
          if (allowed === highRisk || allowed.startsWith(highRisk.replace('*', ''))) {
            findings.push({
              decision: DECISIONS.WARNING,
              rule: 'rule-1-high-risk',
              message: `Worker ${worker.workerId || worker.issueNumber} has high-risk path in allowedFiles: ${allowed}`,
              worker: worker.workerId || worker.issueNumber,
            });
          }
        }
      }
    }
  }

  try {
    const { execSync } = require('child_process');
    const recentCommits = execSync(
      'git log --oneline --since="24 hours ago" --name-only 2>/dev/null',
      { cwd: REPO_ROOT, encoding: 'utf8', timeout: 10000 }
    ).trim();

    if (recentCommits) {
      const lines = recentCommits.split('\n');
      let currentHash = '';
      for (const line of lines) {
        if (/^[0-9a-f]{7,40}\s/.test(line)) {
          currentHash = line.split(' ')[0];
        } else if (line.trim()) {
          for (const highRisk of HIGH_RISK_PATHS) {
            const pattern = highRisk.replace('*', '');
            if (line.startsWith(pattern) || line === highRisk) {
              try {
                const body = execSync(`git log -1 --format=%b ${currentHash}`, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 }).trim();
                if (body.includes('Co-Authored-By') || body.includes('automation') || body.includes('worker')) {
                  findings.push({
                    decision: DECISIONS.VIOLATION,
                    rule: 'rule-1-high-risk',
                    message: `Automation commit ${currentHash} modified high-risk file: ${line}`,
                    commit: currentHash,
                    file: line,
                  });
                }
              } catch { /* ignore */ }
            }
          }
        }
      }
    }
  } catch { /* git not available */ }

  if (findings.length === 0) {
    findings.push({
      decision: DECISIONS.PASS,
      rule: 'rule-1-high-risk',
      message: 'No high-risk boundary violations detected',
    });
  }

  return findings;
}

// ── Check: Constitution Rule 3 — Main-red launch stop ────────────────────────

function checkMainRedLaunchStop() {
  const findings = [];

  const healthState = readJson(path.join(AI_STATE_DIR, 'main-health.json'));
  const mainHealth = healthState ? healthState.state || healthState.health : null;

  if (!mainHealth) {
    findings.push({
      decision: DECISIONS.WARNING,
      rule: 'rule-3-launch-stop',
      message: 'main-health.json not found or missing state — cannot verify launch stop',
    });
    return findings;
  }

  if (mainHealth === 'red' || mainHealth === 'black') {
    const activeWorkers = readJson(path.join(AI_STATE_DIR, 'active-workers.json'));
    if (activeWorkers && activeWorkers.workers && activeWorkers.workers.length > 0) {
      const nonRecovery = activeWorkers.workers.filter(w =>
        w.workerType !== 'foundation-fix' && w.workerType !== 'health-repair'
      );
      if (nonRecovery.length > 0) {
        findings.push({
          decision: DECISIONS.VIOLATION,
          rule: 'rule-3-launch-stop',
          message: `Main health is ${mainHealth} but ${nonRecovery.length} non-recovery workers are active`,
          workers: nonRecovery.map(w => w.workerId || w.issueNumber),
        });
      } else {
        findings.push({
          decision: DECISIONS.PASS,
          rule: 'rule-3-launch-stop',
          message: `Main health is ${mainHealth} — only recovery workers active (compliant)`,
        });
      }
    } else {
      findings.push({
        decision: DECISIONS.PASS,
        rule: 'rule-3-launch-stop',
        message: `Main health is ${mainHealth} — no workers active (compliant)`,
      });
    }
  } else {
    findings.push({
      decision: DECISIONS.PASS,
      rule: 'rule-3-launch-stop',
      message: `Main health is ${mainHealth} — launch stop not triggered`,
    });
  }

  return findings;
}

// ── Check: Constitution Rule 5 — No worker scope expansion ───────────────────

function checkWorkerScopeExpansion() {
  const findings = [];

  const activeWorkers = readJson(path.join(AI_STATE_DIR, 'active-workers.json'));
  if (!activeWorkers || !activeWorkers.workers || activeWorkers.workers.length === 0) {
    findings.push({
      decision: DECISIONS.PASS,
      rule: 'rule-5-scope-expansion',
      message: 'No active workers to check',
    });
    return findings;
  }

  const compiledTasks = readJson(path.join(AI_STATE_DIR, 'compiled-tasks.json'));
  const tasks = compiledTasks && Array.isArray(compiledTasks) ? compiledTasks
    : compiledTasks && compiledTasks.tasks ? compiledTasks.tasks : [];

  for (const worker of activeWorkers.workers) {
    const issueNum = worker.issueNumber;
    if (!issueNum) continue;

    const task = tasks.find(t => t.issueNumber === issueNum || t.issue === issueNum);
    if (!task) continue;

    if (worker.allowedFiles && task.allowedFiles) {
      const taskFiles = new Set(task.allowedFiles);
      const expanded = worker.allowedFiles.filter(f => !taskFiles.has(f));
      if (expanded.length > 0) {
        findings.push({
          decision: DECISIONS.VIOLATION,
          rule: 'rule-5-scope-expansion',
          message: `Worker for issue #${issueNum} has expanded scope beyond compiled task`,
          expandedFiles: expanded,
          worker: worker.workerId || issueNum,
        });
      }
    }

    if (worker.conflictGroup && task.conflictGroup && worker.conflictGroup !== task.conflictGroup) {
      findings.push({
        decision: DECISIONS.VIOLATION,
        rule: 'rule-5-scope-expansion',
        message: `Worker for issue #${issueNum} conflictGroup changed from "${task.conflictGroup}" to "${worker.conflictGroup}"`,
        worker: worker.workerId || issueNum,
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      decision: DECISIONS.PASS,
      rule: 'rule-5-scope-expansion',
      message: 'No scope expansion detected in active workers',
    });
  }

  return findings;
}

// ── Check: SOP — Repository boundary ─────────────────────────────────────────

function checkRepositoryBoundary() {
  const findings = [];

  const FORBIDDEN_PACKAGES = ['@prisma/client', 'ioredis', 'pg', 'mysql2', 'better-sqlite3'];
  const FEATURE_SLICES = ['auth', 'categories', 'feed', 'groups', 'messages', 'posts', 'profile', 'search', 'tags', 'topics', 'users'];
  const ALLOWED_INFRA = {
    'database': ['@prisma/client', 'prisma'],
    'redis': ['ioredis', 'redis'],
  };

  for (const slice of FEATURE_SLICES) {
    const sliceDir = path.join(SRC_DIR, slice);
    if (!fs.existsSync(sliceDir)) continue;

    const files = collectTsFiles(sliceDir, []);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const pkg of FORBIDDEN_PACKAGES) {
        const pattern = new RegExp(`(?:from\\s+|import\\s+|require\\s*\\()\\s*['"].*${pkg.replace('/', '\\/')}.*['"]`);
        if (pattern.test(content)) {
          findings.push({
            decision: DECISIONS.VIOLATION,
            rule: 'sop-repository-boundary',
            message: `Feature slice "${slice}" directly imports ${pkg}`,
            file: relPath(file),
          });
        }
      }
    }
  }

  if (findings.length === 0) {
    findings.push({
      decision: DECISIONS.PASS,
      rule: 'sop-repository-boundary',
      message: 'No repository boundary violations in feature slices',
    });
  }

  return findings;
}

// ── Runtime Health: State file staleness ─────────────────────────────────────

function checkStateFileStaleness() {
  const findings = [];
  const now = Date.now();

  const stateFiles = [
    { file: 'active-workers.json', maxAgeMs: 60 * 60 * 1000 },
    { file: 'local-resource.json', maxAgeMs: 10 * 60 * 1000 },
    { file: 'meta-signals.json', maxAgeMs: 30 * 60 * 1000 },
    { file: 'provider-pool.json', maxAgeMs: 60 * 60 * 1000 },
    { file: 'operational-entropy.json', maxAgeMs: 30 * 60 * 1000 },
    { file: 'risk-signals.json', maxAgeMs: 60 * 60 * 1000 },
  ];

  for (const { file, maxAgeMs } of stateFiles) {
    const filePath = path.join(AI_STATE_DIR, file);
    if (!fs.existsSync(filePath)) {
      findings.push({ decision: DECISIONS.WARNING, dimension: 'state-staleness', message: `State file missing: ${file}`, file });
      continue;
    }
    const stat = fs.statSync(filePath);
    const ageMs = now - stat.mtimeMs;
    if (ageMs > maxAgeMs) {
      findings.push({ decision: DECISIONS.WARNING, dimension: 'state-staleness', message: `${file} is stale: ${Math.round(ageMs / 60000)}m old (max ${Math.round(maxAgeMs / 60000)}m)`, file });
    }
  }

  if (findings.length === 0) findings.push({ decision: DECISIONS.PASS, dimension: 'state-staleness', message: 'All state files within TTL' });
  return findings;
}

// ── Runtime Health: Meta signals vitality ────────────────────────────────────

function checkMetaSignalsVitality() {
  const findings = [];
  const metaSignals = readJson(path.join(AI_STATE_DIR, 'meta-signals.json'));
  if (!metaSignals) {
    findings.push({ decision: DECISIONS.WARNING, dimension: 'meta-signals', message: 'meta-signals.json not found — system flying blind' });
    return findings;
  }

  const sig = metaSignals.signals || metaSignals;
  const allZero = (sig.failureScore || 0) === 0 && (sig.frictionScore || 0) === 0 && (sig.riskScore || 0) === 0 && (sig.trust || 0) === 0;

  if (allZero) {
    const events = readNdjson(path.join(AI_STATE_DIR, 'worker-telemetry-events.ndjson'));
    if (events.length > 0) {
      findings.push({ decision: DECISIONS.WARNING, dimension: 'meta-signals', message: `meta-signals all zeros but ${events.length} telemetry events exist — signals not computed, trust is synthetic` });
    } else {
      findings.push({ decision: DECISIONS.PASS, dimension: 'meta-signals', message: 'meta-signals all zeros — consistent with no activity' });
    }
  } else {
    const trust = sig.trust || 0;
    if (trust < 30) findings.push({ decision: DECISIONS.VIOLATION, dimension: 'meta-signals', message: `Trust critically low: ${trust}/100` });
    else if (trust < 60) findings.push({ decision: DECISIONS.WARNING, dimension: 'meta-signals', message: `Trust below threshold: ${trust}/100` });
    else findings.push({ decision: DECISIONS.PASS, dimension: 'meta-signals', message: `Trust healthy: ${trust}/100`, trust });

    if ((sig.failureScore || 0) >= 50) findings.push({ decision: DECISIONS.VIOLATION, dimension: 'meta-signals', message: `Failure score elevated: ${sig.failureScore}/100` });
    if ((sig.frictionScore || 0) >= 30) findings.push({ decision: DECISIONS.WARNING, dimension: 'meta-signals', message: `Friction elevated: ${sig.frictionScore}/100` });
  }
  return findings;
}

// ── Runtime Health: Build vitality ───────────────────────────────────────────

function checkBuildVitality() {
  const findings = [];
  try {
    const { execSync } = require('child_process');
    try {
      execSync('npm run check', { cwd: REPO_ROOT, encoding: 'utf8', timeout: 90000, stdio: 'pipe' });
      findings.push({ decision: DECISIONS.PASS, dimension: 'build-health', message: 'TypeScript compilation passes' });
    } catch (e) {
      const stderr = e.stderr || e.stdout || '';
      const tsErrors = (stderr.match(/error TS/g) || []).length;
      if (tsErrors === 0 && stderr.includes('tsc')) {
        findings.push({ decision: DECISIONS.WARNING, dimension: 'build-health', message: 'TypeScript check exited non-zero but no TS errors found' });
      } else {
        findings.push({ decision: DECISIONS.VIOLATION, dimension: 'build-health', message: `TypeScript FAILED: ${tsErrors} errors`, detail: stderr.slice(0, 300) });
      }
    }
  } catch {
    findings.push({ decision: DECISIONS.WARNING, dimension: 'build-health', message: 'Could not run build check' });
  }
  return findings;
}

// ── Runtime Health: Worker lifecycle ─────────────────────────────────────────

function checkWorkerLifecycleHealth() {
  const findings = [];
  const events = readNdjson(path.join(AI_STATE_DIR, 'worker-telemetry-events.ndjson'));
  if (events.length === 0) {
    findings.push({ decision: DECISIONS.PASS, dimension: 'worker-lifecycle', message: 'No telemetry events — system idle' });
    return findings;
  }

  const starts = events.filter(e => (e.eventType || e.type) === 'start');
  const completes = events.filter(e => (e.eventType || e.type) === 'complete');

  const startMap = new Map();
  for (const s of starts) { const k = s.issueNumber || s.workerId || s.taskId; if (k) startMap.set(k, s); }
  const completeSet = new Set(completes.map(c => c.issueNumber || c.workerId || c.taskId).filter(Boolean));

  const orphaned = [];
  for (const [key, start] of startMap) {
    if (!completeSet.has(key)) {
      const ageMs = Date.now() - new Date(start.capturedAt || start.timestamp).getTime();
      if (ageMs > 30 * 60 * 1000) orphaned.push({ key, ageMinutes: Math.round(ageMs / 60000) });
    }
  }

  if (orphaned.length > 0) {
    findings.push({ decision: DECISIONS.WARNING, dimension: 'worker-lifecycle', message: `${orphaned.length} workers started but never completed (stale >30m)`, orphaned });
  } else {
    findings.push({ decision: DECISIONS.PASS, dimension: 'worker-lifecycle', message: `${starts.length} starts, ${completes.length} completions — no orphans` });
  }

  const longWorkers = events.filter(e => { const el = e.elapsedMs || e.elapsed; return el && el > 600000; });
  if (longWorkers.length > 0) {
    findings.push({ decision: DECISIONS.WARNING, dimension: 'worker-lifecycle', message: `${longWorkers.length} workers exceeded 10min runtime` });
  }
  return findings;
}

// ── Runtime Health: Conflict contention ──────────────────────────────────────

function checkConflictGroupContention() {
  const findings = [];
  const activeWorkers = readJson(path.join(AI_STATE_DIR, 'active-workers.json'));
  if (!activeWorkers || !activeWorkers.workers || activeWorkers.workers.length <= 1) {
    findings.push({ decision: DECISIONS.PASS, dimension: 'conflict-contention', message: 'No contention possible (0-1 workers)' });
    return findings;
  }

  const groups = new Map();
  for (const w of activeWorkers.workers) { const cg = w.conflictGroup || 'ungrouped'; if (!groups.has(cg)) groups.set(cg, []); groups.get(cg).push(w); }

  for (const [group, workers] of groups) {
    if (group === 'ungrouped' || workers.length <= 1) continue;
    findings.push({ decision: DECISIONS.WARNING, dimension: 'conflict-contention', message: `Conflict group "${group}" has ${workers.length} concurrent workers`, group });
  }

  if (findings.length === 0) findings.push({ decision: DECISIONS.PASS, dimension: 'conflict-contention', message: 'No contention detected' });
  return findings;
}

// ── Runtime Health: PR queue ─────────────────────────────────────────────────

function checkPRQueueHealth() {
  const findings = [];
  try {
    const { execSync } = require('child_process');
    const prs = JSON.parse(execSync('gh pr list --state open --json number,title,createdAt --limit 20', { cwd: REPO_ROOT, encoding: 'utf8', timeout: 15000 }));
    if (prs.length === 0) {
      findings.push({ decision: DECISIONS.PASS, dimension: 'pr-queue', message: 'No open PRs' });
    } else {
      const now = Date.now();
      const stale = prs.filter(pr => now - new Date(pr.createdAt).getTime() > 7 * 86400000);
      if (stale.length > 0) findings.push({ decision: DECISIONS.WARNING, dimension: 'pr-queue', message: `${stale.length} PRs open >7 days` });
      else findings.push({ decision: DECISIONS.PASS, dimension: 'pr-queue', message: `${prs.length} open PRs, none stale` });
    }
  } catch {
    findings.push({ decision: DECISIONS.WARNING, dimension: 'pr-queue', message: 'Could not check PR queue' });
  }
  return findings;
}

// ── Runtime Health: Autonomous loop ──────────────────────────────────────────

function checkAutonomousLoopHealth() {
  const findings = [];
  const events = readNdjson(path.join(AI_STATE_DIR, 'autonomous-loop-events.ndjson'));
  if (events.length === 0) {
    findings.push({ decision: DECISIONS.WARNING, dimension: 'autonomous-loop', message: 'No loop events — loop may never have run' });
    return findings;
  }

  const last = events[events.length - 1];
  const ageHours = (Date.now() - new Date(last.capturedAt || last.timestamp).getTime()) / 3600000;
  const cycles = events.filter(e => (e.eventType || e.type) === 'cycle-complete');
  const idle = cycles.filter(e => (e.workersLaunched || 0) === 0);

  if (ageHours > 24) {
    findings.push({ decision: DECISIONS.WARNING, dimension: 'autonomous-loop', message: `Last loop event ${Math.round(ageHours)}h ago — may be stalled` });
  } else {
    findings.push({ decision: DECISIONS.PASS, dimension: 'autonomous-loop', message: `${events.length} events, ${cycles.length} cycles (${idle.length} idle), last ${Math.round(ageHours)}h ago` });
  }
  return findings;
}

// ── Runtime Health: Resource pressure ────────────────────────────────────────

function checkResourcePressure() {
  const findings = [];
  const lr = readJson(path.join(AI_STATE_DIR, 'local-resource.json'));
  if (!lr) {
    findings.push({ decision: DECISIONS.WARNING, dimension: 'resource-pressure', message: 'local-resource.json not found' });
    return findings;
  }

  if (lr.memory && lr.memory.usagePercent > 90) findings.push({ decision: DECISIONS.VIOLATION, dimension: 'resource-pressure', message: `Memory critical: ${lr.memory.usagePercent}%` });
  else if (lr.memory && lr.memory.usagePercent > 75) findings.push({ decision: DECISIONS.WARNING, dimension: 'resource-pressure', message: `Memory elevated: ${lr.memory.usagePercent}%` });

  if (lr.process && lr.process.headroomPercent !== null && lr.process.headroomPercent < 20) {
    findings.push({ decision: DECISIONS.WARNING, dimension: 'resource-pressure', message: `Process headroom low: ${lr.process.headroomPercent}%` });
  }

  const pp = readJson(path.join(AI_STATE_DIR, 'provider-pool.json'));
  if (pp && pp.providers) {
    for (const p of pp.providers) {
      const util = p.maxConcurrency > 0 ? Math.round(((p.activeWorkers || 0) / p.maxConcurrency) * 100) : 0;
      if (util > 80) findings.push({ decision: DECISIONS.WARNING, dimension: 'resource-pressure', message: `Provider "${p.id}" at ${util}% capacity` });
    }
  }

  if (findings.length === 0) findings.push({ decision: DECISIONS.PASS, dimension: 'resource-pressure', message: 'Resources healthy' });
  return findings;
}

// ── Aggregate runners ────────────────────────────────────────────────────────

/**
 * Run all constitution (static compliance) checks.
 * Returns { findings, violations, warnings, passes, overallDecision }
 */
function runConstitutionChecks() {
  const law1 = checkRealityBeforeJudgment();
  const law2 = checkSelectionBeforeMemory();
  const law3 = checkGovernedRecursion();
  const rule1 = checkHighRiskBoundaries();
  const rule3 = checkMainRedLaunchStop();
  const rule5 = checkWorkerScopeExpansion();
  const sop = checkRepositoryBoundary();

  const findings = [...law1, ...law2, ...law3, ...rule1, ...rule3, ...rule5, ...sop];
  return summarizeFindings(findings);
}

/**
 * Run all runtime health checks.
 * Returns { findings, violations, warnings, passes, overallDecision }
 */
function runRuntimeHealthChecks() {
  const rtStaleness = checkStateFileStaleness();
  const rtMeta = checkMetaSignalsVitality();
  const rtBuild = checkBuildVitality();
  const rtWorker = checkWorkerLifecycleHealth();
  const rtConflict = checkConflictGroupContention();
  const rtPR = checkPRQueueHealth();
  const rtLoop = checkAutonomousLoopHealth();
  const rtResource = checkResourcePressure();

  const findings = [...rtStaleness, ...rtMeta, ...rtBuild, ...rtWorker, ...rtConflict, ...rtPR, ...rtLoop, ...rtResource];
  return summarizeFindings(findings);
}

/**
 * Run all checks (constitution + runtime).
 * Returns the full result object matching the check-constitution-health.js output schema.
 */
function runAllChecks() {
  const law1 = checkRealityBeforeJudgment();
  const law2 = checkSelectionBeforeMemory();
  const law3 = checkGovernedRecursion();
  const rule1 = checkHighRiskBoundaries();
  const rule3 = checkMainRedLaunchStop();
  const rule5 = checkWorkerScopeExpansion();
  const sop = checkRepositoryBoundary();

  const rtStaleness = checkStateFileStaleness();
  const rtMeta = checkMetaSignalsVitality();
  const rtBuild = checkBuildVitality();
  const rtWorker = checkWorkerLifecycleHealth();
  const rtConflict = checkConflictGroupContention();
  const rtPR = checkPRQueueHealth();
  const rtLoop = checkAutonomousLoopHealth();
  const rtResource = checkResourcePressure();

  const allFindings = [
    ...law1, ...law2, ...law3, ...rule1, ...rule3, ...rule5, ...sop,
    ...rtStaleness, ...rtMeta, ...rtBuild, ...rtWorker, ...rtConflict, ...rtPR, ...rtLoop, ...rtResource,
  ];

  const violations = allFindings.filter(f => f.decision === DECISIONS.VIOLATION);
  const warnings = allFindings.filter(f => f.decision === DECISIONS.WARNING);
  const passes = allFindings.filter(f => f.decision === DECISIONS.PASS);

  const overallDecision = violations.length > 0 ? DECISIONS.VIOLATION
    : warnings.length > 0 ? DECISIONS.WARNING
    : DECISIONS.PASS;

  return {
    schemaVersion: SCHEMA_VERSION,
    checkType: CHECK_TYPE,
    capturedAt: new Date().toISOString(),
    overallDecision,
    summary: {
      total: allFindings.length,
      pass: passes.length,
      warning: warnings.length,
      violation: violations.length,
    },
    threeLaws: {
      realityBeforeJudgment: {
        decision: law1.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: law1,
      },
      selectionBeforeMemory: {
        decision: law2.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: law2,
      },
      governedRecursion: {
        decision: law3.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: law3,
      },
    },
    seedConstitution: {
      rule1HighRiskBoundaries: {
        decision: rule1.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: rule1,
      },
      rule3MainRedLaunchStop: {
        decision: rule3.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: rule3,
      },
      rule5NoScopeExpansion: {
        decision: rule5.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: rule5,
      },
    },
    sop: {
      repositoryBoundary: {
        decision: sop.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS,
        findings: sop,
      },
    },
    runtimeHealth: {
      stateStaleness: { decision: rtStaleness.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : rtStaleness.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtStaleness },
      metaSignals: { decision: rtMeta.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : rtMeta.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtMeta },
      buildHealth: { decision: rtBuild.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : DECISIONS.PASS, findings: rtBuild },
      workerLifecycle: { decision: rtWorker.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : rtWorker.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtWorker },
      conflictContention: { decision: rtConflict.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtConflict },
      prQueue: { decision: rtPR.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtPR },
      autonomousLoop: { decision: rtLoop.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtLoop },
      resourcePressure: { decision: rtResource.some(f => f.decision === DECISIONS.VIOLATION) ? DECISIONS.VIOLATION : rtResource.some(f => f.decision === DECISIONS.WARNING) ? DECISIONS.WARNING : DECISIONS.PASS, findings: rtResource },
    },
    findings: allFindings,
  };
}

function summarizeFindings(findings) {
  const violations = findings.filter(f => f.decision === DECISIONS.VIOLATION);
  const warnings = findings.filter(f => f.decision === DECISIONS.WARNING);
  const passes = findings.filter(f => f.decision === DECISIONS.PASS);
  const overallDecision = violations.length > 0 ? DECISIONS.VIOLATION
    : warnings.length > 0 ? DECISIONS.WARNING
    : DECISIONS.PASS;
  return { findings, violations, warnings, passes, overallDecision };
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Constants
  DECISIONS,
  HIGH_RISK_PATHS,
  PROTECTED_POLICY_FILES,
  LEGACY_PATHS,
  CONTROL_PLANE_SCRIPTS,
  REPO_ROOT,
  AI_POLICY_DIR,
  AI_STATE_DIR,

  // Helpers
  readJson,
  readNdjson,
  collectTsFiles,
  relPath,
  matchesGlob,

  // Individual checks
  checkRealityBeforeJudgment,
  checkSelectionBeforeMemory,
  checkGovernedRecursion,
  checkHighRiskBoundaries,
  checkMainRedLaunchStop,
  checkWorkerScopeExpansion,
  checkRepositoryBoundary,
  checkStateFileStaleness,
  checkMetaSignalsVitality,
  checkBuildVitality,
  checkWorkerLifecycleHealth,
  checkConflictGroupContention,
  checkPRQueueHealth,
  checkAutonomousLoopHealth,
  checkResourcePressure,

  // Aggregate runners
  runConstitutionChecks,
  runRuntimeHealthChecks,
  runAllChecks,
  summarizeFindings,
};
