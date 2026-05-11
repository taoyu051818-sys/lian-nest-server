# Merge Queue Assistant

A controlled merge queue helper that lists eligible PRs and prints copyable merge commands (dry-run by default).

## Quick Start

```bash
# Dry-run — list eligible PRs, print merge commands (no actual merges)
node scripts/merge-queue-assistant.js --repo owner/name --dry-run

# Execute — actually merge eligible PRs (stops on first failure)
node scripts/merge-queue-assistant.js --repo owner/name --execute
```

## Options

| Flag         | Description                                      | Default |
| ------------ | ------------------------------------------------ | ------- |
| `--repo`     | Target repository in `OWNER/NAME` format         | required (or `MERGE_QUEUE_REPO` env) |
| `--dry-run`  | List eligible PRs and print merge commands       | **yes** |
| `--execute`  | Perform real merges (stops on first failure)     | no      |
| `--help`     | Show help message                                | —       |

## Eligibility Rules

A PR is **eligible** when ALL of the following are true:

- Not a draft
- Mergeable status is `MERGEABLE` (not `DIRTY`, `UNKNOWN`, or `CONFLICTING`)
- Review decision is not `CHANGES_REQUESTED`
- No status checks in `FAILURE` or `CANCELLED` state
- No labels containing `blocked`, `blocker`, `do-not-merge`, or `wip`

Excluded PRs are printed with the specific reason(s) for exclusion.

## Execute Mode

When `--execute` is passed:

1. The assistant prints the full merge plan (same as dry-run)
2. Merges eligible PRs sequentially using `--squash --delete-branch`
3. **Stops on the first failure** — remaining PRs are not merged
4. Exit code is non-zero on failure

## Environment Variables

| Variable            | Description                          |
| ------------------- | ------------------------------------ |
| `MERGE_QUEUE_REPO`  | Default value for `--repo`           |

## Safety

- **Dry-run is the default.** No merges happen unless `--execute` is explicitly passed.
- **Execute mode prints first.** You see the plan before any merge runs.
- **Fail-fast.** Execute mode stops at the first merge failure.
- **No secrets required.** The script uses `gh` CLI authentication (already configured).
