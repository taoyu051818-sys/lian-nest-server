#!/usr/bin/env node

/**
 * check-pr-handoff.test.js
 *
 * Self-contained tests for the PR handoff guard. No external test framework.
 * Run: node scripts/guards/check-pr-handoff.test.js
 */

const { validate, findSections, headingMatches, extractSectionBody, validateEvidence, REQUIRED_SECTIONS } = require('./check-pr-handoff');

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
    '- Ran tests → PASS',
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
  assert(Array.isArray(result.warnings), 'result.warnings is array');
}

// 10. Body with extra non-required headings still passes
{
  const extraHeadings = fullBody() + '\n\n## Deployment\n- Auto\n\n## Screenshots\n- N/A';
  const result = validate(extraHeadings);
  assert(result.ok === true, 'body with extra non-required headings passes');
}

// --- Validation evidence tests ---

// 11. Validation section with PASS/FAIL evidence produces no warnings
{
  const result = validate(fullBody());
  assert(result.warnings.length === 0, 'PASS/FAIL evidence produces no warnings');
}

// 12. Empty Validation section produces warning
{
  const body = [
    '## Summary',
    '- Something',
    '',
    '## Changed files',
    '- file.js',
    '',
    '## Linked issues',
    'Closes #1',
    '',
    '## Validation',
    '',
    '## Non-goals',
    '- Not this',
    '',
    '## Risk',
    '- Low',
    '',
    '## Handoff',
    '- Done',
  ].join('\n');
  const result = validate(body);
  assert(result.ok === false, 'empty Validation section fails evidence check');
  assert(result.warnings.length === 1, 'empty Validation section produces one warning');
  assert(result.warnings[0].includes('empty'), 'warning mentions empty');
}

// 13. Validation section without PASS/FAIL produces warning
{
  const body = [
    '## Summary',
    '- Something',
    '',
    '## Changed files',
    '- file.js',
    '',
    '## Linked issues',
    'Closes #1',
    '',
    '## Validation',
    '- Ran tests manually',
    '- Checked output',
    '',
    '## Non-goals',
    '- Not this',
    '',
    '## Risk',
    '- Low',
    '',
    '## Handoff',
    '- Done',
  ].join('\n');
  const result = validate(body);
  assert(result.ok === false, 'Validation without PASS/FAIL fails evidence check');
  assert(result.warnings.length === 1, 'Validation without PASS/FAIL produces one warning');
  assert(result.warnings[0].includes('PASS/FAIL'), 'warning mentions PASS/FAIL');
}

// 14. Missing Validation section produces no evidence warning (section missing handles it)
{
  const body = [
    '## Summary',
    '- Something',
    '',
    '## Changed files',
    '- file.js',
    '',
    '## Linked issues',
    'Closes #1',
    '',
    '## Non-goals',
    '- Not this',
    '',
    '## Risk',
    '- Low',
    '',
    '## Handoff',
    '- Done',
  ].join('\n');
  const result = validate(body);
  assert(result.ok === false, 'missing Validation fails');
  assert(result.warnings.length === 0, 'missing Validation produces no evidence warnings');
}

// 15. extractSectionBody returns correct content
{
  const body = '## Summary\n- Line 1\n\n## Validation\n- cmd: PASS\n- other: FAIL\n\n## Other\n- Ignored';
  const section = extractSectionBody(body, ['validation']);
  assert(section.includes('cmd: PASS'), 'extractSectionBody captures validation content');
  assert(!section.includes('Line 1'), 'extractSectionBody excludes prior section');
  assert(!section.includes('Ignored'), 'extractSectionBody excludes next section');
}

// 16. Validation with FAIL result produces no warning (FAIL is valid evidence)
{
  const body = fullBody().replace('PASS', 'FAIL');
  const result = validate(body);
  assert(result.warnings.length === 0, 'FAIL result produces no warning');
}

// 17. Validation with mixed case PASS/FAIL is recognized
{
  const body = [
    '## Summary',
    '- Something',
    '',
    '## Changed files',
    '- file.js',
    '',
    '## Linked issues',
    'Closes #1',
    '',
    '## Validation',
    '- npm run build: pass (exit 0)',
    '',
    '## Non-goals',
    '- Not this',
    '',
    '## Risk',
    '- Low',
    '',
    '## Handoff',
    '- Done',
  ].join('\n');
  const result = validate(body);
  assert(result.warnings.length === 0, 'lowercase pass is recognized');
}

