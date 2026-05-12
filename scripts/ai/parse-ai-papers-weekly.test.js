#!/usr/bin/env node

/**
 * parse-ai-papers-weekly.test.js
 *
 * Tests for parse-ai-papers-weekly.js. Uses Node assert, inline fixtures,
 * no network. Run: node scripts/ai/parse-ai-papers-weekly.test.js
 */

'use strict';

const assert = require('assert');

// ── Pure function mirrors (from parse-ai-papers-weekly.js) ───────────────────

function sanitize(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[A-Za-z0-9+/=]{40,}/g, '[redacted-token]')
    .replace(/ghp_[A-Za-z0-9]+/g, '[redacted-gh-token]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/password[=:]\s*\S+/gi, 'password=[redacted]')
    .replace(/secret[=:]\s*\S+/gi, 'secret=[redacted]')
    .replace(/token[=:]\s*\S+/gi, 'token=[redacted]')
    .slice(0, 500);
}

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
  const titleMatch = cells[0].match(/\*{2}([^*]+)\*{2}/);
  if (!titleMatch) return null;
  const title = sanitize(titleMatch[1].trim());
  let summary = '';
  const dashIdx = cells[0].indexOf('** - ');
  if (dashIdx !== -1) summary = sanitize(cells[0].slice(dashIdx + 5).trim());
  return { title, summary, links: parseLinksCell(cells[1]) };
}

function parseYearFile(content) {
  const weeks = [];
  const sections = content.split(/^## /m);
  for (const section of sections) {
    const headingMatch = section.match(/^Top AI Papers of the Week\s*\(([^)]+)\)\s*-\s*(\d{4})/);
    if (!headingMatch) continue;
    const weekRange = headingMatch[1].trim();
    const year = headingMatch[2].trim();
    const papers = [];
    const lines = section.split('\n');
    let inTable = false;
    let headerSkipped = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|')) { if (inTable) break; continue; }
      if (headerSkipped < 2) {
        if (trimmed.includes('**Paper**') || trimmed.includes('---')) { headerSkipped++; inTable = true; continue; }
      }
      if (!inTable) continue;
      const paper = parsePaperRow(trimmed);
      if (paper) papers.push(paper);
    }
    weeks.push({ source: 'dair-ai/AI-Papers-of-the-Week', week: weekRange, year, paperCount: papers.length, papers });
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
    if (yearHeading) { currentYear = yearHeading[1]; continue; }
    const linkMatch = trimmed.match(/^-\s+\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch && currentYear) {
      years.push({ year: currentYear, label: sanitize(linkMatch[1]), path: sanitize(linkMatch[2].split('#')[0]) });
    }
  }
  return years;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const YEAR_FIXTURE = [
  '## Top AI Papers of the Week (May 4 - May 10) - 2026',
  '| **Paper**  | **Links** |',
  '| ------------- | ------------- |',
  '| 1) **Alpha Model** - First paper about agents.<br>● Key insight 1<br>● Why it matters: improves tool use. | [Paper](https://arxiv.org/abs/2605.01000), [Tweet](https://x.com/researcher/status/111) |',
  '| 2) **Beta Framework** - Second paper on memory systems. | [Paper](https://arxiv.org/abs/2605.02000), [Code](https://github.com/org/beta) |',
  '| 3) **Gamma Evaluator** - Benchmark for planning agents. | [Paper](https://arxiv.org/abs/2605.03000) |',
  '',
  '## Top AI Papers of the Week (April 27 - May 3) - 2026',
  '| **Paper**  | **Links** |',
  '| ------------- | ------------- |',
  '| 1) **Delta Planner** - Novel approach to multi-step reasoning. | [Paper](https://arxiv.org/abs/2604.99000), [Tweet](https://x.com/researcher/status/222) |',
  '',
  '## Top AI Papers of the Week (Dec 23 - Dec 29) - 2025',
  '| **Paper**  | **Links** |',
  '| ------------- | ------------- |',
  '| 1) **Epsilon Memory** - Old paper from 2025. | [Paper](https://arxiv.org/abs/2512.99000) |',
  '| 2) **Zeta Orchestrator** - Multi-agent system. | [Paper](https://arxiv.org/abs/2512.98000), [Tweet](https://x.com/researcher/status/333) |',
  '',
  '## Some Other Section',
  'Not a week section.',
].join('\n');

const INDEX_FIXTURE = [
  '# AI Papers of the Week', '',
  '## 2026',
  '- [Top AI Papers of the Week (May 4 - May 10)](years/2026.md#top-ai-papers-of-the-week-may-4---may-10---2026)',
  '- [Top AI Papers of the Week (April 26 - May 3)](years/2026.md#top-ai-papers-of-the-week-april-26---may-3---2026)',
  '',
  '## 2025',
  '- [Top AI Papers of the Week (Dec 23 - Dec 29)](years/2025.md#anchor)',
  '- [Top AI Papers of the Week (Dec 16 - Dec 22)](years/2025.md#anchor2)',
].join('\n');

