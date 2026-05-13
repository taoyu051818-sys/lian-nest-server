#!/usr/bin/env node

/**
 * hook-forbidden-files-enforcer.js
 *
 * Claude Code PreToolUse hook that blocks Write/Edit/NotebookEdit calls
 * targeting forbidden files. Provides real-time defense-in-depth for
 * seed-constitution enforcement at the tool-call level.
 *
 * Pattern sources (priority order):
 *   1. FORBIDDEN_FILES env var (JSON array string)
 *   2. TASK_MANIFEST env var (path to JSON with forbiddenFiles array)
 *   3. Built-in defaults (.env, node_modules, dist, .git)
 *
 * Exit codes:
 *   0 — allow (file not forbidden)
 *   2 — block (file matches forbidden pattern)
 *
 * Stdin: JSON from Claude Code { tool_name, tool_input }
 * Stderr: structured JSON on block
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Default forbidden patterns (seed-constitution rule 1) ────────────────

const DEFAULT_FORBIDDEN = [
  '.env',
  '.env.*',
  'node_modules/**',
  'dist/**',
  '.git/**',
];

// ── Glob matching (same engine as check-task-boundary.js) ────────────────

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
      const end = pattern.indexOf('}', i);
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

function matchesAny(filePath, patterns) {
  const normed = filePath.replace(/\\/g, '/');
  return patterns.some((pat) => globToRegex(pat).test(normed));
}

// ── Pattern loading ──────────────────────────────────────────────────────

function loadForbiddenPatterns() {
  // Priority 1: explicit env var
  const envPatterns = process.env.FORBIDDEN_FILES;
  if (envPatterns) {
    try {
      const parsed = JSON.parse(envPatterns);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through
    }
  }

  // Priority 2: task manifest
  const manifestPath = process.env.TASK_MANIFEST;
  if (manifestPath && fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (Array.isArray(manifest.forbiddenFiles) && manifest.forbiddenFiles.length > 0) {
        return manifest.forbiddenFiles;
      }
    } catch {
      // fall through
    }
  }

  // Priority 3: defaults
  return DEFAULT_FORBIDDEN;
}

// ── File path extraction ─────────────────────────────────────────────────

function extractFilePath(input) {
  const toolName = input.tool_name;
  const toolInput = input.tool_input || {};

  if (toolName === 'Write' || toolName === 'Edit') {
    return toolInput.file_path || null;
  }
  if (toolName === 'NotebookEdit') {
    return toolInput.notebook_path || null;
  }
  return null;
}

// ── Stdin reader ─────────────────────────────────────────────────────────

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  const raw = readStdin();
  if (!raw || raw.trim().length === 0) {
    // No input — allow silently
    process.exit(0);
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Malformed JSON — allow silently
    process.exit(0);
  }

  const filePath = extractFilePath(input);
  if (!filePath) {
    // Not a file-writing tool — allow silently
    process.exit(0);
  }

  const patterns = loadForbiddenPatterns();
  const normed = filePath.replace(/\\/g, '/');
  const matched = patterns.filter((pat) => globToRegex(pat).test(normed));

  if (matched.length > 0) {
    const result = {
      status: 'blocked',
      tool: input.tool_name,
      file: normed,
      matchedPatterns: matched,
      reason:
        `File "${normed}" matches forbidden pattern(s): ${matched.join(', ')}. ` +
        'This file requires human approval per seed-constitution rule 1 ' +
        '(High-Risk Human-Required Boundaries).',
    };
    process.stderr.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(2);
  }

  // File is allowed
  process.exit(0);
}

main();
