#!/usr/bin/env node

/**
 * hook-forbidden-files-enforcer.js
 *
 * Claude Code PreToolUse hook that blocks Write/Edit/NotebookEdit calls
 * targeting files matching the task contract's forbiddenFiles patterns.
 *
 * Reads tool call JSON from stdin, loads forbiddenFiles from the task
 * manifest pointed to by LIAN_WORKER_TASK_FILE, and exits 2 (block)
 * if the target file matches any forbidden pattern.
 *
 * Hook protocol:
 *   stdin  – { tool_name, tool_input }
 *   exit 0 – allow (no output)
 *   exit 2 – block (reason on stderr)
 *
 * Usage (in .claude/settings.json):
 *   { "hooks": { "Write": [{ "type": "command",
 *       "command": "node scripts/ai/hook-forbidden-files-enforcer.js" }] } }
 */

const fs = require('fs');

// ---------------------------------------------------------------------------
// Glob matcher (shared logic with scripts/guards/check-task-boundary.js)
// ---------------------------------------------------------------------------

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegex(pattern) {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i += 2;
      if (pattern[i] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
      i++;
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if (c === '.') {
      re += '\\.';
      i++;
    } else if (c === '{') {
      let end = pattern.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        i++;
      } else {
        const alternatives = pattern.slice(i + 1, end).split(',');
        re += '(?:' + alternatives.map(escapeRegex).join('|') + ')';
        i = end + 1;
      }
    } else {
      re += escapeRegex(c);
      i++;
    }
  }
  return new RegExp('^' + re + '$');
}

function normalise(p) {
  return p.replace(/\\/g, '/');
}

function matchesAny(filePath, patterns) {
  const normed = normalise(filePath);
  return patterns.filter((pat) => globToRegex(pat).test(normed));
}

// ---------------------------------------------------------------------------
// Shared lock definitions (mirrors scripts/guards/check-task-boundary.js)
// ---------------------------------------------------------------------------

const SHARED_LOCK_MAP = {
  'package': ['package.json', 'package-lock.json'],
  'prisma-schema': ['prisma/**'],
  'app-module': ['src/app.module.ts'],
  'docs-index': ['docs/**/*.md'],
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  let input;
  try {
    const raw = fs.readFileSync(0, 'utf-8');
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const { tool_name, tool_input } = input;
  if (!tool_name || !tool_input) process.exit(0);

  const filePath = tool_name === 'NotebookEdit'
    ? tool_input.notebook_path
    : tool_input.file_path;
  if (!filePath) process.exit(0);

  const taskFile = process.env.LIAN_WORKER_TASK_FILE;
  if (!taskFile) process.exit(0);

  let task;
  try {
    task = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
  } catch {
    process.exit(0);
  }

  const forbidden = Array.isArray(task.forbiddenFiles) ? task.forbiddenFiles : [];
  if (forbidden.length === 0) process.exit(0);

  // Check forbidden patterns
  const matched = matchesAny(filePath, forbidden);
  if (matched.length > 0) {
    const normed = normalise(filePath);
    const result = {
      status: 'blocked',
      tool: tool_name,
      file: normed,
      matchedPatterns: matched,
      reason: `File "${normed}" matches forbidden pattern(s): ${matched.join(', ')}. ` +
        `This file is outside the task boundary. Report the blocker on the issue instead.`,
    };
    process.stderr.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(2);
  }

  // Check if file is outside allowedFiles (defense-in-depth)
  const allowed = Array.isArray(task.allowedFiles) ? task.allowedFiles : [];
  if (allowed.length > 0) {
    const declaredLocks = Array.isArray(task.sharedLocks) ? task.sharedLocks : [];
    const unlockedPatterns = [];
    for (const lock of declaredLocks) {
      const patterns = SHARED_LOCK_MAP[lock];
      if (patterns) unlockedPatterns.push(...patterns);
    }

    const normed = normalise(filePath);
    const inAllowed = matchesAny(normed, allowed).length > 0;
    const unlocked = unlockedPatterns.length > 0 && matchesAny(normed, unlockedPatterns).length > 0;

    if (!inAllowed && !unlocked) {
      const result = {
        status: 'blocked',
        tool: tool_name,
        file: normed,
        reason: `File "${normed}" is outside allowedFiles. ` +
          `Report the blocker on the issue instead of editing out-of-scope files.`,
      };
      process.stderr.write(JSON.stringify(result, null, 2) + '\n');
      process.exit(2);
    }
  }

  process.exit(0);
}

main();
