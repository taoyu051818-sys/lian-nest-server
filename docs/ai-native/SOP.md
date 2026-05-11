# AI-Native Development SOP

## Source of Truth

- GitHub issues define work scope.
- Pull requests carry implementation, validation, and review evidence.
- Worker tasks must stay inside their allowed file set.
- Legacy backend behavior is a reference contract, not the target architecture.

## Flow

1. Create or select a bounded issue.
2. Launch a worker with explicit allowed files, validation commands, role, risk, and acceptance owner.
3. Worker opens or updates a pull request.
4. Review gate checks scope, validation, and architectural fit.
5. Human owner decides merge.

## Hard Rules

- No new legacy backend code.
- No direct NodeBB calls outside the NodeBB module.
- No direct storage access outside repositories.
- No silent fallback without diagnostics.
- Keep PRs small enough to review.
