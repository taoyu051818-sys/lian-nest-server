#!/usr/bin/env node

/**
 * compile-autonomy-handoff-followups.js
 *
 * Reads the Codex retirement runbook, control skill registry, guarded
 * autopilot policy, and command steward agent docs to compile missing
 * autonomy capabilities into bounded follow-up task proposals.
 *
 * This is a dry-run / preview-only tool. It NEVER creates GitHub issues,
 * launches workers, or mutates any external state. Output is
 * machine-readable JSON for the planning console or Command Steward
 * consumption.
 *
 * Gap sources:
 *   codex-retirement-runbook.md   — exit criteria (PARTIAL/OPEN items)
 *   codex-retirement-runbook.md   — retirement checklist (unchecked items)
 *   control-skill-registry.md     — missing skill registrations
 *   guarded-autopilot-execute-policy.md — unmet preconditions
 *   command-steward-agent.md      — workflow autonomy gaps
 *
 * Usage:
 *   node scripts/ai/compile-autonomy-handoff-followups.js --help
 *   node scripts/ai/compile-autonomy-handoff-followups.js
 *   node scripts/ai/compile-autonomy-handoff-followups.js --stdout
 *   node scripts/ai/compile-autonomy-handoff-followups.js --out path/to/file.json
 *   node scripts/ai/compile-autonomy-handoff-followups.js --self-test
 *
 * Exit codes:
 *   0 — proposals produced
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'autonomy-handoff-followups.json');

const SCHEMA_VERSION = 1;

const PRIORITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

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
compile-autonomy-handoff-followups.js — Autonomy handoff follow-up compiler (v1)

USAGE
    node scripts/ai/compile-autonomy-handoff-followups.js [options]

OPTIONS
    --out <path>    Output path for the proposals JSON.
                    (default: .github/ai-state/autonomy-handoff-followups.json)
    --stdout        Print JSON to stdout instead of writing a file.
                    Overrides --out.
    --self-test     Run built-in assertions and exit.
    --help          Show this help message and exit.

DRY-RUN SAFETY
    This script NEVER creates GitHub issues, launches workers, or
    mutates any external state. All output is preview-only for
    planning console or Command Steward consumption.

GAP SOURCES
    docs/ai-native/codex-retirement-runbook.md
    docs/ai-native/control-skill-registry.md
    docs/ai-native/guarded-autopilot-execute-policy.md
    docs/ai-native/command-steward-agent.md

EXIT CODES
    0   Proposals produced
    2   Invalid arguments
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    out: DEFAULT_OUT,
    stdout: false,
    help: false,
    selfTest: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--out') {
      i++;
      if (i >= argv.length) { console.error('Error: --out requires a path'); process.exit(2); }
      args.out = argv[i];
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

// ── Exit criteria gap collectors ─────────────────────────────────────────────

function collectExitCriteriaGaps() {
  const proposals = [];

  // Criterion 3: Health gate auto-trigger after merge — PARTIAL
  proposals.push({
    id: 'exit-3-health-gate-auto-trigger',
    category: 'exit-criteria',
    criterionNumber: 3,
    title: 'Wire health gate auto-trigger after merge to main',
    description:
      'post-merge-health-gate.js and write-main-health-state.ps1 exist but ' +
      'require manual invocation. CI wiring (GitHub Actions or equivalent) ' +
      'is needed to run the health gate and write the marker after every ' +
      'merge to main without human initiation.',
    status: 'partial',
    priority: 'high',
    confidence: 90,
    risk: 'low',
    workerClass: 'docs',
    allowedFiles: [
      '.github/workflows/',
      'scripts/ai/write-main-health-state.ps1',
      'scripts/post-merge-health-gate.js',
      'docs/ai-native/codex-retirement-runbook.md',
    ],
    evidence: {
      source: 'codex-retirement-runbook.md',
      criterion: 'Post-merge health gate auto-triggers',
      currentStatus: 'PARTIAL',
      blockingImpact: 'Self-cycle runner Step 2 (health check) fails if no marker file exists',
    },
    actionHint:
      'Create a GitHub Actions workflow that triggers on push to main, ' +
      'runs post-merge-health-gate.js, and writes the health state marker.',
  });

  // Criterion 4: Recovery workers auto-dispatch on red — PARTIAL
  proposals.push({
    id: 'exit-4-recovery-auto-dispatch',
    category: 'exit-criteria',
    criterionNumber: 4,
    title: 'Wire recovery worker auto-dispatch on red health state',
    description:
      'main-health-policy.md defines which worker types are permitted in ' +
      'each health state and describes the recovery worker flow. However, ' +
      'no script or CI trigger automatically dispatches a foundation-fix or ' +
      'health-repair worker when health drops to red.',
    status: 'partial',
    priority: 'high',
    confidence: 85,
    risk: 'low',
    workerClass: 'docs',
    allowedFiles: [
      'scripts/ai/run-self-cycle.ps1',
      'scripts/ai/check-launch-gate.ps1',
      'docs/ai-native/main-health-policy.md',
      'docs/ai-native/codex-retirement-runbook.md',
    ],
    evidence: {
      source: 'codex-retirement-runbook.md',
      criterion: 'Recovery workers auto-dispatch on red',
      currentStatus: 'PARTIAL',
      blockingImpact: 'Operator must manually create fix issue and launch recovery worker when health is red',
    },
    actionHint:
      'Add a red-state detection step to the self-cycle runner or create ' +
      'a CI trigger that detects red health and launches a foundation-fix ' +
      'worker without human initiation.',
  });

  // Criterion 7: Legacy lian-platform-server retirement — OPEN
  proposals.push({
    id: 'exit-7-legacy-migration',
    category: 'exit-criteria',
    criterionNumber: 7,
    title: 'Complete legacy lian-platform-server orchestration retirement',
    description:
      'The migration checklist tracks legacy component retirement. None ' +
      'are at RETIRED yet. Each legacy component (launcher, monitor, ' +
      'publisher, merge helper, health gate) must reach PARITY and then ' +
      'RETIRED before Codex orchestration can be formally retired.',
    status: 'open',
    priority: 'medium',
    confidence: 75,
    risk: 'medium',
    workerClass: 'runtime-feature',
    allowedFiles: [
      'docs/migration/lian-platform-server-orchestration-retirement.md',
      'docs/ai-native/codex-retirement-runbook.md',
    ],
    evidence: {
      source: 'codex-retirement-runbook.md',
      criterion: 'Legacy lian-platform-server orchestration is RETIRED',
      currentStatus: 'OPEN',
      blockingImpact: 'Codex orchestration cannot be formally retired until all legacy components are RETIRED',
    },
    actionHint:
      'Review the migration checklist, prioritize components for PARITY ' +
      'migration, and track progress toward RETIRED status.',
  });

  return proposals;
}

// ── Retirement checklist gap collectors ──────────────────────────────────────

function collectChecklistGaps() {
  const proposals = [];

  // Fallback procedure tested at least once
  proposals.push({
    id: 'checklist-fallback-test',
    category: 'retirement-checklist',
    checklistSection: 'human-process',
    title: 'Test the safe fallback procedure at least once',
    description:
      'The safe fallback procedure is documented in the codex retirement ' +
      'runbook but has never been tested. A dry-run validation of the ' +
      'fallback steps (stop runner, assess partial progress, preserve WIP, ' +
      'diagnose, resume with manual orchestration) is needed to confirm ' +
      'the procedure works under real failure conditions.',
    status: 'unchecked',
    priority: 'medium',
    confidence: 80,
    risk: 'low',
    workerClass: 'docs',
    allowedFiles: [
      'docs/ai-native/codex-retirement-runbook.md',
      'docs/ai-native/SOP.md',
    ],
    evidence: {
      source: 'codex-retirement-runbook.md',
      section: 'Human Process',
      item: 'Fallback procedure tested at least once',
    },
    actionHint:
      'Simulate a self-cycle runner failure in a controlled environment, ' +
      'follow the fallback steps, and record the result in the Fallback Log.',
  });

  // Launcher migration to PARITY
  proposals.push({
    id: 'checklist-launcher-parity',
    category: 'retirement-checklist',
    checklistSection: 'legacy-retirement',
    title: 'Migrate launcher to PARITY',
    description:
      'The legacy launcher component must reach PARITY before it can be ' +
      'RETIRED. This involves verifying that the self-cycle runner ' +
      'provides equivalent launch functionality without the legacy module.',
    status: 'unchecked',
    priority: 'medium',
    confidence: 70,
    risk: 'medium',
    workerClass: 'runtime-feature',
    allowedFiles: [
      'docs/migration/lian-platform-server-orchestration-retirement.md',
      'scripts/ai/run-self-cycle.ps1',
    ],
    evidence: {
      source: 'codex-retirement-runbook.md',
      section: 'Legacy Retirement',
      item: 'Launcher migrated and at PARITY',
    },
    actionHint:
      'Compare legacy launcher capabilities against the self-cycle runner ' +
      'dispatch functionality. Document any gaps and create issues for ' +
      'closing them.',
  });

  // Monitor migration to PARITY
  proposals.push({
    id: 'checklist-monitor-parity',
    category: 'retirement-checklist',
    checklistSection: 'legacy-retirement',
    title: 'Migrate monitor to PARITY',
    description:
      'The legacy monitor component must reach PARITY. The self-cycle ' +
      'runner and state reconciler should provide equivalent monitoring ' +
      'capabilities (worker heartbeat, stale detection, drift alerting).',
    status: 'unchecked',
    priority: 'medium',
    confidence: 70,
    risk: 'medium',
    workerClass: 'runtime-feature',
    allowedFiles: [
      'docs/migration/lian-platform-server-orchestration-retirement.md',
      'scripts/ai/state-reconciler.ps1',
    ],
    evidence: {
      source: 'codex-retirement-runbook.md',
      section: 'Legacy Retirement',
      item: 'Monitor migrated and at PARITY',
    },
    actionHint:
      'Compare legacy monitor capabilities against state-reconciler.ps1 ' +
      'and worktree-janitor.ps1. Document any gaps.',
  });

  // Publisher migration to PARITY
  proposals.push({
    id: 'checklist-publisher-parity',
    category: 'retirement-checklist',
    checklistSection: 'legacy-retirement',
    title: 'Migrate publisher to PARITY',
    description:
      'The legacy publisher component must reach PARITY. The ' +
      'publish-agent-result.ps1 script should provide equivalent result ' +
      'publishing capabilities (structured comments to issues/PRs).',
    status: 'unchecked',
    priority: 'medium',
    confidence: 70,
    risk: 'medium',
    workerClass: 'runtime-feature',
    allowedFiles: [
      'docs/migration/lian-platform-server-orchestration-retirement.md',
      'scripts/ai/publish-agent-result.ps1',
    ],
    evidence: {
      source: 'codex-retirement-runbook.md',
      section: 'Legacy Retirement',
      item: 'Publisher migrated and at PARITY',
    },
    actionHint:
      'Compare legacy publisher capabilities against ' +
      'publish-agent-result.ps1. Document any gaps.',
  });

  // Merge helper migration to PARITY
  proposals.push({
    id: 'checklist-merge-helper-parity',
    category: 'retirement-checklist',
    checklistSection: 'legacy-retirement',
    title: 'Migrate merge helper to PARITY',
    description:
      'The legacy merge helper component must reach PARITY. The ' +
      'merge-clean-pr-batch.ps1 and merge-queue-assistant.js scripts ' +
      'should provide equivalent merge orchestration capabilities.',
    status: 'unchecked',
    priority: 'medium',
    confidence: 70,
    risk: 'medium',
    workerClass: 'runtime-feature',
    allowedFiles: [
      'docs/migration/lian-platform-server-orchestration-retirement.md',
      'scripts/ai/merge-clean-pr-batch.ps1',
      'scripts/ai/merge-queue-assistant.js',
    ],
    evidence: {
      source: 'codex-retirement-runbook.md',
      section: 'Legacy Retirement',
      item: 'Merge helper migrated and at PARITY',
    },
    actionHint:
      'Compare legacy merge helper capabilities against ' +
      'merge-clean-pr-batch.ps1 and merge-queue-assistant.js. ' +
      'Document any gaps.',
  });

  // Health gate migration to PARITY
  proposals.push({
    id: 'checklist-health-gate-parity',
    category: 'retirement-checklist',
    checklistSection: 'legacy-retirement',
    title: 'Migrate health gate to PARITY',
    description:
      'The legacy health gate component must reach PARITY. The ' +
      'post-merge-health-gate.js and write-main-health-state.ps1 scripts ' +
      'should provide equivalent health checking capabilities.',
    status: 'unchecked',
    priority: 'medium',
    confidence: 70,
    risk: 'medium',
    workerClass: 'runtime-feature',
    allowedFiles: [
      'docs/migration/lian-platform-server-orchestration-retirement.md',
      'scripts/post-merge-health-gate.js',
      'scripts/ai/write-main-health-state.ps1',
    ],
    evidence: {
      source: 'codex-retirement-runbook.md',
      section: 'Legacy Retirement',
      item: 'Health gate migrated and at PARITY',
    },
    actionHint:
      'Compare legacy health gate capabilities against ' +
      'post-merge-health-gate.js. Document any gaps.',
  });

  return proposals;
}

// ── Control skill registry gap collectors ────────────────────────────────────

function collectSkillRegistryGaps() {
  const proposals = [];

  // Recovery dispatch skill missing from registry
  proposals.push({
    id: 'skill-recovery-dispatch',
    category: 'skill-registry',
    title: 'Register recovery-dispatch control skill',
    description:
      'The control skill registry does not include a recovery-dispatch ' +
      'skill. When health drops to red, the command steward has no ' +
      'registered skill to propose launching a foundation-fix worker. ' +
      'A recovery-dispatch skill with preview/execute phases and ' +
      'medium risk classification would close this gap.',
    status: 'missing',
    priority: 'high',
    confidence: 85,
    risk: 'low',
    workerClass: 'docs',
    allowedFiles: [
      'docs/ai-native/control-skill-registry.md',
      'tools/provider-pool-webui/actions/',
    ],
    evidence: {
      source: 'control-skill-registry.md',
      registeredSkills: [
        'merge-prs', 'launch-batch', 'issue-state',
        'refresh-health', 'status-bundle', 'self-cycle',
      ],
      missingCapability: 'recovery-dispatch',
    },
    actionHint:
      'Create a recovery-dispatch action module with preview/execute ' +
      'phases, medium risk, and human-required confirmation. Register ' +
      'it in the control skill registry.',
  });

  // Health auto-trigger skill missing from registry
  proposals.push({
    id: 'skill-health-auto-trigger',
    category: 'skill-registry',
    title: 'Register health-auto-trigger control skill',
    description:
      'The control skill registry does not include a skill for ' +
      'automatically triggering the health gate after merges. A ' +
      'low-risk, preview-only skill that surfaces the current health ' +
      'gate trigger status would help the steward monitor whether ' +
      'auto-trigger CI wiring is operational.',
    status: 'missing',
    priority: 'medium',
    confidence: 75,
    risk: 'low',
    workerClass: 'docs',
    allowedFiles: [
      'docs/ai-native/control-skill-registry.md',
      'tools/provider-pool-webui/actions/',
    ],
    evidence: {
      source: 'control-skill-registry.md',
      registeredSkills: [
        'merge-prs', 'launch-batch', 'issue-state',
        'refresh-health', 'status-bundle', 'self-cycle',
      ],
      missingCapability: 'health-auto-trigger-status',
    },
    actionHint:
      'Create a health-auto-trigger action module that reports whether ' +
      'the post-merge CI workflow is active and last trigger time.',
  });

  return proposals;
}

// ── Guarded autopilot gap collectors ─────────────────────────────────────────

function collectGuardedAutopilotGaps() {
  const proposals = [];

  // Guarded execute not wired to CI trigger
  proposals.push({
    id: 'autopilot-guarded-execute-ci',
    category: 'guarded-autopilot',
    title: 'Wire guarded autopilot execute to a CI or cron trigger',
    description:
      'The guarded autopilot execute policy defines preconditions for ' +
      'auto-executing low-risk tasks, but there is no CI workflow or ' +
      'cron trigger that periodically evaluates preconditions and ' +
      'launches a guarded batch. The policy is defined but not activated.',
    status: 'not-wired',
    priority: 'medium',
    confidence: 70,
    risk: 'medium',
    workerClass: 'docs',
    allowedFiles: [
      '.github/workflows/',
      'scripts/ai/run-self-cycle.ps1',
      'docs/ai-native/guarded-autopilot-execute-policy.md',
    ],
    evidence: {
      source: 'guarded-autopilot-execute-policy.md',
      preconditions: [
        'green health', 'launch gate pass', 'low-risk tasks',
        'explicit allowlists', 'no high-risk files', 'batch size limit',
        'no forbidden files', 'preview pass first',
      ],
      currentWiring: 'none — requires manual invocation with -Execute -Guarded flags',
    },
    actionHint:
      'Create a GitHub Actions scheduled workflow or cron trigger that ' +
      'runs run-self-cycle.ps1 -Execute -Guarded with appropriate ' +
      'safety limits.',
  });

  return proposals;
}

// ── Steward workflow gap collectors ──────────────────────────────────────────

function collectStewardWorkflowGaps() {
  const proposals = [];

  // Steward merge workflow needs auto-health-gate step
  proposals.push({
    id: 'steward-merge-health-integration',
    category: 'steward-workflow',
    title: 'Integrate automatic health gate into steward merge workflow',
    description:
      'The Command Steward Agent merge workflow includes a post-merge ' +
      'health gate step, but this step currently requires manual ' +
      'invocation. Until exit criterion 3 (health gate auto-trigger) ' +
      'is met, the steward must explicitly run the health gate after ' +
      'each merge batch, adding operator toil.',
    status: 'blocked-by-exit-3',
    priority: 'medium',
    confidence: 80,
    risk: 'low',
    workerClass: 'docs',
    allowedFiles: [
      'docs/ai-native/command-steward-agent.md',
      'scripts/ai/merge-clean-pr-batch.ps1',
    ],
    evidence: {
      source: 'command-steward-agent.md',
      workflow: 'Merge PR',
      step: 'Health gate: Run post-merge health check if batch succeeds',
      blocker: 'exit-3-health-gate-auto-trigger',
    },
    actionHint:
      'Once exit criterion 3 is met, update the steward merge workflow ' +
      'to rely on the auto-triggered health gate instead of manual invocation.',
  });

  return proposals;
}

// ── Core logic ───────────────────────────────────────────────────────────────

function compileProposals() {
  const raw = [
    ...collectExitCriteriaGaps(),
    ...collectChecklistGaps(),
    ...collectSkillRegistryGaps(),
    ...collectGuardedAutopilotGaps(),
    ...collectStewardWorkflowGaps(),
  ];

  raw.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] || 0;
    const pb = PRIORITY_RANK[b.priority] || 0;
    if (pb !== pa) return pb - pa;
    return b.confidence - a.confidence;
  });

  return raw;
}

function buildOutput(proposals) {
  const categoryCounts = {};
  for (const p of proposals) {
    categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'preview-only',
    proposalCount: proposals.length,
    categoryCounts,
    proposals,
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

  const proposals = compileProposals();
  const output = buildOutput(proposals);

  // Output shape
  assert(output.schemaVersion === 1, 'schemaVersion is 1');
  assert(typeof output.generatedAt === 'string', 'generatedAt is string');
  assert(output.mode === 'preview-only', 'mode is preview-only');
  assert(typeof output.proposalCount === 'number', 'proposalCount is number');
  assert(output.proposalCount === proposals.length, 'proposalCount matches proposals length');
  assert(output.proposalCount > 0, 'has at least one proposal');
  assert(typeof output.categoryCounts === 'object', 'categoryCounts is object');

  // Categories
  const expectedCategories = [
    'exit-criteria', 'retirement-checklist', 'skill-registry',
    'guarded-autopilot', 'steward-workflow',
  ];
  for (const cat of expectedCategories) {
    assert(cat in output.categoryCounts, `categoryCounts has ${cat}`);
    assert(output.categoryCounts[cat] > 0, `categoryCounts.${cat} > 0`);
  }

  // Required exit-criteria proposals
  const exitIds = proposals.filter(p => p.category === 'exit-criteria').map(p => p.id);
  assert(exitIds.includes('exit-3-health-gate-auto-trigger'), 'has exit-3 proposal');
  assert(exitIds.includes('exit-4-recovery-auto-dispatch'), 'has exit-4 proposal');
  assert(exitIds.includes('exit-7-legacy-migration'), 'has exit-7 proposal');

  // Required checklist proposals
  const checklistIds = proposals.filter(p => p.category === 'retirement-checklist').map(p => p.id);
  assert(checklistIds.includes('checklist-fallback-test'), 'has fallback-test proposal');
  assert(checklistIds.length >= 6, `has at least 6 checklist proposals, got ${checklistIds.length}`);

  // Required skill-registry proposals
  const skillIds = proposals.filter(p => p.category === 'skill-registry').map(p => p.id);
  assert(skillIds.includes('skill-recovery-dispatch'), 'has recovery-dispatch proposal');

  // Proposal shape validation
  for (const p of proposals) {
    assert(typeof p.id === 'string' && p.id.length > 0, `${p.id || 'unknown'}.id is non-empty string`);
    assert(typeof p.category === 'string' && p.category.length > 0, `${p.id}.category is non-empty string`);
    assert(typeof p.title === 'string' && p.title.length > 0, `${p.id}.title is non-empty string`);
    assert(typeof p.description === 'string' && p.description.length > 0, `${p.id}.description is non-empty string`);
    assert(typeof p.status === 'string' && p.status.length > 0, `${p.id}.status is non-empty string`);
    assert(typeof p.priority === 'string' && p.priority.length > 0, `${p.id}.priority is non-empty string`);
    assert(typeof p.confidence === 'number' && p.confidence >= 0 && p.confidence <= 100, `${p.id}.confidence is 0-100`);
    assert(typeof p.risk === 'string' && p.risk.length > 0, `${p.id}.risk is non-empty string`);
    assert(typeof p.workerClass === 'string' && p.workerClass.length > 0, `${p.id}.workerClass is non-empty string`);
    assert(Array.isArray(p.allowedFiles), `${p.id}.allowedFiles is array`);
    assert(p.allowedFiles.length > 0, `${p.id}.allowedFiles is not empty`);
    assert(p.evidence && typeof p.evidence === 'object', `${p.id}.evidence is object`);
    assert(typeof p.actionHint === 'string' && p.actionHint.length > 0, `${p.id}.actionHint is non-empty string`);
  }

  // Sort order: high before medium
  const highIdx = proposals.findIndex(p => p.priority === 'high');
  const mediumIdx = proposals.findIndex(p => p.priority === 'medium');
  if (highIdx !== -1 && mediumIdx !== -1) {
    assert(highIdx < mediumIdx, 'high priority proposals come before medium');
  }

  // categoryCounts sum matches proposalCount
  const categorySum = Object.values(output.categoryCounts).reduce((a, b) => a + b, 0);
  assert(categorySum === output.proposalCount, 'categoryCounts sum matches proposalCount');

  // Report
  console.log(`\n  compile-autonomy-handoff-followups self-test`);
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

  const proposals = compileProposals();
  const output = buildOutput(proposals);
  const json = JSON.stringify(output, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  // Default: write file (dry-run preview tool, but writes output for consumers)
  const outDir = path.dirname(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  process.stdout.write(`Autonomy handoff follow-ups written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

main();
