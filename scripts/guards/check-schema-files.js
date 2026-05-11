#!/usr/bin/env node

/**
 * check-schema-files.js
 *
 * Schema files guard: verifies schemas/*.schema.json files parse as valid JSON
 * and contain required top-level JSON Schema metadata.
 *
 * Required top-level keys: $schema, title, description, type, properties.
 *
 * Usage:
 *   node scripts/guards/check-schema-files.js [options]
 *
 * Options:
 *   --help          Show this help message and exit 0.
 *   --dry-run       Report what would be checked without running validations.
 *   --json          Output machine-readable JSON summary.
 *   --warn-only     Report violations as warnings (exit 0) instead of errors (exit 1).
 *   --schemas-dir   Override schemas directory (default: schemas/).
 *
 * Exit codes:
 *   0 -- No violations (or --warn-only with warnings, or --help / --dry-run)
 *   1 -- Violations found (blocked mode)
 *   2 -- Usage error (bad arguments)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const REQUIRED_TOP_LEVEL = ['$schema', 'title', 'description', 'type', 'properties'];

// --- Argument parsing ---

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    help: false,
    dryRun: false,
    json: false,
    warnOnly: false,
    schemasDir: path.join(ROOT, 'schemas'),
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--warn-only') {
      opts.warnOnly = true;
    } else if (arg === '--schemas-dir') {
      i++;
      if (i >= args.length) {
        console.error('Error: --schemas-dir requires a value');
        process.exit(2);
      }
      opts.schemasDir = path.resolve(args[i]);
    } else {
      console.error(`Error: unknown argument "${arg}"`);
      process.exit(2);
    }
  }

  return opts;
}

// --- Core logic ---

function collectSchemaFiles(schemasDir) {
  if (!fs.existsSync(schemasDir)) return [];
  return fs.readdirSync(schemasDir)
    .filter((f) => f.endsWith('.schema.json'))
    .map((f) => path.join(schemasDir, f))
    .sort();
}

function validateSchemaFile(filePath) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const violations = [];

  // 1. Parse JSON
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    violations.push({ file: rel, rule: 'read-error', message: `Cannot read file: ${err.message}` });
    return violations;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    violations.push({ file: rel, rule: 'json-parse', message: `Invalid JSON: ${err.message}` });
    return violations;
  }

  // 2. Must be an object at root
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    violations.push({ file: rel, rule: 'root-type', message: 'Root value must be a JSON object' });
    return violations;
  }

  // 3. Check required top-level keys
  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in parsed)) {
      violations.push({ file: rel, rule: 'missing-key', message: `Missing required top-level key: "${key}"` });
    }
  }

  // 4. $schema must reference JSON Schema draft
  if (parsed.$schema && typeof parsed.$schema === 'string') {
    if (!parsed.$schema.includes('json-schema.org')) {
      violations.push({ file: rel, rule: 'invalid-schema-ref', message: `$schema does not reference json-schema.org: "${parsed.$schema}"` });
    }
  }

  // 5. type must be "object" at root
  if (parsed.type && parsed.type !== 'object') {
    violations.push({ file: rel, rule: 'root-type-value', message: `Root type must be "object", got "${parsed.type}"` });
  }

  return violations;
}

function run(opts) {
  const schemasDir = opts.schemasDir || path.join(ROOT, 'schemas');
  const files = collectSchemaFiles(schemasDir);

  if (opts.dryRun) {
    const summary = {
      mode: 'dry-run',
      schemasDir: path.relative(ROOT, schemasDir).replace(/\\/g, '/') || '.',
      fileCount: files.length,
      files: files.map((f) => path.relative(ROOT, f).replace(/\\/g, '/')),
    };
    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`Dry run — ${files.length} schema file(s) would be checked:`);
      for (const f of summary.files) console.log(`  - ${f}`);
    }
    return { warnings: [], errors: [], fileCount: files.length };
  }

  if (files.length === 0) {
    console.log('No schema files found. Nothing to check.');
    return { warnings: [], errors: [], fileCount: 0 };
  }

  const warnings = [];
  const errors = [];

  for (const file of files) {
    const violations = validateSchemaFile(file);
    for (const v of violations) {
      const msg = `[${v.rule}] ${v.file}: ${v.message}`;
      (opts.warnOnly ? warnings : errors).push(msg);
    }
  }

  const summary = {
    fileCount: files.length,
    warningCount: warnings.length,
    errorCount: errors.length,
    mode: opts.warnOnly ? 'warn-only' : 'enforce',
    warnings,
    errors,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    if (warnings.length > 0) {
      console.warn(`Warnings (${warnings.length}):`);
      for (const w of warnings) console.warn(`  - ${w}`);
    }
    if (errors.length > 0) {
      console.error(`Errors (${errors.length}):`);
      for (const e of errors) console.error(`  - ${e}`);
    }
    if (warnings.length === 0 && errors.length === 0) {
      console.log(`Schema files check passed. (${files.length} file(s) scanned)`);
    }
  }

  return summary;
}

// --- CLI entry ---

if (require.main === module) {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    const script = path.relative(ROOT, __filename).replace(/\\/g, '/');
    console.log(`Usage: node ${script} [options]

Options:
  --help            Show this help message and exit 0.
  --dry-run         Report what would be checked without running validations.
  --json            Output machine-readable JSON summary.
  --warn-only       Report violations as warnings (exit 0) instead of errors (exit 1).
  --schemas-dir DIR Override schemas directory (default: schemas/).

Checks:
  - Each schemas/*.schema.json file must be valid JSON.
  - Root value must be a JSON object.
  - Required top-level keys: ${REQUIRED_TOP_LEVEL.join(', ')}.
  - $schema must reference json-schema.org.
  - Root type must be "object".

Exit codes:
  0  No violations (or --warn-only, or --help / --dry-run).
  1  Violations found.
  2  Usage error.`);
    process.exit(0);
  }

  const summary = run(opts);
  process.exit(summary.errors.length > 0 ? 1 : 0);
}

module.exports = {
  parseArgs,
  collectSchemaFiles,
  validateSchemaFile,
  REQUIRED_TOP_LEVEL,
  run,
};
