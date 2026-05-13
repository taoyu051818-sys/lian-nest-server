# Agent Lifecycle Hooks

Feasibility assessment of Claude Code hooks as a defense-in-depth layer
for forbiddenFiles enforcement at the tool-call level.

> **Closes:** [#1365](https://github.com/taoyu051818-sys/lian-nest-server/issues/1365)
>
> **See also:**
> [seed-constitution.md](seed-constitution.md) for immutable boundaries,
> [worker-behavior-policy.md](worker-behavior-policy.md) for behavioral
> principles, [worker-task-contract.md](worker-task-contract.md) for
> task JSON schema.

---

## Current Enforcement Model

Constitution rules (seed-constitution.md) are enforced at two layers:

| Layer | When | Mechanism | Blocks? |
|-------|------|-----------|:-------:|
| **Task contract** | Before launch | `allowedFiles` / `forbiddenFiles` in task JSON | No (advisory) |
| **Pre-merge guard** | After PR opened | `check-task-boundary.js` validates diff | Yes (CI fail) |

Gap: neither layer blocks a worker *during execution* from writing a
forbidden file. A worker that ignores its task contract can produce a
diff touching forbidden files; the violation is only caught at merge time.

---

## Claude Code Hooks

Claude Code supports lifecycle hooks that run shell commands before or
after tool execution. Hooks are configured in `.claude/settings.json`.

### Hook Types

| Event | Trigger | Can Block? |
|-------|---------|:----------:|
| `PreToolUse` | Before tool executes | Yes (exit 2 = block) |
| `PostToolUse` | After tool completes | No (observational) |

### Configuration

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/ai/hook-forbidden-files-enforcer.js"
          }
        ]
      }
    ]
  }
}
```

- `matcher`: regex against tool name (e.g. `Write|Edit|Bash`)
- `hooks[].command`: shell command to execute
- `hooks[].env`: optional environment variables

### Input Contract

Claude Code pipes JSON to the hook's stdin:

```json
{
  "tool_name": "Write",
  "tool_input": {
    "file_path": "src/app.module.ts",
    "content": "..."
  }
}
```

### Exit Code Semantics

| Code | Meaning |
|------|---------|
| 0 | Allow — tool call proceeds |
| 1 | Hook error (treated as failure, not intentional block) |
| 2 | Intentional block — tool call prevented, stderr shown to agent |

---

## Feasibility Assessment

### What Hooks Can Do

1. **Block forbidden file writes in real time.** A `PreToolUse` hook on
   `Write|Edit|NotebookEdit` can inspect `file_path` and exit 2 if the
   path matches a forbidden glob pattern. This closes the execution-time
   gap.

2. **Audit tool calls.** A `PostToolUse` hook can log every tool call
   (tool name, file path, timestamp) to a fact event ledger for
   post-hoc analysis.

3. **Enforce allowedFiles scope.** Same mechanism — block writes to files
   not matching allowed patterns.

4. **Trigger side effects.** Hooks can call any script, enabling
   notifications (webhook, fact event) on violation.

### What Hooks Cannot Do

| Limitation | Impact |
|-----------|--------|
| Cannot modify tool arguments | Hook can only allow or block, not auto-correct |
| Cannot inject worker context | Worker must already know its boundaries |
| Project-level config only | Same hooks for all workers (mitigated by env vars) |
| No built-in glob matcher | Must implement pattern matching in hook script |
| Cannot distinguish workers | Resolved via `TASK_MANIFEST` or `FORBIDDEN_FILES` env vars |
| PostToolUse cannot block | Observational only — cannot prevent side effects |

### Per-Task Pattern Override

Since hooks are project-level, per-task forbidden patterns are passed
via environment variables:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/ai/hook-forbidden-files-enforcer.js",
            "env": {
              "TASK_MANIFEST": ".ai/task-manifest.json"
            }
          }
        ]
      }
    ]
  }
}
```

Or directly:

```json
{
  "env": {
    "FORBIDDEN_FILES": "[\"src/**\",\"prisma/**\"]"
  }
}
```

Pattern priority: `FORBIDDEN_FILES` env var > `TASK_MANIFEST` file >
built-in defaults.

---

## Three-Layer Enforcement Model

With hooks, the enforcement stack becomes:

```
Layer 1: Task contract (instruction)
  └─ forbiddenFiles declared in task manifest
  └─ Worker is instructed to stay within scope

Layer 2: Claude Code hook (real-time)
  └─ PreToolUse blocks Write/Edit/NotebookEdit before file is touched
  └─ Provides immediate feedback to the worker

Layer 3: Pre-merge guard (post-hoc)
  └─ check-task-boundary.js validates PR diff before merge
  └─ Catches anything that slips past Layers 1-2
```

Layer 2 is the new addition. It converts the advisory task contract
into a real-time enforcement gate.

---

## Implementation Approach

### Hook Script: `scripts/ai/hook-forbidden-files-enforcer.js`

A lightweight Node.js script (no external dependencies) that:

1. Reads JSON from stdin (tool_name, tool_input).
2. Extracts file path from Write/Edit/NotebookEdit calls.
3. Loads forbidden patterns from env var, task manifest, or defaults.
4. Matches file path against patterns using glob-to-regex.
5. Exits 2 with structured stderr on match; exits 0 silently otherwise.

### Pattern Source Priority

| Priority | Source | Env Var / Path |
|----------|--------|---------------|
| 1 | Explicit patterns | `FORBIDDEN_FILES` (JSON array string) |
| 2 | Task manifest | `TASK_MANIFEST` (path to JSON with `forbiddenFiles`) |
| 3 | Defaults | Built-in: `.env`, `node_modules/**`, `dist/**`, `.git/**` |

### Default Forbidden Patterns

The built-in defaults align with seed-constitution rule 1
(High-Risk Human-Required Boundaries):

- `.env`, `.env.*` — secrets
- `node_modules/**` — dependency tree
- `dist/**` — build artifacts
- `.git/**` — git internals

Workers with task-specific forbidden patterns (e.g., `src/**`,
`prisma/**`) should set `FORBIDDEN_FILES` or `TASK_MANIFEST`.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Hook blocks legitimate file | Medium | Silent-allow on malformed input; worker can report blocker |
| Hook adds latency to every write | Low | Script is <50ms; no external deps |
| Pattern mismatch between hook and guard | Low | Reuse same glob engine (`check-task-boundary.js`) |
| Worker bypasses hook via Bash | Low | Can add PreToolUse on Bash to intercept `cat > file` patterns |
| Env var not set for a task | Low | Defaults cover constitution-critical files |

---

## Recommendation

**Implement hooks as an optional defense-in-depth layer.** The
three-layer model (contract → hook → guard) provides defense-in-depth
without replacing existing enforcement. Hooks are most valuable for:

1. Real-time feedback to workers (faster than waiting for CI).
2. Audit logging of tool calls for behavioral analysis.
3. Constitution enforcement at the point of action, not just at merge.

The hook script should be opt-in per task (via env vars) to avoid
blocking workers that don't set up forbidden patterns.

---

## References

- [Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) — Official documentation
- [Seed Constitution](seed-constitution.md) — Immutable boundaries
- [Worker Behavior Policy](worker-behavior-policy.md) — Behavioral principles
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema
- [check-task-boundary.js](../../scripts/guards/check-task-boundary.js) — Pre-merge guard
- [check-worker-behavior-policy.js](../../scripts/ai/check-worker-behavior-policy.js) — Post-hoc policy checker
- [#1365](https://github.com/taoyu051818-sys/lian-nest-server/issues/1365) — This investigation
