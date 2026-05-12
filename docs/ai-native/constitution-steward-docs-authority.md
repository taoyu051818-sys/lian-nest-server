# Constitution Steward Docs Authority

Maps source-of-truth ownership for constitution steward documentation.
Prevents duplicate truth sources and guides workers to the correct
canonical doc for each constitution sub-topic.

> **Closes:** [#1009](https://github.com/taoyu051818-sys/lian-nest-server/issues/1009)
> **See also:** [docs-authority-map.md](docs-authority-map.md) for
> folder-level authority, [external-intake-docs-authority.md](external-intake-docs-authority.md)
> for intake-side authority, [seed-constitution.md](seed-constitution.md)
> for the immutable boundaries themselves.

---

## Source Docs

| Doc | Canonical For | Authority Level | Mutability |
|-----|---------------|-----------------|------------|
| [seed-constitution.md](seed-constitution.md) | Immutable boundaries: high-risk human-required rules, merge allowlists, main-red launch stop, legacy read-only, no scope expansion, amendment process | **Constitutional** — overrides all other governance docs | Immutable; requires human-authored PR, architecture-review, and repo-owner approval |
| [constitution-guard.md](constitution-guard.md) | Pre-flight validation of constitution integrity: required sections, mirror sync | **Canonical** for constitution validation | Stable; changes require repo-owner approval |
| [ai-policy-files-guard.md](ai-policy-files-guard.md) | Policy directory integrity: required JSON policy files, schema validation | **Canonical** for policy file validation | Stable; changes require repo-owner approval |
| [external-source-threat-model.md](external-source-threat-model.md) | Threat model for external inputs: prompt injection, noisy data, stale sources, LLM reproduction | **Canonical** for constitution-adjacent threat definitions | Stable; changes require repo-owner approval |
| [external-intake-docs-authority.md](external-intake-docs-authority.md) | Source-of-truth ownership for external intake documentation | **Canonical** for intake docs authority mapping | Stable; changes require repo-owner approval |
| [docs-authority-map.md](docs-authority-map.md) | Folder-level authority, migration doc lifecycle, worker context selection | **Canonical** for folder authority hierarchy | Stable; changes require repo-owner approval |

### Authoritative Policy Files

The seed constitution is enforced by JSON policy files in `.github/ai-policy/`.
These are **authoritative** for their respective domains — docs describe
the rules; policy files enforce them.

| Policy File | Enforces | Relationship to Docs |
|-------------|----------|---------------------|
| `seed-constitution.md` (`.github/ai-policy/`) | Immutable boundaries — the single source of truth | `docs/ai-native/seed-constitution.md` is a mirror; authoritative version wins on conflict |
| `worker-permissions.json` | Worker file access boundaries | Supplements seed constitution §2 (merge allowlists) |
| `risk-policy.json` | Risk classification for operations | Supplements seed constitution §1 (high-risk boundaries) |
| `merge-policy.json` | Merge gate behavior | Supplements seed constitution §2 (merge allowlists) |
| `launch-policy.json` | Launch gate behavior | Supplements seed constitution §3 (main-red launch stop) |
| `failure-taxonomy.json` | Failure categories and health impacts | Cross-referenced by constitution guard and threat model |
| `external-intake-policy.json` | External intake source rules | Supplements external-reality-intake.md |

---

## Topic Ownership Matrix

Each constitution steward sub-topic has exactly one canonical source.
Workers MUST read the canonical doc; other docs may reference the topic
but must defer to the canonical source on conflicts.

| Topic | Canonical Source | Secondary References |
|-------|-----------------|---------------------|
| Immutable boundaries (all 5 sections) | `seed-constitution.md` §1–5 (authoritative: `.github/ai-policy/seed-constitution.md`) | `external-source-threat-model.md` §Layer 3 (enforcement view) |
| High-risk human-required operations | `seed-constitution.md` §1 | `external-source-threat-model.md` §Threat Categories (threat context) |
| Merge allowlist rules | `seed-constitution.md` §2 | `docs-authority-map.md` §Folder Authority (folder-level view) |
| Main-red launch stop | `seed-constitution.md` §3 | `main-health-policy.md` (health state details) |
| Legacy backend read-only policy | `seed-constitution.md` §4 | `docs-authority-map.md` §Migration Doc Lifecycle (doc expiry) |
| No worker scope expansion | `seed-constitution.md` §5 | `parallel-work-policy.md` (conflict groups) |
| Amendment process | `seed-constitution.md` §Amendment Process | — |
| Constitution integrity validation | `constitution-guard.md` | `ai-policy-files-guard.md` (policy file validation) |
| Policy file validation | `ai-policy-files-guard.md` | `constitution-guard.md` (constitution validation) |
| External threat model | `external-source-threat-model.md` | `external-reality-intake.md` §Prompt-Injection Boundaries (intake-side enforcement) |
| Folder authority hierarchy | `docs-authority-map.md` | — |
| Intake docs authority | `external-intake-docs-authority.md` | — |

---

## Duplicate Avoidance Rules

1. **Constitution vs. enforcement.** `seed-constitution.md` states
   immutable rules. `constitution-guard.md` validates that the constitution
   file is intact. `ai-policy-files-guard.md` validates that policy files
   exist and parse. Do not duplicate validation logic in the constitution
   doc or constitution rules in the guard docs.

2. **Authoritative vs. mirror.** `.github/ai-policy/seed-constitution.md`
   is the single source of truth. `docs/ai-native/seed-constitution.md`
   is a mirror for worker context. If they diverge, the authoritative
   version wins. The constitution guard checks sync between them.

3. **Threat model vs. intake enforcement.** `external-source-threat-model.md`
   defines *what* threats exist. `external-reality-intake.md` defines *how*
   the intake layer defends against them. Do not duplicate threat
   definitions in the intake doc or intake mechanics in the threat model.

4. **Folder authority vs. topic authority.** `docs-authority-map.md`
   defines which *folder* owns which domain. This doc defines which
   *specific file* owns which constitution sub-topic. Topic authority
   is more specific and takes precedence within the constitution domain.

5. **Policy files vs. docs.** JSON policy files in `.github/ai-policy/`
   are machine-enforceable rules. Markdown docs describe the rules in
   human-readable form. When a policy file and a doc conflict on a
   specific rule value, the policy file is authoritative.

---

## Constitution Steward Role Boundaries

The Constitution Steward role may propose policy changes but may NOT
self-approve high-risk or constitutional changes. This boundary is
enforced by the seed constitution itself.

| Action | Steward Permitted | Human Required |
|--------|:-----------------:|:--------------:|
| Propose a policy doc change | Yes | — |
| Propose a JSON policy file change | Yes | — |
| Approve a constitutional amendment | **No** | Yes (human-authored PR) |
| Approve a high-risk boundary change | **No** | Yes (architecture-review + repo-owner) |
| Validate constitution integrity | Yes (run guard) | — |
| Flag stale or conflicting docs | Yes | — |
| Merge a docs-only PR within `allowedFiles` | Yes (if task contract allows) | — |
| Edit `.github/ai-policy/` files | **No** (unless in `allowedFiles`) | Yes |

---

## Integration With Folder Authority

This map is scoped to constitution steward governance. The parent
[docs-authority-map.md](docs-authority-map.md) assigns `docs/ai-native/`
as the **Governance** folder for process docs. All docs listed here are
governance docs under that authority.

The authoritative seed constitution at `.github/ai-policy/seed-constitution.md`
is a **policy file**, not a governance doc — it lives outside `docs/` and
is subject to the high-risk boundary rules in §1 of the constitution itself.

---

## References

- [Seed Constitution](seed-constitution.md) — Immutable boundaries (docs mirror)
- [Seed Constitution (authoritative)](../../.github/ai-policy/seed-constitution.md) — Single source of truth
- [Constitution Guard](constitution-guard.md) — Pre-flight constitution validation
- [AI Policy Files Guard](ai-policy-files-guard.md) — Policy directory integrity
- [External Source Threat Model](external-source-threat-model.md) — Threat definitions
- [External Intake Docs Authority](external-intake-docs-authority.md) — Intake docs ownership
- [Docs Authority Map](docs-authority-map.md) — Folder-level authority
- [External Reality Intake](external-reality-intake.md) — Intake flow and sanitization
