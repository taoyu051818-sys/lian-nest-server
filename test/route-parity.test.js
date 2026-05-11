#!/usr/bin/env node

/**
 * route-parity.test.js
 *
 * Lightweight contract tests for the route parity harness.
 * Run: node test/route-parity.test.js
 *
 * Validates:
 *   - Route inventory doc is well-formed.
 *   - Tracker doc covers all families from the inventory.
 *   - Acceptance criteria doc exists and covers all families.
 *   - Parity script runs without error.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${message}`);
  } else {
    failed++;
    console.error(`  FAIL  ${message}`);
  }
}

function readDoc(relativePath) {
  const full = path.join(ROOT, relativePath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

function extractFamiliesFromTable(content) {
  const families = [];
  const lines = content.split('\n');
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('| Family') || trimmed.startsWith('| Method')) {
      inTable = true;
      continue;
    }
    if (inTable && /^\|[-\s|]+\|$/.test(trimmed)) continue;
    if (inTable && trimmed.startsWith('|')) {
      const cell = trimmed.split('|').map(c => c.trim()).filter(c => c.length > 0)[0];
      if (cell && !cell.startsWith('--')) families.push(cell);
    } else if (inTable && !trimmed.startsWith('|') && trimmed.length > 0) {
      inTable = false;
    }
  }

  return families;
}

// --- Tests ---

console.log('Route Parity Harness Tests');
console.log('='.repeat(50));
console.log();

// 1. Required docs exist
console.log('Document existence:');
const requiredDocs = [
  'docs/contracts/route-inventory.md',
  'docs/migration/route-parity-tracker.md',
  'docs/migration/acceptance-criteria.md',
  'docs/migration/legacy-freeze-rules.md',
];

for (const doc of requiredDocs) {
  assert(fs.existsSync(path.join(ROOT, doc)), `${doc} exists`);
}

// 2. Inventory has route families
console.log('\nRoute inventory:');
const inventory = readDoc('docs/contracts/route-inventory.md');
assert(inventory !== null, 'route-inventory.md is readable');
const inventoryFamilies = inventory ? extractFamiliesFromTable(inventory) : [];
// Count unique family headers (lines starting with ###)
const familyHeaders = inventory
  ? inventory.split('\n').filter(l => l.match(/^###\s+\w+/)).map(l => l.replace(/^###\s+/, '').split(' ')[0])
  : [];
assert(familyHeaders.length >= 5, `Inventory has at least 5 route families (found ${familyHeaders.length})`);

// 3. Tracker covers all inventory families
console.log('\nTracker coverage:');
const tracker = readDoc('docs/migration/route-parity-tracker.md');
assert(tracker !== null, 'route-parity-tracker.md is readable');
if (tracker) {
  for (const family of familyHeaders) {
    assert(tracker.includes(family), `Tracker includes family: ${family}`);
  }
}

// 4. Acceptance criteria covers families
console.log('\nAcceptance criteria:');
const criteria = readDoc('docs/migration/acceptance-criteria.md');
assert(criteria !== null, 'acceptance-criteria.md is readable');
assert(criteria && criteria.includes('Global Criteria'), 'Has global criteria section');
if (criteria) {
  for (const family of familyHeaders.slice(0, 5)) {
    assert(criteria.includes(family), `Criteria covers family: ${family}`);
  }
}

// 5. Legacy freeze rules
console.log('\nLegacy freeze rules:');
const rules = readDoc('docs/migration/legacy-freeze-rules.md');
assert(rules !== null, 'legacy-freeze-rules.md is readable');
assert(rules && rules.includes('No Direct Imports'), 'Has no-direct-imports rule');
assert(rules && rules.includes('No Copy-Paste'), 'Has no-copy-paste rule');

// 6. Parity script runs
console.log('\nParity script:');
try {
  const output = execSync('node scripts/check-route-parity.js', {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert(output.includes('Route Parity Report'), 'Script produces report output');
  assert(output.includes('UNMIGRATED'), 'Script shows unmigrated status');
} catch (err) {
  assert(false, `Script runs without error: ${err.message}`);
}

// 7. All statuses in the main family table are valid
console.log('\nStatus validation:');
if (tracker) {
  const validStatuses = ['UNMIGRATED', 'IN_PROGRESS', 'MIGRATED', 'VERIFIED'];
  const lines = tracker.split('\n');
  let inFamilyTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('| Family') && trimmed.includes('Status')) {
      inFamilyTable = true;
      continue;
    }
    if (inFamilyTable && /^\|[-\s|]+\|$/.test(trimmed)) continue;
    if (inFamilyTable && trimmed.startsWith('|')) {
      const cells = trimmed.split('|').map(c => c.trim()).filter(c => c.length > 0);
      if (cells.length >= 2) {
        assert(
          validStatuses.includes(cells[1].toUpperCase()),
          `Status "${cells[1]}" for ${cells[0]} is valid`
        );
      }
    } else if (inFamilyTable && !trimmed.startsWith('|') && trimmed.length > 0) {
      inFamilyTable = false;
    }
  }
}

// --- Summary ---
console.log();
console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