// --- Validation evidence regression tests ---

// 18. Regression: empty Validation causes ok=false (not just a warning)
{
  const body = [
    '## Summary',
    '- Something',
    '',
    '## Changed files',
    '- file.js',
    '',
    '## Linked issues',
    'Closes #1',
    '',
    '## Validation',
    '',
    '## Non-goals',
    '- Not this',
    '',
    '## Risk',
    '- Low',
    '',
    '## Handoff',
    '- Done',
  ].join('\n');
  const result = validate(body);
  assert(result.ok === false, 'regression: empty Validation section fails guard');
  assert(result.missing.length === 0, 'regression: no missing sections when Validation is present but empty');
  assert(result.warnings.length === 1, 'regression: empty Validation produces exactly one warning');
}

// 19. Regression: Validation with only whitespace fails
{
  const body = [
    '## Summary',
    '- Something',
    '',
    '## Changed files',
    '- file.js',
    '',
    '## Linked issues',
    'Closes #1',
    '',
    '## Validation',
    '   ',
    '  ',
    '',
    '## Non-goals',
    '- Not this',
    '',
    '## Risk',
    '- Low',
    '',
    '## Handoff',
    '- Done',
  ].join('\n');
  const result = validate(body);
  assert(result.ok === false, 'regression: whitespace-only Validation fails guard');
  assert(result.warnings[0].includes('empty'), 'regression: whitespace-only Validation warns about empty');
}

// 20. Regression: Validation with commands but no PASS/FAIL fails
{
  const body = [
    '## Summary',
    '- Something',
    '',
    '## Changed files',
    '- file.js',
    '',
    '## Linked issues',
    'Closes #1',
    '',
    '## Validation',
    '- node scripts/guards/check-pr-handoff.test.js',
    '- npm run check',
    '',
    '## Non-goals',
    '- Not this',
    '',
    '## Risk',
    '- Low',
    '',
    '## Handoff',
    '- Done',
  ].join('\n');
  const result = validate(body);
  assert(result.ok === false, 'regression: Validation with commands but no PASS/FAIL fails');
  assert(result.warnings.some((w) => /PASS\/FAIL/.test(w)), 'regression: missing PASS/FAIL warning present');
}

// 21. Regression: Validation with PASS evidence passes
{
  const body = [
    '## Summary',
    '- Something',
    '',
    '## Changed files',
    '- file.js',
    '',
    '## Linked issues',
    'Closes #1',
    '',
    '## Validation',
    '- node scripts/guards/check-pr-handoff.test.js → PASS',
    '- npm run check → PASS',
    '',
    '## Non-goals',
    '- Not this',
    '',
    '## Risk',
    '- Low',
    '',
    '## Handoff',
    '- Done',
  ].join('\n');
  const result = validate(body);
  assert(result.ok === true, 'regression: PASS evidence passes guard');
  assert(result.warnings.length === 0, 'regression: PASS evidence produces no warnings');
}

// 22. Regression: mixed PASS and FAIL results pass (both are valid evidence)
{
  const body = [
    '## Summary',
    '- Something',
    '',
    '## Changed files',
    '- file.js',
    '',
    '## Linked issues',
    'Closes #1',
    '',
    '## Validation',
    '- npm run build → PASS',
    '- npm test → FAIL (expected, test not yet written)',
    '',
    '## Non-goals',
    '- Not this',
    '',
    '## Risk',
    '- Low',
    '',
    '## Handoff',
    '- Done',
  ].join('\n');
  const result = validate(body);
  assert(result.ok === true, 'regression: mixed PASS/FAIL evidence passes guard');
  assert(result.warnings.length === 0, 'regression: mixed PASS/FAIL produces no warnings');
}

// 23. Regression: multiple validation commands without evidence all fail together
{
  const body = [
    '## Summary',
    '- Something',
    '',
    '## Changed files',
    '- file.js',
    '',
    '## Linked issues',
    'Closes #1',
    '',
    '## Validation',
    '```\nnpm run check\nnpm run build\nnpm test\n```',
    '',
    '## Non-goals',
    '- Not this',
    '',
    '## Risk',
    '- Low',
    '',
    '## Handoff',
    '- Done',
  ].join('\n');
  const result = validate(body);
  assert(result.ok === false, 'regression: code block without PASS/FAIL fails');
  assert(result.warnings.length === 1, 'regression: produces exactly one evidence warning');
}

// --- Summary ---

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed > 0 ? 1 : 0);
