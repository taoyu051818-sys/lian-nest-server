#!/usr/bin/env node

/**
 * check-pr-handoff.js
 *
 * Validates that a PR body contains all required handoff sections for AI worker PRs.
 *
 * Usage:
 *   echo "$PR_BODY" | node scripts/guards/check-pr-handoff.js
 *   node scripts/guards/check-pr-handoff.js --file pr-body.md
 *   node scripts/guards/check-pr-handoff.js --json --file pr-body.md
 */

const fs = require('fs');

const REQUIRED_SECTIONS = [
  { canonical: 'Summary',           aliases: ['summary', 'overview'] },
  { canonical: 'Changed files',     aliases: ['changed files', 'files changed', 'changes'] },
  { canonical: 'Linked issues',     aliases: ['linked issues', 'linked issue', 'issue', 'issues'] },
  { canonical: 'Validation',        aliases: ['validation', 'validation commands', 'test plan', 'testing'] },
  { canonical: 'Non-goals',         aliases: ['non-goals', 'non goals', 'nongoals', 'out of scope'] },
  { canonical: 'Risk / rollback',   aliases: ['risk / rollback', 'risk', 'rollback', 'risk/rollback', 'risk & rollback'] },
  { canonical: 'Follow-up handoff', aliases: ['follow-up handoff', 'follow up handoff', 'handoff', 'follow-up'] },
];

function headingMatches(line, section) {
  const normalized = line.replace(/^#+\s*/, '').trim().toLowerCase();
  return section.aliases.some((alias) => normalized === alias);
}

function findSections(body) {
  const lines = body.split('\n');
  const found = new Set();
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      for (const section of REQUIRED_SECTIONS) {
        if (headingMatches(line, section)) {
          found.add(section.canonical);
        }
      }
    }
  }
  return found;
}

function extractSectionBody(body, sectionAliases) {
  const lines = body.split('\n');
  let capturing = false;
  const collected = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      const normalized = line.replace(/^#+\s*/, '').trim().toLowerCase();
      if (sectionAliases.some((a) => a === normalized)) {
        capturing = true;
        continue;
      } else if (capturing) {
        break;
      }
    } else if (capturing) {
      collected.push(line);
    }
  }
  return collected.join('\n');
}

function validateEvidence(body) {
  const validationSection = REQUIRED_SECTIONS.find((s) => s.canonical === 'Validation');
  const sectionText = extractSectionBody(body, validationSection.aliases);
  const warnings = [];

  if (!sectionText.trim()) {
    warnings.push('Validation section is empty — no evidence provided');
    return warnings;
  }

  const hasPassOrFail = /^.*\b(PASS|FAIL)\b/im.test(sectionText);
  if (!hasPassOrFail) {
    warnings.push('Validation section has no PASS/FAIL results — evidence is incomplete');
  }

  return warnings;
}

function validate(body) {
  const found = findSections(body);
  const missing = REQUIRED_SECTIONS
    .map((s) => s.canonical)
    .filter((name) => !found.has(name));

  const warnings = [];
  if (found.has('Validation')) {
    warnings.push(...validateEvidence(body));
  }

  return { ok: missing.length === 0, found: [...found], missing, warnings };
}

function parseArgs(argv) {
  const args = { json: false, file: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--json') {
      args.json = true;
    } else if (argv[i] === '--file' && i + 1 < argv.length) {
      args.file = argv[++i];
    }
  }
  return args;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

async function main() {
  const args = parseArgs(process.argv);

  let body;
  if (args.file) {
    body = fs.readFileSync(args.file, 'utf-8');
  } else {
    body = await readStdin();
  }

  const result = validate(body);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('PR handoff guard passed.');
    console.log('Found sections: ' + result.found.join(', '));
    if (result.warnings.length > 0) {
      console.warn('Warnings:');
      for (const w of result.warnings) {
        console.warn('  ⚠ ' + w);
      }
    }
  } else {
    console.error('PR handoff guard FAILED.');
    console.error('Missing required sections:');
    for (const name of result.missing) {
      console.error('  - ' + name);
    }
  }

  process.exit(result.ok ? 0 : 1);
}

// Exported for testing
module.exports = { validate, findSections, headingMatches, extractSectionBody, validateEvidence, REQUIRED_SECTIONS };

if (require.main === module) {
  main();
}
