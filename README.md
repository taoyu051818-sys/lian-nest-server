# lian-nest-server

Nest-first backend rewrite for LIAN.

This repository is the AI-native development home for the new LIAN backend. The legacy backend remains the behavior reference during migration; new backend work should be planned through GitHub issues and implemented by bounded worker tasks.

## AI-Native Development

- [SOP](docs/ai-native/SOP.md) - Complete standard operating procedure
- [Roles](docs/ai-native/roles.md) - Role definitions and responsibilities
- [Worker Task Contract](docs/ai-native/worker-task-contract.md) - JSON contract schema for worker tasks
- [Issue Lifecycle](docs/ai-native/issue-lifecycle.md) - Issue states, labels, and transitions
- [PR Review Gate](docs/ai-native/pr-review-gate.md) - Review checklist and merge criteria
- [Validation Evidence](docs/ai-native/validation-evidence.md) - Evidence format requirements

### Agent Prompts

Role prompts for AI workers and reviewers live in [ops/agent-prompts/](ops/agent-prompts/).

### Automation Policy

- [Next-Wave Policy](ops/agent-prompts/next-wave-policy.md) - How to continue after a worker wave completes (manual orchestrator, router-driven, serial aggregator).
- [Writeback Checklist](ops/agent-prompts/writeback-checklist.md) - Verify worker PR comments and label updates actually landed.
