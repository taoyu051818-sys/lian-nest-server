#!/usr/bin/env node

/**
 * emit-control-skill-registry.js
 *
 * Emits a registry of LIAN control skills from WebUI action modules
 * and the action registry. Fixture-driven and sanitized — no raw logs,
 * secrets, or script paths.
 *
 * Default mode is dry-run: prints a preview to stdout without writing.
 * Pass --live to persist the snapshot to the output file.
 *
 * Usage:
 *   node scripts/ai/emit-control-skill-registry.js --help
 *   node scripts/ai/emit-control-skill-registry.js
 *   node scripts/ai/emit-control-skill-registry.js --live
 *   node scripts/ai/emit-control-skill-registry.js --stdout
 *
 * Exit codes:
 *   0 — registry produced
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'control-skill-registry.json');

const SCHEMA_VERSION = 1;

// ── Fixture: skill catalogue ─────────────────────────────────────────────────
//
// Derived from:
//   - docs/ai-native/control-skill-registry.md (skill model + catalogue)
//   - tools/provider-pool-webui/actions/*.js (action module metadata)
//   - tools/provider-pool-webui/lib/action-registry.js (registry metadata)
//
// All fields are sanitized — no script paths, tokens, or raw logs.

const SKILL_CATALOGUE = [
  // ── WebUI action module skills ─────────────────────────────────────────
  {
    skillId: 'merge-prs',
    label: 'Merge PRs',
    description: 'Merge an explicit allowlist of PRs with health gate and guard checks.',
    source: 'action-module',
    risk: 'high',
    humanRequired: true,
    dangerous: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ['prNumbers'],
    category: 'merge',
  },
  {
    skillId: 'launch-batch',
    label: 'Launch Batch',
    description: 'Run the launch gate on queued tasks and preview or execute a batch dispatch.',
    source: 'action-module',
    risk: 'high',
    humanRequired: true,
    dangerous: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: [],
    category: 'launch',
  },
  {
    skillId: 'issue-state',
    label: 'Issue State Control',
    description: 'Reconcile issue labels/PRs and close done issues.',
    source: 'action-module',
    risk: 'medium',
    humanRequired: false,
    dangerous: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: [],
    category: 'issue',
  },
  {
    skillId: 'health-state',
    label: 'Health State',
    description: 'Preview or write the main branch health state marker.',
    source: 'action-module',
    risk: 'low',
    humanRequired: false,
    dangerous: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ['state'],
    category: 'health',
  },
  {
    skillId: 'status-bundle',
    label: 'Status Bundle',
    description: 'Preview the Command Steward status bundle. Read-only.',
    source: 'action-module',
    risk: 'low',
    humanRequired: false,
    dangerous: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    category: 'view',
  },
  {
    skillId: 'self-cycle',
    label: 'Self-Cycle Preview',
    description: 'Preview the self-cycle pipeline: health gate, provider pool preflight, queue status.',
    source: 'action-module',
    risk: 'low',
    humanRequired: false,
    dangerous: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    category: 'view',
  },
  {
    skillId: 'command-steward-brief',
    label: 'Command Steward Brief',
    description: 'Preview the Command Steward daily brief. Read-only.',
    source: 'action-module',
    risk: 'low',
    humanRequired: false,
    dangerous: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    category: 'view',
  },
  {
    skillId: 'compile-tasks',
    label: 'Compile Tasks',
    description: 'Compile issue JSON into worker task contracts.',
    source: 'action-module',
    risk: 'low',
    humanRequired: false,
    dangerous: false,
    readOnly: false,
    defaultPreview: true,
    requiredFields: [],
    category: 'planning',
  },
  {
    skillId: 'create-issues',
    label: 'Create Issues',
    description: 'Propose and create GitHub issues from gap analysis.',
    source: 'action-module',
    risk: 'high',
    humanRequired: true,
    dangerous: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: [],
    category: 'issue',
  },
  {
    skillId: 'plan-next-batch',
    label: 'Plan Next Batch',
    description: 'Preview the next worker batch: queued issues matched to available provider capacity.',
    source: 'action-module',
    risk: 'low',
    humanRequired: false,
    dangerous: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    category: 'planning',
  },
  {
    skillId: 'provider-rotation',
    label: 'Provider Key Rotation',
    description: 'Preview or execute provider credential rotation.',
    source: 'action-module',
    risk: 'high',
    humanRequired: true,
    dangerous: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ['providerId'],
    category: 'provider',
  },
  {
    skillId: 'worker.control',
    label: 'Worker Control',
    description: 'List, preview, and stop workers with explicit worker targeting.',
    source: 'action-module',
    risk: 'high',
    humanRequired: false,
    dangerous: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ['action'],
    category: 'worker',
  },

  // ── Action registry (control console) skills ───────────────────────────
  {
    skillId: 'view.provider.status',
    label: 'View Provider Status',
    description: 'Display current status, concurrency, and cooldown for a provider.',
    source: 'action-registry',
    risk: 'low',
    humanRequired: false,
    dangerous: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    category: 'view',
  },
  {
    skillId: 'view.worker.status',
    label: 'View Worker Status',
    description: 'Display active worker assignments and health.',
    source: 'action-registry',
    risk: 'low',
    humanRequired: false,
    dangerous: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    category: 'view',
  },
  {
    skillId: 'view.queue.status',
    label: 'View Queue Status',
    description: 'Display pending dispatch queue depth and blocked reasons.',
    source: 'action-registry',
    risk: 'low',
    humanRequired: false,
    dangerous: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    category: 'view',
  },
  {
    skillId: 'view.resources',
    label: 'View Resource Utilization',
    description: 'Display concurrency utilization, headroom, and pressure level.',
    source: 'action-registry',
    risk: 'low',
    humanRequired: false,
    dangerous: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    category: 'view',
  },
  {
    skillId: 'view.policy',
    label: 'View Policy',
    description: 'Display provider pool policy with secrets stripped.',
    source: 'action-registry',
    risk: 'low',
    humanRequired: false,
    dangerous: false,
    readOnly: true,
    defaultPreview: false,
    requiredFields: [],
    category: 'view',
  },
  {
    skillId: 'provider.cooldown.reset',
    label: 'Reset Provider Cooldown',
    description: 'Clear the cooldown timer for an exhausted provider.',
    source: 'action-registry',
    risk: 'medium',
    humanRequired: false,
    dangerous: false,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ['providerId'],
    category: 'provider',
  },
  {
    skillId: 'provider.enable',
    label: 'Enable Provider',
    description: 'Re-enable a disabled provider so it can accept new workers.',
    source: 'action-registry',
    risk: 'medium',
    humanRequired: false,
    dangerous: false,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ['providerId'],
    category: 'provider',
  },
  {
    skillId: 'provider.disable',
    label: 'Disable Provider',
    description: 'Disable a provider so it stops accepting new workers.',
    source: 'action-registry',
    risk: 'medium',
    humanRequired: false,
    dangerous: false,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ['providerId'],
    category: 'provider',
  },
  {
    skillId: 'worker.kill',
    label: 'Kill Worker',
    description: 'Terminate a running worker process immediately.',
    source: 'action-registry',
    risk: 'high',
    humanRequired: true,
    dangerous: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ['workerId'],
    category: 'worker',
  },
  {
    skillId: 'worker.drain',
    label: 'Drain Worker',
    description: 'Gracefully drain a worker — finish current task, then stop.',
    source: 'action-registry',
    risk: 'high',
    humanRequired: true,
    dangerous: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ['workerId'],
    category: 'worker',
  },
  {
    skillId: 'concurrency.update',
    label: 'Update Concurrency Limit',
    description: 'Change max concurrency for a provider or the global limit.',
    source: 'action-registry',
    risk: 'high',
    humanRequired: true,
    dangerous: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ['target', 'value'],
    category: 'resources',
  },
  {
    skillId: 'queue.clear',
    label: 'Clear Queue',
    description: 'Remove all pending entries from the dispatch queue.',
    source: 'action-registry',
    risk: 'high',
    humanRequired: true,
    dangerous: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: [],
    category: 'queue',
  },
  {
    skillId: 'settings.key.rotate',
    label: 'Rotate Admin Token',
    description: 'Generate a new admin token and invalidate the current one.',
    source: 'action-registry',
    risk: 'critical',
    humanRequired: true,
    dangerous: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: [],
    category: 'settings',
  },
  {
    skillId: 'policy.update',
    label: 'Update Policy',
    description: 'Modify the provider pool policy file.',
    source: 'action-registry',
    risk: 'critical',
    humanRequired: true,
    dangerous: true,
    readOnly: false,
    defaultPreview: true,
    requiredFields: ['field', 'value'],
    category: 'settings',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
emit-control-skill-registry.js — Control skill registry emitter (v1)

USAGE
    node scripts/ai/emit-control-skill-registry.js [options]

OPTIONS
    --live          Write the registry to the output file.
                    Without this flag, the script runs in dry-run mode
                    and prints a preview to stdout without writing.
    --out <path>    Output path for the registry JSON.
                    (default: .github/ai-state/control-skill-registry.json)
    --stdout        Print JSON to stdout instead of writing a file.
                    Overrides --out. Always prints regardless of --live.
    --self-test     Run built-in assertions and exit.
    --help          Show this help message and exit.

EXIT CODES
    0   Registry produced
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

// ── Build registry ───────────────────────────────────────────────────────────

function buildRegistry(skills) {
  const byRisk = { low: 0, medium: 0, high: 0, critical: 0 };
  const bySource = { 'action-module': 0, 'action-registry': 0 };
  let dangerousCount = 0;
  let readOnlyCount = 0;

  for (const skill of skills) {
    if (skill.risk in byRisk) byRisk[skill.risk]++;
    if (skill.source in bySource) bySource[skill.source]++;
    if (skill.dangerous) dangerousCount++;
    if (skill.readOnly) readOnlyCount++;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    totalSkills: skills.length,
    summary: {
      byRisk,
      bySource,
      dangerousCount,
      readOnlyCount,
      humanRequiredCount: skills.filter(s => s.humanRequired).length,
    },
    skills: skills.map(s => ({
      skillId: s.skillId,
      label: s.label,
      description: s.description,
      source: s.source,
      risk: s.risk,
      humanRequired: s.humanRequired,
      dangerous: s.dangerous,
      readOnly: s.readOnly,
      defaultPreview: s.defaultPreview,
      requiredFields: [...s.requiredFields],
      category: s.category,
    })),
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

  // Test: buildRegistry with empty skills
  const empty = buildRegistry([]);
  assert(empty.schemaVersion === 1, 'schemaVersion is 1');
  assert(typeof empty.capturedAt === 'string', 'capturedAt is string');
  assert(empty.totalSkills === 0, 'totalSkills 0 for empty');
  assert(empty.summary.byRisk.low === 0, 'byRisk.low 0');
  assert(empty.summary.dangerousCount === 0, 'dangerousCount 0');
  assert(Array.isArray(empty.skills), 'skills is array');

  // Test: buildRegistry with full catalogue
  const full = buildRegistry(SKILL_CATALOGUE);
  assert(full.totalSkills === SKILL_CATALOGUE.length, 'totalSkills matches catalogue length');
  assert(full.totalSkills > 0, 'catalogue is not empty');
  assert(full.summary.byRisk.low + full.summary.byRisk.medium + full.summary.byRisk.high + full.summary.byRisk.critical === full.totalSkills, 'byRisk sums to total');
  assert(full.summary.bySource['action-module'] + full.summary.bySource['action-registry'] === full.totalSkills, 'bySource sums to total');
  assert(full.summary.dangerousCount > 0, 'has some dangerous skills');
  assert(full.summary.readOnlyCount > 0, 'has some read-only skills');
  assert(full.summary.humanRequiredCount > 0, 'has some human-required skills');

  // Test: required skills are present
  const requiredIds = ['merge-prs', 'launch-batch', 'issue-state', 'health-state', 'status-bundle', 'self-cycle'];
  const skillIds = full.skills.map(s => s.skillId);
  for (const id of requiredIds) {
    assert(skillIds.includes(id), `required skill ${id} is present`);
  }

  // Test: each skill has all required fields
  const requiredFields = ['skillId', 'label', 'description', 'source', 'risk', 'humanRequired', 'dangerous', 'readOnly', 'defaultPreview', 'requiredFields', 'category'];
  for (const skill of full.skills) {
    for (const field of requiredFields) {
      assert(field in skill, `skill ${skill.skillId} has field ${field}`);
    }
    assert(Array.isArray(skill.requiredFields), `skill ${skill.skillId} requiredFields is array`);
    assert(typeof skill.humanRequired === 'boolean', `skill ${skill.skillId} humanRequired is boolean`);
    assert(typeof skill.dangerous === 'boolean', `skill ${skill.skillId} dangerous is boolean`);
    assert(typeof skill.readOnly === 'boolean', `skill ${skill.skillId} readOnly is boolean`);
  }

  // Test: risk levels are valid
  const validRisks = ['low', 'medium', 'high', 'critical'];
  for (const skill of full.skills) {
    assert(validRisks.includes(skill.risk), `skill ${skill.skillId} has valid risk`);
  }

  // Test: no secrets or script paths in output
  const json = JSON.stringify(full);
  assert(!json.includes('.ps1'), 'no .ps1 script paths');
  assert(!json.includes('.sh'), 'no .sh script paths');
  assert(!json.includes('password'), 'no password references');
  // Verify no raw credential values (not documentation words)
  for (const skill of full.skills) {
    const val = JSON.stringify(skill);
    assert(!(/"apiKey"\s*:/.test(val)), `skill ${skill.skillId} should not expose apiKey`);
    assert(!(/"token"\s*:/.test(val)), `skill ${skill.skillId} should not expose token value`);
    assert(!(/"secret"\s*:/.test(val)), `skill ${skill.skillId} should not expose secret value`);
  }

  // Test: skillId uniqueness
  const seen = new Set();
  let unique = true;
  for (const skill of full.skills) {
    if (seen.has(skill.skillId)) { unique = false; break; }
    seen.add(skill.skillId);
  }
  assert(unique, 'all skillIds are unique');

  // Report
  console.log(`\n  emit-control-skill-registry self-test`);
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

  const snapshot = buildRegistry(SKILL_CATALOGUE);
  const json = JSON.stringify(snapshot, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  if (!args.live) {
    // Dry-run mode
    const banner = [
      '╔' + '═'.repeat(62) + '╗',
      '║' + '                     DRY RUN                                ' + '║',
      '╚' + '═'.repeat(62) + '╝',
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
  process.stdout.write(`Control skill registry written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}\n`);
}

main();
