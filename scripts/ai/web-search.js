#!/usr/bin/env node

/**
 * web-search.js
 *
 * Web search tool for the self-bootstrap agent system.
 * Calls MiMo API with web_search tool to fetch real-time information.
 *
 * Usage:
 *   node scripts/ai/web-search.js "search query"
 *   node scripts/ai/web-search.js --query "search query" [--max-keywords 3] [--limit 3] [--stdout]
 *
 * Requires MIMO_API_KEY environment variable.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { REPO_ROOT } = require('./lib');
const DEFAULT_OUT = path.join(REPO_ROOT, '.github', 'ai-state', 'web-search-results.json');
const API_ENDPOINT = 'https://api.xiaomimimo.com/v1/chat/completions';
const MODEL = 'mimo-v2.5-pro';

// ── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { query: null, maxKeywords: 3, limit: 3, forceSearch: true, out: DEFAULT_OUT, stdout: false, help: false };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; }
    else if (arg === '--query' || arg === '-q') { i++; args.query = argv[i]; }
    else if (arg === '--max-keywords') { i++; args.maxKeywords = parseInt(argv[i], 10); }
    else if (arg === '--limit') { i++; args.limit = parseInt(argv[i], 10); }
    else if (arg === '--no-force') { args.forceSearch = false; }
    else if (arg === '--out') { i++; args.out = path.resolve(argv[i]); }
    else if (arg === '--stdout') { args.stdout = true; }
    else if (!arg.startsWith('-')) { args.query = arg; }
    else { console.error(`Unknown argument: ${arg}`); process.exit(2); }
    i++;
  }
  return args;
}

// ── MiMo API call ────────────────────────────────────────────────────────────

function callMiMoWebSearch(query, maxKeywords, limit, forceSearch) {
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) {
    throw new Error('MIMO_API_KEY environment variable is required');
  }

  const body = JSON.stringify({
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: query,
      },
    ],
    tools: [
      {
        type: 'web_search',
        max_keyword: maxKeywords,
        force_search: forceSearch,
        limit: limit,
      },
    ],
    max_completion_tokens: 2048,
    temperature: 1.0,
    top_p: 0.95,
    stream: false,
    thinking: { type: 'disabled' },
  });

  return new Promise((resolve, reject) => {
    const url = new URL(API_ENDPOINT);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(`API error ${res.statusCode}: ${data}`));
            return;
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Result extraction ────────────────────────────────────────────────────────

function extractResults(apiResponse) {
  const choice = apiResponse.choices && apiResponse.choices[0];
  if (!choice) return { content: '', sources: [], usage: {} };

  const message = choice.message || {};
  const annotations = message.annotations || [];
  const sources = annotations
    .filter((a) => a.type === 'url_citation')
    .map((a) => ({
      url: a.url,
      title: a.title,
      summary: a.summary || '',
      siteName: a.site_name || '',
      publishTime: a.publish_time || null,
    }));

  const usage = apiResponse.usage || {};
  const webSearchUsage = usage.web_search_usage || {};

  return {
    content: message.content || '',
    sources,
    tokenUsage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    },
    searchUsage: {
      toolCalls: webSearchUsage.tool_usage || 0,
      pagesUsed: webSearchUsage.page_usage || 0,
    },
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    console.log('web-search.js — Web search tool for self-bootstrap agents');
    console.log('Usage: node scripts/ai/web-search.js "search query" [--max-keywords 3] [--limit 3] [--stdout]');
    console.log('Requires MIMO_API_KEY environment variable.');
    process.exit(0);
  }

  if (!args.query) {
    console.error('Error: query is required. Use --query "text" or pass as first argument.');
    process.exit(2);
  }

  try {
    const apiResponse = await callMiMoWebSearch(args.query, args.maxKeywords, args.limit, args.forceSearch);
    const results = extractResults(apiResponse);

    const output = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      query: args.query,
      model: MODEL,
      content: results.content,
      sources: results.sources,
      tokenUsage: results.tokenUsage,
      searchUsage: results.searchUsage,
    };

    const json = JSON.stringify(output, null, 2) + '\n';

    if (args.stdout) {
      process.stdout.write(json);
    } else {
      fs.mkdirSync(path.dirname(args.out), { recursive: true });
      fs.writeFileSync(args.out, json, 'utf8');
      console.log(`Search results: ${results.sources.length} sources found`);
      console.log(`Written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
    }
  } catch (err) {
    console.error(`Search failed: ${err.message}`);
    process.exit(1);
  }
}

main();
