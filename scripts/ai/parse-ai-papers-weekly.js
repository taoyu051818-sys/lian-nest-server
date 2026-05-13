#!/usr/bin/env node

/**
 * parse-ai-papers-weekly.js
 *
 * Parse dair-ai/AI-Papers-of-the-Week markdown into sanitized weekly source
 * facts. Reads from a file path or stdin. Outputs JSON to stdout.
 *
 * Does NOT create tasks or write fact events — pure parser.
 *
 * Usage:
 *   node scripts/ai/parse-ai-papers-weekly.js --file years/2026.md
 *   node scripts/ai/parse-ai-papers-weekly.js --file README.md --format index
 *   cat years/2026.md | node scripts/ai/parse-ai-papers-weekly.js --stdin
 *   node scripts/ai/parse-ai-papers-weekly.js --help
 *
 * Exit codes:
 *   0 — Success
 *   2 — Invalid arguments or parse error
 */

'use strict';

const fs = require('fs');
const { sanitize } = require('./lib');

// ── Parsing ──────────────────────────────────────────────────────────────────

function parseLinksCell(cell) {
  const links = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(cell)) !== null) {
    links.push({ label: sanitize(m[1]), url: sanitize(m[2]) });
  }
  return links;
}

function parsePaperRow(row) {
  const cells = row.split('|').map(c => c.trim()).filter(Boolean);
  if (cells.length < 2) return null;

  const paperCell = cells[0];
  const linksCell = cells[1];

  const titleMatch = paperCell.match(/\*{2}([^*]+)\*{2}/);
  if (!titleMatch) return null;

  const title = sanitize(titleMatch[1].trim());

  let summary = '';
  const dashIdx = paperCell.indexOf('** - ');
  if (dashIdx !== -1) {
    summary = sanitize(paperCell.slice(dashIdx + 5).trim());
  }

  const links = parseLinksCell(linksCell);
  return { title, summary, links };
}

function parseYearFile(content) {
  const weeks = [];
  const sections = content.split(/^## /m);

  for (const section of sections) {
    const headingMatch = section.match(
      /^Top AI Papers of the Week\s*\(([^)]+)\)\s*-\s*(\d{4})/
    );
    if (!headingMatch) continue;

    const weekRange = headingMatch[1].trim();
    const year = headingMatch[2].trim();
    const papers = [];

    const lines = section.split('\n');
    let inTable = false;
    let headerSkipped = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|')) {
        if (inTable) break;
        continue;
      }

      if (headerSkipped < 2) {
        if (trimmed.includes('**Paper**') || trimmed.includes('---')) {
          headerSkipped++;
          inTable = true;
          continue;
        }
      }

      if (!inTable) continue;

      const paper = parsePaperRow(trimmed);
      if (paper) papers.push(paper);
    }

    weeks.push({
      source: 'dair-ai/AI-Papers-of-the-Week',
      week: weekRange,
      year,
      paperCount: papers.length,
      papers,
    });
  }

  return weeks;
}

function parseIndexFile(content) {
  const years = [];
  const lines = content.split('\n');
  let currentYear = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const yearHeading = trimmed.match(/^##\s+(\d{4})\s*$/);
    if (yearHeading) {
      currentYear = yearHeading[1];
      continue;
    }

    const linkMatch = trimmed.match(/^-\s+\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch && currentYear) {
      years.push({
        year: currentYear,
        label: sanitize(linkMatch[1]),
        path: sanitize(linkMatch[2].split('#')[0]),
      });
    }
  }

  return years;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  process.stdout.write(
    'parse-ai-papers-weekly.js — Parse AI Papers of the Week markdown\n\n' +
    'USAGE\n' +
    '    node scripts/ai/parse-ai-papers-weekly.js [OPTIONS]\n\n' +
    'OPTIONS\n' +
    '    --file <path>       Read markdown from file\n' +
    '    --stdin             Read markdown from stdin\n' +
    '    --format <type>     "year" (default) or "index"\n' +
    '    --help, -h          Show this help\n\n' +
    'Outputs sanitized JSON to stdout. No file writes, no task creation.\n'
  );
}

function parseArgs(argv) {
  const args = { file: null, stdin: false, format: 'year', help: false };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--file') {
      if (++i >= argv.length) { console.error('Error: --file requires a path'); process.exit(2); }
      args.file = argv[i];
    } else if (arg === '--stdin') {
      args.stdin = true;
    } else if (arg === '--format') {
      if (++i >= argv.length) { console.error('Error: --format requires a value'); process.exit(2); }
      if (!['year', 'index'].includes(argv[i])) { console.error('Error: --format must be "year" or "index"'); process.exit(2); }
      args.format = argv[i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }
  return args;
}

function readInput(args) {
  if (args.stdin) return fs.readFileSync(0, 'utf8');
  if (args.file) return fs.readFileSync(args.file, 'utf8');
  console.error('Error: provide --file <path> or --stdin');
  process.exit(2);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); process.exit(0); }

  const content = readInput(args);
  const result = args.format === 'index' ? parseIndexFile(content) : parseYearFile(content);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main();
