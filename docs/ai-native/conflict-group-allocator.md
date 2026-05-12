# Conflict Group Allocator

Assigns stable unique conflict groups and shared locks to generated issues
so parallel scheduling is not accidentally serialized.

> **Closes:** [#1328](https://github.com/taoyu051818-sys/lian-nest-server/issues/1328)

---

## Problem

The self-cycle could request 30 workers but only had 5 executable issues.
Generated issues lacked conflict group assignments, causing the batch launcher
to either serialize everything or launch overlapping tasks in parallel — both
wasteful. The existing duplicate detector (`check-duplicate-route-tasks.js`)
can *find* conflicts after the fact, but nothing *prevents* them by assigning
groups upfront.

## Goals

- Analyze `allowedFiles` overlap across a batch of tasks and assign conflict
  groups automatically before launch.
- Detect shared lock patterns (AppModule, package, Prisma, docs) and attach
  `sharedLocks` arrays to each task.
- Produce deterministic, stable group names from route segments so the same
  input always yields the same allocation.
- Keep the script read-only on GitHub state — no issues created or modified.

## Non-Goals

- No changes to runtime backend code (`src/**`).
- No changes to Prisma schema.
- No changes to `package.json` or `package-lock.json`.
- No worker launching or PR creation.

---

## Algorithm

### 1. Route Extraction

Each task's `allowedFiles` array is normalized to forward slashes and split
into route segments. Broad patterns (`**`, `src/**`, `docs/**`) are skipped.
File extensions are stripped.

```
"src/modules/auth/**"  → {auth, modules}
"scripts/ai/foo.js"    → {ai}
```

### 2. Overlap Detection

Two tasks overlap if their route segment sets share at least one element.
The allocator uses a Union-Find (disjoint set) data structure to group
transitively overlapping tasks.

```
Task A routes: {auth, modules}
Task B routes: {auth, users}       ← overlaps A (shared: auth)
Task C routes: {users, profile}    ← overlaps B (shared: users)

Result: A, B, C all in same group (transitive closure)
```

### 3. Group Naming

Group names are derived from the sorted, deduplicated union of all route
segments in the group, capped at two segments:

- `{auth, modules}` → `auth-modules`
- `{posts}` → `posts`
- No routes → `generic-{root-id}`

When two groups would produce the same name, a numeric suffix is appended.

### 4. Shared Lock Detection

Each task's `allowedFiles` is checked against the shared lock definitions:

| Lock name | File patterns |
|-----------|---------------|
| `package` | `package.json`, `package-lock.json` |
| `prisma-schema` | `prisma/**` |
| `app-module` | `src/app.module.ts` |
| `docs-index` | `docs/**/*.md` |

Tasks claim a lock when any of their `allowedFiles` matches the lock's
patterns. Multiple locks may be claimed simultaneously.

---

## Input Schema

```json
{
  "tasks": [
    {
      "id": "issue-1328",
      "title": "feat(ai): add conflict group allocator",
      "allowedFiles": [
        "scripts/ai/allocate-conflict-groups.js",
        "scripts/ai/allocate-conflict-groups.test.js",
        "docs/ai-native/conflict-group-allocator.md"
      ],
      "forbiddenFiles": ["src/**"]
    }
  ]
}
```

Each task requires `id` (string) and `allowedFiles` (string array).
`title`, `forbiddenFiles`, and other fields are optional passthrough.

## Output Schema

```json
{
  "schemaVersion": 1,
  "capturedAt": "2026-05-12T10:00:00.000Z",
  "summary": {
    "taskCount": 2,
    "groupCount": 1,
    "groups": { "auth-modules": 2 }
  },
  "tasks": [
    {
      "id": "issue-1328",
      "conflictGroup": "auth-modules",
      "sharedLocks": []
    }
  ]
}
```

---

## Usage

```bash
# Show help
node scripts/ai/allocate-conflict-groups.js --help

# Allocate from input file, write to default output
node scripts/ai/allocate-conflict-groups.js --input tasks.json

# Allocate and print to stdout
node scripts/ai/allocate-conflict-groups.js --input tasks.json --stdout

# Dry-run: print summary without writing
node scripts/ai/allocate-conflict-groups.js --input tasks.json --dry-run

# Custom output path
node scripts/ai/allocate-conflict-groups.js --input tasks.json --out custom/path.json
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Allocation complete |
| 2 | Invalid arguments or missing input |

---

## Integration Points

- **Batch launcher** (`batch-launch.ps1`): Call this script before launch to
  pre-assign conflict groups instead of relying on post-hoc duplicate detection.
- **Duplicate detector** (`check-duplicate-route-tasks.js`): Runs after
  allocation to verify no conflicts remain.
- **Launch gate** (`check-launch-gate.ps1`): Uses the assigned `conflictGroup`
  and `sharedLocks` for gate validation.
- **Parallel work policy** (`parallel-work-policy.md`): Group names follow the
  same naming conventions documented there.

---

## Testing

```bash
# Run focused tests
node scripts/ai/allocate-conflict-groups.test.js
```

Tests cover:
- Route segment extraction from various path patterns
- Route overlap detection (disjoint, overlapping, transitive)
- Shared lock detection for all lock types
- Conflict group allocation for independent tasks
- Conflict group allocation for overlapping tasks
- Transitive grouping through intermediate overlap
- Mixed batches with independent and overlapping tasks
- Edge cases: empty input, single task, broad patterns
- CLI: help, validation errors, dry-run, stdout output, file output
