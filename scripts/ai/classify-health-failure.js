#!/usr/bin/env node

/**
 * classify-health-failure.js
 *
 * Deterministic classifier for post-merge health gate failures.
 * Reads failure text (combined stdout+stderr) from stdin or a file argument
 * and outputs a JSON classification.
 *
 * Categories:
 *   dependency/generate  — Prisma client missing, npm install/CI failures
 *   runtime compile      — TypeScript or build errors
 *   boundary guard       — Repository boundary violations
 *   docs guard           — Documentation authority violations
 *   unknown              — No pattern matched
 *
 * Usage:
 *   node scripts/ai/classify-health-failure.js < failure-output.txt
 *   node scripts/ai/classify-health-failure.js --file failure-output.txt
 *   node scripts/ai/classify-health-failure.js --text "error output here"
 *   node scripts/ai/classify-health-failure.js --help
 *
 * Exit codes:
 *   0 — classification produced
 *   2 — invalid arguments
 */

'use strict';

const fs = require('fs');

// --- Pattern definitions ---

const PATTERNS = {
  'dependency/generate': [
    /Cannot find module ['"]@prisma\/client['"]/i,
    /Cannot find module ['"]prisma\/config['"]/i,
    /has no exported member ['"]?PrismaClient/i,
    /Property '\$connect' does not exist/i,
    /Property '\$disconnect' does not exist/i,
    /is not assignable to type ['"]PrismaClient['"]/i,
    /npm ERR! code ERESOLVE/i,
    /npm ERR! missing:/i,
    /npm ERR! peer dep/i,
    /npm ci failed/i,
    /prisma generate/i,
    /prisma validate/i,
    /is not part of your project dependency tree/i,
  ],
  'runtime compile': [
    /error TS\d+:/i,
    /Cannot find module ['"][^'"]+['"]/i,
    /Cannot find name ['"][^'"]+['"]/i,
    /Property ['"][^'"]+['"] does not exist on type/i,
    /Argument of type ['"][^'"]+['"] is not assignable/i,
    /nest build/i,
    /Build failed/i,
    /Compilation error/i,
    /Type '.*' is not assignable/i,
  ],
  'boundary guard': [
    /repository boundary/i,
    /boundary guard/i,
    /data-store.*import/i,
    /violates.*boundary/i,
    /check-repository-boundary/i,
    /test:boundary/i,
    /Boundary violation/i,
  ],
  'docs guard': [
    /docs authority/i,
    /documentation.*outdated/i,
    /docs guard/i,
    /check-docs-authority/i,
    /authority.*violation/i,
    /Missing required documentation/i,
  ],
};

// --- Classification logic ---

function classify(text) {
  if (!text || !text.trim()) {
    return { category: 'unknown', matchedPatterns: [], confidence: 'none' };
  }

  const matches = {};

  for (const [category, patterns] of Object.entries(PATTERNS)) {
    const matched = [];
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        matched.push(pattern.source);
      }
    }
    if (matched.length > 0) {
      matches[category] = matched;
    }
  }

  if (Object.keys(matches).length === 0) {
    return { category: 'unknown', matchedPatterns: [], confidence: 'none' };
  }

  // Pick category with most matches; ties broken by definition order.
  let bestCategory = null;
  let bestCount = 0;
  for (const [category, matched] of Object.entries(matches)) {
    if (matched.length > bestCount) {
      bestCategory = category;
      bestCount = matched.length;
    }
  }

  const confidence = bestCount >= 3 ? 'high' : bestCount >= 2 ? 'medium' : 'low';

  return {
    category: bestCategory,
    matchedPatterns: matches[bestCategory],
    confidence,
    allMatches: matches,
  };
}

// --- CLI ---

function printHelp() {
  const help = `
classify-health-failure.js — Deterministic health failure classifier

Usage:
  node scripts/ai/classify-health-failure.js [options]

Options:
  --file <path>   Read failure text from a file
  --text <string> Classify the given string directly
  --help          Show this help message

With no options, reads from stdin.

Categories:
  dependency/generate  Prisma client, npm install/CI, missing dependencies
  runtime compile      TypeScript errors, build failures
  boundary guard       Repository boundary violations
  docs guard           Documentation authority violations
  unknown              No pattern matched

Output:
  JSON object with { category, matchedPatterns, confidence, allMatches }

Exit codes:
  0  Classification produced
  2  Invalid arguments
`.trim();
  console.log(help);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  let text = '';

  const fileIdx = args.indexOf('--file');
  const textIdx = args.indexOf('--text');

  if (fileIdx !== -1) {
    const filePath = args[fileIdx + 1];
    if (!filePath) {
      console.error('Error: --file requires a path argument');
      process.exit(2);
    }
    if (!fs.existsSync(filePath)) {
      console.error(`Error: file not found: ${filePath}`);
      process.exit(2);
    }
    text = fs.readFileSync(filePath, 'utf8');
  } else if (textIdx !== -1) {
    text = args[textIdx + 1] || '';
  } else if (!process.stdin.isTTY) {
    text = await readStdin();
  } else {
    printHelp();
    process.exit(0);
  }

  const result = classify(text);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(err.message);
  process.exit(2);
});
