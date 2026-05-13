# Claude Code Hooks for forbiddenFiles Enforcement

Adds a real-time PreToolUse hook that blocks Write/Edit/NotebookEdit calls
targeting files matching the task contract's `forbiddenFiles` or outside
`allowedFiles`. Provides defense-in-depth against constitution violations.

> **Closes:** [#1372](https://github.com/taoyu051818-sys/lian-nest-server/issues/1372)
>
> **Reference:** [worker-task-contract.md](worker-task-contract.md) for
> `forbiddenFiles` definition, [bounded-experiment-policy.md](bounded-experiment-policy.md)
> for experiment scoping rules.

---

## Problem

Previously, `forbiddenFiles` enforcement relied on two post-hoc mechanisms:

1. **Prompt-based instruction** — the launcher embeds forbidden patterns as
   text in the worker prompt. Enforcement is advisory; the LLM may ignore it.
2. **Pre-merge boundary guard** — `scripts/guards/check-task-boundary.js`
   runs after the worker has already committed changes. Violations are detected
   too late to prevent them.

Neither mechanism blocks file writes at the moment they happen.

## Solution

A Claude Code `PreToolUse` hook intercepts every Write, Edit, and NotebookEdit
call before execution. The hook:

1. Reads the tool call JSON from stdin (`{ tool_name, tool_input }`).
2. Loads `forbiddenFiles` and `allowedFiles` from the task manifest
   (path from `LIAN_WORKER_TASK_FILE` env var).
3. Checks the target file path against forbidden patterns.
4. If forbidden or outside allowed: exits 2 (block) with reason on stderr.
5. If allowed: exits 0 (proceed silently).

### Defense-in-depth layers

| Layer | When | Mechanism | Blocking? |
|-------|------|-----------|-----------|
| Prompt instruction | Pre-launch | Text in worker prompt | No (advisory) |
| **Hook** | **Write time** | **PreToolUse hook** | **Yes** |
| Boundary guard | Pre-merge | CI check on diff | No (post-hoc) |
| Behavior policy | Pre-merge | PR fact checker | No (post-hoc) |

---

## Files

| File | Purpose |
|------|---------|
| `scripts/ai/hook-forbidden-files-enforcer.js` | Hook script — reads stdin, checks patterns, exits 0/2 |
| `scripts/ai/batch-launch.ps1` | Injects `.claude/settings.json` with hook config into each worktree |

---

## Hook Protocol

### Input (stdin)

```json
{
  "tool_name": "Write",
  "tool_input": {
    "file_path": "src/app.module.ts",
    "content": "..."
  }
}
```

### Exit codes

| Exit | Meaning | Behavior |
|------|---------|----------|
| 0 | Allow | Tool call proceeds, no output |
| 2 | Block | Tool call prevented, reason shown to agent on stderr |

Exit code 1 is not used (Claude Code treats it as a hook error, not a block).

### Block output (stderr)

```json
{
  "status": "blocked",
  "tool": "Write",
  "file": "src/app.module.ts",
  "matchedPatterns": ["src/**"],
  "reason": "File \"src/app.module.ts\" matches forbidden pattern(s): src/**."
}
```

---

## Settings Injection

The batch launcher writes `.claude/settings.json` into each worktree before
launching the worker:

```json
{
  "hooks": {
    "Write": [
      { "type": "command", "command": "node scripts/ai/hook-forbidden-files-enforcer.js" }
    ],
    "Edit": [
      { "type": "command", "command": "node scripts/ai/hook-forbidden-files-enforcer.js" }
    ],
    "NotebookEdit": [
      { "type": "command", "command": "node scripts/ai/hook-forbidden-files-enforcer.js" }
    ]
  }
}
```

The hook reads `LIAN_WORKER_TASK_FILE` (set by the launcher) to find the task
manifest containing `forbiddenFiles` and `allowedFiles` patterns.

---

## Pattern Matching

The hook uses the same glob-to-regex logic as
`scripts/guards/check-task-boundary.js`:

| Pattern | Matches |
|---------|---------|
| `src/**` | `src/app.module.ts`, `src/auth/login.ts` |
| `package.json` | `package.json` exactly |
| `.env*` | `.env`, `.env.local`, `.env.production` |
| `prisma/**` | `prisma/schema.prisma`, `prisma/migrations/...` |

### Shared Locks

Tasks with `sharedLocks` can bypass forbidden patterns for specific file sets.
For example, a task with `"sharedLocks": ["package"]` may edit `package.json`
even when it appears in `forbiddenFiles`. The lock map is defined in both
`scripts/guards/check-task-boundary.js` and the hook script.

---

## Testing

Run the hook script directly with test fixtures:

```bash
# Should block (exit 2)
echo '{"tool_name":"Write","tool_input":{"file_path":"src/app.module.ts"}}' | \
  LIAN_WORKER_TASK_FILE=test-task.json node scripts/ai/hook-forbidden-files-enforcer.js

# Should allow (exit 0)
echo '{"tool_name":"Write","tool_input":{"file_path":"docs/ai-native/example.md"}}' | \
  LIAN_WORKER_TASK_FILE=test-task.json node scripts/ai/hook-forbidden-files-enforcer.js
```

---

## References

- [worker-task-contract.md](worker-task-contract.md) — `forbiddenFiles` field definition
- [bounded-experiment-policy.md](bounded-experiment-policy.md) — Experiment scoping rules
- [worker-behavior-policy.md](worker-behavior-policy.md) — Advisory policy (Principle 3: Surgical Scope)
- [failure-taxonomy-policy.md](failure-taxonomy-policy.md) — `forbidden-files-touched` failure category
- `scripts/guards/check-task-boundary.js` — Post-hoc boundary guard (shared glob logic)
