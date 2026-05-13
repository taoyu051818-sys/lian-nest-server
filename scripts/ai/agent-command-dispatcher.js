#!/usr/bin/env node

/**
 * agent-command-dispatcher.js
 *
 * Reads agent commands from agent-commands.ndjson and executes them.
 * The agent writes decisions; this dispatcher executes them.
 *
 * Agent writes:  .github/ai-state/agent-commands.ndjson
 * Dispatcher reads and executes each command.
 *
 * Command format:
 *   {"command": "search-and-ingest", "args": {"query": "...", "live": true}}
 *   {"command": "compile-and-launch", "args": {"label": "agent:codex-action-needed", "parallel": 30}}
 *   {"command": "evaluate-workers", "args": {}}
 *   {"command": "top-up-queue", "args": {}}
 *
 * Usage:
 *   node scripts/ai/agent-command-dispatcher.js [--state-dir <path>] [--dry-run]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const COMMANDS_FILE = 'agent-commands.ndjson';
const RESULTS_FILE = 'agent-command-results.ndjson';
const SCRIPT_DIR = __dirname;

// ── Command handlers ─────────────────────────────────────────────────────────

const HANDLERS = {
  'search-and-ingest': (args, stateDir) => {
    const script = path.join(SCRIPT_DIR, 'search-and-ingest.js');
    const cmdArgs = [];
    if (args.query) cmdArgs.push(`--query "${args.query}"`);
    if (args.topics) cmdArgs.push(`--topics "${args.topics}"`);
    if (args.live) cmdArgs.push('--live');
    return execSync(`node "${script}" ${cmdArgs.join(' ')}`, { encoding: 'utf-8', timeout: 60000 });
  },

  'compile-and-launch': (args, stateDir) => {
    const label = args.label || 'agent:codex-action-needed';
    const repo = args.repo || process.env.GH_REPO || '';
    const parallel = args.parallel || 30;

    // Reset worker state
    const activeWorkers = path.join(stateDir, 'active-workers.json');
    const logDir = path.join(stateDir, 'worker-logs');
    fs.writeFileSync(activeWorkers, JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), workers: [] }));
    try { fs.rmSync(logDir, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(logDir, { recursive: true });

    // Clean stale worktrees for issues that would be launched
    try {
      const wtList = execSync('git worktree list --porcelain', { encoding: 'utf-8', timeout: 5000 });
      const worktrees = wtList.split('\n').filter(l => l.startsWith('worktree ')).map(l => l.replace('worktree ', ''));
      for (const wt of worktrees) {
        if (wt.includes('.claude/worktrees/claude/issue-') && !wt.includes('long-bootstrap-agent-first/.claude')) {
          try { execSync(`git worktree remove "${wt}" --force`, { timeout: 5000 }); } catch {}
        }
      }
    } catch {}

    // Clean stale branches
    try {
      const branches = execSync('git branch -l "claude/issue-*"', { encoding: 'utf-8', timeout: 5000 });
      for (const branch of branches.split('\n').map(b => b.replace(/^[+*]\s+/, '').trim()).filter(b => b)) {
        try { execSync(`git branch -D "${branch}"`, { timeout: 5000 }); } catch {}
      }
    } catch {}

    // Compile
    const compileScript = path.join(SCRIPT_DIR, 'compile-issues-to-tasks.js');
    const compileOut = path.join(stateDir, 'compiled-tasks.json');
    const compileResult = execSync(
      `node "${compileScript}" --label "${label}" --repo "${repo}" --stdout`,
      { encoding: 'utf-8', timeout: 30000 }
    );
    const compileData = JSON.parse(compileResult);
    const tasks = compileData.tasks || [];
    fs.writeFileSync(compileOut, JSON.stringify(tasks, null, 2));

    if (tasks.length === 0) {
      return 'No tasks to launch';
    }

    // Launch
    const launchScript = path.join(SCRIPT_DIR, 'batch-launch.ps1');
    const providerPool = path.join(stateDir, 'provider-pool.json');
    const localResource = path.join(stateDir, 'local-resource.json');
    const mainHealth = path.join(stateDir, 'main-health.json');

    return execSync(
      `pwsh -NoProfile -File "${launchScript}" -TaskFile "${compileOut}" -ProviderPoolStatePath "${providerPool}" -LocalResourceStatePath "${localResource}" -MainHealthStatePath "${mainHealth}" -WorkerManifestPath "${activeWorkers}" -LogDir "${logDir}" -Execute -Parallel -MaxParallelWorkers ${parallel}`,
      { encoding: 'utf-8', timeout: 600000 }
    );
  },

  'evaluate-workers': (args, stateDir) => {
    const workersFile = path.join(stateDir, 'active-workers.json');
    if (!fs.existsSync(workersFile)) return 'No active-workers.json found';
    const data = JSON.parse(fs.readFileSync(workersFile, 'utf8'));
    const workers = data.workers || [];
    const completed = workers.filter(w => w.status === 'completed').length;
    const failed = workers.filter(w => w.status === 'failed').length;
    const running = workers.filter(w => w.status === 'running').length;
    return JSON.stringify({ completed, failed, running, total: workers.length });
  },

  'top-up-queue': (args, stateDir) => {
    const script = path.join(SCRIPT_DIR, 'top-up-self-cycle-queue.js');
    return execSync(`node "${script}" --state-dir "${stateDir}" --stdout`, { encoding: 'utf-8', timeout: 30000 });
  },

  'web-search': (args, stateDir) => {
    const script = path.join(SCRIPT_DIR, 'web-search.js');
    const cmdArgs = [];
    if (args.query) cmdArgs.push(`--query "${args.query}"`);
    if (args.maxKeywords) cmdArgs.push(`--max-keywords ${args.maxKeywords}`);
    if (args.limit) cmdArgs.push(`--limit ${args.limit}`);
    cmdArgs.push('--stdout');
    return execSync(`node "${script}" ${cmdArgs.join(' ')}`, { encoding: 'utf-8', timeout: 30000 });
  },
};

// ── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { stateDir: DEFAULT_STATE_DIR, dryRun: false, help: false };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; }
    else if (arg === '--state-dir') { i++; args.stateDir = path.resolve(argv[i]); }
    else if (arg === '--dry-run') { args.dryRun = true; }
    else { console.error(`Unknown argument: ${arg}`); process.exit(2); }
    i++;
  }
  return args;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log('agent-command-dispatcher.js — Execute agent commands from command queue');
    console.log('Usage: node scripts/ai/agent-command-dispatcher.js [--state-dir <path>] [--dry-run]');
    process.exit(0);
  }

  const commandsFile = path.join(args.stateDir, COMMANDS_FILE);
  const resultsFile = path.join(args.stateDir, RESULTS_FILE);

  if (!fs.existsSync(commandsFile)) {
    console.log('No commands file found. Agent needs to write commands first.');
    process.exit(0);
  }

  const lines = fs.readFileSync(commandsFile, 'utf8').split('\n').filter(l => l.trim());
  const results = [];

  for (const line of lines) {
    let cmd;
    try { cmd = JSON.parse(line); } catch { continue; }

    const handler = HANDLERS[cmd.command];
    if (!handler) {
      results.push({ command: cmd.command, status: 'unknown-command', error: `No handler for "${cmd.command}"` });
      continue;
    }

    if (args.dryRun) {
      results.push({ command: cmd.command, status: 'dry-run', args: cmd.args });
      console.log(`[dry-run] ${cmd.command}: ${JSON.stringify(cmd.args || {})}`);
      continue;
    }

    try {
      const output = handler(cmd.args || {}, args.stateDir);
      results.push({ command: cmd.command, status: 'success', output: output.slice(0, 500) });
      console.log(`[ok] ${cmd.command}`);
    } catch (err) {
      results.push({ command: cmd.command, status: 'error', error: err.message });
      console.error(`[fail] ${cmd.command}: ${err.message}`);
    }
  }

  // Write results
  const resultEntry = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    commandsProcessed: lines.length,
    results,
  };
  fs.appendFileSync(resultsFile, JSON.stringify(resultEntry) + '\n', 'utf8');
  console.log(`\nProcessed ${lines.length} command(s). Results written to ${RESULTS_FILE}`);
}

main();
