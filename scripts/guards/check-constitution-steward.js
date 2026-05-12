#!/usr/bin/env node

/**
 * check-constitution-steward.js
 *
 * Constitution steward checker: inspects JSON or markdown inputs for
 * forbidden patterns that would violate the seed constitution.
 *
 * Forbidden pattern categories:
 *   1. Bypass gate        — flags/options that skip required gates
 *   2. Auto high-risk     — automated high-risk actions without human approval
 *   3. Self-approve       — agent self-approval of policy/constitution changes
 *   4. Lower human-required — weakening or removing human-required boundaries
 *   5. Write unverified facts — recording facts without verification
 *
 * This is a local, deterministic checker. No network calls. It reads an
 * input file (JSON or markdown), scans for forbidden patterns, and produces
 * a structured result.
 *
 * Usage:
 *   node scripts/guards/check-constitution-steward.js --help
 *   node scripts/guards/check-constitution-steward.js --input proposal.json
 *   node scripts/guards/check-constitution-steward.js --input proposal.md
 *   cat proposal.json | node scripts/guards/check-constitution-steward.js --stdin
 *
 * Exit codes:
 *   0 — pass (no forbidden patterns detected)
 *   1 — violation (one or more forbidden patterns found)
 *   2 — usage error
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// ── Forbidden Pattern Definitions ──────────────────────────────────────────

/**
 * Each pattern category has:
 *   - code: unique violation code
 *   - description: human-readable explanation
 *   - patterns: array of { regex, flags, label } objects to match against input
 */
