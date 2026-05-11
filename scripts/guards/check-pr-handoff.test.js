#!/usr/bin/env node

/**
 * check-pr-handoff.test.js
 *
 * Self-contained tests for the PR handoff guard. No external test framework.
 * Run: node scripts/guards/check-pr-handoff.test.js
 */

const { validate, findSections, headingMatches, REQUIRED_SECTIONS } = require('./check-pr-handoff');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    console.error('  FAIL  ' + name);
  }
}

// --- Helpers ---

function fullBody() {
  return [
    '## Summary',
    '- Add PR handoff guard script',
    '',
    '## Changed files',
    '- scripts/guards/check-pr-handoff.js',
    '- scripts/guards/check-pr-handoff.test.js',
    '',
    '## Linked issues',
    'Closes #110',
    '',
    '## Validation',
    '```\nnode scripts/guards/check-pr-handoff.test.js  → PASS\n```',
    '',
    '## Non-goals',
    '- No runtime changes',
    '',
    '## Risk / rollback',
    'Low risk. Revert commit to rollback.',
    '',
    '## Follow-up handoff',
    '- None required',
  ].join('\n');
}

// --- Tests ---

console.log('\ncheck-pr-handoff tests\n');

// 1. Full valid body passes
{
  const result = validate(fullBody());
  assert(result.ok === true, 'full valid body passes');
  assert(result.missing.length === 0, 'full valid body has no missing sections');
  assert(result.found.length === REQUIRED_SECTIONS.length, 'full valid body finds all sections');
}

// 2. Empty body fails with all sections missing
{
  const result = validate('');
  assert(result.ok === false, 'empty body fails');
  assert(result.missing.length === REQUIRED_SECTIONS.length, 'empty body missing all sections');
}

// 3. Missing each individual section fails
for (const section of REQUIRED_SECTIONS) {
  const lines = fullBody().split('\n');
  const filtered = lines.filter((line) => {
    if (/^#{1,6}\s/.test(line)) {
      const normalized = line.replace(/^#+\s*/, '').trim().toLowerCase();
      return !section.aliases.some((a) => a === normalized);
    }
    return true;
  });
  const body = filtered.join('\n');
  const result = validate(body);
  assert(result.ok === false, `missing "${section.canonical}" fails`);
  assert(result.missing.includes(section.canonical), `missing "${section.canonical}" reported in missing list`);
}

// 4. Common heading aliases are accepted
{
  const aliasBody = [
    '## Overview',
    '- Something',
    '',
    '## Files changed',
    '- file.js',
    '',
    '## Issue',
    'Closes #1',
    '',
    '## Test plan',
    '- Ran tests',
    '',
    '## Out of scope',
    '- Not this',
    '',
    '## Risk',
    '- Low',
    '',
    '## Handoff',
    '- Done',
  ].join('\n');
  const result = validate(aliasBody);
  assert(result.ok === true, 'common aliases (Overview, Files changed, Issue, Test plan, Out of scope, Risk, Handoff) all pass');
}

// 5. Docs-only PR body (all sections present) passes
{
  const docsBody = [
    '## Summary',
    '- Update migration docs',
    '',
    '## Changed files',
    '- docs/migration/README.md',
    '',
    '## Linked issues',
    'Refs #50',
    '',
    '## Validation',
    '```\nnpm run build  → PASS\n```',
    '',
    '## Non-goals',
    '- No code changes',
    '',
    '## Risk / rollback',
    'Docs only. Low risk.',
    '',
    '## Follow-up handoff',
    '- None',
  ].join('\n');
  const result = validate(docsBody);
  assert(result.ok === true, 'docs-only PR with all sections passes');
}

// 6. Runtime PR body missing validation evidence fails
{
  const runtimeBody = [
    '## Summary',
    '- Fix auth guard',
    '',
    '## Changed files',
    '- src/auth/auth.guard.ts',
    '',
    '## Linked issues',
    'Closes #42',
    '',
    '## Non-goals',
    '- No new endpoints',
    '',
    '## Risk / rollback',
    'Medium risk. Revert commit.',
    '',
    '## Follow-up handoff',
    '- Monitor error rates',
  ].join('\n');
  const result = validate(runtimeBody);
  assert(result.ok === false, 'runtime PR missing Validation section fails');
  assert(result.missing.includes('Validation'), 'Validation reported missing for runtime PR');
}

// 7. headingMatches recognizes h2 and h3 headings
{
  assert(headingMatches('## Summary', REQUIRED_SECTIONS[0]), 'h2 heading matches');
  assert(headingMatches('### Summary', REQUIRED_SECTIONS[0]), 'h3 heading matches');
  assert(headingMatches('#### Linked issues', REQUIRED_SECTIONS[2]), 'h4 heading matches');
  assert(!headingMatches('Not a heading', REQUIRED_SECTIONS[0]), 'non-heading line does not match');
  assert(!headingMatches('## Unknown section', REQUIRED_SECTIONS[0]), 'wrong heading does not match');
}

// 8. findSections returns correct set
{
  const found = findSections(fullBody());
  assert(found.size === REQUIRED_SECTIONS.length, 'findSections returns correct count');
  assert(found.has('Summary'), 'findSections finds Summary');
  assert(found.has('Follow-up handoff'), 'findSections finds Follow-up handoff');
}

// 9. validate output structure
{
  const result = validate(fullBody());
  assert(typeof result.ok === 'boolean', 'result.ok is boolean');
  assert(Array.isArray(result.found), 'result.found is array');
  assert(Array.isArray(result.missing), 'result.missing is array');
}

// 10. Body with extra non-required headings still passes
{
  const extraHeadings = fullBody() + '\n\n## Deployment\n- Auto\n\n## Screenshots\n- N/A';
  const result = validate(extraHeadings);
  assert(result.ok === true, 'body with extra non-required headings passes');
}

// --- Summary ---

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed > 0 ? 1 : 0);
