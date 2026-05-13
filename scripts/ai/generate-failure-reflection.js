#!/usr/bin/env node

/**
 * generate-failure-reflection.js
 *
 * Produces a structured self-critique (reflexion-style reflection) from
 * a classify-self-cycle-failure.js classification output.
 *
 * Reads classifier JSON from stdin, a file, or --text argument.
 * Optionally queries the gap ledger for similar past failures.
 * Outputs a reflection JSON object suitable for embedding in gap ledger
 * meta.reflection.
 *
 * Based on the Reflexion framework (Shinn et al., 2023):
 * agents improve by generating verbal self-critiques after failures,
 * storing them in episodic memory, and referencing them in subsequent
 * attempts.
 *
 * Usage:
 *   node scripts/ai/classify-self-cycle-failure.js --step compile --file err.txt \
 *     | node scripts/ai/generate-failure-reflection.js
 *
 *   node scripts/ai/generate-failure-reflection.js --file classification.json
 *   node scripts/ai/generate-failure-reflection.js --text '{"errorClass":"TASK_CONTRACT_INVALID",...}'
 *   node scripts/ai/generate-failure-reflection.js --file classification.json --ledger .github/ai-state/gap-ledger.ndjson
 *   node scripts/ai/generate-failure-reflection.js --help
 *
 * Exit codes:
 *   0 — reflection produced
 *   2 — invalid arguments or unparseable input
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_LEDGER = path.join(REPO_ROOT, '.github', 'ai-state', 'gap-ledger.ndjson');
const REFLECTION_VERSION = 1;
const MAX_PAST_REFLECTIONS = 5;

// ── Critique templates ──────────────────────────────────────────────────────
// Each error class has a template that produces a specific, actionable
// critique from the classifier output. The templates are deterministic —
// no LLM call required.

const CRITIQUE_TEMPLATES = {
  TASK_CONTRACT_INVALID: (cls) => ({
    critique: `The task contract failed validation: ${cls.matchedPatterns.join(', ')}. ${cls.likelyCause}`,
    rootCause: 'The compile script produced an incomplete or invalid task contract.',
    nextAction: 'Re-run compile-issue-to-task-json.ps1 with a corrected issue body, or manually fix the missing fields in the task JSON before retrying.',
  }),

  ISSUE_BODY_PARSE_BLEED: (cls) => ({
    critique: `The issue body parser extracted content from the wrong section: ${cls.matchedPatterns.join(', ')}. ${cls.likelyCause}`,
    rootCause: 'Regex for CONTROL APPENDIX fields matched content outside the intended section.',
    nextAction: 'Check the issue body format. Ensure CONTROL APPENDIX sections use clear delimiters. Consider tightening the regex to stop at section boundaries.',
  }),

  RUNNER_STRICT_MODE_VARIABLE: (cls) => {
    const varMatch = cls.matchedPatterns.find(p => p.includes('targetPrText'));
    const varName = varMatch ? 'targetPR' : 'an optional task field';
    return {
      critique: `PowerShell strict mode crashed because ${varName} was accessed without a null guard. ${cls.likelyCause}`,
      rootCause: `The run-claude-print.ps1 script accesses ${varName} without checking if it is set.`,
      nextAction: `Add a Has-Prop or Get-OptionalField guard for ${varName} in run-claude-print.ps1 before accessing it.`,
    };
  },

  BATCH_SINGLE_TASK_MISMATCH: (cls) => ({
    critique: `The batch launcher dispatched a multi-task file to a single-task worker, or the branch issue number did not match any task: ${cls.matchedPatterns.join(', ')}. ${cls.likelyCause}`,
    rootCause: 'batch-launch.ps1 forwarded the batch file directly instead of extracting the individual task, or the branch naming convention is wrong.',
    nextAction: 'Verify that batch-launch.ps1 writes a single-task temp file per worker. Check branch naming convention matches the issue number.',
  }),

  PROVIDER_UNAVAILABLE: (cls) => ({
    critique: `All API providers are exhausted or unavailable: ${cls.matchedPatterns.join(', ')}. ${cls.likelyCause}`,
    rootCause: 'Provider cooldown has not expired, credentials are invalid, or concurrency limits are too low.',
    nextAction: 'Check provider-pool.json status. Wait for cooldown to expire, fix credentials, or increase concurrency limits. Consider adding a provider rotation fallback.',
  }),

  DISK_PRESSURE: (cls) => ({
    critique: `Local resources are critically low: ${cls.matchedPatterns.join(', ')}. ${cls.likelyCause}`,
    rootCause: 'Too many concurrent workers, large worktrees, or disk space exhausted.',
    nextAction: 'Run worktree-janitor.ps1 to clean stale worktrees, reduce batch size, or free disk space before retrying.',
  }),

  WORKTREE_STALE: (cls) => ({
    critique: `A git worktree is stale, locked, or corrupted: ${cls.matchedPatterns.join(', ')}. ${cls.likelyCause}`,
    rootCause: 'A previous worker run left a worktree that was not cleaned up, or the worktree lock file is present.',
    nextAction: 'Run worktree-janitor.ps1 to clean stale worktrees, or manually remove the worktree directory before retrying.',
  }),

  HUMAN_REQUIRED: (cls) => ({
    critique: `A gate or policy requires a human decision: ${cls.matchedPatterns.join(', ')}. ${cls.likelyCause}`,
    rootCause: 'High-risk task, main branch health is red/black, or a human-required label is present.',
    nextAction: 'Review the gate report and make the required decision (approve, override, or skip). Do not retry until the human decision is made.',
  }),

  UNKNOWN_CONTROL_PLANE_FAILURE: (cls) => ({
    critique: `The self-cycle failed with an unrecognized error pattern. ${cls.likelyCause}`,
    rootCause: 'A new failure mode that the classifier does not yet recognize.',
    nextAction: 'Review the full error output. If this is a recurring pattern, add it to classify-self-cycle-failure.js with appropriate regex patterns.',
  }),
};

// ── Reflection generation ────────────────────────────────────────────────────

function generateReflection(classification, pastReflections) {
  const template = CRITIQUE_TEMPLATES[classification.errorClass];
  if (!template) {
    return {
      version: REFLECTION_VERSION,
      critique: classification.humanSummary || 'Unknown failure.',
      rootCause: classification.likelyCause || 'Unknown cause.',
      nextAction: classification.recommendedAction || 'Review the error output manually.',
      similarPastCount: pastReflections.length,
      reflectionId: `refl-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Date.now()).slice(-6)}`,
    };
  }

  const { critique, rootCause, nextAction } = template(classification);

  return {
    version: REFLECTION_VERSION,
    critique,
    rootCause,
    nextAction,
    similarPastCount: pastReflections.length,
    reflectionId: `refl-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Date.now()).slice(-6)}`,
  };
}

// ── Gap ledger query ─────────────────────────────────────────────────────────

function queryPastReflections(ledgerPath, errorClass) {
  if (!fs.existsSync(ledgerPath)) {
    return [];
  }

  const content = fs.readFileSync(ledgerPath, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  const reflections = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (
        entry.meta &&
        entry.meta.reflection &&
        entry.meta.errorClass === errorClass
      ) {
        reflections.push(entry.meta.reflection);
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Return the most recent N reflections
  return reflections.slice(-MAX_PAST_REFLECTIONS);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
generate-failure-reflection.js — Reflexion-style self-critique generator (v1)

Produces a structured self-critique from a classify-self-cycle-failure.js
classification output. Based on the Reflexion framework (Shinn et al., 2023):
agents improve by generating verbal self-critiques after failures, storing
them in episodic memory, and referencing them in subsequent attempts.

Usage:
  node scripts/ai/classify-self-cycle-failure.js --step compile --file err.txt \\
    | node scripts/ai/generate-failure-reflection.js

  node scripts/ai/generate-failure-reflection.js --file classification.json
  node scripts/ai/generate-failure-reflection.js --text '{"errorClass":"TASK_CONTRACT_INVALID",...}'
  node scripts/ai/generate-failure-reflection.js --help

Options:
  --file <path>     Read classifier JSON from a file
  --text <string>   Classify the given JSON string directly
  --ledger <path>   Gap ledger path for querying past reflections
                    (default: .github/ai-state/gap-ledger.ndjson)
  --no-ledger       Skip querying the gap ledger
  --help            Show this help message

With no --file/--text, reads from stdin.

Input:
  JSON object from classify-self-cycle-failure.js with at minimum:
  errorClass, humanSummary, likelyCause, recommendedAction, matchedPatterns

Output:
  JSON object with: version, critique, rootCause, nextAction,
  similarPastCount, reflectionId

Exit codes:
  0  Reflection produced
  2  Invalid arguments or unparseable input
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
  let ledgerPath = DEFAULT_LEDGER;
  let skipLedger = false;

  const fileIdx = args.indexOf('--file');
  const textIdx = args.indexOf('--text');
  const ledgerIdx = args.indexOf('--ledger');

  if (ledgerIdx !== -1) {
    ledgerPath = args[ledgerIdx + 1] || DEFAULT_LEDGER;
  }

  if (args.includes('--no-ledger')) {
    skipLedger = true;
  }

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

  // Parse classifier output
  let classification;
  try {
    classification = JSON.parse(text);
  } catch (err) {
    console.error(`Error: input is not valid JSON: ${err.message}`);
    process.exit(2);
  }

  if (!classification.errorClass) {
    console.error('Error: input JSON must contain an "errorClass" field');
    process.exit(2);
  }

  // Query past reflections from gap ledger
  const pastReflections = skipLedger
    ? []
    : queryPastReflections(ledgerPath, classification.errorClass);

  // Generate reflection
  const reflection = generateReflection(classification, pastReflections);

  console.log(JSON.stringify(reflection, null, 2));
}

main().catch(err => {
  console.error(err.message);
  process.exit(2);
});
