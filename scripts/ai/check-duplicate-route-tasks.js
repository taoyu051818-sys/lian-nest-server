#!/usr/bin/env node

/**
 * check-duplicate-route-tasks.js
 *
 * Dry-run detector for duplicate route/task issues in the planner pipeline.
 * Scans open GitHub issues by label, parses CONTROL APPENDIX metadata, and
 * reports when two or more issues target overlapping routes (allowedFiles).
 *
 * This script NEVER modifies issues or launches workers.  It is read-only.
 *
 * Usage:
 *   node scripts/ai/check-duplicate-route-tasks.js [options]
 *
 * Options:
 *   --label <label>   GitHub issue label (default: agent:codex-action-needed)
 *   --repo <owner/n>  GitHub repo (or set GH_REPO env var)
 *   --json            Output as JSON
 *   --help            Show usage
 *
 * Exit codes:
 *   0 – No duplicates found (or no issues scanned)
 *   1 – Duplicate route conflicts detected
 *   2 – Bad arguments / gh CLI failure
 */

const { execSync } = require('child_process');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.log(`Usage: node check-duplicate-route-tasks.js [options]

Dry-run detector for duplicate route/task issues.

Options:
  --label <label>   GitHub issue label to scan (default: agent:codex-action-needed)
  --repo <owner/n>  GitHub repository in OWNER/NAME format (or set GH_REPO env var)
  --json            Output as JSON instead of console text
  --help            Show this help and exit

Exit codes:
  0  No duplicates found
  1  Duplicate route conflicts detected
  2  Bad arguments or gh CLI failure

Examples:
  # Scan default label
  node scripts/ai/check-duplicate-route-tasks.js --repo owner/name

  # Custom label, JSON output
  node scripts/ai/check-duplicate-route-tasks.js --label my-label --repo owner/name --json`);
}

function parseArgs(argv) {
  const args = { label: 'agent:codex-action-needed', repo: null, json: false };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--label') {
      i++;
      if (i >= argv.length) { console.error('Error: --label requires a value'); process.exit(2); }
      args.label = argv[i];
    } else if (arg === '--repo') {
      i++;
      if (i >= argv.length) { console.error('Error: --repo requires a value'); process.exit(2); }
      args.repo = argv[i];
    } else if (arg === '--json') {
      args.json = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
    i++;
  }
  return args;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg, args) {
  if (!args.json) console.log(msg);
}

function warn(msg, args) {
  if (!args.json) console.error(`[warn] ${msg}`);
}

/**
 * Fetch open issues with the given label via gh CLI.
 * Returns an array of { number, title, body } objects.
 */
function fetchIssues(label, repo) {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const cmd = `gh issue list --label "${label}" --state open --limit 100 ${repoFlag} --json number,title,body`;
  try {
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return JSON.parse(out);
  } catch (err) {
    console.error(`Error: Failed to fetch issues. Is gh CLI authenticated?\n${err.message}`);
    process.exit(2);
  }
}

/**
 * Extract CONTROL APPENDIX metadata from an issue body.
 * Returns { conflictGroup, allowedFiles, forbiddenFiles, targetIssue } or null.
 */
function parseControlAppendix(body) {
  if (!body || !body.includes('CONTROL APPENDIX')) return null;

  const result = { conflictGroup: null, allowedFiles: [], forbiddenFiles: [], targetIssue: null };

  // Extract conflict group
  const cgMatch = body.match(/Conflict\s*group:\s*(.+)/i);
  if (cgMatch) result.conflictGroup = cgMatch[1].trim();

  // Extract target issue
  const tiMatch = body.match(/Target\s*issue:\s*(\d+)/i);
  if (tiMatch) result.targetIssue = parseInt(tiMatch[1], 10);

  // Extract allowed files block
  const allowedMatch = body.match(/Allowed\s*files:\s*\n((?:\s*-\s*.+\n?)+)/i);
  if (allowedMatch) {
    result.allowedFiles = allowedMatch[1]
      .split('\n')
      .map(l => l.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean);
  }

  // Extract forbidden files block
  const forbiddenMatch = body.match(/Forbidden\s*files:\s*\n((?:\s*-\s*.+\n?)+)/i);
  if (forbiddenMatch) {
    result.forbiddenFiles = forbiddenMatch[1]
      .split('\n')
      .map(l => l.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean);
  }

  return result;
}

/**
 * Extract route segments from allowedFiles patterns.
 * E.g. "src/modules/auth/**" -> "auth", "src/api/users.ts" -> "users"
 * Returns a Set of normalized route identifiers.
 */
