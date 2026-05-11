# Worker Writeback Checklist

## Purpose

Verify that worker PR comments and label updates actually landed, not
just that the audit passed.

## Background

Audit success validates that the worker ran its commands and produced
output. It does **not** verify that the worker successfully wrote
comments or updated labels via the GitHub API. A 403 from GitHub is
silently swallowed, and the audit still passes.

## Checklist

### Before launching a worker

- [ ] Worker token has `repo` scope (private repos) or `public_repo` scope (public repos).
- [ ] Token is not expired or revoked.
- [ ] Token belongs to a user with write access to the target repository.

### After worker completes

- [ ] PR has at least one comment from the worker bot/user.
- [ ] Comment contains expected summary or output excerpt.
- [ ] Worker log shows 2xx response for comment POST.
- [ ] Worker log shows 2xx response for label PATCH (if labels were updated).
- [ ] No 403 or 401 entries in worker log for `api.github.com`.

### If writeback is missing

1. Verify token scopes:
   ```bash
   curl -s -H "Authorization: token $GH_TOKEN" -I https://api.github.com/user | grep -i x-oauth-scopes
   ```
   Expected: `repo` or `public_repo` listed.

2. Check if the token user has write access:
   ```bash
   curl -s -H "Authorization: token $GH_TOKEN" https://api.github.com/repos/{owner}/{repo} | jq '.permissions'
   ```
   Expected: `push: true` or `admin: true`.

3. Check worker logs for silent failures:
   ```bash
   grep -i "403\|401\|permission\|forbidden" worker.log
   ```

4. If the token is scoped correctly but comments still fail, check if
   branch protection rules or CODEOWNERS restrictions block the token user.

## Token scope reference

| Scope | Grants |
|-------|--------|
| `repo` | Full control of private repos (read/write PR comments, labels, reviews) |
| `public_repo` | Full control of public repos |
| `repo:status` | Read/write commit statuses only (not sufficient for PR comments) |
| `read:repo` | Read-only access (not sufficient for PR comments) |

**Minimum for writeback:** `repo` (private) or `public_repo` (public).

## Common failure modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| No PR comment, audit green | Token lacks write scope | Add `repo` or `public_repo` scope |
| No PR comment, audit green | Token user has read-only access | Grant write access to token user |
| No label update, audit green | Token lacks write scope | Add `repo` or `public_repo` scope |
| 403 in worker log | Any of the above | Check scopes and permissions |
| PR comment from wrong user | Token belongs to different user | Verify token ownership |

## See also

- [SOP](../../docs/ai-native/SOP.md) - Full development SOP
- [Next-Wave Policy](./next-wave-policy.md) - Continuation options
