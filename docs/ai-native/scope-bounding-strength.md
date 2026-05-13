# Scope-Bounding Strength: Bounded Task Contracts vs. Free-Form Agent Approaches

This document analyzes why LIAN's bounded task contract provides stronger scope control than SWE-agent free-form tool use or CrewAI role-goal-backstory, and establishes the contract as the trust boundary for any future tool registry or graph orchestration.

## Motivation

External research identified that LIAN's task contracts with explicit `allowedFiles` provide more rigorous scope-bounding than the dominant open-source agent paradigms. This matters because scope violations are the primary vector for unintended side effects in autonomous code modification.

## Comparison

| Dimension | LIAN Bounded Task Contract | SWE-agent | CrewAI |
|---|---|---|---|
| **Scope declaration** | Explicit `allowedFiles` + `forbiddenFiles` globs in the contract JSON | No file-level boundary; agent reads repo and decides | Role description mentions domain but no file-level constraint |
| **Scope enforcement** | Three layers: compile-time rejection, runtime launcher checks, post-hoc PR diff audit | None beyond the agent's own judgment | None beyond role prompt alignment |
| **Injection resistance** | Rejects broad patterns (`**`, `*`), quarantines opaque sources, separates evidence from commands | Agent processes any file it can reach | Agent processes any file it can reach |
| **Budget control** | `maxFiles`, `maxLinesChanged`, soft/hard time limits in contract | Token-level limits only | Token-level limits only |
| **Conflict isolation** | `conflictGroup` prevents concurrent edits on overlapping scopes | No conflict awareness | No conflict awareness |
| **Validation gate** | `validationCommands` must pass before PR is accepted | Post-hoc only | Post-hoc only |
| **Trust model** | Contract is the trust boundary; worker cannot expand scope | Agent is the trust boundary | Role prompt is the trust boundary |

## LIAN Scope-Bounding Layers

### Layer 1: Compile-Time Rejection

The task compiler (`compile-issue-to-task-json.ps1`, `compile-issues-to-tasks.js`) rejects contracts that:

- Missing `allowedFiles`, `conflictGroup`, `validationCommands`, or `rolePacket`
- Overly broad `allowedFiles` patterns (`**`, `*`, `docs/**`)
- Empty `forbiddenFiles` (warns; defaults to `['src/**', 'prisma/**', 'package.json']`)

This prevents underspecified contracts from entering the execution pipeline.

### Layer 2: Hardcoded Scope Defaults for External Intake

`propose-external-intake-issues.js` enforces:

- `ALLOWED_SCOPES`: `scripts/ai/**`, `docs/ai-native/**`, `schemas/**`
- `FORBIDDEN_SCOPES`: `src/**`, `prisma/**`, `package.json`, `package-lock.json`, `seed-constitution.md`

External signals cannot produce proposals with broader scope than these defaults.

### Layer 3: Injection Boundary in External Intake Loop

The external intake executable loop (`external-intake-executable-loop.md`) enforces:

- External text is never a command; it is evidence
- Actions require a valid task JSON with explicit `allowedFiles` and `validationCommands`
- `allowedFiles: ["**"]` is a detected injection pattern that must be rejected
- Opaque sources are quarantined until human promotion

### Layer 4: Runtime Launcher Enforcement

The launcher reads the task JSON to:

- Set up the worktree with file boundary awareness
- Enforce `allowedFiles` / `forbiddenFiles` before the worker begins
- Run `validationCommands` and capture output

### Layer 5: Post-Hoc PR Diff Audit

`check-worker-behavior-policy.js` evaluates the PR diff against:

- **Surgical Scope**: only allowed files touched, no forbidden files modified
- **Diff size budgets**: lines changed within `maxLinesChanged`
- **Validation evidence**: `validationCommands` output attached to PR
- **Forbidden prefixes**: `.env`, `dist/`, `node_modules/`, `prisma/migrations/`, `seed-constitution.md`, `ai-state/`
- **Broad patterns**: flags underspecified contracts

## Why This Matters for Tool Registries and Graph Orchestration

The bounded task contract must remain the unit of work when introducing:

- **Tool registries**: Tools must be scoped to the contract's `allowedFiles`. A tool that can edit files outside the contract's boundary breaks the trust model.
- **Graph branches**: Branch decisions (conditional routing, parallel forks) must not expand scope. A branch that adds `allowedFiles` patterns violates the contract's immutability.
- **Dynamic tool selection**: If a worker dynamically selects tools at runtime, the tools' effective file access must be bounded by the contract's globs.

The contract is the trust boundary. It is set at compile time, validated at launch time, and audited at review time. No runtime behavior should expand it.

## Strengths Summary

1. **Explicit over implicit**: File boundaries are declared, not inferred from role descriptions.
2. **Multi-layer enforcement**: Compile-time, launch-time, and review-time checks create defense in depth.
3. **Injection resistance**: Broad patterns are rejected; external evidence is separated from commands.
4. **Budget control**: File count and line change limits bound blast radius beyond file selection.
5. **Conflict isolation**: Conflict groups prevent concurrent scope violations across workers.
6. **Validation evidence**: Required validation commands produce auditable proof of correctness.

## Gaps and Follow-Up

No actionable improvement was identified in the current scope-bounding mechanism. The system already provides multi-layer enforcement with compile-time rejection, runtime checks, and post-hoc auditing. The primary risk is future tool registries or graph orchestration bypassing the contract boundary -- this document establishes the principle that must be preserved.
