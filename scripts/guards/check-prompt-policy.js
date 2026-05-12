#!/usr/bin/env node

/**
 * check-prompt-policy.js
 *
 * Prompt policy linter: scans text (prompts, PR bodies, issue comments)
 * for constitution violations and prompt-injection patterns.
 *
 * Checks:
 *   1. Self-approval of high-risk boundaries (agents must not self-approve)
 *   2. Weakening of human gates or constitution rules
 *   3. Agent authority expansion beyond declared scope
 *   4. Prompt injection markers (system-role prefixes, command execution)
 *
 * Usage:
 *   node scripts/guards/check-prompt-policy.js --file <path>
 *   node scripts/guards/check-prompt-policy.js --stdin
 *   node scripts/guards/check-prompt-policy.js --json --file <path>
 *   node scripts/guards/check-prompt-policy.js --dry-run --file <path>
 *   node scripts/guards/check-prompt-policy.js --help
 *
 * Exit codes:
 *   0 – pass (or --dry-run)
 *   1 – policy violation detected
 *   2 – usage error
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * High-risk boundaries from the seed constitution.
 * Agents MUST NOT self-approve changes touching these areas.
 */
const HIGH_RISK_BOUNDARIES = [
  { pattern: /\b(?:delete|rotate)\s+(?:secrets?|tokens?|credentials?)\b/gi, label: 'Secret/token manipulation' },
  { pattern: /\bmodify\b.*\b\.env\b/gi, label: '.env modification' },
  { pattern: /\bprisma\s+(?:schema|migrat)/gi, label: 'Prisma schema/migration change' },
  { pattern: /\bforce[- ]?push\b/gi, label: 'Force push' },
  { pattern: /\bpackage\.json\b.*\b(?:dependen|add|remove|upgrade)\b/gi, label: 'Dependency modification' },
  { pattern: /\bseed-constitution\.md\b/gi, label: 'Constitution modification' },
  { pattern: /\.github\/ai-policy\b/gi, label: 'Policy file modification' },
  { pattern: /\b(?:launch[- ]?gate|health[- ]?gate|batch[- ]?launcher)\b/gi, label: 'Control-plane script modification' },
];

/**
 * Self-approval pattern: language suggesting an agent approved its own
 * high-risk change without human sign-off.
 */
const SELF_APPROVAL_PATTERNS = [
  { pattern: /\b(?:I|we)\s+(?:have\s+)?(?:approved|authorized|permitted)\s+(?:this|the)\s+(?:change|action|modification)\b/gi, label: 'Self-approval claim' },
  { pattern: /\b(?:auto[- ]?approv|self[- ]?approv|bypass(?:ing)?\s+(?:human|review|approval))\b/gi, label: 'Auto/self-approval' },
  { pattern: /\b(?:skip|bypass|override)\s+(?:human|manual)\s+(?:review|approval|gate)\b/gi, label: 'Human gate bypass' },
];

/**
 * Agent scope expansion: language suggesting an agent is granting itself
 * new authority or broadening its allowed scope.
 */
const SCOPE_EXPANSION_PATTERNS = [
  { pattern: /\b(?:expand|broaden|widen|extend)\s+(?:my|our|the)\s+(?:scope|authority|permissions?|allowed)\b/gi, label: 'Scope expansion' },
  { pattern: /\b(?:grant|give)\s+(?:myself|ourselves)\s+(?:access|permission|authority)\b/gi, label: 'Self-granted authority' },
  { pattern: /\b(?:allowedFiles|forbiddenFiles)\s*(?::|=>|=)\s*\[?\s*\*\*\s*\]?\b/gi, label: 'Wildcard scope claim' },
];

/**
 * Prompt injection patterns (from external-reality-intake.md).
 */
const INJECTION_PATTERNS = [
  { pattern: /^(?:SYSTEM|ASSISTANT|USER)\s*:/gmi, label: 'System-role prefix', severity: 'error' },
  { pattern: /<system>/gi, label: 'System tag injection', severity: 'error' },
  { pattern: /!\s*`[^`]*(?:rm|del|drop|exec|eval)\b/gi, label: 'Command execution attempt', severity: 'error' },
  { pattern: /\bignore\s+(?:previous|all|above)\s+(?:instructions?|rules?)\b/gi, label: 'Instruction override', severity: 'error' },
  { pattern: /\byou\s+are\s+now\b/gi, label: 'Role reassignment attempt', severity: 'warning' },
];

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Finding
 * @property {string} rule     – which rule category triggered
 * @property {string} label    – human-readable description
 * @property {string} severity – "error" or "warning"
 * @property {number} line     – 1-based line number (0 if unknown)
 * @property {string} snippet  – short context around the match
 */

