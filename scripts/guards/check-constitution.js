#!/usr/bin/env node

/**
 * check-constitution.js
 *
 * Constitution guard: verifies seed constitution presence and structure.
 *
 * Checks:
 *   1. Authoritative constitution exists at .github/ai-policy/seed-constitution.md
 *   2. Docs mirror exists at docs/ai-native/seed-constitution.md
 *   3. Both files contain the 5 required constitution sections
 *   4. Section headings match between authoritative and mirror
 *
 * Run standalone: node scripts/guards/check-constitution.js [options]
 *
 * Options:
 *   --json       Print JSON summary to stdout
 *   --dry-run    Report checks without failing (exit 0 even on violations)
 *   --help, -h   Show help
 *
 * Exit codes:
 *   0 — pass (or --dry-run)
 *   1 — violation
 *   2 — usage error
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const AUTHORITATIVE_PATH = path.join(ROOT, '.github', 'ai-policy', 'seed-constitution.md');
const DOCS_MIRROR_PATH = path.join(ROOT, 'docs', 'ai-native', 'seed-constitution.md');

const AUTHORITATIVE_REL = '.github/ai-policy/seed-constitution.md';
const DOCS_MIRROR_REL = 'docs/ai-native/seed-constitution.md';

// The 5 required constitution sections (must match seed-constitution.md H2 headings)
const REQUIRED_SECTIONS = [
  'High-Risk Human-Required Boundaries',
  'Explicit Merge Allowlists',
  'Main-Red Launch Stop',
  'Legacy Backend Read-Only Policy',
  'No Worker Scope Expansion',
];

// --- Exports for testing ---

function parseArgs(argv) {
  const args = { json: false, dryRun: false, help: false };
  const raw = argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case '--json':
        args.json = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        args._unknown = raw[i];
        break;
    }
  }
  return args;
}

function extractH2Headings(content) {
  const headings = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^##\s+(.+)/);
    if (match) {
      // Strip leading number prefix like "1. ", "2. ", "10. "
      headings.push(match[1].replace(/^\d+\.\s+/, '').trim());
    }
  }
  return headings;
}

function checkFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    return { pass: false, message: `${label} not found: ${path.relative(ROOT, filePath)}` };
  }
  return { pass: true, message: `${label} present` };
}

function checkSections(content, filePath) {
  const headings = extractH2Headings(content);
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const missing = [];

  for (const required of REQUIRED_SECTIONS) {
    const found = headings.some((h) => h.toLowerCase() === required.toLowerCase());
    if (!found) {
      missing.push(required);
    }
  }

  if (missing.length > 0) {
    return {
      pass: false,
      message: `${rel} missing sections: ${missing.join(', ')}`,
      headings,
      missing,
    };
  }

  return { pass: true, message: `${rel} has all ${REQUIRED_SECTIONS.length} required sections`, headings, missing: [] };
}

function checkSectionSync(authoritativeContent, mirrorContent) {
  const authHeadings = extractH2Headings(authoritativeContent);
  const mirrorHeadings = extractH2Headings(mirrorContent);

  const authSet = new Set(authHeadings.map((h) => h.toLowerCase()));
  const mirrorSet = new Set(mirrorHeadings.map((h) => h.toLowerCase()));

  const onlyInAuth = [...authSet].filter((h) => !mirrorSet.has(h));
  const onlyInMirror = [...mirrorSet].filter((h) => !authSet.has(h));

  const issues = [];
  if (onlyInAuth.length > 0) {
    issues.push(`Sections in authoritative but missing from mirror: ${onlyInAuth.join(', ')}`);
  }
  if (onlyInMirror.length > 0) {
    issues.push(`Sections in mirror but missing from authoritative: ${onlyInMirror.join(', ')}`);
  }

  if (issues.length > 0) {
    return { pass: false, message: issues.join('; ') };
  }
  return { pass: true, message: 'Section headings are in sync' };
}

function runGuard({ json = false, dryRun = false } = {}) {
  const violations = [];
  const warnings = [];
  const checks = [];

  // 1. Check authoritative file exists
  const authExists = checkFileExists(AUTHORITATIVE_PATH, 'Authoritative constitution');
  checks.push({ name: 'authoritative-exists', ...authExists });
  if (!authExists.pass) violations.push(authExists.message);

  // 2. Check docs mirror exists
  const mirrorExists = checkFileExists(DOCS_MIRROR_PATH, 'Docs mirror');
  checks.push({ name: 'docs-mirror-exists', ...mirrorExists });
  if (!mirrorExists.pass) violations.push(mirrorExists.message);

  // 3. Check sections in authoritative (if exists)
  let authSections = null;
  if (authExists.pass) {
    const authContent = fs.readFileSync(AUTHORITATIVE_PATH, 'utf-8');
    authSections = checkSections(authContent, AUTHORITATIVE_PATH);
    checks.push({ name: 'authoritative-sections', ...authSections });
    if (!authSections.pass) violations.push(authSections.message);
  }

  // 4. Check sections in mirror (if exists)
  let mirrorSections = null;
  if (mirrorExists.pass) {
    const mirrorContent = fs.readFileSync(DOCS_MIRROR_PATH, 'utf-8');
    mirrorSections = checkSections(mirrorContent, DOCS_MIRROR_PATH);
    checks.push({ name: 'mirror-sections', ...mirrorSections });
    if (!mirrorSections.pass) violations.push(mirrorSections.message);
  }

  // 5. Check section sync (if both exist and have sections)
  if (authExists.pass && mirrorExists.pass) {
    const authContent = fs.readFileSync(AUTHORITATIVE_PATH, 'utf-8');
    const mirrorContent = fs.readFileSync(DOCS_MIRROR_PATH, 'utf-8');
    const sync = checkSectionSync(authContent, mirrorContent);
    checks.push({ name: 'section-sync', ...sync });
    if (!sync.pass) warnings.push(sync.message);
  }

  const status = violations.length > 0 ? 'fail' : 'pass';

  const result = {
    status,
    checks,
    violations,
    warnings,
    summary: {
      authoritativeExists: authExists.pass,
      mirrorExists: mirrorExists.pass,
      requiredSections: REQUIRED_SECTIONS.length,
      violationCount: violations.length,
      warningCount: warnings.length,
      mode: dryRun ? 'dry-run' : 'enforce',
    },
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const check of checks) {
      const icon = check.pass ? 'PASS' : 'FAIL';
      console.log(`  ${icon}  ${check.message}`);
    }
    if (warnings.length > 0) {
      console.warn('\nWarnings:');
      for (const w of warnings) console.warn(`  - ${w}`);
    }
    if (violations.length > 0) {
      console.error('\nViolations:');
      for (const v of violations) console.error(`  - ${v}`);
    }
    if (status === 'pass') {
      console.log('\nConstitution guard passed.');
    }
  }

  return result;
}

function printHelp() {
  console.log(`Usage: node scripts/guards/check-constitution.js [options]

Constitution guard: verifies seed constitution presence and structure.

Checks:
  1. Authoritative constitution exists at ${AUTHORITATIVE_REL}
  2. Docs mirror exists at ${DOCS_MIRROR_REL}
  3. Both files contain the 5 required constitution sections
  4. Section headings match between authoritative and mirror

Options:
  --json       Print JSON summary to stdout
  --dry-run    Report checks without failing (exit 0 even on violations)
  --help, -h   Show this help

Exit codes:
  0  pass (or --dry-run)
  1  violation
  2  usage error

Required sections:
${REQUIRED_SECTIONS.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`);
}

// --- Main ---

if (require.main === module) {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args._unknown) {
    console.error(`Unknown argument: ${args._unknown}`);
    process.exit(2);
  }

  const result = runGuard({ json: args.json, dryRun: args.dryRun });
  const code = args.dryRun ? 0 : (result.status === 'fail' ? 1 : 0);
  process.exit(code);
}

module.exports = {
  parseArgs,
  extractH2Headings,
  checkFileExists,
  checkSections,
  checkSectionSync,
  runGuard,
  REQUIRED_SECTIONS,
  AUTHORITATIVE_PATH,
  DOCS_MIRROR_PATH,
  AUTHORITATIVE_REL,
  DOCS_MIRROR_REL,
  ROOT,
};
