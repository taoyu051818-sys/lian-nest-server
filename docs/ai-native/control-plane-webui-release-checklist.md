# Control Plane WebUI Release Checklist

Run this checklist before and after deploying a new version of the
local control-plane WebUI (`tools/provider-pool-webui/`).

> **Closes:** #821

---

## 1 — Pre-flight

Verify the environment before starting any release work.

- [ ] **Node.js** and **npm** installed (`node --version`, `npm --version`).
- [ ] **gh CLI** authenticated (`gh auth status` shows Logged in).
- [ ] **Repository clean** — `git status` shows no uncommitted changes.
- [ ] **On main** — `git branch --show-current` returns `main`.
- [ ] **main up to date** — `git pull --ff-only` succeeds.

---

## 2 — Health Gate

Run the post-merge health gate to confirm the server baseline is green.

```bash
npm run ops:health
```

- [ ] Exit code 0, health state is `green` or `yellow`.
- [ ] If state is `red` or `black`, stop and resolve before proceeding.

---

## 3 — Guard Checks

Run boundary, docs-authority, and Prisma guards.

```bash
npm run ops:guard
```

- [ ] All guard checks pass.
- [ ] No forbidden file edits detected.

---

## 4 — Unit Tests

Run the full Jest test suite.

```bash
npm test
```

- [ ] All tests pass.
- [ ] No new failures compared to previous run.

---

## 5 — WebUI Smoke Tests

Run the WebUI-specific smoke tests.

```bash
npm run ops:webui:smoke
```

- [ ] Smoke tests pass.
- [ ] Console output shows no errors or warnings.

---

## 6 — Start the WebUI Locally

Start the control-plane WebUI server and verify it comes up.

```bash
npm run ops:webui
```

- [ ] Server starts on `127.0.0.1:4179`.
- [ ] `curl http://127.0.0.1:4179/api/health` returns `{ "ok": true }`.

---

## 7 — Manual Smoke Walk

Open the WebUI in a browser and verify core flows.

- [ ] **Dashboard** loads without errors.
- [ ] **Provider pool** page renders provider list.
- [ ] **Planning console** shows recent launch plans.
- [ ] **Audit log** page loads and displays entries.
- [ ] **Action runner** can execute a read-only action (e.g. `provider.list`).
- [ ] No console errors in browser DevTools.

---

## 8 — Secret / Env Check

Verify no secrets are leaking into the build or logs.

- [ ] `.env` files are not tracked by git (`git ls-files .env` returns empty).
- [ ] No API tokens or passwords appear in WebUI server stdout.
- [ ] `NODE_ENV` is set to `production` for release builds.

---

## 9 — Build Validation

Run the project-wide type check and build.

```bash
npm run check
npm run build
```

- [ ] `npm run check` exits 0 (no type errors).
- [ ] `npm run build` exits 0 (build succeeds).

---

## 10 — Commit and Push

Stage, commit, and push the release changes.

```bash
git add docs/ai-native/control-plane-webui-release-checklist.md
git commit -m "docs(webui): add control plane WebUI release checklist"
git push -u origin <branch>
```

- [ ] Commit message follows `docs(webui):` convention.
- [ ] Branch pushed to remote.

---

## 11 — Open PR

Open a pull request linked to the tracking issue.

- [ ] PR title matches commit message convention.
- [ ] PR body links to the tracking issue.
- [ ] PR body includes validation command output.

---

## 12 — Rollback

If the release causes issues, follow this rollback path.

1. **Revert the merge commit** on `main`:
   ```bash
   git revert <merge-sha>
   git push
   ```
2. **Run the health gate** to confirm the revert restores green state:
   ```bash
   npm run ops:health
   ```
3. **Export the audit log** for investigation:
   ```bash
   node scripts/post-merge-health-gate.js --full
   ```
4. **If the WebUI is running**, stop the server process.

---

## Reference Docs

| Doc | Purpose |
|-----|---------|
| [webui-operation-runbook.md](webui-operation-runbook.md) | Full operator runbook with action-level rollback |
| [control-plane-adoption-checklist.md](control-plane-adoption-checklist.md) | Phased adoption guide for new operators |
| [SOP.md](SOP.md) | Development standard operating procedures |
| [main-health-policy.md](main-health-policy.md) | Health states and what each permits |
