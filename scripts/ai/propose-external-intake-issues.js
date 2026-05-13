#!/usr/bin/env node

/**
 * propose-external-intake-issues.js
 *
 * Converts external research/opportunity signals into bounded experiment
 * issue proposals without directly launching work. Reads external-facts.ndjson
 * and opportunity-signals.json, then generates issue proposals that follow
 * the same CONTROL APPENDIX format as propose-self-cycle-issues.js.
 *
 * Dry-run by default. Pass --execute to auto-create policy-eligible issues.
 *
 * Usage:
 *   node scripts/ai/propose-external-intake-issues.js [--execute] [--stdout] [--out <path>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { REPO_ROOT } = require('./lib');

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_STATE_DIR = path.join(REPO_ROOT, '.github', 'ai-state');
const DEFAULT_OUT = path.join(DEFAULT_STATE_DIR, 'external-intake-proposals.json');
const AUDIT_FILE = 'external-intake-events.ndjson';
const SCHEMA_VERSION = 1;

const ALLOWED_SCOPES = [
  'scripts/ai/**',
  'docs/ai-native/**',
  'schemas/**',
  '.github/ai-state/*.example.json',
];

const FORBIDDEN_SCOPES = [
  'src/**',
  'prisma/**',
  'package.json',
  'package-lock.json',
  '.github/ai-policy/seed-constitution.md',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function readNdjsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim())
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function generateEventId() { return crypto.randomUUID(); }

function printHelp() {
  const help = `
propose-external-intake-issues.js — External signal to issue proposal bridge

USAGE
    node scripts/ai/propose-external-intake-issues.js [options]

OPTIONS
    --repo <owner/n>  GitHub repository for dedup (or set GH_REPO env var).
    --execute         Auto-create low/medium-risk issues on GitHub.
                      Default: dry-run (preview only).
    --stdout          Print JSON to stdout instead of writing a file.
    --out <path>      Output path. Default: .github/ai-state/external-intake-proposals.json
    --state-dir <path>  Path to ai-state directory.
    --self-test       Run built-in assertions and exit.
    --help            Show this help message and exit.

EXIT CODES
    0   Proposals produced
    2   Invalid arguments
`.trimStart();
  process.stdout.write(help);
}

// ── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    repo: process.env.GH_REPO || null,
    execute: false,
    stdout: false,
    out: DEFAULT_OUT,
    stateDir: DEFAULT_STATE_DIR,
    selfTest: false,
    help: false,
  };
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { args.help = true; }
    else if (arg === '--repo') { i++; args.repo = argv[i]; }
    else if (arg === '--execute') { args.execute = true; }
    else if (arg === '--stdout') { args.stdout = true; }
    else if (arg === '--out') { i++; args.out = path.resolve(argv[i]); }
    else if (arg === '--state-dir') { i++; args.stateDir = path.resolve(argv[i]); }
    else if (arg === '--self-test') { args.selfTest = true; }
    else { console.error(`Unknown argument: ${arg}`); process.exit(2); }
    i++;
  }
  return args;
}

// ── GitHub CLI ───────────────────────────────────────────────────────────────

function fetchOpenIssues(repo) {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const cmd = `gh issue list --state open --limit 200 ${repoFlag} --json number,title,body,labels`;
  try { return JSON.parse(execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })); }
  catch { return []; }
}

function fetchOpenPRs(repo) {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const cmd = `gh pr list --state open --limit 200 ${repoFlag} --json number,title,body`;
  try { return JSON.parse(execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })); }
  catch { return []; }
}

function createGitHubIssue(repo, title, body, label) {
  const repoFlag = repo ? `--repo ${repo}` : '';
  const cmd = `gh issue create ${repoFlag} --title "${title.replace(/"/g, '\\"')}" --label "${label}" --body-file -`;
  try {
    const result = execSync(cmd, { encoding: 'utf-8', input: body, stdio: ['pipe', 'pipe', 'pipe'] });
    return { url: result.trim(), error: null };
  } catch (err) { return { url: null, error: err.message }; }
}

// ── Deduplication ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'it', 'that', 'this', 'be', 'do', 'add', 'improve', 'update', 'fix', 'create', 'seed', 'implement']);

function extractKeywords(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function titleOverlap(a, b) {
  const kwA = new Set(extractKeywords(a));
  const kwB = new Set(extractKeywords(b));
  if (kwA.size === 0 || kwB.size === 0) return 0;
  let overlap = 0;
  for (const w of kwA) { if (kwB.has(w)) overlap++; }
  return overlap / Math.max(kwA.size, kwB.size);
}

function isDuplicate(title, existingIssues, existingPRs) {
  for (const issue of existingIssues) {
    if (titleOverlap(title, issue.title || '') > 0.5) return true;
  }
  for (const pr of existingPRs) {
    if (titleOverlap(title, pr.title || '') > 0.5) return true;
  }
  return false;
}

// ── Proposal generation ──────────────────────────────────────────────────────

function generateProposalsFromExternalFacts(facts) {
  const proposals = [];

  for (const fact of facts) {
    // Skip genesis/placeholder entries
    if (fact.factType === 'evidence.intake' && fact.subject === 'external-facts ledger initialized') continue;
    if (fact.eventVersion && fact.sourceClass === 'human-instruction' && fact.facts && fact.facts.sourceClass === 'human-instruction') continue;

    // Normalize fields across both schema formats
    // Format A (external-fact.schema.json): entryVersion, factType, subject, claim, sourceReliability, tags
    // Format B (write-external-fact.js output): eventVersion, sourceClass, facts.{topic,pattern,keyInsight,relevance}, reliabilityTier
    const factType = fact.factType || fact.sourceClass || 'unknown';
    const subject = fact.subject || (fact.facts && fact.facts.topic) || 'unknown';
    const claim = fact.claim || (fact.facts && fact.facts.keyInsight) || '';
    const reliability = fact.sourceReliability || fact.reliabilityTier || 'medium';
    const relevance = (fact.facts && fact.facts.relevance) || '';
    const pattern = (fact.facts && fact.facts.pattern) || '';

    // For Format B (write-external-fact.js), all external-doc entries are actionable
    const isExternalDoc = fact.sourceClass === 'external-doc' || (fact.factType && fact.factType.startsWith('external'));
    const hasTags = fact.tags && fact.tags.length > 0;
    const hasActionableContent = isExternalDoc || (fact.facts && fact.facts.keyInsight);

    if (!hasTags && !hasActionableContent) continue;

    const conflictSuffix = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);

    proposals.push({
      title: `Investigate: ${pattern || subject}`.slice(0, 200),
      taskType: 'research',
      risk: 'low',
      conflictGroup: `external-intake-${conflictSuffix}`,
      actorRole: 'research-worker',
      allowedFiles: ['docs/ai-native/**', 'scripts/ai/**'],
      forbiddenFiles: FORBIDDEN_SCOPES,
      validationCommands: ['npm run check'],
      rationale: `External research (${factType}): ${claim}${relevance ? ` Relevance: ${relevance}` : ''}`,
      evidence: `Source reliability: ${reliability}. Captured at: ${fact.capturedAt}. Source: ${fact.sourceUrl || 'N/A'}.`,
      rollbackFollowUp: 'If the investigation finds no actionable improvement, close the issue with a summary of findings.',
      macroGoal: 'external-intake-bridge',
      sourceFactId: fact.entryId || null,
      sourceReliability: reliability,
    });
  }

  return proposals;
}

function generateProposalsFromOpportunitySignals(signals) {
  const proposals = [];

  for (const signal of signals) {
    // Skip signals already promoted or rejected
    if (signal.status === 'rejected' || signal.status === 'accepted') continue;
    if (signal.promotedTaskId) continue;

    const hypothesis = signal.hypothesis || {};
    const experiment = signal.proposedExperiment || {};
    const impact = signal.expectedImpact || {};
    const risk = signal.risk || { level: 'low', concerns: [] };

    const title = `Experiment: ${hypothesis.claim || 'Unnamed opportunity'}`.slice(0, 200);

    proposals.push({
      title,
      taskType: 'execution',
      risk: risk.level || 'low',
      conflictGroup: `opportunity-${(signal.signalId || 'unknown').replace('opp-', '')}`,
      actorRole: 'experiment-worker',
      allowedFiles: ['scripts/ai/**', 'docs/ai-native/**', 'schemas/**'],
      forbiddenFiles: FORBIDDEN_SCOPES,
      validationCommands: ['npm run check'],
      rationale: `Opportunity signal ${signal.signalId}: ${hypothesis.claim || 'No claim'}. Reasoning: ${hypothesis.reasoning || 'Not specified'}`,
      evidence: `Source facts: ${(signal.sourceFacts || []).map(f => f.description || f.factId || '?').join(', ')}. Expected impact: ${impact.metric || '?'} from ${impact.currentValue || '?'} to ${impact.targetValue || '?'}.`,
      rollbackFollowUp: experiment.rollbackPlan || 'Revert changes if experiment fails success criteria.',
      macroGoal: 'opportunity-experiment',
      opportunitySignalId: signal.signalId,
      experimentType: experiment.type || 'code-change',
      successCriteria: experiment.successCriteria || [],
    });
  }

  return proposals;
}

// ── Audit logging ────────────────────────────────────────────────────────────

function writeAuditEvent(stateDir, eventType, detail) {
  const auditPath = path.join(stateDir, AUDIT_FILE);
  const event = {
    eventVersion: 1,
    eventType,
    eventId: generateEventId(),
    capturedAt: new Date().toISOString(),
    ...detail,
  };
  fs.appendFileSync(auditPath, JSON.stringify(event) + '\n', 'utf8');
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);

  if (args.help) { printHelp(); process.exit(0); }

  if (args.selfTest) {
    console.log('propose-external-intake-issues.js — self-test');
    // Basic assertions
    let passed = 0;
    let failed = 0;
    function assert(cond, msg) { if (cond) passed++; else { failed++; console.error(`  FAIL: ${msg}`); } }

    // Test: empty facts produce no proposals
    assert(generateProposalsFromExternalFacts([]).length === 0, 'empty facts -> 0 proposals');

    // Test: genesis entry is skipped (Format A)
    assert(generateProposalsFromExternalFacts([{
      entryVersion: 1, factType: 'evidence.intake', subject: 'external-facts ledger initialized',
      claim: 'init', capturedAt: '2026-01-01T00:00:00Z', sourceReliability: 'verified'
    }]).length === 0, 'genesis entry skipped (Format A)');

    // Test: genesis entry is skipped (Format B — write-external-fact.js)
    assert(generateProposalsFromExternalFacts([{
      eventVersion: 1, sourceClass: 'human-instruction', capturedAt: '2026-01-01T00:00:00Z',
      facts: { sourceClass: 'human-instruction', sanitized: true }
    }]).length === 0, 'genesis entry skipped (Format B)');

    // Test: actionable fact produces proposal (Format A)
    const actionableFact = {
      entryVersion: 1, factType: 'perf.degradation', subject: 'API latency',
      claim: 'API p99 latency increased 50%', capturedAt: '2026-01-01T00:00:00Z',
      sourceReliability: 'observed', tags: ['performance'],
    };
    const factProposals = generateProposalsFromExternalFacts([actionableFact]);
    assert(factProposals.length === 1, 'actionable fact (Format A) -> 1 proposal');
    assert(factProposals[0].risk === 'low', 'fact proposal risk is low');
    assert(factProposals[0].taskType === 'research', 'fact proposal is research');

    // Test: actionable fact produces proposal (Format B — write-external-fact.js)
    const formatBFact = {
      eventVersion: 1, sourceClass: 'external-doc', capturedAt: '2026-01-01T00:00:00Z',
      sourceUrl: 'https://example.com', actor: 'research-intake', reliabilityTier: 'high', sanitized: true,
      facts: { topic: 'agent-orchestration', pattern: 'graph-based', keyInsight: 'Graphs enable parallel', relevance: 'LIAN wave planning' },
    };
    const formatBProposals = generateProposalsFromExternalFacts([formatBFact]);
    assert(formatBProposals.length === 1, 'external-doc (Format B) -> 1 proposal');
    assert(formatBProposals[0].conflictGroup.includes('agent-orchestration'), 'conflictGroup from topic');

    // Test: opportunity signal produces proposal
    const oppSignal = {
      schemaVersion: 1, signalId: 'opp-test-001', createdAt: '2026-01-01T00:00:00Z',
      status: 'validated',
      sourceFacts: [{ factId: 'fact:test:latency', description: 'High latency', source: 'monitoring' }],
      hypothesis: { claim: 'Caching reduces latency', reasoning: 'Similar projects benefit' },
      expectedImpact: { metric: 'p99', currentValue: '500ms', targetValue: '200ms' },
      proposedExperiment: { type: 'code-change', description: 'Add cache layer', scope: 'api/**',
        rollbackPlan: 'Remove cache', successCriteria: ['p99 < 300ms'] },
      risk: { level: 'medium', concerns: ['cache invalidation'] },
      requiredGate: { requiredReviewRoles: ['tech-lead'], acceptanceOwner: 'taoyu', criteria: ['tests pass'] },
      relevance: { applicability: 'direct', lianSurface: 'API layer' },
      executionBlock: { directExecutionBlocked: true, reason: 'Opportunity signals must pass through bounded experiment gating before any task creation. Direct execution authority is not granted.' },
    };
    const oppProposals = generateProposalsFromOpportunitySignals([oppSignal]);
    assert(oppProposals.length === 1, 'opportunity signal -> 1 proposal');
    assert(oppProposals[0].risk === 'medium', 'opp proposal risk is medium');
    assert(oppProposals[0].taskType === 'execution', 'opp proposal is execution');

    // Test: rejected signal is skipped
    const rejectedSignal = { ...oppSignal, signalId: 'opp-test-002', status: 'rejected' };
    assert(generateProposalsFromOpportunitySignals([rejectedSignal]).length === 0, 'rejected signal skipped');

    // Test: promoted signal is skipped
    const promotedSignal = { ...oppSignal, signalId: 'opp-test-003', status: 'scheduled', promotedTaskId: 'task-001' };
    assert(generateProposalsFromOpportunitySignals([promotedSignal]).length === 0, 'promoted signal skipped');

    // Test: dedup
    assert(isDuplicate('Investigate external signal: API latency', [{ title: 'Investigate API latency issue' }], []), 'title overlap detected');
    assert(!isDuplicate('Brand new unrelated task', [{ title: 'Fix auth bug' }], []), 'no false positive overlap');

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // Read signals
  const externalFacts = readNdjsonFile(path.join(args.stateDir, 'external-facts.ndjson'));
  // Read opportunity signals from both JSON and NDJSON formats
  const opportunitySignalsData = readJsonFile(path.join(args.stateDir, 'opportunity-signals.json'));
  const opportunitySignalsNddjson = readNdjsonFile(path.join(args.stateDir, 'opportunity-signals.ndjson'));
  const opportunitySignals = [
    ...((opportunitySignalsData && opportunitySignalsData.signals) || []),
    ...opportunitySignalsNddjson,
  ];

  // Generate proposals
  const factProposals = generateProposalsFromExternalFacts(externalFacts);
  const oppProposals = generateProposalsFromOpportunitySignals(opportunitySignals);
  const allProposals = [...factProposals, ...oppProposals];

  // Dedup against existing issues/PRs
  const existingIssues = fetchOpenIssues(args.repo);
  const existingPRs = fetchOpenPRs(args.repo);

  const eligible = [];
  const skipped = [];

  for (const proposal of allProposals) {
    if (isDuplicate(proposal.title, existingIssues, existingPRs)) {
      skipped.push({ title: proposal.title, reason: 'duplicate' });
      continue;
    }
    eligible.push(proposal);
  }

  // Build output
  const output = {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    label: 'agent:codex-action-needed',
    mode: args.execute ? 'execute' : 'dry-run',
    source: 'external-intake-bridge',
    externalFactCount: externalFacts.length,
    opportunitySignalCount: opportunitySignals.length,
    proposals: eligible,
    skippedDuplicates: skipped,
  };

  // Execute mode: create issues
  if (args.execute) {
    for (const proposal of eligible) {
      const body = [
        `## Goal\n${proposal.rationale}`,
        `## Evidence\n${proposal.evidence}`,
        `## Rollback / Follow-up\n${proposal.rollbackFollowUp}`,
        '',
        '---',
        'CONTROL APPENDIX (external-intake bridge generated)',
        `Task type: ${proposal.taskType}`,
        `Risk: ${proposal.risk}`,
        `Conflict group: ${proposal.conflictGroup}`,
        `Target issue:`,
        `Target PR:`,
        `Issues:`,
        `Expected PR: True`,
        `Allowed files:\n${proposal.allowedFiles.map(f => `- ${f}`).join('\n')}`,
        `Forbidden files:\n${proposal.forbiddenFiles.map(f => `- ${f}`).join('\n')}`,
        `Validation commands:\n${proposal.validationCommands.map(c => `- ${c}`).join('\n')}`,
        '',
        `Role packet:\nActor role: ${proposal.actorRole}`,
        `Macro goal: ${proposal.macroGoal}`,
      ].join('\n');

      const result = createGitHubIssue(args.repo, proposal.title, body, 'agent:codex-action-needed');
      if (result.url) {
        writeAuditEvent(args.stateDir, 'create', { title: proposal.title, url: result.url });
        console.log(`Created: ${result.url}`);
      } else {
        writeAuditEvent(args.stateDir, 'create-failed', { title: proposal.title, error: result.error });
        console.error(`Failed: ${proposal.title} — ${result.error}`);
      }
    }
  }

  // Output
  const json = JSON.stringify(output, null, 2) + '\n';
  if (args.stdout) {
    process.stdout.write(json);
  } else {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, json, 'utf8');
    console.log(`External intake proposals: ${eligible.length} eligible, ${skipped.length} skipped`);
    console.log(`Written to ${path.relative(REPO_ROOT, args.out).replace(/\\/g, '/')}`);
  }

  // Audit log
  writeAuditEvent(args.stateDir, 'propose', {
    externalFactCount: externalFacts.length,
    opportunitySignalCount: opportunitySignals.length,
    proposalCount: eligible.length,
    skippedCount: skipped.length,
  });
}

main();