const MINIMAL_YEAR_FIXTURE = [
  '## Top AI Papers of the Week (Jan 1 - Jan 7) - 2025',
  '| **Paper**  | **Links** |',
  '| ------------- | ------------- |',
].join('\n');

// ── Tests ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(label, fn) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`  FAIL: ${label}\n        ${err.message}`); }
}

console.log('parse-ai-papers-weekly.test.js');
console.log('='.repeat(50));

// parseLinksCell
console.log('parseLinksCell');
test('extracts multiple links', () => {
  const links = parseLinksCell('[Paper](https://arxiv.org/abs/1234), [Tweet](https://x.com/u/s/5678)');
  assert.strictEqual(links.length, 2);
  assert.strictEqual(links[0].label, 'Paper');
  assert.strictEqual(links[0].url, 'https://arxiv.org/abs/1234');
  assert.strictEqual(links[1].label, 'Tweet');
});
test('handles single link', () => {
  assert.strictEqual(parseLinksCell('[Paper](https://arxiv.org/abs/1)').length, 1);
});
test('returns empty for no links', () => {
  assert.strictEqual(parseLinksCell('no links').length, 0);
  assert.strictEqual(parseLinksCell('').length, 0);
});
test('handles code links', () => {
  const links = parseLinksCell('[Paper](https://arxiv.org/abs/1), [Code](https://github.com/org/repo)');
  assert.strictEqual(links.length, 2);
  assert.strictEqual(links[1].label, 'Code');
});

// parsePaperRow
console.log('parsePaperRow');
test('parses paper with summary and multiple links', () => {
  const paper = parsePaperRow('| 1) **Test Paper** - A summary. | [Paper](https://arxiv.org/abs/1), [Code](https://github.com/x) |');
  assert.ok(paper);
  assert.strictEqual(paper.title, 'Test Paper');
  assert.strictEqual(paper.summary, 'A summary.');
  assert.strictEqual(paper.links.length, 2);
});
test('parses paper without summary', () => {
  const paper = parsePaperRow('| 1) **Short Title** | [Paper](https://arxiv.org/abs/1) |');
  assert.ok(paper);
  assert.strictEqual(paper.title, 'Short Title');
  assert.strictEqual(paper.summary, '');
});
test('parses paper with <br> in summary', () => {
  const paper = parsePaperRow('| 1) **Br Paper** - Line one.<br>● Bullet. | [Paper](https://arxiv.org/abs/1) |');
  assert.ok(paper);
  assert.ok(paper.summary.includes('<br>'));
});
test('returns null for no bold title', () => {
  assert.strictEqual(parsePaperRow('| no bold title | [x](y) |'), null);
});
test('returns null for non-row', () => {
  assert.strictEqual(parsePaperRow('not a row'), null);
  assert.strictEqual(parsePaperRow(''), null);
});
test('sanitizes tokens in title and summary', () => {
  const paper = parsePaperRow('| 1) **Paper ghp_abc123xyz** - Contains ghp_secret. | [Paper](https://arxiv.org/abs/1) |');
  assert.ok(paper);
  assert.ok(!paper.title.includes('ghp_abc123xyz'));
  assert.ok(!paper.summary.includes('ghp_secret'));
});

