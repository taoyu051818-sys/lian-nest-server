#!/usr/bin/env node

/**
 * compile-issues-to-tasks.js
 *
 * Fetches open issues with a given label and compiles their CONTROL APPENDIX
 * into task contract JSON suitable for batch-launch.ps1.
 *
 * Usage:
 *   node scripts/ai/compile-issues-to-tasks.js [--label <label>] [--out <path>] [--stdout]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { REPO_ROOT } = require('./lib');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'compiled-tasks.json');

function parseArgs(argv) {
  const args = { label: 'agent:codex-action-needed', repo: null, out: DEFAULT_OUT, stdout: false, help: false };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; }
    else if (arg === '--label') { i++; args.label = argv[i]; }
    else if (arg === '--repo') { i++; args.repo = argv[i]; }
    else if (arg === '--out') { i++; args.out = path.resolve(argv[i]); }
    else if (arg === '--stdout') { args.stdout = true; }
    else { console.error(`Unknown argument: ${arg}`); process.exit(2); }
    i++;
  }
  return args;
}

function fetchIssues(repo, label) {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const cmd = `gh issue list --state open --label "${label}" --limit 100 ${repoFlag} --json number,title,body,labels`;
  try {
    return JSON.parse(execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }));
  } catch (err) {
    console.error(`Failed to fetch issues: ${err.message}`);
    return [];
  }
}

function parseControlAppendix(body) {
  if (!body) return null;

  const taskType = extractField(body, 'Task type');
  const risk = extractField(body, 'Risk');
  const conflictGroup = extractField(body, 'Conflict group');
  const actorRole = extractField(body, 'Actor role');
  const allowedFiles = extractList(body, 'Allowed files');
  const forbiddenFiles = extractList(body, 'Forbidden files');
  const validationCommands = extractList(body, 'Validation commands');

  if (!conflictGroup || !allowedFiles || allowedFiles.length === 0) return null;

  return {
    taskType: taskType || 'execution',
    risk: risk || 'low',
    conflictGroup,
    allowedFiles,
    forbiddenFiles: forbiddenFiles.length > 0 ? forbiddenFiles : ['src/**', 'prisma/**', 'package.json'],
    validationCommands: validationCommands.length > 0 ? validationCommands : ['npm run check'],
    rolePacket: { actorRole: actorRole || 'automation-cycle-worker', description: '' },
  };
}

function extractField(body, fieldName) {
  const re = new RegExp(`${fieldName}:\\s*(.+)`, 'i');
  const match = body.match(re);
  return match ? match[1].trim() : null;
}

function extractList(body, sectionName) {
  const re = new RegExp(`${sectionName}:\\s*\\n((?:- .+\\n?)+)`, 'i');
  const match = body.match(re);
  if (!match) return [];
  return match[1].split('\n')
    .map(l => l.replace(/^- /, '').trim())
    .filter(l => l.length > 0);
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log('compile-issues-to-tasks.js — Compile GitHub issues into task contracts');
    console.log('Usage: node scripts/ai/compile-issues-to-tasks.js [--label <label>] [--out <path>] [--stdout]');
    process.exit(0);
  }

  const issues = fetchIssues(args.repo, args.label);
  const tasks = [];
  const skipped = [];

  for (const issue of issues) {
    const contract = parseControlAppendix(issue.body || '');
    if (contract) {
      tasks.push({
        targetIssue: issue.number,
        title: issue.title,
        ...contract,
      });
    } else {
      skipped.push({ number: issue.number, title: issue.title, reason: 'no valid CONTROL APPENDIX' });
    }
  }

  const output = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    sourceLabel: args.label,
    totalIssues: issues.length,
    compiledTasks: tasks.length,
    skippedCount: skipped.length,
    tasks,
    skipped,
  };

  const json = JSON.stringify(output, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  console.log(`Compiled ${tasks.length}/${issues.length} issues into task contracts`);
  console.log(`Written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);

  if (skipped.length > 0) {
    console.log(`Skipped: ${skipped.map(s => `#${s.number}`).join(', ')}`);
  }
}

main();
