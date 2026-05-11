#!/usr/bin/env node

/**
 * check-route-parity.js
 *
 * Guard script for route parity docs:
 *   1. Parses docs/migration/route-parity-tracker.md and reports migration status.
 *   2. Parses docs/migration/route-parity-matrix.md and validates that the
 *      Progress Summary counts match the actual matrix row counts.
 *
 * Run: node scripts/check-route-parity.js
 *
 * Exit codes:
 *   0 -- All checks pass
 *   1 -- Parse error, missing file, or summary count mismatch
 */

const fs = require('fs');
const path = require('path');

const TRACKER_PATH = path.join(__dirname, '..', 'docs', 'migration', 'route-parity-tracker.md');
const MATRIX_PATH = path.join(__dirname, '..', 'docs', 'migration', 'route-parity-matrix.md');

function parseTracker(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: Tracker file not found: ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const families = [];
  let inFamilyTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect start of the status table (header row followed by separator)
    if (trimmed.startsWith('| Family') && trimmed.includes('Status')) {
      inFamilyTable = true;
      continue;
    }

    // Skip separator line
    if (inFamilyTable && /^\|[-\s|]+\|$/.test(trimmed)) {
      continue;
    }

    // Parse table rows
    if (inFamilyTable && trimmed.startsWith('|')) {
      const cells = trimmed
        .split('|')
        .map(c => c.trim())
        .filter(c => c.length > 0);

      if (cells.length >= 2) {
        families.push({
          family: cells[0],
          status: cells[1],
          module: cells[2] || '',
          issue: cells[3] || '',
          notes: cells[4] || '',
        });
      }
    } else if (inFamilyTable && !trimmed.startsWith('|') && trimmed.length > 0) {
      // Left the table
      inFamilyTable = false;
    }
  }

  return families;
}

function report(families) {
  const counts = { VERIFIED: 0, MIGRATED: 0, IN_PROGRESS: 0, UNMIGRATED: 0 };

  console.log('Route Parity Report');
  console.log('='.repeat(50));
  console.log();

  for (const f of families) {
    const status = f.status.toUpperCase();
    const marker = status === 'UNMIGRATED' ? '[ ]' :
                   status === 'IN_PROGRESS' ? '[~]' :
                   status === 'MIGRATED'    ? '[x]' :
                   status === 'VERIFIED'    ? '[X]' : '[?]';

    console.log(`  ${marker} ${f.family.padEnd(16)} ${f.status.padEnd(14)} ${f.module}`);
    if (counts[status] !== undefined) {
      counts[status]++;
    }
  }

  console.log();
  console.log('Summary:');
  console.log(`  VERIFIED:     ${counts.VERIFIED}`);
  console.log(`  MIGRATED:     ${counts.MIGRATED}`);
  console.log(`  IN_PROGRESS:  ${counts.IN_PROGRESS}`);
  console.log(`  UNMIGRATED:   ${counts.UNMIGRATED}`);
  console.log(`  Total:        ${families.length}`);
  console.log();

  const pct = families.length > 0
    ? Math.round(((counts.VERIFIED + counts.MIGRATED) / families.length) * 100)
    : 0;
  console.log(`Parity: ${pct}% (${counts.VERIFIED + counts.MIGRATED}/${families.length} families complete)`);
}

// ─── Route Parity Matrix Guard ───────────────────────────────────────────────

const MATRIX_STATUSES = ['NOT_STARTED', 'CONTRACTED', 'IMPLEMENTED', 'PARITY_TESTED', 'LEGACY_DISABLED'];

/**
 * Parse the route-parity-matrix.md file and return:
 *   - rows: counted statuses from all family endpoint tables
 *   - summary: declared counts from the Progress Summary section
 */