function extractRoutes(allowedFiles) {
  const routes = new Set();
  for (const pattern of allowedFiles) {
    // Skip very broad patterns like "src/**" or "docs/**"
    const normed = pattern.replace(/\\/g, '/');
    if (normed === 'src/**' || normed === 'docs/**' || normed === '**') continue;

    // Extract meaningful segments
    const segments = normed.split('/').filter(s => s !== '**' && s !== '*' && s !== 'src' && s !== 'docs' && s !== 'scripts');
    for (const seg of segments) {
      // Remove file extensions for route matching
      const clean = seg.replace(/\.(ts|js|vue|md|json)$/, '');
      if (clean && clean !== '*' && clean !== '**') {
        routes.add(clean);
      }
    }
  }
  return routes;
}

/**
 * Check if two route sets overlap.
 */
function routesOverlap(routesA, routesB) {
  for (const r of routesA) {
    if (routesB.has(r)) return true;
  }
  return false;
}

/**
 * Find the overlapping route names between two sets.
 */
function findOverlap(routesA, routesB) {
  const overlap = [];
  for (const r of routesA) {
    if (routesB.has(r)) overlap.push(r);
  }
  return overlap;
}

// ---------------------------------------------------------------------------
// Core detection
// ---------------------------------------------------------------------------

/**
 * Detect duplicate route conflicts across issues.
 * Returns { duplicates: Array, scanned: number }.
 */
function detectDuplicates(issues) {
  const candidates = [];

  for (const issue of issues) {
    const meta = parseControlAppendix(issue.body);
    if (!meta) continue;

    const routes = extractRoutes(meta.allowedFiles);
    if (routes.size === 0) continue;

    candidates.push({
      number: issue.number,
      title: issue.title,
      conflictGroup: meta.conflictGroup,
      allowedFiles: meta.allowedFiles,
      routes,
    });
  }

  const duplicates = [];

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];

      // Conflict if same conflictGroup OR overlapping routes
      const sameGroup = a.conflictGroup && b.conflictGroup && a.conflictGroup === b.conflictGroup;
      const overlappingRoutes = routesOverlap(a.routes, b.routes);

      if (sameGroup || overlappingRoutes) {
        duplicates.push({
          issueA: { number: a.number, title: a.title },
          issueB: { number: b.number, title: b.title },
          conflictGroup: sameGroup ? a.conflictGroup : null,
          overlappingRoutes: overlappingRoutes ? findOverlap(a.routes, b.routes) : [],
          reason: sameGroup ? 'conflict-group' : 'route-overlap',
        });
      }
    }
  }

  return { duplicates, scanned: candidates.length };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printConsole(result, totalIssues) {
  console.log('Duplicate Route / Task Detector');
  console.log('='.repeat(50));
  console.log();
  console.log(`Issues scanned:     ${totalIssues}`);
  console.log(`With metadata:      ${result.scanned}`);
  console.log(`Conflicts found:    ${result.duplicates.length}`);
  console.log();

  if (result.duplicates.length === 0) {
    console.log('OK: No duplicate route/task conflicts detected.');
    return;
  }

  console.log('CONFLICTS:');
  console.log('-'.repeat(50));

  for (const d of result.duplicates) {
    console.log();
    console.log(`  #${d.issueA.number} "${d.issueA.title}"`);
    console.log(`    vs`);
    console.log(`  #${d.issueB.number} "${d.issueB.title}"`);
    console.log(`  Reason: ${d.reason}`);
    if (d.conflictGroup) {
      console.log(`  Conflict group: ${d.conflictGroup}`);
    }
    if (d.overlappingRoutes.length > 0) {
      console.log(`  Overlapping routes: ${d.overlappingRoutes.join(', ')}`);
    }
  }

  console.log();
  console.log('ACTION: Resolve conflicts before launching both tasks in the same or later batch.');
}

function printJson(result, totalIssues) {
  const output = {
    tool: 'check-duplicate-route-tasks',
    totalIssues,
    withMetadata: result.scanned,
    conflictCount: result.duplicates.length,
    duplicates: result.duplicates,
  };
  console.log(JSON.stringify(output, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv);

  const repo = args.repo || process.env.GH_REPO;
  if (!repo) {
    console.error('Error: --repo is required (or set GH_REPO env var).');
    process.exit(2);
  }

  log(`Scanning issues with label "${args.label}" in ${repo}...`, args);

  const issues = fetchIssues(args.label, repo);
  log(`Found ${issues.length} open issue(s).`, args);

  const result = detectDuplicates(issues);

  if (args.json) {
    printJson(result, issues.length);
  } else {
    printConsole(result, issues.length);
  }

  process.exit(result.duplicates.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { parseControlAppendix, extractRoutes, routesOverlap, findOverlap, detectDuplicates };
