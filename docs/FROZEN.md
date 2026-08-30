# Frozen Repository Policy

Effective: 2026-08-30

`taoyu051818-sys/lian-nest-server` is a frozen migration repository. The canonical production
backend and sole LIAN backend release source is `taoyu051818-sys/lian-platform-server`.

## Prohibited while frozen

- Feature, route, schema, dependency, generated-client or infrastructure changes.
- Deployment, release, production configuration or traffic migration from this repository.
- New issues or pull requests that continue the rewrite or its agent orchestration.
- Treating parity trackers, plans or tests here as current LIAN runtime truth.

## Allowed exceptions

- A critical security redaction needed to make retained history safe.
- Documentation that corrects a materially false claim about the frozen state.
- Exporting non-secret migration evidence to the canonical repositories before final archival.

Every exception requires an explicit owner-approved issue, a narrowly scoped pull request and a
statement that the repository remains non-deployable. Routine dependency updates are not security
exceptions; automated dependency pull requests should remain disabled.

## Unfreeze rule

Unfreezing is an architecture decision, not a normal code change. It requires first updating the
single authoritative
[`REPOSITORY_RELATIONSHIP.md`](https://github.com/taoyu051818-sys/lian-mobile-web/blob/main/docs/REPOSITORY_RELATIONSHIP.md)
with ownership, migration, deployment, data and rollback plans. Until that change is reviewed and
merged, `main` remains a read-only migration snapshot.
