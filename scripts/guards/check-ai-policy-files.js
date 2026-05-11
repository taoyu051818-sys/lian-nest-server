#!/usr/bin/env node

/**
 * check-ai-policy-files.js
 *
 * Verifies that required .github/ai-policy files exist and JSON policy files
 * parse correctly. Non-destructive read-only guard.
 *
 * Usage:
 *   node scripts/guards/check-ai-policy-files.js
 *   node scripts/guards/check-ai-policy-files.js --json
 *   node scripts/guards/check-ai-policy-files.js --dry-run
 *   node scripts/guards/check-ai-policy-files.js --help
 *
 * Exit codes:
 *   0 – all required files present and JSON valid
 *   1 – missing files or invalid JSON detected
 *   2 – bad arguments or policy directory not found
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLICY_DIR = '.github/ai-policy';

const REQUIRED_JSON = [
  'failure-taxonomy.json',
  'launch-policy.json',
  'merge-policy.json',
  'provider-pool-policy.json',
  'risk-policy.json',
  'telemetry-budget-policy.json',
  'worker-permissions.json',
];

const REQUIRED_NON_JSON = [
  'seed-constitution.md',
];

const REQUIRED_FILES = [...REQUIRED_JSON, ...REQUIRED_NON_JSON];

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Check the ai-policy directory for required files and JSON validity.
 *
 * @param {string} repoRoot – absolute or relative path to repo root
 * @param {object} [options]
 * @param {boolean} [options.dryRun] – if true, report what would be checked without failing
 * @returns {{ ok: boolean, dirExists: boolean, missing: string[], invalidJson: object[], checked: number }}
 */
function checkPolicyFiles(repoRoot, options = {}) {
  const policyDir = path.resolve(repoRoot, POLICY_DIR);
  const dirExists = fs.existsSync(policyDir) && fs.statSync(policyDir).isDirectory();

  if (!dirExists) {
    return {
      ok: false,
      dirExists: false,
      missing: REQUIRED_FILES.slice(),
      invalidJson: [],
      checked: 0,
    };
  }

  const missing = [];
  const invalidJson = [];

  for (const file of REQUIRED_FILES) {
    const filePath = path.join(policyDir, file);
    if (!fs.existsSync(filePath)) {
      missing.push(file);
      continue;
    }

    if (file.endsWith('.json')) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        JSON.parse(content);
      } catch (err) {
        invalidJson.push({ file, error: err.message });
      }
    }
  }

  const checked = REQUIRED_FILES.length - missing.length;
  const ok = missing.length === 0 && invalidJson.length === 0;

  return { ok, dirExists: true, missing, invalidJson, checked };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.log(`Usage: node check-ai-policy-files.js [options]

Verifies that required .github/ai-policy files exist and JSON policy files
parse correctly. Non-destructive read-only guard.

Options:
  --json      Output result as JSON.
  --dry-run   Report what would be checked without failing on missing files.
  --help, -h  Show this help.

Required files:
${REQUIRED_FILES.map((f) => '  - ' + f).join('\n')}

Exit codes:
  0  All required files present and JSON valid
  1  Missing files or invalid JSON detected
  2  Bad arguments or policy directory not found`);
}

function parseArgs(argv) {
  const args = { json: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = path.resolve(__dirname, '..', '..');
  const result = checkPolicyFiles(repoRoot, { dryRun: args.dryRun });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!result.dirExists) {
    console.error(`Policy directory not found: ${POLICY_DIR}`);
    console.error('Expected at: ' + path.resolve(repoRoot, POLICY_DIR));
  } else if (result.ok) {
    console.log('AI policy files guard passed.');
    console.log(`Checked ${result.checked} files in ${POLICY_DIR}/`);
  } else {
    if (result.missing.length > 0) {
      console.error('Missing required policy files:');
      for (const f of result.missing) {
        console.error('  - ' + f);
      }
    }
    if (result.invalidJson.length > 0) {
      console.error('Invalid JSON in policy files:');
      for (const entry of result.invalidJson) {
        console.error('  - ' + entry.file + ': ' + entry.error);
      }
    }
  }

  // Dry-run mode: always exit 0, just report
  if (args.dryRun) {
    process.exit(0);
  }

  process.exit(result.ok ? 0 : (!result.dirExists ? 2 : 1));
}

// Export for testing
module.exports = { checkPolicyFiles, REQUIRED_FILES, REQUIRED_JSON, REQUIRED_NON_JSON, POLICY_DIR };

if (require.main === module) {
  main();
}