function parseMatrix(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: Matrix file not found: ${filePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const rows = {};
  for (const s of MATRIX_STATUSES) rows[s] = 0;

  const summary = {};
  let inFamilyTable = false;
  let inSummarySection = false;
  let summaryHeaderSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect family section header (### AUTH — Authentication)
    if (trimmed.startsWith('### ') && trimmed.includes('—')) {
      inFamilyTable = false;
      inSummarySection = false;
    }

    // Detect start of an endpoint table (header with "endpoint" and "status")
    if (trimmed.startsWith('| endpoint') && trimmed.includes('status')) {
      inFamilyTable = true;
      summaryHeaderSeen = false;
      continue;
    }

    // Detect Progress Summary section
    if (trimmed === '## Progress Summary') {
      inSummarySection = true;
      inFamilyTable = false;
      continue;
    }

    // Detect end of a section (next ## heading)
    if (trimmed.startsWith('## ') && trimmed !== '## Progress Summary') {
      inSummarySection = false;
      inFamilyTable = false;
    }

    // Skip separator lines
    if (/^\|[-\s|]+\|$/.test(trimmed)) {
      continue;
    }

    // Count statuses from family endpoint tables
    if (inFamilyTable && trimmed.startsWith('|')) {
      const cells = trimmed
        .split('|')
        .map(c => c.trim())
        .filter(c => c.length > 0);

      if (cells.length >= 4) {
        const status = cells[3].replace(/`/g, '').trim();
        if (rows[status] !== undefined) {
          rows[status]++;
        }
      }
    }

    // Parse Progress Summary table
    if (inSummarySection && trimmed.startsWith('|')) {
      const cells = trimmed
        .split('|')
        .map(c => c.trim())
        .filter(c => c.length > 0);

      if (cells.length >= 2) {
        const label = cells[0].replace(/[`*]/g, '').trim();
        const count = parseInt(cells[1].replace(/[`*]/g, '').trim(), 10);
        if (!isNaN(count)) {
          if (MATRIX_STATUSES.includes(label)) {
            summary[label] = count;
          } else if (label === 'Total') {
            summary['Total'] = count;
          }
        }
      }
    }
  }

  return { rows, summary };
}

/**
 * Compare matrix row counts against the Progress Summary and report mismatches.
 * Returns true if counts match, false otherwise.
 */
function validateMatrix(filePath) {
  console.log('Route Parity Matrix Guard');
  console.log('='.repeat(50));
  console.log();

  const { rows, summary } = parseMatrix(filePath);

  let ok = true;

  console.log('Matrix row counts vs Progress Summary:');
  console.log(`  ${'Status'.padEnd(16)} ${'Rows'.padEnd(8)} ${'Summary'.padEnd(10)} Match`);
  console.log(`  ${'─'.repeat(16)} ${'─'.repeat(8)} ${'─'.repeat(10)} ${'─'.repeat(5)}`);

  for (const s of MATRIX_STATUSES) {
    const rowCount = rows[s] || 0;
    const summaryCount = summary[s];
    const match = summaryCount !== undefined && summaryCount === rowCount;
    const marker = match ? 'OK' : summaryCount === undefined ? 'MISSING' : 'MISMATCH';
    if (!match) ok = false;

    console.log(`  ${s.padEnd(16)} ${String(rowCount).padEnd(8)} ${summaryCount !== undefined ? String(summaryCount).padEnd(10) : '—'.padEnd(10)} ${marker}`);
  }

  const rowTotal = Object.values(rows).reduce((a, b) => a + b, 0);
  const summaryTotal = summary['Total'];
  const totalMatch = summaryTotal !== undefined && summaryTotal === rowTotal;
  if (!totalMatch) ok = false;
  console.log(`  ${'Total'.padEnd(16)} ${String(rowTotal).padEnd(8)} ${summaryTotal !== undefined ? String(summaryTotal).padEnd(10) : '—'.padEnd(10)} ${totalMatch ? 'OK' : summaryTotal === undefined ? 'MISSING' : 'MISMATCH'}`);

  console.log();

  if (!ok) {
    console.error('FAIL: Progress Summary counts do not match matrix rows.');
    console.error('Update docs/migration/route-parity-matrix.md Progress Summary to match actual rows.');
    return false;
  }

  console.log('OK: Progress Summary counts match matrix rows.');
  return true;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const families = parseTracker(TRACKER_PATH);
report(families);

const matrixOk = validateMatrix(MATRIX_PATH);
if (!matrixOk) {
  process.exit(1);
}
