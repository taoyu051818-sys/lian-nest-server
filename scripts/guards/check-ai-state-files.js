#!/usr/bin/env node

/**
 * check-ai-state-files.js
 *
 * AI state files guard: verifies .github/ai-state projection files exist
 * where expected and parse without errors.
 *
 * Checks:
 *   1. Expected state files exist.
 *   2. Each file is valid JSON.
 *   3. Each file has a recognised version field (markerVersion / stateVersion / snapshotVersion).
 *   4. Each file has expected top-level keys for its projection type.
 *   5. Captured-at timestamps are not stale beyond threshold (warning only).
 *
 * Run standalone: node scripts/guards/check-ai-state-files.js [--dry-run] [--json] [--stale-threshold-hours N]
 * Exit codes:
 *   0 -- No violations
 *   1 -- Violations found
 *   2 -- Bad arguments
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const AI_STATE_DIR = path.join(ROOT, '.github', 'ai-state');

// ---------------------------------------------------------------------------
// Expected state files and their schema contracts
// ---------------------------------------------------------------------------

const EXPECTED_FILES = [
  {
    name: 'launch-locks.json',
    versionField: 'markerVersion',
    requiredKeys: ['markerVersion', 'capturedAt', 'locks'],
  },
  {
    name: 'main-health.json',
    versionField: 'markerVersion',
    requiredKeys: ['markerVersion', 'state', 'capturedAt'],
  },
  {
    name: 'provider-pool.json',
    versionField: 'stateVersion',
    requiredKeys: ['stateVersion', 'providers', 'global'],
  },
  {
    name: 'worker-trust.json',
    versionField: 'markerVersion',
    requiredKeys: ['markerVersion', 'capturedAt', 'workerClasses'],
  },
  {
    name: 'active-workers.json',
    versionField: 'markerVersion',
    requiredKeys: ['markerVersion', 'capturedAt', 'workers'],
  },
  {
    name: 'meta-signals.json',
    versionField: 'snapshotVersion',
    requiredKeys: ['snapshotVersion', 'signals'],
  },
];

const CAPTURED_AT_KEYS = ['capturedAt', 'calculatedAt'];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.log(`Usage: node check-ai-state-files.js [options]

Verifies .github/ai-state projection files exist and parse correctly.

Options:
  --dry-run                   Print what would be checked without enforcing.
  --json                      Output JSON summary instead of human-readable text.
  --stale-threshold-hours N   Warn when capturedAt is older than N hours (default: 48).
  -h, --help                  Show this help.

Exit codes:
  0  All state files valid
  1  Violations found
  2  Bad arguments`);
}

function parseArgs(argv) {
  const args = { dryRun: false, json: false, staleThresholdHours: 48 };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--stale-threshold-hours') {
      i++;
      if (i >= argv.length) {
        console.error('Error: --stale-threshold-hours requires a number');
        process.exit(2);
      }
      const n = parseInt(argv[i], 10);
      if (isNaN(n) || n < 0) {
        console.error('Error: --stale-threshold-hours must be a non-negative integer');
        process.exit(2);
      }
      args.staleThresholdHours = n;
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
    i++;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Core checks
// ---------------------------------------------------------------------------

function checkExistence(fileSpec, dir) {
  const filePath = path.join(dir || AI_STATE_DIR, fileSpec.name);
  if (!fs.existsSync(filePath)) {
    return { file: fileSpec.name, type: 'missing', message: `Expected file not found: ${fileSpec.name}` };
  }
  return null;
}

function checkParsable(fileSpec, dir) {
  const filePath = path.join(dir || AI_STATE_DIR, fileSpec.name);
  if (!fs.existsSync(filePath)) return null;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return { file: fileSpec.name, type: 'read-error', message: `Cannot read ${fileSpec.name}: ${err.message}` };
  }

  try {
    JSON.parse(content);
  } catch (err) {
    return { file: fileSpec.name, type: 'invalid-json', message: `Invalid JSON in ${fileSpec.name}: ${err.message}` };
  }

  return null;
}

function checkSchema(fileSpec, dir) {
  const filePath = path.join(dir || AI_STATE_DIR, fileSpec.name);
  if (!fs.existsSync(filePath)) return null;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null; // parse error already caught
  }

  // Check version field
  if (parsed[fileSpec.versionField] === undefined) {
    return {
      file: fileSpec.name,
      type: 'missing-version',
      message: `${fileSpec.name} missing version field "${fileSpec.versionField}"`,
    };
  }

  // Check required keys
  const missing = fileSpec.requiredKeys.filter((k) => parsed[k] === undefined);
  if (missing.length > 0) {
    return {
      file: fileSpec.name,
      type: 'missing-keys',
      message: `${fileSpec.name} missing required keys: ${missing.join(', ')}`,
    };
  }

  return null;
}

function checkStaleness(fileSpec, thresholdHours, dir) {
  const filePath = path.join(dir || AI_STATE_DIR, fileSpec.name);
  if (!fs.existsSync(filePath)) return null;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }

  // Find a timestamp field
  let tsValue = null;
  for (const key of CAPTURED_AT_KEYS) {
    if (parsed[key]) {
      tsValue = parsed[key];
      break;
    }
  }
  if (!tsValue) return null;

  const captured = new Date(tsValue);
  if (isNaN(captured.getTime())) return null;

  const ageMs = Date.now() - captured.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours > thresholdHours) {
    return {
      file: fileSpec.name,
      type: 'stale',
      message: `${fileSpec.name} capturedAt is ${Math.round(ageHours)}h old (threshold: ${thresholdHours}h)`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function run(options = {}) {
  const thresholdHours = options.staleThresholdHours !== undefined ? options.staleThresholdHours : 48;
  const dir = options.dir || AI_STATE_DIR;

  const errors = [];
  const warnings = [];

  for (const spec of EXPECTED_FILES) {
    // Existence
    const missing = checkExistence(spec, dir);
    if (missing) {
      errors.push(missing);
      continue; // skip further checks for missing files
    }

    // Parse
    const parseErr = checkParsable(spec, dir);
    if (parseErr) {
      errors.push(parseErr);
      continue;
    }

    // Schema
    const schemaErr = checkSchema(spec, dir);
    if (schemaErr) {
      errors.push(schemaErr);
    }

    // Staleness (warning only)
    const staleWarn = checkStaleness(spec, thresholdHours, dir);
    if (staleWarn) {
      warnings.push(staleWarn);
    }
  }

  return { errors, warnings, fileCount: EXPECTED_FILES.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);

  if (args.dryRun) {
    console.log('Dry run — files that would be checked:');
    for (const spec of EXPECTED_FILES) {
      const filePath = path.join(AI_STATE_DIR, spec.name);
      const exists = fs.existsSync(filePath);
      console.log(`  ${exists ? 'OK' : 'MISSING'}  .github/ai-state/${spec.name}`);
    }
    process.exit(0);
  }

  const result = run({ staleThresholdHours: args.staleThresholdHours });

  const summary = {
    tool: 'check-ai-state-files',
    pass: result.errors.length === 0,
    fileCount: result.fileCount,
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    errors: result.errors,
    warnings: result.warnings,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    if (result.warnings.length > 0) {
      console.warn(`Warnings (${result.warnings.length}):`);
      for (const w of result.warnings) console.warn(`  - ${w.message}`);
    }
    if (result.errors.length > 0) {
      console.error(`Errors (${result.errors.length}):`);
      for (const e of result.errors) console.error(`  - ${e.message}`);
    }
    if (result.errors.length === 0 && result.warnings.length === 0) {
      console.log(`AI state files check passed. (${result.fileCount} files checked)`);
    }
  }

  process.exit(result.errors.length > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

module.exports = {
  AI_STATE_DIR,
  EXPECTED_FILES,
  CAPTURED_AT_KEYS,
  checkExistence,
  checkParsable,
  checkSchema,
  checkStaleness,
  run,
};

if (require.main === module) {
  main();
}
