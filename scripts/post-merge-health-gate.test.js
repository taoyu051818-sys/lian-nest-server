/**
 * post-merge-health-gate.test.js
 *
 * Tests for the post-merge health gate script.
 * Run: node scripts/post-merge-health-gate.test.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'post-merge-health-gate.js');
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

function run(args = []) {
  try {
    const out = execSync(`node "${SCRIPT}" ${args.join(' ')}`, {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 180_000,
      env: { ...process.env, NODE_ENV: 'test' },
    });
    return { code: 0, stdout: out.toString(), stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
}

// --- Tests ---

console.log('post-merge-health-gate.js tests');
console.log('='.repeat(50));

// Help output
console.log('\n--help flag');
{
  const res = run(['--help']);
  assert(res.code === 0, '--help exits 0');
  assert(res.stdout.includes('--quick'), 'help mentions --quick');
  assert(res.stdout.includes('--full'), 'help mentions --full');
  assert(res.stdout.includes('EXIT CODES'), 'help shows exit codes');
  assert(res.stdout.includes('FAILURE CATEGORIES'), 'help shows failure categories');
  assert(res.stdout.includes('database foundation'), 'help mentions database foundation category');
  assert(res.stdout.includes('dependency/generate'), 'help mentions dependency/generate category');
}

// Invalid args
console.log('\ninvalid arguments');
{
  const res = run(['--bogus']);
  assert(res.code === 2, 'unknown flag exits 2');
}

// Combined flags
console.log('\ncombined --quick --full');
{
  const res = run(['--quick', '--full']);
  assert(res.code === 2, 'combined flags exits 2');
}

// Quick mode
console.log('\n--quick mode');
{
  const res = run(['--quick']);
  assert(res.stdout.includes('Post-merge health gate [quick]'), 'shows quick mode header');
  assert(res.stdout.includes('npm run check'), 'runs tsc check');
  assert(res.stdout.includes('npm run build'), 'runs build');
}

// Default (no args) behaves like --quick
console.log('\ndefault mode (no args)');
{
  const res = run([]);
  assert(res.stdout.includes('Post-merge health gate [quick]'), 'default is quick mode');
}

// --- Prisma client error classification (unit tests) ---
console.log('\nPrisma client error classification');
{
  const { categorize, refineCategory } = require(SCRIPT);

  // Label-based categorization still works
  assert(categorize('npm run check') === 'conflict refresh', 'tsc label → conflict refresh');
  assert(categorize('npm run build') === 'runtime compile', 'build label → runtime compile');
  assert(categorize('npm run test:boundary') === 'boundary guard', 'boundary label → boundary guard');

  // Prisma error patterns re-classify to dependency/generate
  const prismaOutputs = [
    'error TS2305: Module "@prisma/client" has no exported member PrismaClient',
    "Cannot find module '@prisma/client' from 'src/database'",
    "Cannot find module 'prisma/config' from 'node_modules/@prisma/client'",
    "Property '$connect' does not exist on type 'PrismaClient'",
    "Property '$disconnect' does not exist on type 'typeof PrismaClient'",
  ];

  for (const output of prismaOutputs) {
    const result = refineCategory('runtime compile', output);
    assert(result === 'dependency/generate',
      `Prisma pattern re-classified: "${output.substring(0, 60)}..." → dependency/generate`);
  }

  // Non-Prisma errors are not re-classified
  assert(refineCategory('runtime compile', 'error TS2322: Type string is not assignable') === 'runtime compile',
    'non-Prisma TS error stays runtime compile');
  assert(refineCategory('conflict refresh', 'src/app.ts(10,5): error TS1005') === 'conflict refresh',
    'non-Prisma conflict stays conflict refresh');

  // Empty/undefined output returns original category
  assert(refineCategory('test env', '') === 'test env', 'empty output returns original');
  assert(refineCategory('test env', undefined) === 'test env', 'undefined output returns original');
}

// --- Guard integration tests ---
console.log('\nGuard integration');
{
  const { GUARD_SCRIPTS, detectAvailableGuards } = require(SCRIPT);

  // GUARD_SCRIPTS defines the expected guards
  assert(typeof GUARD_SCRIPTS === 'object', 'GUARD_SCRIPTS is an object');
  assert('task boundary' in GUARD_SCRIPTS, 'defines task boundary guard');
  assert('pr handoff' in GUARD_SCRIPTS, 'defines pr handoff guard');
  assert('docs authority' in GUARD_SCRIPTS, 'defines docs authority guard');

  // Each guard has required properties
  for (const [name, guard] of Object.entries(GUARD_SCRIPTS)) {
    assert(typeof guard.script === 'string', `${name} has script path`);
    assert(typeof guard.hasInputs === 'function', `${name} has hasInputs function`);
    assert(typeof guard.buildArgs === 'function', `${name} has buildArgs function`);
    assert(Array.isArray(guard.buildArgs()), `${name} buildArgs returns array`);
  }

  // detectAvailableGuards returns an array
  const available = detectAvailableGuards();
  assert(Array.isArray(available), 'detectAvailableGuards returns array');

  // docs authority guard should be available (docs/ directory exists)
  assert(available.some(g => g.name === 'docs authority'),
    'docs authority guard is available when docs/ exists');
}

// Help mentions guard warnings
console.log('\n--help flag (guard section)');
{
  const res = run(['--help']);
  assert(res.code === 0, '--help exits 0');
  assert(res.stdout.includes('GUARD WARNINGS'), 'help mentions GUARD WARNINGS section');
  assert(res.stdout.includes('task boundary'), 'help mentions task boundary guard');
  assert(res.stdout.includes('pr handoff'), 'help mentions pr handoff guard');
  assert(res.stdout.includes('docs authority'), 'help mentions docs authority guard');
  assert(res.stdout.includes('non-blocking'), 'help states guards are non-blocking');
}

// --- Issue-to-task compiler tests ---
console.log('\ncompile-issue-to-task-json.ps1');
console.log('-'.repeat(50));

const COMPILER = path.join(__dirname, 'ai', 'compile-issue-to-task-json.ps1');
const canTestCompiler = fs.existsSync(COMPILER);

function runPwsh(script, args = []) {
  try {
    const out = execSync(`pwsh -NoProfile -File "${script}" ${args.join(' ')}`, {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return { code: 0, stdout: out.toString(), stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
}

function runPwshWithInput(script, jsonInput) {
  try {
    const out = execSync(`pwsh -NoProfile -Command "& { '${jsonInput.replace(/'/g, "''")}' | & '${script}' }"`, {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return { code: 0, stdout: out.toString(), stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
}

if (canTestCompiler) {
  // --help flag
  console.log('\ncompiler --help');
  {
    const res = runPwsh(COMPILER, ['-Help']);
    assert(res.code === 0, '--help exits 0');
    assert(res.stdout.includes('USAGE'), 'help shows USAGE');
    assert(res.stdout.includes('OPTIONS'), 'help shows OPTIONS');
    assert(res.stdout.includes('LLM CONTRACT'), 'help shows LLM CONTRACT section');
    assert(res.stdout.includes('EXIT CODES'), 'help shows EXIT CODES');
    assert(res.stdout.includes('llmExtracted'), 'help mentions llmExtracted');
    assert(res.stdout.includes('deterministic'), 'help mentions deterministic fallback');
  }

  // Missing required fields → exit 1
  console.log('\ncompiler rejects underspecified input');
  {
    const tmpFile = path.join(os.tmpdir(), `compiler-test-missing-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify({ targetIssue: 999, taskType: 'execution' }));
    const res = runPwsh(COMPILER, ['-IssueFile', tmpFile]);
    assert(res.code === 1, 'missing required fields exits 1');
    assert(res.stdout.includes('Missing required fields'), 'reports missing fields');
    fs.unlinkSync(tmpFile);
  }

  // Deterministic fallback — minimal valid input without llmExtracted
  console.log('\ncompiler deterministic fallback (no llmExtracted)');
  {
    const tmpFile = path.join(os.tmpdir(), `compiler-test-det-${Date.now()}.json`);
    const issue = {
      targetIssue: 258,
      taskType: 'execution',
      risk: 'medium',
      conflictGroup: 'test-group',
      allowedFiles: ['scripts/ai/compile-issue-to-task-json.ps1'],
      validationCommands: ['npm run check'],
      rolePacket: { actorRole: 'test-worker', description: 'Test worker' },
    };
    fs.writeFileSync(tmpFile, JSON.stringify(issue));
    const res = runPwsh(COMPILER, ['-IssueFile', tmpFile, '-DryRun']);
    assert(res.code === 0, 'deterministic input exits 0');
    assert(res.stdout.includes('taskType'), 'output contains taskType');
    assert(!res.stdout.includes('LLM contract'), 'no LLM contract validation for deterministic input');
    fs.unlinkSync(tmpFile);
  }

  // LLM contract: llmExtracted=true with semantic fields present
  console.log('\ncompiler LLM contract (valid)');
  {
    const tmpFile = path.join(os.tmpdir(), `compiler-test-llm-valid-${Date.now()}.json`);
    const issue = {
      targetIssue: 258,
      taskType: 'execution',
      risk: 'medium',
      conflictGroup: 'test-group',
      allowedFiles: ['scripts/ai/compile-issue-to-task-json.ps1'],
      validationCommands: ['npm run check'],
      rolePacket: { actorRole: 'test-worker', description: 'Test worker' },
      llmExtracted: true,
      knowledgeRefs: ['docs/ai-native/issue-to-task-compiler.md'],
      promptHandoff: 'Harden the issue-to-task compiler with LLM contract.',
    };
    fs.writeFileSync(tmpFile, JSON.stringify(issue));
    const res = runPwsh(COMPILER, ['-IssueFile', tmpFile, '-DryRun']);
    assert(res.code === 0, 'LLM-valid input exits 0');
    assert(res.stdout.includes('LLM contract'), 'shows LLM contract validation');
    assert(res.stdout.includes('semantic fields present'), 'confirms semantic fields present');
    fs.unlinkSync(tmpFile);
  }

  // LLM contract: llmExtracted=true with missing semantic fields → warns
  console.log('\ncompiler LLM contract (missing semantic fields)');
  {
    const tmpFile = path.join(os.tmpdir(), `compiler-test-llm-warn-${Date.now()}.json`);
    const issue = {
      targetIssue: 258,
      taskType: 'execution',
      risk: 'medium',
      conflictGroup: 'test-group',
      allowedFiles: ['scripts/ai/compile-issue-to-task-json.ps1'],
      validationCommands: ['npm run check'],
      rolePacket: { actorRole: 'test-worker', description: 'Test worker' },
      llmExtracted: true,
    };
    fs.writeFileSync(tmpFile, JSON.stringify(issue));
    const res = runPwsh(COMPILER, ['-IssueFile', tmpFile, '-DryRun']);
    assert(res.code === 0, 'LLM-incomplete input still exits 0 (warns, does not block)');
    assert(res.stdout.includes('WARN'), 'shows WARN for missing semantic fields');
    assert(res.stdout.includes('knowledgeRefs'), 'warns about missing knowledgeRefs');
    assert(res.stdout.includes('promptHandoff'), 'warns about missing promptHandoff');
    fs.unlinkSync(tmpFile);
  }

  // llmExtracted=false is treated as deterministic
  console.log('\ncompiler llmExtracted=false (deterministic path)');
  {
    const tmpFile = path.join(os.tmpdir(), `compiler-test-llm-false-${Date.now()}.json`);
    const issue = {
      targetIssue: 258,
      taskType: 'execution',
      risk: 'medium',
      conflictGroup: 'test-group',
      allowedFiles: ['scripts/ai/compile-issue-to-task-json.ps1'],
      validationCommands: ['npm run check'],
      rolePacket: { actorRole: 'test-worker', description: 'Test worker' },
      llmExtracted: false,
    };
    fs.writeFileSync(tmpFile, JSON.stringify(issue));
    const res = runPwsh(COMPILER, ['-IssueFile', tmpFile, '-DryRun']);
    assert(res.code === 0, 'llmExtracted=false exits 0');
    assert(!res.stdout.includes('LLM contract'), 'no LLM contract validation when llmExtracted=false');
    fs.unlinkSync(tmpFile);
  }
} else {
  console.log('\nSKIPPED: compile-issue-to-task-json.ps1 not found');
}

// --- Summary ---
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
