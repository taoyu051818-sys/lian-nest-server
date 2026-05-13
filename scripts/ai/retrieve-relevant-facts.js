#!/usr/bin/env node

/**
 * retrieve-relevant-facts.js
 *
 * Deterministic fact retrieval and relevance scoring for the AI-native
 * control plane. Reads NDJSON ledgers (fact-events, knowledge-updates,
 * external-facts, gap-ledger) and ranks entries by relevance to a
 * given task context using keyword overlap, tag matching, trust score,
 * recency decay, and outcome signals.
 *
 * No LLM calls. All scoring is deterministic, computable from existing
 * ledger fields. The retrieval layer is a reader concern — it never
 * modifies append-only ledgers.
 *
 * Usage:
 *   node scripts/ai/retrieve-relevant-facts.js --help
 *   node scripts/ai/retrieve-relevant-facts.js --issue 1369 --domain "agent-memory,retrieval"
 *   node scripts/ai/retrieve-relevant-facts.js --issue 1369 --ledgers "knowledge-updates,external-facts" --limit 10
 *   node scripts/ai/retrieve-relevant-facts.js --issue 1369 --minScore 0.5 --stdout
 *   node scripts/ai/retrieve-relevant-facts.js --self-test
 *
 * Exit codes:
 *   0 — Results produced (or self-test passed)
 *   1 — No results above threshold (when not using --allowEmpty)
 *   2 — Invalid arguments / usage error
 *
 * Closes: #1369
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AI_STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');

const DEFAULT_LEDGERS = {
  'fact-events': path.join(AI_STATE_DIR, 'fact-events.ndjson'),
  'knowledge-updates': path.join(AI_STATE_DIR, 'knowledge-updates.ndjson'),
  'external-facts': path.join(AI_STATE_DIR, 'external-facts.ndjson'),
  'gap-ledger': path.join(AI_STATE_DIR, 'gap-ledger.ndjson'),
};

const DEFAULT_LIMIT = 20;
const DEFAULT_MIN_SCORE = 0.3;

const WEIGHTS = {
  keyword: 0.25,
  tag: 0.20,
  trust: 0.20,
  recency: 0.15,
  outcome: 0.20,
};

const RELIABILITY_TRUST_MAP = {
  verified: 1.0,
  observed: 0.8,
  reported: 0.5,
  rumor: 0.2,
  authoritative: 1.0,
  high: 0.9,
  medium: 0.7,
  low: 0.4,
  untrusted: 0.1,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function readNdjson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const entries = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines — non-destructive
    }
  }
  return entries;
}

function tokenize(text) {
  if (!text || typeof text !== 'string') return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2),
  );
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ── Scoring Components ───────────────────────────────────────────────────────

function extractEntryTokens(entry) {
  const parts = [];
  // fact-events: subject, facts values
  if (entry.subject) parts.push(entry.subject);
  if (entry.facts && typeof entry.facts === 'object') {
    for (const v of Object.values(entry.facts)) {
      if (typeof v === 'string') parts.push(v);
    }
  }
  // knowledge-updates: summary, details
  if (entry.summary) parts.push(entry.summary);
  if (entry.details) parts.push(entry.details);
  // external-facts: subject, claim
  if (entry.claim) parts.push(entry.claim);
  // gap-ledger: description, gapType
  if (entry.description) parts.push(entry.description);
  if (entry.gapType) parts.push(entry.gapType);
  // common: eventType
  if (entry.eventType) parts.push(entry.eventType);
  return tokenize(parts.join(' '));
}

function extractEntryTags(entry) {
  if (Array.isArray(entry.tags)) return new Set(entry.tags.map(t => t.toLowerCase()));
  return new Set();
}

function extractEntryTimestamp(entry) {
  const raw = entry.capturedAt || entry.recordedAt;
  if (!raw) return null;
  const ts = Date.parse(raw);
  return Number.isNaN(ts) ? null : ts;
}

function computeKeywordScore(entryTokens, taskTokens) {
  return jaccardSimilarity(entryTokens, taskTokens);
}

function computeTagScore(entryTags, taskTags) {
  if (entryTags.size === 0 && taskTags.size === 0) return 0;
  let matches = 0;
  for (const tag of entryTags) {
    if (taskTags.has(tag)) matches++;
  }
  const union = new Set([...entryTags, ...taskTags]).size;
  return union === 0 ? 0 : matches / union;
}

function computeTrustScore(entry) {
  const reliability = entry.sourceReliability || entry.reliabilityTier;
  if (reliability && RELIABILITY_TRUST_MAP[reliability] !== undefined) {
    return RELIABILITY_TRUST_MAP[reliability];
  }
  return 0.5; // default neutral trust
}

function computeRecencyScore(entry) {
  const ts = extractEntryTimestamp(entry);
  if (!ts) return 0.5; // unknown timestamp gets neutral score
  const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
  return 1 / (1 + ageHours / 24);
}

function computeOutcomeScore(entry) {
  // knowledge-updates with experiment tags
  const tags = extractEntryTags(entry);
  if (tags.has('experiment,accepted') || tags.has('accepted')) return 1.0;
  if (tags.has('experiment,rejected') || tags.has('rejected')) return 0.0;
  // fact-events: health.green = positive, health.red = negative
  if (entry.eventType === 'health.green') return 0.8;
  if (entry.eventType === 'health.red') return 0.2;
  // external-facts: verified = positive signal
  if (entry.sourceReliability === 'verified') return 0.8;
  if (entry.sourceReliability === 'rumor') return 0.3;
  return 0.5; // neutral
}

// ── Composite Scoring ────────────────────────────────────────────────────────

function scoreEntry(entry, taskContext) {
  const entryTokens = extractEntryTokens(entry);
  const entryTags = extractEntryTags(entry);

  const keywordScore = computeKeywordScore(entryTokens, taskContext.tokens);
  const tagScore = computeTagScore(entryTags, taskContext.tags);
  const trustScore = computeTrustScore(entry);
  const recencyScore = computeRecencyScore(entry);
  const outcomeScore = computeOutcomeScore(entry);

  const total =
    keywordScore * WEIGHTS.keyword +
    tagScore * WEIGHTS.tag +
    trustScore * WEIGHTS.trust +
    recencyScore * WEIGHTS.recency +
    outcomeScore * WEIGHTS.outcome;

  return {
    relevanceScore: Math.round(total * 1000) / 1000,
    components: {
      keyword: Math.round(keywordScore * 1000) / 1000,
      tag: Math.round(tagScore * 1000) / 1000,
      trust: Math.round(trustScore * 1000) / 1000,
      recency: Math.round(recencyScore * 1000) / 1000,
      outcome: Math.round(outcomeScore * 1000) / 1000,
    },
  };
}

function buildMatchReason(score) {
  const reasons = [];
  if (score.components.keyword > 0.1) reasons.push(`keyword: ${score.components.keyword}`);
  if (score.components.tag > 0) reasons.push(`tag match: ${score.components.tag}`);
  if (score.components.trust > 0.6) reasons.push(`trust: ${score.components.trust}`);
  if (score.components.recency > 0.7) reasons.push(`recent: ${score.components.recency}`);
  if (score.components.outcome !== 0.5) reasons.push(`outcome: ${score.components.outcome}`);
  return reasons.length > 0 ? reasons.join('; ') : 'low signal';
}

// ── Task Context ─────────────────────────────────────────────────────────────

function buildTaskContext(issue, domain) {
  // Build token set from issue number and domain tags
  const parts = [`issue ${issue}`];
  const tags = new Set();
  if (domain) {
    for (const tag of domain.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)) {
      tags.add(tag);
      parts.push(tag.replace(/-/g, ' '));
    }
  }
  return {
    issue,
    tags,
    tokens: tokenize(parts.join(' ')),
  };
}

// ── Ledger Reading ───────────────────────────────────────────────────────────

function readAllLedgers(selectedLedgers) {
  const results = {};
  for (const name of selectedLedgers) {
    const filePath = DEFAULT_LEDGERS[name];
    if (!filePath) continue;
    results[name] = readNdjson(filePath);
  }
  return results;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function printHelp() {
  const help = `
retrieve-relevant-facts.js — Deterministic fact retrieval and relevance scoring

USAGE
    node scripts/ai/retrieve-relevant-facts.js [OPTIONS]

OPTIONS
    --issue <n>          GitHub issue number (required unless --self-test)
    --domain <tags>      Comma-separated domain tags for relevance matching
    --limit <n>          Maximum results to return (default: ${DEFAULT_LIMIT})
    --minScore <0-1>     Minimum relevance threshold (default: ${DEFAULT_MIN_SCORE})
    --ledgers <list>     Comma-separated ledger names to search
                         (default: all — fact-events, knowledge-updates,
                         external-facts, gap-ledger)
    --stdout             Print JSON to stdout (default)
    --allowEmpty         Exit 0 even when no results above threshold
    --self-test          Run built-in scoring tests
    --help, -h           Show this help message

SCORING
    relevance = keyword * ${WEIGHTS.keyword}
              + tag * ${WEIGHTS.tag}
              + trust * ${WEIGHTS.trust}
              + recency * ${WEIGHTS.recency}
              + outcome * ${WEIGHTS.outcome}

    keyword   Jaccard similarity of tokenized text (0-1)
    tag       Set intersection of fact tags vs. domain tags (0-1)
    trust     Source reliability mapping (0-1)
    recency   1 / (1 + ageHours/24), decays over days (0-1)
    outcome   Accepted experiments → 1.0, rejected → 0.0, neutral → 0.5

EXIT CODES
    0   Results produced (or --allowEmpty with no results)
    1   No results above threshold
    2   Invalid arguments

EXAMPLES
    # Find facts relevant to issue #1369 about agent memory
    node scripts/ai/retrieve-relevant-facts.js \\
      --issue 1369 --domain "agent-memory,external-intake,retrieval"

    # Search only knowledge and external-facts, high threshold
    node scripts/ai/retrieve-relevant-facts.js \\
      --issue 1369 --ledgers "knowledge-updates,external-facts" --minScore 0.5

    # Run self-test
    node scripts/ai/retrieve-relevant-facts.js --self-test
`.trimStart();
  process.stdout.write(help);
}

function parseArgs(argv) {
  const args = {
    issue: null,
    domain: null,
    limit: DEFAULT_LIMIT,
    minScore: DEFAULT_MIN_SCORE,
    ledgers: Object.keys(DEFAULT_LEDGERS),
    stdout: true,
    allowEmpty: false,
    selfTest: false,
    help: false,
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--issue') {
      i++;
      if (i >= argv.length) { console.error('Error: --issue requires a number'); process.exit(2); }
      const n = parseInt(argv[i], 10);
      if (Number.isNaN(n) || n < 0) { console.error('Error: --issue must be a non-negative integer'); process.exit(2); }
      args.issue = n;
    } else if (arg === '--domain') {
      i++;
      if (i >= argv.length) { console.error('Error: --domain requires a comma-separated list'); process.exit(2); }
      args.domain = argv[i];
    } else if (arg === '--limit') {
      i++;
      if (i >= argv.length) { console.error('Error: --limit requires a number'); process.exit(2); }
      const n = parseInt(argv[i], 10);
      if (Number.isNaN(n) || n < 1) { console.error('Error: --limit must be a positive integer'); process.exit(2); }
      args.limit = n;
    } else if (arg === '--minScore') {
      i++;
      if (i >= argv.length) { console.error('Error: --minScore requires a number'); process.exit(2); }
      const n = parseFloat(argv[i]);
      if (Number.isNaN(n) || n < 0 || n > 1) { console.error('Error: --minScore must be between 0 and 1'); process.exit(2); }
      args.minScore = n;
    } else if (arg === '--ledgers') {
      i++;
      if (i >= argv.length) { console.error('Error: --ledgers requires a comma-separated list'); process.exit(2); }
      args.ledgers = argv[i].split(',').map(s => s.trim()).filter(Boolean);
      for (const l of args.ledgers) {
        if (!DEFAULT_LEDGERS[l]) {
          console.error(`Error: unknown ledger "${l}". Valid: ${Object.keys(DEFAULT_LEDGERS).join(', ')}`);
          process.exit(2);
        }
      }
    } else if (arg === '--stdout') {
      args.stdout = true;
    } else if (arg === '--allowEmpty') {
      args.allowEmpty = true;
    } else if (arg === '--self-test') {
      args.selfTest = true;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
    i++;
  }

  return args;
}

// ── Self-test ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let passed = 0;
  let failed = 0;

  function assert(condition, label) {
    if (condition) {
      passed++;
    } else {
      failed++;
      console.error(`  FAIL: ${label}`);
    }
  }

  console.log('retrieve-relevant-facts.js — self-test');
  console.log('='.repeat(45));

  // Tokenize
  const t1 = tokenize('The quick brown fox jumps');
  assert(t1.has('quick'), 'tokenize extracts words');
  assert(!t1.has('ab'), 'tokenize skips tokens <= 2 chars');
  assert(t1.size === 5, 'tokenize keeps tokens > 2 chars');

  // Jaccard similarity
  const a = new Set(['hello', 'world']);
  const b = new Set(['hello', 'there']);
  const sim = jaccardSimilarity(a, b);
  assert(sim === 1/3, `jaccard: {hello,world} vs {hello,there} = 1/3, got ${sim}`);

  const empty = jaccardSimilarity(new Set(), new Set());
  assert(empty === 0, 'jaccard: empty sets = 0');

  const identical = jaccardSimilarity(new Set(['x']), new Set(['x']));
  assert(identical === 1, 'jaccard: identical singleton = 1');

  // Keyword score
  const entryTokens = tokenize('agent memory retrieval system');
  const taskTokens = tokenize('issue 1369 agent memory');
  const kwScore = computeKeywordScore(entryTokens, taskTokens);
  assert(kwScore > 0, `keyword score > 0 for matching tokens, got ${kwScore}`);

  // Tag score
  const entryTags = new Set(['agent-memory', 'retrieval']);
  const taskTags = new Set(['agent-memory', 'external-intake']);
  const tsResult = computeTagScore(entryTags, taskTags);
  assert(tsResult > 0 && tsResult < 1, `tag score partial match, got ${tsResult}`);

  const fullTagMatch = computeTagScore(new Set(['a', 'b']), new Set(['a', 'b']));
  assert(fullTagMatch === 1, `tag score full match = 1, got ${fullTagMatch}`);

  // Trust score
  assert(computeTrustScore({ sourceReliability: 'verified' }) === 1.0, 'trust: verified = 1.0');
  assert(computeTrustScore({ sourceReliability: 'rumor' }) === 0.2, 'trust: rumor = 0.2');
  assert(computeTrustScore({ reliabilityTier: 'high' }) === 0.9, 'trust: high tier = 0.9');
  assert(computeTrustScore({}) === 0.5, 'trust: unknown = 0.5');

  // Recency score
  const recentEntry = { capturedAt: new Date().toISOString() };
  const recentScore = computeRecencyScore(recentEntry);
  assert(recentScore > 0.9, `recency: just-now > 0.9, got ${recentScore}`);

  const oldEntry = { capturedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() };
  const oldScore = computeRecencyScore(oldEntry);
  assert(oldScore < 0.1, `recency: 30 days old < 0.1, got ${oldScore}`);

  // Outcome score
  assert(computeOutcomeScore({ tags: ['experiment,accepted'] }) === 1.0, 'outcome: accepted = 1.0');
  assert(computeOutcomeScore({ tags: ['experiment,rejected'] }) === 0.0, 'outcome: rejected = 0.0');
  assert(computeOutcomeScore({ eventType: 'health.green' }) === 0.8, 'outcome: health.green = 0.8');
  assert(computeOutcomeScore({}) === 0.5, 'outcome: neutral = 0.5');

  // Composite scoring
  const taskCtx = buildTaskContext(1369, 'agent-memory,retrieval');
  assert(taskCtx.tags.has('agent-memory'), 'task context has domain tags');
  assert(taskCtx.tokens.has('agent'), 'task context tokenizes domain');

  const knowledgeEntry = {
    schemaVersion: 1,
    category: 'architecture',
    summary: 'Agent memory retrieval uses keyword overlap scoring',
    capturedAt: new Date().toISOString(),
    tags: ['agent-memory', 'retrieval'],
  };
  const score = scoreEntry(knowledgeEntry, taskCtx);
  assert(score.relevanceScore > 0.3, `high-relevance entry scores > 0.3, got ${score.relevanceScore}`);
  assert(score.components.keyword > 0, 'has keyword component');
  assert(score.components.tag > 0, 'has tag component');

  const irrelevantEntry = {
    schemaVersion: 1,
    category: 'migration',
    summary: 'Prisma seed script truncates migration_state rows',
    capturedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    tags: ['prisma', 'seed'],
  };
  const lowScore = scoreEntry(irrelevantEntry, taskCtx);
  assert(lowScore.relevanceScore < score.relevanceScore, `irrelevant entry scores lower: ${lowScore.relevanceScore} < ${score.relevanceScore}`);

  // Match reason
  const reason = buildMatchReason(score);
  assert(typeof reason === 'string' && reason.length > 0, 'match reason is non-empty string');

  console.log();
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.selfTest) {
    runSelfTest();
  }

  if (args.issue === null) {
    console.error('Error: --issue is required (or use --self-test)');
    console.error('Run with --help for usage information');
    process.exit(2);
  }

  const taskContext = buildTaskContext(args.issue, args.domain);
  const ledgerEntries = readAllLedgers(args.ledgers);

  const results = [];
  for (const [source, entries] of Object.entries(ledgerEntries)) {
    for (const entry of entries) {
      const score = scoreEntry(entry, taskContext);
      if (score.relevanceScore >= args.minScore) {
        results.push({
          source,
          entry,
          relevanceScore: score.relevanceScore,
          matchReason: buildMatchReason(score),
        });
      }
    }
  }

  // Sort by relevance descending, apply limit
  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const limited = results.slice(0, args.limit);

  const output = {
    issue: args.issue,
    domain: args.domain || null,
    ledgers: args.ledgers,
    totalScanned: Object.values(ledgerEntries).reduce((sum, e) => sum + e.length, 0),
    aboveThreshold: results.length,
    returned: limited.length,
    results: limited,
  };

  const json = JSON.stringify(output, null, 2) + '\n';
  process.stdout.write(json);

  if (limited.length === 0 && !args.allowEmpty) {
    process.exit(1);
  }
}

main();
