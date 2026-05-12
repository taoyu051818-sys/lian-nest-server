# Constitution Steward Runbook

Operating procedures for the Constitution Steward role: when to run audits,
how to interpret findings, how to escalate to the human owner, and how to
close amendments.

> **Closes:** [#1007](https://github.com/taoyu051818-sys/lian-nest-server/issues/1007)

---

## Role Definition

The Constitution Steward is a governance role responsible for verifying that
the seed constitution and policy files remain intact, that workers respect
constitutional boundaries, and that amendments follow the prescribed process.

The steward **observes and reports** — it does not enforce, override, or
self-approve. All enforcement actions require human confirmation.

| Action | Steward May | Steward Must Not |
|--------|:-----------:|:----------------:|
| Run constitution / policy guards | Yes | — |
| Report findings to issue/PR | Yes | — |
| Recommend amendment | Yes | Self-approve amendment |
| Report a violating PR | Yes | Merge or close PR |
| Modify constitution or policy files | — | Edit under any circumstances |
| Override human gate | — | Bypass or relax any boundary |

---

## When to Run Audits

### Scheduled Triggers

| Trigger | Frequency | Scope |
|---------|-----------|-------|
| Pre-wave launch | Each wave | Full constitution + policy file check |
| Post-merge to main | After each merge | Constitution guard (structure intact) |
| Weekly health review | Weekly | Full audit + cross-reference sync |

### Event-Driven Triggers

| Event | Action |
|-------|--------|
| New `.github/ai-policy/**` file added | Run policy files guard |
| Seed constitution file modified | Run constitution guard + diff review |
| Worker PR touches forbidden boundary | Escalate (see Escalation) |
| Boundary guard reports violation | Interpret and escalate |
| Health gate drops to red | Verify constitution guard still passes |

### How to Run

```bash
node scripts/guards/check-constitution.js        # structure + section sync
node scripts/guards/check-constitution.js --json   # machine-readable
node scripts/guards/check-ai-policy-files.js       # policy file integrity
node scripts/guards/check-ai-policy-files.js --json
```

---

## Interpreting Findings

### Constitution Guard

The guard checks five required sections in both `.github/ai-policy/seed-constitution.md`
(authoritative) and `docs/ai-native/seed-constitution.md` (mirror):

1. `## High-Risk Human-Required Boundaries`
2. `## Explicit Merge Allowlists`
3. `## Main-Red Launch Stop`
4. `## Legacy Backend Read-Only Policy`
5. `## No Worker Scope Expansion`

| Check | Fail Meaning |
|-------|-------------|
| `authoritative-exists` | Constitution missing — **critical**, halt all workers |
| `docs-mirror-exists` | Mirror missing — create mirror from authoritative |
| `authoritative-sections` | Section deleted or renamed — **critical**, possible self-expansion |
| `mirror-sections` | Mirror out of sync — update from authoritative |
| `section-sync` | Drift between files — reconcile to authoritative |

### Policy Files Guard

| Check | Fail Meaning |
|-------|-------------|
| `dirExists` | `.github/ai-policy/` missing — **critical** |
| `missing` (empty list) | Missing policy file — governance gap |
| `invalidJson` (empty list) | Corrupt policy — may cause incorrect worker decisions |

### Severity Classification

| Severity | Condition | Response |
|----------|-----------|----------|
| **Critical** | Constitution missing or sections deleted | Halt all workers, escalate immediately |
| **High** | Policy file missing or JSON invalid | Block new launches, escalate |
| **Medium** | Mirror out of sync | Update mirror, log drift |
| **Low** | Cosmetic differences | Fix in next docs-only PR |

---

## Escalation to Human Owner

### When to Escalate

1. Constitution guard fails on `authoritative-exists` or `authoritative-sections`.
2. Policy files guard fails (missing files or invalid JSON).
3. Worker PR violates a constitutional boundary.
4. Self-expansion detected — automation modified its own task JSON or policy files.
5. Automation-authored amendment to constitution or policy files.

### Procedure

```
1. RECORD — run guard with --json, capture failing check(s) and timestamp.
2. COMMENT — post on relevant issue/PR using the template below.
3. LABEL — apply constitution:violation or constitution:drift.
4. BLOCK — if critical/high, comment "constitution audit blocked" on pending launches.
5. WAIT — do not retry, work around, or close the finding.
```

**Comment template:**

```
**Constitution Steward Finding**
- Guard: <constitution-guard | policy-files-guard>
- Check: <failing check name>
- Severity: <critical | high | medium | low>
- Finding: <what failed>
- Recommended action: <what the human should do>
```

### Escalation Matrix

| Finding | Escalate To | Blocking? |
|---------|-------------|:---------:|
| Constitution file missing | Repo owner (immediate) | Yes — all workers |
| Constitution section deleted | Repo owner + architect | Yes — all workers |
| Policy file missing / JSON invalid | Repo owner | Yes — new launches |
| Mirror out of sync | Architect (non-urgent) | No |
| Worker boundary violation | Repo owner + PR reviewer | Yes — violating PR |
| Self-expansion detected | Repo owner (immediate) | Yes — all workers |

---

## Amendment Process

Amendments to the seed constitution or policy files require a human-gated
process. No automation may propose, draft, or merge amendments.

### Steps

```
1. HUMAN drafts the amendment PR (not generated by automation).
2. ARCHITECT reviews for boundary consistency and no self-expansion.
3. REPO OWNER approves.
4. DOCS MIRROR updated to match authoritative file.
5. CONSTITUTION GUARD re-run and passes.
6. PR MERGED by human (automation must not merge).
```

### Checklist

- [ ] Amendment is human-authored
- [ ] Reviewed by `architecture-review` role
- [ ] Approved by repository owner
- [ ] Docs mirror updated to match authoritative
- [ ] Constitution guard passes
- [ ] Policy files guard passes (if JSON changed)
- [ ] No new worker authority without explicit human intent
- [ ] Human gates remain intact

### Closing an Amendment

After merge: re-run both guards, update the audit log, and close the finding
issue if the amendment was driven by a violation.

---

## Audit Log

The steward logs audit runs in issue threads or PR comments:

```
**Constitution Audit — YYYY-MM-DD**
- Trigger: <scheduled | post-merge | event-driven>
- Constitution guard: <pass | fail>
- Policy files guard: <pass | fail>
- Findings: <list or "none">
- Action taken: <none | escalated | blocked launches>
```

---

## Key Files

| Path | Purpose |
|------|---------|
| `.github/ai-policy/seed-constitution.md` | Authoritative constitution |
| `docs/ai-native/seed-constitution.md` | Docs mirror (must stay in sync) |
| `.github/ai-policy/*.json` | JSON policy files |
| `scripts/guards/check-constitution.js` | Constitution guard script |
| `scripts/guards/check-ai-policy-files.js` | Policy files guard script |

---

## References

- [Seed Constitution](seed-constitution.md) — Immutable boundaries.
- [Constitution Guard](constitution-guard.md) — Pre-flight validation.
- [AI Policy Files Guard](ai-policy-files-guard.md) — Policy file integrity.
- [External Reality Intake](external-reality-intake.md) — Evidence classification.
- [Agent Idea Review Gate](agent-idea-review-gate.md) — Idea promotion criteria.
- [Docs Authority Map](docs-authority-map.md) — Folder authority rules.
- [Main Health Policy](main-health-policy.md) — Health states and launch permissions.
