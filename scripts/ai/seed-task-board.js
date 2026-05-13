#!/usr/bin/env node

/**
 * seed-task-board.js
 *
 * Seeds .github/ai-state/task-board.json from open GitHub issues.
 * Fetches issues via gh CLI, projects them through project-task-board.js,
 * and writes the result. Idempotent — overwrites existing task-board.json.
 *
 * Usage:
 *   node scripts/ai/seed-task-board.js [--repo owner/name] [--out <path>] [--stdout]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(STATE_DIR, 'task-board.json');

// Import projection logic from project-task-board.js
const { buildProjection } = require('./project-task-board.js');

function parseArgs(argv) {
  const args = {
    repo: process.env.GH_REPO || null,
    out: DEFAULT_OUT,
    stdout: false,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; }
    else if (arg === '--repo') { i++; args.repo = argv[i]; }
    else if (arg === '--out') { i++; args.out = path.resolve(argv[i]); }
    else if (arg === '--stdout') { args.stdout = true; }
    else { console.error(`Unknown argument: ${arg}`); process.exit(2); }
    i++;
  }
  return args;
}

function fetchIssues(repo) {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const cmd = `gh issue list --state open --limit 200 ${repoFlag} --json number,title,body,labels`;
  try {
    return JSON.parse(execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }));
  } catch (err) {
    console.error(`Failed to fetch issues: ${err.message}`);
    return [];
  }
}

function fetchOpenPRs(repo) {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const cmd = `gh pr list --state open --limit 200 ${repoFlag} --json number,title,body,headRefName`;
  try {
    return JSON.parse(execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }));
  } catch {
    return [];
  }
}

function readActiveWorkers() {
  const p = path.join(STATE_DIR, 'active-workers.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log('seed-task-board.js — Seed task board from open GitHub issues');
    console.log('Usage: node scripts/ai/seed-task-board.js [--repo owner/name] [--out <path>] [--stdout]');
    process.exit(0);
  }

  const issues = fetchIssues(args.repo);
  const openPRs = fetchOpenPRs(args.repo);
  const activeWorkers = readActiveWorkers();

  const projection = buildProjection(issues, openPRs, activeWorkers, null);
  const json = JSON.stringify(projection, null, 2) + '\n';

  if (args.stdout) {
    process.stdout.write(json);
    return;
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, json, 'utf8');
  console.log(`Task board seeded: ${projection.tasks.length} tasks at ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
}

main();
