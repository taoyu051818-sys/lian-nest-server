#!/usr/bin/env node

/**
 * check-docs-authority.js
 *
 * Docs authority guard: detects documentation drift patterns.
 *
 * Checks:
 *   1. Duplicate basenames across docs folders.
 *   2. Duplicate H1 titles across docs folders.
 *   3. Duplicate topic frontmatter across docs (duplicate current sources).
 *   4. Docs missing optional frontmatter owner/status/topic (where present).
 *   5. Docs with stale status (superseded/archived) in frontmatter.
 *
 * Run standalone: node scripts/guards/check-docs-authority.js [--warn-only]
 * Exit codes:
 *   0 -- No violations (or --warn-only with warnings)
 *   1 -- Violations found (blocked mode)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DOCS_ROOT = path.join(ROOT, 'docs');

const WARN_ONLY = process.argv.includes('--warn-only');
const JSON_SUMMARY = process.argv.includes('--json');

// --- Helpers ---

function collectMarkdownFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    // Handle empty frontmatter: ---\n---
    if (/^---\r?\n---/.test(content)) return {};
    return null;
  }

  const fm = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kv) {
      fm[kv[1].toLowerCase()] = kv[2].trim();
    }
  }
  return fm;
}

function extractH1(content) {
  // Strip frontmatter before looking for H1
  const stripped = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const match = stripped.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : null;
}

// --- Checks ---

function checkDuplicateBasenames(files) {
  const groups = new Map();

  for (const file of files) {
    const basename = path.basename(file, '.md');
    const rel = path.relative(ROOT, file);
    if (!groups.has(basename)) groups.set(basename, []);
    groups.get(basename).push(rel);
  }

  const duplicates = [];
  for (const [basename, fileList] of groups) {
    if (fileList.length > 1) {
      duplicates.push({ type: 'duplicate-basename', basename, files: fileList });
    }
  }
  return duplicates;
}

function checkDuplicateTitles(files) {
  const seen = new Map();
  const duplicates = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const title = extractH1(content);
    if (!title) continue;

    const key = title.toLowerCase();
    if (seen.has(key)) {
      duplicates.push({
        type: 'duplicate-title',
        title,
        files: [seen.get(key), path.relative(ROOT, file)],
      });
    } else {
      seen.set(key, path.relative(ROOT, file));
    }
  }
  return duplicates;
}

function checkMissingFrontmatter(files) {
  const missing = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const fm = parseFrontmatter(content);

    // Only flag if doc uses frontmatter at all (some don't, which is fine)
    // We check: if frontmatter is present, are owner/status/topic present?
    if (fm) {
      const absent = [];
      if (!fm.owner) absent.push('owner');
      if (!fm.status) absent.push('status');
      if (!fm.topic) absent.push('topic');

      if (absent.length > 0) {
        missing.push({
          type: 'missing-frontmatter-fields',
          file: path.relative(ROOT, file),
          missing: absent,
        });
      }
    }
  }
  return missing;
}

function checkDuplicateTopics(files) {
  const groups = new Map();

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm || !fm.topic) continue;

    const topic = fm.topic.toLowerCase();
    const rel = path.relative(ROOT, file);
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic).push(rel);
  }

  const duplicates = [];
  for (const [topic, fileList] of groups) {
    if (fileList.length > 1) {
      duplicates.push({ type: 'duplicate-topic', topic, files: fileList });
    }
  }
  return duplicates;
}

const STALE_STATUSES = new Set(['superseded', 'archived']);

function checkStaleStatus(files) {
  const stale = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm || !fm.status) continue;

    if (STALE_STATUSES.has(fm.status.toLowerCase())) {
      stale.push({
        type: 'stale-status',
        file: path.relative(ROOT, file),
        status: fm.status.toLowerCase(),
      });
    }
  }
  return stale;
}

// --- Main ---

function run() {
  const files = collectMarkdownFiles(DOCS_ROOT);

  if (files.length === 0) {
    console.log('No docs files found. Nothing to check.');
    return { warnings: [], errors: [], fileCount: 0 };
  }

  const warnings = [];
  const errors = [];

  // 1. Duplicate basenames
  const dupBases = checkDuplicateBasenames(files);
  for (const d of dupBases) {
    const msg = `Duplicate basename "${d.basename}": ${d.files.join(', ')}`;
    (WARN_ONLY ? warnings : errors).push(msg);
  }

  // 2. Duplicate titles
  const dupTitles = checkDuplicateTitles(files);
  for (const d of dupTitles) {
    const msg = `Duplicate title "${d.title}": ${d.files.join(', ')}`;
    (WARN_ONLY ? warnings : errors).push(msg);
  }

  // 3. Duplicate topics (error in enforce mode)
  const dupTopics = checkDuplicateTopics(files);
  for (const d of dupTopics) {
    const msg = `Duplicate topic "${d.topic}": ${d.files.join(', ')}`;
    (WARN_ONLY ? warnings : errors).push(msg);
  }

  // 4. Missing frontmatter fields (always warn, never block)
  const missingFm = checkMissingFrontmatter(files);
  for (const m of missingFm) {
    warnings.push(
      `Missing frontmatter [${m.missing.join(', ')}]: ${m.file}`
    );
  }

  // 5. Stale status (always warn, never block)
  const staleDocs = checkStaleStatus(files);
  for (const s of staleDocs) {
    warnings.push(`Stale status [${s.status}]: ${s.file}`);
  }

  // Output
  const summary = {
    fileCount: files.length,
    warningCount: warnings.length,
    errorCount: errors.length,
    mode: WARN_ONLY ? 'warn-only' : 'enforce',
    warnings,
    errors,
  };

  if (JSON_SUMMARY) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    if (warnings.length > 0) {
      console.warn(`Warnings (${warnings.length}):`);
      for (const w of warnings) console.warn(`  - ${w}`);
    }
    if (errors.length > 0) {
      console.error(`Errors (${errors.length}):`);
      for (const e of errors) console.error(`  - ${e}`);
    }
    if (warnings.length === 0 && errors.length === 0) {
      console.log(`Docs authority check passed. (${files.length} files scanned)`);
    }
  }

  return summary;
}

if (require.main === module) {
  const summary = run();
  process.exit(summary.errors.length > 0 ? 1 : 0);
}

module.exports = {
  collectMarkdownFiles,
  parseFrontmatter,
  extractH1,
  checkDuplicateBasenames,
  checkDuplicateTitles,
  checkDuplicateTopics,
  checkMissingFrontmatter,
  checkStaleStatus,
  run,
};
