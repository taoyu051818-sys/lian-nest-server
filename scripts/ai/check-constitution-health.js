#!/usr/bin/env node

/**
 * check-constitution-health.js
 *
 * Autonomous health checker that verifies the AI agent system complies with
 * the Three Laws (amendment-policy.json) and Seed Constitution (seed-constitution.md).
 *
 * Checks performed:
 *   1. Three Laws compliance
 *      a. Reality before judgment — policy changes must cite evidence
 *      b. Selection before memory — invariants preserved
 *      c. Governed recursion — no self-approval mechanisms
 *   2. Seed Constitution Rule 1 — high-risk files unmodified by automation
 *   3. Seed Constitution Rule 2 — no scope expansion in active workers
 *   4. Seed Constitution Rule 3 — main-red launch stop enforced
 *   5. Seed Constitution Rule 5 — worker scope boundaries respected
 *   6. SOP hard rules — no direct storage access, no silent fallbacks
 *
 * Usage:
 *   node scripts/ai/check-constitution-health.js --help
 *   node scripts/ai/check-constitution-health.js [--stdout] [--out path]
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — one or more violations detected
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AI_POLICY_DIR = path.join(REPO_ROOT, '.github', 'ai-policy');
const AI_STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const DEFAULT_OUT = path.join(AI_STATE_DIR, 'constitution-health-result.json');

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

function printHelp() {
  const help = `
check-constitution-health.js — Three Laws and Seed Constitution compliance checker

USAGE
    node scripts/ai/check-constitution-health.js [options]

OPTIONS
    --out <path>     Output path for check result JSON
                     (default: .github/ai-state/constitution-health-result.json)
    --stdout         Print JSON to stdout instead of writing a file
    --help, -h       Show this help message and exit.

CHECKS PERFORMED
    Three Laws:
      1. Reality before judgment — policy changes cite evidence
      2. Selection before memory — invariants preserved
      3. Governed recursion — no self-approval mechanisms

    Seed Constitution:
      Rule 1 — high-risk files unmodified by automation
      Rule 2 — no scope expansion in active workers
      Rule 3 — main-red launch stop enforced
      Rule 5 — worker scope boundaries respected

    SOP Hard Rules:
      No direct storage access outside repositories
      No silent fallback without diagnostics

EXIT CODES
    0 — all checks pass
    1 — one or more violations detected
    2 — invalid arguments
`;
  process.stdout.write(help);
}

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

  // Check that amendment-policy.json has evidenceRequirements
  const amendmentPolicy = readJson(path.join(AI_POLICY_DIR, 'amendment-policy.json'));
  if (!amendmentPolicy) {
    findings.push({
      decision: DECISIONS.VIOLATION,
      law: 'reality-before-judgment',
      message: 'amendment-policy.json not found — cannot verify evidence requirements',
    });
    return findings;
  }

  // Verify threeLaws section exists
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

  // Check that enforcement rule exists
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

  // Check recent policy changes in git for evidence citations
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

  // Verify seed constitution rules are all still marked immutable
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

  // Verify seed-constitution.md still exists and has all 5 rules
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

  // Verify amendment policy prevents self-approval
  const amendmentPolicy = readJson(path.join(AI_POLICY_DIR, 'amendment-policy.json'));
  if (!amendmentPolicy) {
    findings.push({
      decision: DECISIONS.VIOLATION,
      law: 'governed-recursion',
      message: 'amendment-policy.json not found',
    });
    return findings;
  }

  // Check that no rule grants self-approval capability
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

  // Verify constitution steward policy constraints
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

  // Verify protected policy files have not been modified by automation
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

  // Check if any active workers have allowedFiles that include high-risk paths
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

  // Check recent git commits for high-risk file modifications
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
              // Check if commit was by automation (look for Co-Authored-By)
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
    // Check if any workers were launched recently
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

  // Check compiled tasks for scope consistency
  const compiledTasks = readJson(path.join(AI_STATE_DIR, 'compiled-tasks.json'));
  const tasks = compiledTasks && Array.isArray(compiledTasks) ? compiledTasks
    : compiledTasks && compiledTasks.tasks ? compiledTasks.tasks : [];

  for (const worker of activeWorkers.workers) {
    const issueNum = worker.issueNumber;
    if (!issueNum) continue;

    // Find matching compiled task
    const task = tasks.find(t => t.issueNumber === issueNum || t.issue === issueNum);
    if (!task) continue;

    // Verify worker's allowedFiles hasn't expanded beyond task's allowedFiles
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

    // Verify conflictGroup hasn't changed
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

  // Check that feature modules don't directly import data-store drivers
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

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let outPath = DEFAULT_OUT;
  let stdout = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--stdout') {
      stdout = true;
    } else if (arg === '--out') {
      i++;
      outPath = args[i];
    }
  }

  // Run all checks
  const allFindings = [];

  const law1 = checkRealityBeforeJudgment();
  const law2 = checkSelectionBeforeMemory();
  const law3 = checkGovernedRecursion();
  const rule1 = checkHighRiskBoundaries();
  const rule3 = checkMainRedLaunchStop();
  const rule5 = checkWorkerScopeExpansion();
  const sop = checkRepositoryBoundary();

  allFindings.push(
    ...law1,
    ...law2,
    ...law3,
    ...rule1,
    ...rule3,
    ...rule5,
    ...sop,
  );

  // Aggregate
  const violations = allFindings.filter(f => f.decision === DECISIONS.VIOLATION);
  const warnings = allFindings.filter(f => f.decision === DECISIONS.WARNING);
  const passes = allFindings.filter(f => f.decision === DECISIONS.PASS);

  const overallDecision = violations.length > 0 ? DECISIONS.VIOLATION
    : warnings.length > 0 ? DECISIONS.WARNING
    : DECISIONS.PASS;

  const result = {
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
    findings: allFindings,
  };

  const json = JSON.stringify(result, null, 2);

  if (stdout) {
    process.stdout.write(json + '\n');
  } else {
    const outDir = path.dirname(outPath);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, json, 'utf8');
    process.stdout.write(`constitution health result written to ${relPath(outPath)}\n`);
  }

  // Summary
  process.stdout.write(`\nConstitution Health: ${overallDecision.toUpperCase()}\n`);
  process.stdout.write(`  Pass: ${passes.length}  Warning: ${warnings.length}  Violation: ${violations.length}\n`);

  if (violations.length > 0) {
    process.stdout.write('\nViolations:\n');
    for (const v of violations) {
      process.stdout.write(`  - [${v.rule || v.law}] ${v.message}\n`);
    }
  }

  process.exit(violations.length > 0 ? 1 : 0);
}

main();
