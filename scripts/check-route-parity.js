#!/usr/bin/env node

/**
 * check-route-parity.js
 *
 * Parses docs/migration/route-parity-tracker.md and reports migration status.
 * Run: node scripts/check-route-parity.js
 *
 * Exit codes:
 *   0 -- All families have a status (informational)
 *   1 -- Parse error or missing tracker file
 */

const fs = require('fs');
const path = require('path');

const TRACKER_PATH = path.join(__dirname, '..', 'docs', 'migration', 'route-parity-tracker.md');

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

const families = parseTracker(TRACKER_PATH);
report(families);
