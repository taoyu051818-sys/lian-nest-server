# Issue Producer PR Dedupe

Extends the issue producer's deduplication logic to prevent creating
issues already covered by open or recently merged PRs.

> **Closes:** [#1335](https://github.com/taoyu051818-sys/lian-nest-server/issues/1335)

---

## Problem

The issue producer (`propose-self-cycle-issues.js`) deduplicates
candidates against open issues by title overlap and conflict group.
However, it did not check against:

1. **Open PR bodies** — a PR covering the same conflict group would
   not block a duplicate issue from being proposed.
2. **Recently merged PRs** — work already completed via a merged PR
   could be re-proposed in the next planning cycle.

This caused the self-cycle to generate redundant issues, wasting
worker slots and reviewer capacity.

---

## Solution

### PR body conflict group extraction

The `deduplicate` function now extracts `Conflict group:` from PR
bodies (both open and merged) in addition to issue bodies. Candidates
whose `conflictGroup` matches any PR's conflict group are skipped.

### Recently merged PR dedup

A new `fetchMergedPRs(repo, limit)` function calls `gh pr list --state
merged` to retrieve the 50 most recently merged PRs. These are passed
to `deduplicate` alongside open issues and open PRs.

### Title overlap with merged PRs

Merged PR titles are included in the title overlap check. A candidate
whose title has >0.5 keyword overlap with a merged PR title is skipped.

---

## Dedup flow

```
propose-self-cycle-issues.js
       │
       ├─ fetchOpenIssues(repo)      → open issues
       ├─ fetchOpenPRs(repo)         → open PRs
       ├─ fetchMergedPRs(repo, 50)   → recently merged PRs
       │
       ▼
  deduplicate(candidates, openIssues, openPRs, mergedPRs)
       │
       ├─ title overlap: issues + open PRs + merged PRs
       ├─ conflictGroup: issues + open PRs + merged PRs
       │
       ▼
  { proposed, skipped }
```

---

## Changes

| File | Change |
|------|--------|
| `scripts/ai/propose-self-cycle-issues.js` | Added `fetchMergedPRs`, extended `deduplicate` to accept `mergedPRs` param, check conflict groups in PR bodies, include merged PRs in title overlap |
| `scripts/ai/propose-self-cycle-issues.test.js` | Added 4 unit tests: conflictGroup from open PR body, conflictGroup from merged PR body, title overlap with merged PRs, pass-through for non-conflicting candidates |
| `docs/ai-native/issue-producer-pr-dedupe.md` | This document |

---

## Design Decisions

- **50 merged PR limit:** Balances dedup coverage against API call
  cost. Covers roughly the last week of merged PRs in an active repo.
- **Same 0.5 title overlap threshold:** Reuses the existing threshold
  for consistency. No new tunables introduced.
- **PR body format:** PRs use the same `Conflict group:` format in
  their body as issues, so `extractConflictGroupFromIssueBody` works
  for both (the function name is a misnomer but the logic is generic).

---

## References

- [Candidate Gap Dedupe Policy](candidate-gap-dedupe-policy.md) — Five-dimension dedupe key.
- [#1335](https://github.com/taoyu051818-sys/lian-nest-server/issues/1335) — This feature.