const FORBIDDEN_CATEGORIES = [
  {
    code: 'BYPASS_GATE',
    description: 'Input suggests bypassing a required gate or validation step',
    patterns: [
      { regex: /\b(?:skip|bypass|disable|override)\s+(?:gate|check|validation|guard|review)\b/gi, label: 'skip-gate-keyword' },
      { regex: /\b--no-verify\b/g, label: 'no-verify-flag' },
      { regex: /\b--force\b/g, label: 'force-flag' },
      { regex: /\bno[_-]?check\b/gi, label: 'no-check-keyword' },
      { regex: /\bskip[_-]?(?:validation|ci|lint|test)\b/gi, label: 'skip-ci-keyword' },
    ],
  },
  {
    code: 'AUTO_HIGH_RISK',
    description: 'Input proposes automated high-risk action without explicit human approval',
    patterns: [
      { regex: /\bauto[_-]?(?:approve|merge|deploy|release)\b/gi, label: 'auto-action-keyword' },
      { regex: /\bautomatically\s+(?:approve|merge|deploy|release|rotate|delete)\b/gi, label: 'auto-verb-keyword' },
      { regex: /\b(?:rotate|delete|destroy)\s+(?:secrets?|tokens?|credentials?|keys?)\b/gi, label: 'secret-destruction' },
      { regex: /\bforce[_-]?push\b/gi, label: 'force-push-keyword' },
      { regex: /\b(?:drop|truncate|delete)\s+(?:table|database|schema|migration)\b/gi, label: 'data-destruction' },
    ],
  },
  {
    code: 'SELF_APPROVE',
    description: 'Input suggests agent self-approval of policy or constitution changes',
    patterns: [
      { regex: /\bself[_-]?(?:approve|authoriz|ratif|validat)\b/gi, label: 'self-approve-keyword' },
      { regex: /\bapprove\s+(?:own|my|this)\s+(?:pr|change|policy|constitution)\b/gi, label: 'approve-own-work' },
      { regex: /\bworker\s+(?:may|can|should)\s+(?:approve|merge)\s+(?:its\s+own|policy)\b/gi, label: 'worker-self-merge' },
      { regex: /\bwithout\s+(?:human|reviewer|owner)\s+(?:approval|review)\b/gi, label: 'without-human-approval' },
    ],
  },
  {
    code: 'LOWER_HUMAN_REQUIRED',
    description: 'Input proposes weakening or removing human-required boundaries',
    patterns: [
      { regex: /\b(?:remove|lower|relax|weaken|reduce)\s+(?:human[_-]?(?:required|gate|approval|review))\b/gi, label: 'lower-human-gate' },
      { regex: /\bhuman[_-]?(?:required|approval)\s*[:=]\s*(?:false|no|0|none)\b/gi, label: 'human-required-false' },
      { regex: /\bmake\s+(?:optional|automatic)\s+(?:human|reviewer|owner)\b/gi, label: 'make-human-optional' },
      { regex: /\bno\s+(?:longer\s+)?(?:require|need)\s+(?:human|manual)\s+(?:approval|review)\b/gi, label: 'no-longer-require-human' },
    ],
  },
  {
    code: 'WRITE_UNVERIFIED_FACTS',
    description: 'Input proposes recording facts without verification or evidence',
    patterns: [
      { regex: /\bwrite\s+(?:unverified|unchecked|unsourced)\s+facts?\b/gi, label: 'write-unverified-keyword' },
      { regex: /\bwithout\s+(?:verification|evidence|source|proof)\b/gi, label: 'without-verification' },
      { regex: /\bskip\s+(?:verification|fact[_-]?check|validation)\s+(?:and|then)?\s*write\b/gi, label: 'skip-then-write' },
      { regex: /\bassume\s+(?:and\s+)?(?:record|write|log|emit)\b/gi, label: 'assume-and-record' },
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return null;
  }
}

function printHelp() {
  const help = `
check-constitution-steward.js — Constitution steward checker

USAGE
    node scripts/guards/check-constitution-steward.js [options]

OPTIONS
    --input <path>   Path to input file (JSON or markdown)
    --stdin          Read input from stdin
    --json           Print JSON result to stdout
    --dry-run        Report violations without failing (exit 0)
    --help, -h       Show this help message and exit

FORBIDDEN PATTERN CATEGORIES
${FORBIDDEN_CATEGORIES.map((c, i) => `    ${i + 1}. ${c.code} — ${c.description}`).join('\n')}

EXIT CODES
    0   pass (no forbidden patterns) or --dry-run
    1   violation detected
    2   usage error
`.trimStart();
  process.stdout.write(help);
}

// ── Scanner ────────────────────────────────────────────────────────────────

/**
 * Scan input text against all forbidden pattern categories.
 * Returns an array of violation objects.
 */
function scanForViolations(inputText) {
  const violations = [];

  for (const category of FORBIDDEN_CATEGORIES) {
    const matches = [];

    for (const pat of category.patterns) {
      // Reset regex lastIndex for global patterns
      pat.regex.lastIndex = 0;
      const found = pat.regex.exec(inputText);
      if (found) {
        matches.push({
          label: pat.label,
          matchedText: found[0],
          index: found.index,
        });
      }
    }

    if (matches.length > 0) {
      violations.push({
        code: category.code,
        description: category.description,
        matchCount: matches.length,
        matches: matches.slice(0, 5), // cap at 5 per category to avoid noise
      });
    }
  }

  return violations;
}

// ── Result Builder ─────────────────────────────────────────────────────────

function buildResult(inputText, inputSource, violations) {
  const pass = violations.length === 0;

  return {
    tool: 'check-constitution-steward',
    pass,
    inputSource,
    inputLength: inputText.length,
    violationCount: violations.length,
    violations,
    checkedAt: new Date().toISOString(),
    categories: FORBIDDEN_CATEGORIES.map((c) => c.code),
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    input: null,
    stdin: false,
    json: false,
    dryRun: false,
    help: false,
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--input') {
      i++;
      if (i >= argv.length) {
        console.error('Error: --input requires a path');
        process.exit(2);
      }
      args.input = argv[i];
    } else if (arg === '--stdin') {
      args.stdin = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }

  return args;
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Load input
  let raw;
  let inputSource;

  if (args.stdin) {
    raw = readStdin();
    inputSource = 'stdin';
  } else if (args.input) {
    if (!fs.existsSync(args.input)) {
      console.error(`Error: Input file not found: ${args.input}`);
      process.exit(2);
    }
    raw = fs.readFileSync(args.input, 'utf8');
    inputSource = path.relative(ROOT, args.input).replace(/\\/g, '/');
  } else {
    console.error('Error: --input <path> or --stdin is required.');
    process.exit(2);
  }

  if (!raw || raw.trim().length === 0) {
    console.error('Error: Input is empty.');
    process.exit(2);
  }

  // Scan
  const violations = scanForViolations(raw);
  const result = buildResult(raw, inputSource, violations);

  // Output
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.pass) {
      console.log('PASS  No forbidden constitution patterns detected.');
      console.log(`      Source: ${result.inputSource} (${result.inputLength} chars)`);
    } else {
      console.log('FAIL  Forbidden constitution patterns detected:\n');
      for (const v of result.violations) {
        console.log(`  [${v.code}] ${v.description}`);
        for (const m of v.matches) {
          console.log(`    - "${m.matchedText}" (at char ${m.index}, pattern: ${m.label})`);
        }
      }
      console.log(`\n${result.violationCount} violation(s) in ${result.inputSource}.`);
    }
  }

  // Exit code
  const code = result.pass || args.dryRun ? 0 : 1;
  process.exit(code);
}

if (require.main === module) {
  main();
}

module.exports = {
  FORBIDDEN_CATEGORIES,
  scanForViolations,
  buildResult,
  parseArgs,
};