/**
 * Scan text for policy violations.
 *
 * @param {string} text – the text to lint
 * @param {object} [options]
 * @param {boolean} [options.dryRun] – if true, findings are reported but result is always "pass"
 * @returns {{ status: string, findings: Finding[], summary: object }}
 */
function lintPromptPolicy(text, options = {}) {
  const findings = [];

  const lines = text.split(/\r?\n/);

  /**
   * Helper: scan text for a set of pattern rules.
   * @param {Array<{pattern: RegExp, label: string}>} rules
   * @param {string} category
   * @param {string} [severity]
   */
  function scan(rules, category, severity = 'error') {
    for (const rule of rules) {
      // Reset lastIndex for global regexes
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(text)) !== null) {
        const lineNum = text.slice(0, match.index).split(/\r?\n/).length;
        const start = Math.max(0, match.index - 30);
        const end = Math.min(text.length, match.index + match[0].length + 30);
        const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
        findings.push({
          rule: category,
          label: rule.label,
          severity: rule.severity || severity,
          line: lineNum,
          snippet: snippet.length > 120 ? snippet.slice(0, 117) + '...' : snippet,
        });
      }
    }
  }

  scan(HIGH_RISK_BOUNDARIES, 'high-risk-boundary', 'warning');
  scan(SELF_APPROVAL_PATTERNS, 'self-approval', 'error');
  scan(SCOPE_EXPANSION_PATTERNS, 'scope-expansion', 'error');
  scan(INJECTION_PATTERNS, 'prompt-injection');

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const status = options.dryRun ? 'pass' : (errorCount > 0 ? 'fail' : 'pass');

  return {
    status,
    findings,
    summary: {
      totalFindings: findings.length,
      errors: errorCount,
      warnings: warningCount,
      mode: options.dryRun ? 'dry-run' : 'enforce',
    },
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`Usage: node scripts/guards/check-prompt-policy.js [options]

Prompt policy linter: scans text for constitution violations and
prompt-injection patterns.

Checks:
  1. Self-approval of high-risk boundaries
  2. Weakening of human gates or constitution rules
  3. Agent authority expansion beyond declared scope
  4. Prompt injection markers

Options:
  -f, --file <path>   Read text from file.
  --stdin             Read text from stdin.
  --json              Output result as JSON.
  --dry-run           Report findings without failing (exit 0).
  --help, -h          Show this help.

Exit codes:
  0  pass (or --dry-run)
  1  policy violation detected
  2  usage error

Rule categories:
${HIGH_RISK_BOUNDARIES.map((r) => '  - high-risk-boundary: ' + r.label).join('\n')}
${SELF_APPROVAL_PATTERNS.map((r) => '  - self-approval: ' + r.label).join('\n')}
${SCOPE_EXPANSION_PATTERNS.map((r) => '  - scope-expansion: ' + r.label).join('\n')}
${INJECTION_PATTERNS.map((r) => '  - prompt-injection: ' + r.label).join('\n')}`);
}

function parseArgs(argv) {
  const args = { file: null, stdin: false, json: false, dryRun: false };
  const raw = argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case '-f':
      case '--file':
        i++;
        if (i >= raw.length) { console.error('Error: --file requires a path'); process.exit(2); }
        args.file = raw[i];
        break;
      case '--stdin':
        args.stdin = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${raw[i]}`);
        printHelp();
        process.exit(2);
    }
  }
  return args;
}

function readStdin() {
  return fs.readFileSync(0, 'utf-8');
}

function main() {
  const args = parseArgs(process.argv);

  let text;
  if (args.file) {
    const filePath = path.resolve(args.file);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(2);
    }
    text = fs.readFileSync(filePath, 'utf-8');
  } else if (args.stdin || !process.stdin.isTTY) {
    text = readStdin();
  } else {
    console.error('Error: provide --file <path> or --stdin (or pipe input).');
    printHelp();
    process.exit(2);
  }

  const result = lintPromptPolicy(text, { dryRun: args.dryRun });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.findings.length === 0) {
      console.log('Prompt policy linter passed. No violations found.');
    } else {
      for (const f of result.findings) {
        const icon = f.severity === 'error' ? 'FAIL' : 'WARN';
        console.log(`  ${icon}  [${f.rule}] ${f.label} (line ${f.line})`);
        console.log(`         ${f.snippet}`);
      }
      console.log(`\n${result.summary.errors} error(s), ${result.summary.warnings} warning(s).`);
    }
  }

  const code = args.dryRun ? 0 : (result.status === 'fail' ? 1 : 0);
  process.exit(code);
}

// --- Exports for testing ---

module.exports = {
  lintPromptPolicy,
  parseArgs,
  HIGH_RISK_BOUNDARIES,
  SELF_APPROVAL_PATTERNS,
  SCOPE_EXPANSION_PATTERNS,
  INJECTION_PATTERNS,
};

if (require.main === module) {
  main();
}
