# Repository Boundary Guard

> Architecture note for issue [#17](https://github.com/taoyu051818-sys/lian-nest-server/issues/17).

## 1. Motivation

Business modules (auth, channels, AI records, notifications) must never touch
data stores directly. Every read or write to Postgres, Redis, or the local
filesystem must pass through a class inside `src/repositories/` that implements
one of the `I*Repository` interfaces.

**Why this boundary exists:**

| Concern | How the boundary helps |
|---|---|
| Testability | Services can be unit-tested against repository mocks without standing up Postgres or Redis. |
| Swap safety | Switching from Prisma to Drizzle, or from ioredis to a managed cache client, changes files inside `src/repositories/` only. |
| Audit surface | All persistence calls are funneled through a small, reviewable set of classes. Security reviewers can audit a single module instead of grepping the entire tree. |
| Worker isolation | AI-native workers get `allowedFiles` scoped to their domain. A worker that needs data access must go through repository interfaces, preventing hidden coupling. |

The same pattern already exists for NodeBB: `src/nodebb/` owns every HTTP call
to the forum API and enforces it with `nodebb-boundary.spec.ts`. This document
extends that discipline to all data stores.

## 2. Allowed vs forbidden imports

### Allowed (inside `src/repositories/`)

```typescript
// src/repositories/providers/auth.repository.ts
import { PrismaService } from '../prisma/prisma.service';   // OK — inside boundary
import { Redis } from 'ioredis';                             // OK — inside boundary
import { readFile } from 'fs/promises';                      // OK — inside boundary (dev/test adapters)
```

### Forbidden (outside `src/repositories/`)

```typescript
// src/auth/auth.service.ts  ← WRONG
import { PrismaClient } from '@prisma/client';               // FORBIDDEN — direct ORM
import { createClient } from 'redis';                         // FORBIDDEN — direct Redis
import { readFile } from 'fs/promises';                       // FORBIDDEN — direct filesystem
```

### Allowed (outside `src/repositories/`)

```typescript
// src/auth/auth.service.ts  ← CORRECT
import { Inject } from '@nestjs/common';
import { REPOSITORY_TOKENS } from '../repositories/tokens';
import type { IAuthRepository } from '../repositories/interfaces';

@Injectable()
export class AuthService {
  constructor(
    @Inject(REPOSITORY_TOKENS.AUTH_REPOSITORY)
    private readonly authRepo: IAuthRepository,
  ) {}
}
```

Services depend on **interfaces + tokens**, never on concrete implementations or
storage drivers.

## 3. Guard script and test shape

### 3.1 Runtime guard test (recommended)

Follow the pattern established by `src/nodebb/nodebb-boundary.spec.ts`:

```typescript
// src/repositories/repository-boundary.spec.ts

import * as fs from 'fs';
import * as path from 'path';

const FORBIDDEN_PACKAGES = [
  '@prisma/client',
  'prisma',
  'ioredis',
  'redis',
  'pg',
  'mysql2',
  'better-sqlite3',
];

const FORBIDDEN_NODE_MODULES = ['fs', 'fs/promises', 'path'];

const SRC_ROOT = path.resolve(__dirname, '..');
const REPOSITORIES_DIR = path.join(SRC_ROOT, 'repositories');

function collectTsFiles(dir: string, exclude: Set<string>): string[] {
  // walk dir, return .ts files not in exclude set
}

describe('repository boundary', () => {
  let outsideFiles: string[];

  beforeAll(() => {
    const exclude = new Set([
      REPOSITORIES_DIR,
      // always exclude test files
    ]);
    outsideFiles = collectTsFiles(SRC_ROOT, exclude);
  });

  it('no file outside src/repositories imports a data-store driver', () => {
    const violations: string[] = [];
    for (const file of outsideFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const pkg of FORBIDDEN_PACKAGES) {
        if (content.includes(`'${pkg}'`) || content.includes(`"${pkg}"`)) {
          violations.push(`${file} imports ${pkg}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
```

### 3.2 Candidate validation commands

| Command | Purpose | When to run |
|---|---|---|
| `npm run test:boundary` | Runs `repository-boundary.spec.ts` and `nodebb-boundary.spec.ts` together. | Every PR, CI gate. |
| `npm run lint:imports` | ESLint `no-restricted-imports` rule targeting data-store packages outside `src/repositories/`. | Pre-commit, CI. |
| `npx ts-prune --error` | Detects unused `REPOSITORY_TOKENS` exports. | Periodic cleanup, pre-merge. |
| `npm run check` | Existing type-check gate (includes boundary files once merged). | Every PR. |

### 3.3 ESLint rule (complementary)

```jsonc
// .eslintrc.cjs (excerpt)
{
  "rules": {
    "no-restricted-imports": ["error", {
      "paths": [
        { "name": "@prisma/client", "message": "Use repository interfaces. See docs/architecture/repository-boundary-guard.md" },
        { "name": "ioredis", "message": "Use repository interfaces." },
        { "name": "redis", "message": "Use repository interfaces." }
      ],
      "patterns": [{
        "group": ["src/repositories/providers/*"],
        "message": "Inject via REPOSITORY_TOKENS, do not import providers directly."
      }]
    }]
  }
}
```

With an override for `src/repositories/**` to allow those imports.

## 4. Type-tightening follow-ups from PR #15 review

PR #15 (RepositoryModule) introduced string-literal unions for enum-like
fields. The following should be tightened before the first real
implementations land.

### 4.1 `AuthCredential['provider']`

**Current** (string-literal union):
```typescript
provider: 'local' | 'google' | 'github' | 'apple';
```

**Target** (dedicated const or enum):
```typescript
export const AUTH_PROVIDERS = ['local', 'google', 'github', 'apple'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

// in AuthCredential:
provider: AuthProvider;
```

Using a `const` tuple + indexed type keeps runtime iteration available
(e.g., for validation) while preserving exhaustiveness checking.

### 4.2 `ChannelRead['channelType']`

**Current** (string-literal union):
```typescript
channelType: 'topic' | 'category' | 'chat';
```

**Target**:
```typescript
export const CHANNEL_TYPES = ['topic', 'category', 'chat'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

// in ChannelRead:
channelType: ChannelType;
```

### 4.3 Unused `RepositoryToken` handling

`REPOSITORY_TOKENS` currently exports 7 tokens. Not all will have
implementations on day one. Two concerns:

1. **Unused-token lint noise.** `ts-prune` or `@typescript-eslint/no-unused-vars`
   will flag tokens that have no inject site yet. Solution: suppress via
   `export { REPOSITORY_TOKENS }` in the barrel (already done) and document
   that all tokens are intentionally exported even when unused.

2. **Runtime safety.** If a token is injected but no provider is registered,
   NestJS throws at startup. This is the correct behavior. However, skeleton
   providers currently throw `'not implemented'` at call time, which is a
   different failure mode. Decide: keep skeletons (fail-on-call) or remove
   them and let NestJS fail-on-inject. **Recommendation:** keep skeletons
   for now; they make partial wiring testable. Remove them once Prisma
   implementations land in issue #9.

## 5. Implementation slices

### Slice 1 — Repository boundary guard test

| Field | Detail |
|---|---|
| **Files** | `src/repositories/repository-boundary.spec.ts` |
| **Dependency** | RepositoryModule merged to main. |
| **Validation** | `npm run test -- --testPathPattern=repository-boundary` passes; deliberately importing `@prisma/client` in a service file fails the test. |
| **Acceptance** | CI includes `test:boundary` step. Violations block merge. |

### Slice 2 — Type-tightening for provider and channelType

| Field | Detail |
|---|---|
| **Files** | `src/repositories/interfaces/auth-repository.interface.ts`, `src/repositories/interfaces/channel-read-repository.interface.ts`, `src/repositories/types.ts` (new barrel for shared const tuples). |
| **Dependency** | RepositoryModule merged. |
| **Validation** | `npm run check` passes. Exhaustive switch on `AuthProvider` and `ChannelType` compiles. |
| **Acceptance** | No string-literal unions remain for these fields. All consumers use the exported const tuple for runtime iteration. |

### Slice 3 — ESLint no-restricted-imports for data-store packages

| Field | Detail |
|---|---|
| **Files** | `.eslintrc.cjs` or equivalent flat config. |
| **Dependency** | RepositoryModule merged. |
| **Validation** | `npx eslint src/auth/auth.service.ts` errors when `@prisma/client` is imported; `npx eslint src/repositories/providers/auth.repository.ts` does not error. |
| **Acceptance** | CI lint step catches boundary violations at PR time without running tests. |

### Slice 4 — Consolidated `npm run test:boundary` script

| Field | Detail |
|---|---|
| **Files** | `package.json` (script only), `src/repositories/repository-boundary.spec.ts`, `src/nodebb/nodebb-boundary.spec.ts` (rename/alias if needed). |
| **Dependency** | Slices 1 and existing `nodebb-boundary.spec.ts`. |
| **Validation** | `npm run test:boundary` runs both boundary specs and exits non-zero on any violation. |
| **Acceptance** | Single command validates all module boundaries. Documented in CI config and worker contracts. |

## 6. Implemented commands (issue #27)

| Command | What it does |
|---|---|
| `npm run test:boundary` | Runs the Jest boundary spec only (`repository-boundary.spec.ts`). |
| `npm test` | Runs all specs including the boundary guard. |
| `node scripts/check-repository-boundary.js` | Standalone Node script — same check, no Jest dependency. |

### Allowlist (approved importers)

Only files under `src/repositories/` may import these packages:

`@prisma/client`, `prisma`, `ioredis`, `redis`, `pg`, `mysql2`, `better-sqlite3`, `fs`, `fs/promises`

All other `src/` files must use repository interfaces via `REPOSITORY_TOKENS` injection.