// parseYearFile
console.log('parseYearFile');
test('parses multiple weeks', () => {
  const weeks = parseYearFile(YEAR_FIXTURE);
  assert.strictEqual(weeks.length, 3);
  assert.strictEqual(weeks[0].week, 'May 4 - May 10');
  assert.strictEqual(weeks[0].year, '2026');
  assert.strictEqual(weeks[0].source, 'dair-ai/AI-Papers-of-the-Week');
  assert.strictEqual(weeks[0].paperCount, 3);
  assert.strictEqual(weeks[1].week, 'April 27 - May 3');
  assert.strictEqual(weeks[1].paperCount, 1);
  assert.strictEqual(weeks[2].week, 'Dec 23 - Dec 29');
  assert.strictEqual(weeks[2].year, '2025');
  assert.strictEqual(weeks[2].paperCount, 2);
});
test('extracts paper titles correctly', () => {
  const weeks = parseYearFile(YEAR_FIXTURE);
  assert.strictEqual(weeks[0].papers[0].title, 'Alpha Model');
  assert.strictEqual(weeks[0].papers[1].title, 'Beta Framework');
  assert.strictEqual(weeks[0].papers[2].title, 'Gamma Evaluator');
  assert.strictEqual(weeks[1].papers[0].title, 'Delta Planner');
  assert.strictEqual(weeks[2].papers[0].title, 'Epsilon Memory');
  assert.strictEqual(weeks[2].papers[1].title, 'Zeta Orchestrator');
});
test('extracts paper summaries', () => {
  const weeks = parseYearFile(YEAR_FIXTURE);
  assert.ok(weeks[0].papers[0].summary.includes('agents'));
  assert.ok(weeks[0].papers[0].summary.includes('tool use'));
  assert.ok(weeks[0].papers[1].summary.includes('memory systems'));
});
test('extracts links correctly', () => {
  const weeks = parseYearFile(YEAR_FIXTURE);
  assert.strictEqual(weeks[0].papers[0].links.length, 2);
  assert.strictEqual(weeks[0].papers[0].links[0].label, 'Paper');
  assert.strictEqual(weeks[0].papers[0].links[1].label, 'Tweet');
  assert.strictEqual(weeks[0].papers[2].links.length, 1);
  assert.strictEqual(weeks[0].papers[1].links[1].label, 'Code');
});
test('handles empty week table', () => {
  const weeks = parseYearFile(MINIMAL_YEAR_FIXTURE);
  assert.strictEqual(weeks.length, 1);
  assert.strictEqual(weeks[0].paperCount, 0);
  assert.deepStrictEqual(weeks[0].papers, []);
});
test('returns empty for no valid sections', () => {
  assert.deepStrictEqual(parseYearFile('# Heading\nText.'), []);
  assert.deepStrictEqual(parseYearFile(''), []);
});
test('ignores non-week headings', () => {
  const weeks = parseYearFile(YEAR_FIXTURE);
  for (const w of weeks) assert.ok(w.week !== 'Some Other Section');
});
test('paperCount matches papers array length', () => {
  const weeks = parseYearFile(YEAR_FIXTURE);
  for (const w of weeks) assert.strictEqual(w.paperCount, w.papers.length);
});

// parseIndexFile
console.log('parseIndexFile');
test('parses year sections and links', () => {
  const years = parseIndexFile(INDEX_FIXTURE);
  assert.strictEqual(years.length, 4);
  assert.strictEqual(years[0].year, '2026');
  assert.strictEqual(years[0].path, 'years/2026.md');
  assert.ok(years[0].label.includes('May 4'));
  assert.strictEqual(years[2].year, '2025');
  assert.strictEqual(years[2].path, 'years/2025.md');
});
test('strips anchor fragments from paths', () => {
  const years = parseIndexFile(INDEX_FIXTURE);
  for (const y of years) assert.ok(!y.path.includes('#'));
});
test('returns empty for no entries', () => {
  assert.deepStrictEqual(parseIndexFile('# AI Papers\nNo links.'), []);
  assert.deepStrictEqual(parseIndexFile(''), []);
});
test('preserves label text', () => {
  const years = parseIndexFile(INDEX_FIXTURE);
  assert.ok(years[0].label.includes('Top AI Papers of the Week'));
  assert.ok(years[0].label.includes('May 4 - May 10'));
});

// sanitize
console.log('sanitize');
test('strips long base64-like tokens', () => { assert.strictEqual(sanitize('a'.repeat(50)), '[redacted-token]'); });
test('strips ghp_ tokens', () => { assert.strictEqual(sanitize('ghp_abc123xyz'), '[redacted-gh-token]'); });
test('strips Bearer tokens', () => { assert.strictEqual(sanitize('Bearer mytoken123'), 'Bearer [redacted]'); });
test('preserves normal text', () => { assert.strictEqual(sanitize('hello world'), 'hello world'); });
test('truncates to 500 chars', () => { assert.ok(sanitize('x'.repeat(600)).length <= 500); });
test('handles non-string input', () => { assert.strictEqual(sanitize(42), 42); assert.strictEqual(sanitize(null), null); });

// JSON output
console.log('JSON output');
test('year parse output round-trips through JSON', () => {
  const parsed = JSON.parse(JSON.stringify(parseYearFile(YEAR_FIXTURE)));
  assert.strictEqual(parsed.length, 3);
  assert.strictEqual(parsed[0].papers[0].title, 'Alpha Model');
});
test('index parse output round-trips through JSON', () => {
  const parsed = JSON.parse(JSON.stringify(parseIndexFile(INDEX_FIXTURE)));
  assert.strictEqual(parsed.length, 4);
});
test('output contains no raw secrets', () => {
  const dirtyMd = '## Top AI Papers of the Week (Jan 1 - Jan 7) - 2026\n| **Paper**  | **Links** |\n| ------------- | ------------- |\n| 1) **Paper** - ghp_leaked123 | [Paper](https://arxiv.org/abs/1) |';
  assert.ok(!JSON.stringify(parseYearFile(dirtyMd)).includes('ghp_leaked123'));
});

// ── Report ───────────────────────────────────────────────────────────────────

console.log();
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
