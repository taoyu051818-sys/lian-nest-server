#!/usr/bin/env node

/**
 * search-and-ingest.js
 *
 * Agent tool: search the web and ingest results as external facts.
 * Chains web-search.js → write-external-fact.js.
 *
 * The agent decides WHAT to search and WHETHER to ingest.
 * This script handles the mechanical chaining.
 *
 * Usage:
 *   node scripts/ai/search-and-ingest.js "AI agent orchestration patterns" --live
 *   node scripts/ai/search-and-ingest.js --topics "topic1,topic2,topic3" --live
 *
 * Requires MIMO_API_KEY environment variable.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { REPO_ROOT } = require('./lib');
const SCRIPT_DIR = __dirname;
const WEB_SEARCH = path.join(SCRIPT_DIR, 'web-search.js');
const WRITE_FACT = path.join(SCRIPT_DIR, 'write-external-fact.js');
const STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');

const SEARCH_TOPICS = [
  'AI agent orchestration frameworks 2026',
  'multi-agent collaboration patterns',
  'autonomous code generation safety',
  'LLM self-improvement techniques',
  'agent-based software engineering',
];

// ── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { query: null, topics: null, live: false, maxKeywords: 3, limit: 3, help: false };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; }
    else if (arg === '--query' || arg === '-q') { i++; args.query = argv[i]; }
    else if (arg === '--topics') { i++; args.topics = argv[i].split(',').map(t => t.trim()); }
    else if (arg === '--live') { args.live = true; }
    else if (arg === '--max-keywords') { i++; args.maxKeywords = parseInt(argv[i], 10); }
    else if (arg === '--limit') { i++; args.limit = parseInt(argv[i], 10); }
    else if (!arg.startsWith('-')) { args.query = arg; }
    else { console.error(`Unknown argument: ${arg}`); process.exit(2); }
    i++;
  }
  return args;
}

// ── Search ───────────────────────────────────────────────────────────────────

function searchWeb(query, maxKeywords, limit) {
  try {
    const result = execSync(
      `node "${WEB_SEARCH}" --query "${query.replace(/"/g, '\\"')}" --max-keywords ${maxKeywords} --limit ${limit} --stdout`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }
    );
    return JSON.parse(result);
  } catch (err) {
    console.error(`Search failed for "${query}": ${err.message}`);
    return null;
  }
}

// ── Ingest ───────────────────────────────────────────────────────────────────

function ingestAsFact(searchResult, live) {
  if (!searchResult || !searchResult.sources || searchResult.sources.length === 0) {
    console.log('  No sources to ingest');
    return null;
  }

  // Build fact from search result
  const topSource = searchResult.sources[0];
  const topic = searchResult.query.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);

  const args = [
    '--sourceClass', 'web-scan',
    '--sourceUrl', topSource.url || 'N/A',
    '--actor', 'web-search-intake',
    '--reliabilityTier', 'medium',
    '--topic', topic,
    '--pattern', topSource.title || searchResult.query,
    '--keyInsight', searchResult.content.slice(0, 500),
    '--relevance', 'External research for self-bootstrap improvement',
  ];

  if (live) { args.push('--live'); }

  try {
    const result = execSync(
      `node "${WRITE_FACT}" ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }
    );
    return { success: true, output: result };
  } catch (err) {
    console.error(`  Ingest failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log('search-and-ingest.js — Search web and ingest as external facts');
    console.log('Usage: node scripts/ai/search-and-ingest.js "query" [--live]');
    console.log('       node scripts/ai/search-and-ingest.js --topics "topic1,topic2" [--live]');
    process.exit(0);
  }

  const queries = args.topics || (args.query ? [args.query] : SEARCH_TOPICS);
  const mode = args.live ? 'LIVE' : 'DRY-RUN';

  console.log(`\n=== Search & Ingest [${mode}] ===`);
  console.log(`Queries: ${queries.length}`);
  console.log('');

  const results = [];

  for (const query of queries) {
    console.log(`Searching: "${query}"`);
    const searchResult = searchWeb(query, args.maxKeywords, args.limit);

    if (searchResult) {
      console.log(`  Found ${searchResult.sources.length} sources`);
      console.log(`  Content: ${searchResult.content.slice(0, 100)}...`);

      const ingestResult = ingestAsFact(searchResult, args.live);
      results.push({
        query,
        sourcesFound: searchResult.sources.length,
        ingested: ingestResult ? ingestResult.success : false,
        topSource: searchResult.sources[0] ? searchResult.sources[0].url : null,
      });
    } else {
      results.push({ query, sourcesFound: 0, ingested: false, error: 'search failed' });
    }
    console.log('');
  }

  console.log('=== Summary ===');
  console.log(`Searched: ${results.length} queries`);
  console.log(`Sources found: ${results.reduce((s, r) => s + r.sourcesFound, 0)}`);
  console.log(`Ingested: ${results.filter(r => r.ingested).length}`);

  if (!args.live) {
    console.log('\nDRY-RUN: No facts written. Pass --live to ingest.');
  }
}

main();
