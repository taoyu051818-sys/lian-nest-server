# Roles

Definitions for every role in the AI-native development process.

## repo-owner

- **Who**: Human maintainer or designated automation.
- **Responsibilities**: Repository health, branch protection, merge authority, release decisions.
- **Authority**: Final merge decision. Can override review gate with documented justification.
- **Prompt**: [ops/agent-prompts/repo-owner.md](../ops/agent-prompts/repo-owner.md)

## pm-gate

- **Who**: Product manager role, human or AI-assisted.
- **Responsibilities**: Issue triage, scope validation, acceptance criteria review, wave planning.
- **Authority**: Can block issues for scope clarification. Can request splitting oversized issues.
- **Prompt**: [ops/agent-prompts/pm-gate.md](../ops/agent-prompts/pm-gate.md)

## architect

- **Who**: Technical lead or senior engineer.
- **Responsibilities**: Module boundaries, dependency direction, migration strategy, API contracts.
- **Authority**: Can block PRs that violate architectural boundaries. Approves new module creation.
- **Prompt**: [ops/agent-prompts/architect.md](../ops/agent-prompts/architect.md)

## backend-programmer

- **Who**: AI worker or human developer implementing NestJS code.
- **Responsibilities**: Implementation within bounded scope, validation, evidence collection.
- **Authority**: None beyond allowed file set. Must escalate out-of-scope discoveries.
- **Prompt**: [ops/agent-prompts/backend-programmer.md](../ops/agent-prompts/backend-programmer.md)

## nodebb-owner

- **Who**: Specialist responsible for NodeBB integration.
- **Responsibilities**: NodeBB module health, API adapter correctness, forum feature parity.
- **Authority**: Owns all files under the NodeBB module boundary.
- **Prompt**: [ops/agent-prompts/nodebb-owner.md](../ops/agent-prompts/nodebb-owner.md)

## qa-contract-reviewer

- **Who**: QA role validating worker output.
- **Responsibilities**: Check validation evidence, verify test coverage, confirm contract compliance.
- **Authority**: Can request-changes on PRs with insufficient evidence.
- **Prompt**: [ops/agent-prompts/qa-contract-reviewer.md](../ops/agent-prompts/qa-contract-reviewer.md)

## security-reviewer

- **Who**: Security-focused reviewer.
- **Responsibilities**: OWASP top 10 checks, auth flow review, secrets scanning, injection prevention.
- **Authority**: Can block PRs with security concerns. Findings must be resolved before merge.
- **Prompt**: [ops/agent-prompts/security-reviewer.md](../ops/agent-prompts/security-reviewer.md)

## migration-auditor

- **Who**: Specialist ensuring legacy backend parity.
- **Responsibilities**: Compare new behavior against legacy reference, validate data migration paths.
- **Authority**: Can flag parity gaps. Cannot block merge but findings are tracked as issues.
- **Prompt**: [ops/agent-prompts/migration-auditor.md](../ops/agent-prompts/migration-auditor.md)
