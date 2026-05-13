# External Intake: Agent Lifecycle Hooks for ForbiddenFiles Enforcement

Investigates Claude Code hooks as a defense-in-depth mechanism for
enforcing `forbiddenFiles` and `allowedFiles` boundaries at the tool-call
level, complementing the existing task-contract and pre-merge guard
enforcement.

> **Closes:** [#1365](https://github.com/taoyu051818-sys/lian-nest-server/issues/1365),
> [#1406](https://github.com/taoyu051818-sys/lian-nest-server/issues/1406)
>
> **Source type:** external-doc (Claude Code documentation)
> **Reliability:** authoritative
> **Captured:** 2026-05-13

---

## Current Enforcement Model

Constitution rules (including `forbiddenFiles`) are enforced at two
layers today:

| Layer | Mechanism | When | Strength |
|-------|-----------|------|----------|
| Task contract | `allowedFiles` / `forbiddenFiles` globs in task JSON; worker honor system | Runtime (worker reads contract) | Advisory — depends on worker compliance |
| Pre-merge guard | `check-task-boundary.js` validates diffs against boundaries | Pre-merge validation | Deterministic — blocks PR merge |

**Gap:** Neither layer intercepts the actual tool call. A worker that
violates its boundary can still *write* the file — the violation is only
caught later at merge time, after the damage is done (dirty worktree,
wasted compute, potential side effects).

---

## Claude Code Hooks: Technical Summary

Claude Code supports lifecycle hooks — user-defined shell commands that
run at specific points during tool execution. Configuration lives in
`.claude/settings.json` (project-level) or `~/.claude/settings.json`
(global).

### Hook Events

| Event | Trigger | Can Block? |
|-------|---------|:----------:|
| `PreToolUse` | Before a tool executes | Yes (non-zero exit) |
| `PostToolUse` | After a tool completes | No (observational) |

### Configuration Schema

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/ai/check-file-boundary.js"
          }
        ]
      }
    ]
  }
}
```

### Key Properties

- **`matcher`**: Regex on tool name (`Write`, `Edit`, `Read`, `Bash`,
  etc.). `|` separates alternatives.
- **`type`**: Currently `"command"` only.
- **`command`**: Shell command to execute. Receives tool context via
  environment variables (tool name, arguments including file path).
- **Blocking behavior**: Non-zero exit code from a `PreToolUse` hook
  prevents the tool from executing. The hook's stderr is surfaced to the
  worker as an error message.

---

## Feasibility Assessment

### What Hooks Can Do

| Capability | Supported? | Notes |
|------------|:----------:|-------|
| Intercept file writes before execution | Yes | `PreToolUse` on `Write\|Edit` |
| Block writes to forbidden paths | Yes | Non-zero exit code blocks the tool |
| Read the target file path from tool args | Yes | Passed via environment/stdin |
| Apply glob pattern matching | Yes | Script-level (minimatch, picomatch) |
| Log violations to fact event ledger | Yes | Script can call `write-fact-event.js` |
| Surface clear error to worker | Yes | stderr message shown in Claude Code UI |

### What Hooks Cannot Do

| Limitation | Impact |
|------------|--------|
| Cannot modify tool arguments | Cannot auto-correct paths; can only allow or block |
| Cannot inject context into worker prompt | Worker must already know its boundaries |
| Project-level only (`.claude/settings.json`) | Cannot be set per-task — same hooks for all workers in the repo |
| No built-in glob matcher | Must implement pattern matching in the hook script |
| Cannot distinguish between workers | Hook sees the same config regardless of which task is running |

### The Per-Task Problem

The critical limitation: hooks are configured at the **project level**,
but `forbiddenFiles` and `allowedFiles` are defined **per task** in the
task JSON. The hook script needs to know which task is currently running
to apply the correct boundaries.

**Resolution approaches:**

1. **Task context file**: The launcher writes the current task's
   `allowedFiles`/`forbiddenFiles` to a well-known path
   (e.g., `.claude/active-task-boundary.json`) before starting the
   worker. The hook script reads this file on every tool call.

2. **Environment variables**: The launcher sets
   `LIAN_ALLOWED_FILES` and `LIAN_FORBIDDEN_FILES` env vars. The hook
   reads them. Simpler but less flexible for complex glob lists.

3. **Constitution-only enforcement**: The hook enforces only the
   constitution-level `forbiddenFiles` (`.env`, `package.json`,
   `.github/ai-policy/**`, etc.) which are constant across all tasks.
   Task-specific boundaries remain advisory.

**Recommended:** Option 3 (constitution-only) for initial
implementation, with Option 1 (task context file) as a follow-up. This
matches the risk profile — constitution violations are high-severity and
task-independent, while task boundary violations are medium-severity and
already caught at merge time.

---

## Implemented Architecture

### Layer Model

The investigation found that a 3-layer enforcement model is already in
place:

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Claude Code Hook (PreToolUse)             │
│  Blocks: constitution-level forbiddenFiles          │
│  When:   tool call, before execution                │
│  Scope:  constant across all tasks                  │
│  Status: IMPLEMENTED (hook-forbidden-files-enforcer.js) │
├─────────────────────────────────────────────────────┤
│  Layer 2: Task Context Hook (PreToolUse, optional)  │
│  Blocks: task-level forbiddenFiles                  │
│  When:   tool call, before execution                │
│  Scope:  per-task (reads active-task-boundary.json) │
│  Status: NOT YET IMPLEMENTED                        │
├─────────────────────────────────────────────────────┤
│  Layer 3: Pre-merge Guard (check-task-boundary.js)  │
│  Blocks: any boundary violation in diff             │
│  When:   PR validation                              │
│  Scope:  per-task (reads task JSON)                 │
│  Status: IMPLEMENTED                                │
└─────────────────────────────────────────────────────┘
```

### Implemented Hook Script

`scripts/ai/hook-forbidden-files-enforcer.js` implements the
constitution-level hook. See [forbidden-files-hook.md](forbidden-files-hook.md)
for full technical details.

Key properties:

- Blocks `Write`, `Edit`, and `NotebookEdit` tool calls targeting
  constitution-protected files.
- Exit 0 = allow, exit 2 = block (stderr reason surfaced to agent).
- Supports three configuration sources: `FORBIDDEN_FILES` env var,
  `TASK_MANIFEST` env var, and built-in global defaults.
- Global defaults mirror `worker-permissions.json` globalForbidden and
  `merge-policy.json` forbidden-files guard globs.
- Uses the same glob matcher as `check-task-boundary.js` for
  consistency.

### Constitution-Level Forbidden Patterns

The hook's built-in global defaults cover:

```
.env, .env.*, node_modules/**, dist/**, .git/**, src/**, prisma/**,
package.json, package-lock.json
```

These patterns are task-independent and represent the absolute
boundaries that no worker may cross. They are derived from the seed
constitution (Rule 1: High-Risk Boundaries) and
`worker-permissions.json` globalForbidden.

---

## Implementation Status

### Phase 1: Constitution-Only Hook — DONE

| Step | File | Status |
|------|------|--------|
| 1 | `scripts/ai/hook-forbidden-files-enforcer.js` | Implemented |
| 2 | `.claude/settings.json` | Pending — hook not yet wired into project settings |
| 3 | `docs/ai-native/forbidden-files-hook.md` | Documented |

The hook script is complete and tested. Wiring it into
`.claude/settings.json` is a follow-up task (requires creating a
project-level settings file, which is outside this investigation's
scope).

### Phase 2: Task Context Hook (Follow-up)

| Step | File | Action |
|------|------|--------|
| 4 | `scripts/ai/write-active-task-boundary.js` | New script: launcher writes task boundaries to `.claude/active-task-boundary.json` |
| 5 | `scripts/ai/hook-forbidden-files-enforcer.js` | Update: also read task-level boundaries from `.claude/active-task-boundary.json` |
| 6 | `docs/ai-native/launch-gate.md` | Update: document boundary file write step |

### Phase 3: Observability (Follow-up)

| Step | File | Action |
|------|------|--------|
| 7 | `scripts/ai/hook-forbidden-files-enforcer.js` | Update: log blocks to fact event ledger |
| 8 | `docs/ai-native/worker-behavior-policy.md` | Update: reference hook enforcement |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|:----------:|--------|------------|
| Hook blocks legitimate file access | Low | Medium | Start with constitution-only patterns; dry-run mode |
| Hook adds latency to every tool call | Low | Low | Script is fast (file read + glob match, <50ms) |
| Hook config conflicts with developer local settings | Low | Low | Project-level `.claude/settings.json` is gitignored by default; document merge guidance |
| False sense of security (hook bypassed) | Medium | Medium | Hook is defense-in-depth, not primary enforcement; pre-merge guard remains authoritative |
| Task context file becomes stale | Low | Medium | Launcher writes file atomically; hook reads on every call |

---

## Comparison with Existing Guards

| Guard | Enforcement Point | Scope | Deterministic? |
|-------|------------------|-------|:--------------:|
| `check-task-boundary.js` | Pre-merge | Per-task diff | Yes |
| `check-constitution.js` | Pre-merge | Constitution integrity | Yes |
| Claude Code hook (proposed) | Pre-tool-call | Constitution forbidden files | Yes |
| Worker honor system | Runtime | Per-task contract | No (advisory) |

The hook fills the gap between "worker promises to behave" and "merge
guard catches violations" — it blocks the write at the moment it
happens.

---

## Decision

**Investigation complete.** Phase 1 (constitution-only hook) is
implemented via `hook-forbidden-files-enforcer.js`. The script is
tested and ready to wire into `.claude/settings.json`.

**Remaining follow-up:**

1. Wire the hook into `.claude/settings.json` (requires creating the
   project-level settings file).
2. Phase 2: per-task boundary enforcement via
   `.claude/active-task-boundary.json`.
3. Phase 3: observability — logging hook blocks to the fact event
   ledger.

All follow-up items are low-risk and can proceed independently.

---

## Research Summary (Issue #1406)

**Question:** Can Claude Code hooks enforce `forbiddenFiles` at the
tool-call level as defense-in-depth?

**Answer:** Yes. The investigation confirms:

1. **Hook infrastructure exists.** `hook-forbidden-files-enforcer.js`
   is implemented, tested, and blocks `Write`/`Edit`/`NotebookEdit`
   calls to constitution-protected files (`.env`, `src/**`, `prisma/**`,
   `package.json`, etc.) at the moment of the tool call.

2. **Three-layer model is sound.** The constitution-level hook
   (Layer 1) fills the gap between the worker honor system (advisory)
   and the pre-merge guard (post-hoc). Constitution violations are
   caught immediately, not after wasted compute.

3. **Wiring is the only blocker.** The hook script is complete but
   `.claude/settings.json` does not exist at the project root. Creating
   that file and adding the hook configuration is a follow-up task
   (outside this investigation's allowed files).

4. **No additional actionable improvements found.** The per-task
   boundary hook (Phase 2) and observability logging (Phase 3) are
   already scoped as follow-ups. No new gaps were identified.

**Recommendation:** Close #1406 with this summary. Wire the hook
into `.claude/settings.json` as a separate low-risk task.

---

## References

- [Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) — Official documentation (external-doc, authoritative)
- [Forbidden Files Hook](forbidden-files-hook.md) — Technical documentation for the implemented hook
- [hook-forbidden-files-enforcer.js](../../scripts/ai/hook-forbidden-files-enforcer.js) — Implemented hook script
- [Seed Constitution](../../.github/ai-policy/seed-constitution.md) — Immutable boundaries
- [Constitution Guard](constitution-guard.md) — Pre-merge constitution validation
- [Worker Task Contract](worker-task-contract.md) — Task JSON schema with `forbiddenFiles`
- [Worker Behavior Policy](worker-behavior-policy.md) — Behavioral principles for boundary compliance
- [External Intake Source Matrix](external-intake-source-matrix.md) — Source classification
- [Worker Permissions](worker-permissions.md) — Worker permission boundaries
