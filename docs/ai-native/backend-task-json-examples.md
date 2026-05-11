# Backend Task JSON Examples

Reference examples for each backend worker tier. All examples include the four required backend fields: `sourceOfTruthDocs`, `blockedBy`, `mainHealthPolicy`, `generatedCodePolicy`.

See [worker-task-contract.md](worker-task-contract.md) for field definitions.

---

## 1. Foundation Worker

Resolves minimum runtime blockers (Prisma client, DatabaseModule, RedisModule). Runs first, blocks all other backend workers.

```json
{
  "taskType": "execution",
  "risk": "high",
  "conflictGroup": "runtime-foundation",
  "targetIssue": 68,
  "targetPR": null,
  "issues": [68],
  "expectedPR": true,
  "allowedFiles": [
    "src/prisma/**",
    "src/generated/prisma/**",
    "src/database/**"
  ],
  "forbiddenFiles": [
    "src/**/*.module.ts",
    "src/**/*.controller.ts",
    "prisma/schema.prisma",
    "package.json",
    "package-lock.json"
  ],
  "validationCommands": [
    "npx prisma validate",
    "npx prisma generate",
    "npm run build"
  ],
  "sourceOfTruthDocs": [
    "docs/ai-native/worker-task-contract.md",
    "https://www.prisma.io/docs/orm/prisma-schema/overview"
  ],
  "blockedBy": [],
  "mainHealthPolicy": "gate-all",
  "generatedCodePolicy": "allow-with-regenerate-note",
  "rolePacket": {
    "actorRole": "backend-foundation-worker",
    "description": "Resolve Prisma 7 generated client and PrismaService runtime blockers."
  },
  "attentionAreas": {
    "focus": [
      "Prisma client generation must succeed",
      "DatabaseModule must bootstrap without errors",
      "No business logic changes"
    ],
    "knownBlindspots": [
      "Do not modify schema.prisma — that is a migration worker's job",
      "Do not touch controllers or services outside prisma/database"
    ]
  },
  "reviewAndAcceptance": {
    "requiredReviewRoles": ["devops-automation-engineer", "architect"],
    "acceptanceOwner": "Codex orchestrator gate after worker PR"
  },
  "budgets": {
    "maxFiles": 8,
    "maxLinesChanged": 200,
    "softTimeMinutes": 20,
    "hardTimeMinutes": 40
  },
  "complexityAssessment": {
    "level": "medium",
    "drivers": ["Prisma 7 client changes", "runtime bootstrap"],
    "splitRecommendation": null
  },
  "stragglerPolicy": {
    "action": "open_pr_or_comment_blocker",
    "publishPartial": true,
    "maxExtensionMinutes": 15
  },
  "pmPhase": "foundation-wave-1"
}
```

---

## 2. Health / Diagnostic Worker

Enhances post-merge health gates, failure classification, and CI diagnostics. Runs after foundation is stable.

```json
{
  "taskType": "execution",
  "risk": "medium",
  "conflictGroup": "health-diagnostics",
  "targetIssue": 69,
  "targetPR": null,
  "issues": [69],
  "expectedPR": true,
  "allowedFiles": [
    "scripts/**",
    "docs/ai-native/post-merge-health-gate.md",
    "docs/ai-native/worker-acceptance-checklist.md"
  ],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    "package.json",
    "package-lock.json"
  ],
  "validationCommands": [
    "npm run check",
    "bash scripts/post-merge-health-gate.sh"
  ],
  "sourceOfTruthDocs": [
    "docs/ai-native/post-merge-health-gate.md",
    "docs/ai-native/worker-acceptance-checklist.md"
  ],
  "blockedBy": [68],
  "mainHealthPolicy": "gate-all",
  "generatedCodePolicy": "forbid",
  "rolePacket": {
    "actorRole": "health-diagnostics-worker",
    "description": "Enhance post-merge health gate with Prisma/Redis/NodeBB failure classification."
  },
  "attentionAreas": {
    "focus": [
      "Failure classification must cover Prisma client, Redis, and NodeBB adapter",
      "Health gate script must be idempotent",
      "Diagnosable vs fatal error separation"
    ],
    "knownBlindspots": [
      "Do not modify application source code",
      "Do not change CI pipeline YAML — only scripts and docs"
    ]
  },
  "reviewAndAcceptance": {
    "requiredReviewRoles": ["devops-automation-engineer", "architect"],
    "acceptanceOwner": "Codex orchestrator gate after worker PR"
  },
  "budgets": {
    "maxFiles": 6,
    "maxLinesChanged": 300,
    "softTimeMinutes": 25,
    "hardTimeMinutes": 50
  },
  "complexityAssessment": {
    "level": "medium",
    "drivers": ["failure classification design", "script idempotency"],
    "splitRecommendation": null
  },
  "stragglerPolicy": {
    "action": "open_pr_or_comment_blocker",
    "publishPartial": true,
    "maxExtensionMinutes": 10
  },
  "pmPhase": "foundation-wave-1"
}
```

---

## 3. Lifecycle Docs Worker

Produces architecture docs, migration guides, and worker operation manuals. No runtime code changes.

```json
{
  "taskType": "execution",
  "risk": "low",
  "conflictGroup": "ai-native-docs",
  "targetIssue": 70,
  "targetPR": null,
  "issues": [70],
  "expectedPR": true,
  "allowedFiles": [
    "docs/ai-native/**"
  ],
  "forbiddenFiles": [
    "src/**",
    "prisma/**",
    "scripts/**",
    "package.json",
    "package-lock.json"
  ],
  "validationCommands": [
    "git diff --check"
  ],
  "sourceOfTruthDocs": [
    "docs/ai-native/worker-task-contract.md",
    "docs/ai-native/SOP.md"
  ],
  "blockedBy": [68, 69],
  "mainHealthPolicy": "gate-docs-only",
  "generatedCodePolicy": "forbid",
  "rolePacket": {
    "actorRole": "ai-native-process-architect",
    "description": "Document Prisma 7 client lifecycle and worker operation norms."
  },
  "attentionAreas": {
    "focus": [
      "Docs must be actionable for future workers",
      "Install/generate/validate/check/build sequence must be explicit",
      "Link to existing contracts and SOPs"
    ],
    "knownBlindspots": [
      "Do not edit runtime code",
      "Do not duplicate content already in SOP.md"
    ]
  },
  "reviewAndAcceptance": {
    "requiredReviewRoles": ["devops-automation-engineer"],
    "acceptanceOwner": "Codex orchestrator gate after worker PR"
  },
  "budgets": {
    "maxFiles": 5,
    "maxLinesChanged": 400,
    "softTimeMinutes": 20,
    "hardTimeMinutes": 40
  },
  "complexityAssessment": {
    "level": "low",
    "drivers": ["documentation"],
    "splitRecommendation": null
  },
  "stragglerPolicy": {
    "action": "open_pr_or_comment_blocker",
    "publishPartial": true,
    "maxExtensionMinutes": 10
  },
  "pmPhase": "foundation-wave-1"
}
```

---

## 4. Feature / Repository Worker

Business module changes (API endpoints, services, controllers). Only runs after foundation + health tiers are stable.

```json
{
  "taskType": "execution",
  "risk": "medium",
  "conflictGroup": "feature-feed",
  "targetIssue": 73,
  "targetPR": null,
  "issues": [73],
  "expectedPR": true,
  "allowedFiles": [
    "src/feed/**",
    "src/common/**",
    "test/**"
  ],
  "forbiddenFiles": [
    "src/prisma/**",
    "src/generated/**",
    "prisma/schema.prisma",
    "scripts/**",
    "package.json",
    "package-lock.json"
  ],
  "validationCommands": [
    "npm run check",
    "npm run build",
    "npm test -- --testPathPattern=feed"
  ],
  "sourceOfTruthDocs": [
    "docs/contracts/feed-read-only-contract.md",
    "docs/ai-native/worker-task-contract.md"
  ],
  "blockedBy": [68, 69, 70],
  "mainHealthPolicy": "gate-all",
  "generatedCodePolicy": "forbid",
  "rolePacket": {
    "actorRole": "feature-worker",
    "description": "Implement feed read-only API endpoints per contract."
  },
  "attentionAreas": {
    "focus": [
      "API response shape must match contract exactly",
      "No schema changes in this worker",
      "Test coverage for happy path and error cases"
    ],
    "knownBlindspots": [
      "Do not modify Prisma schema or generated client",
      "Do not change shared modules outside allowedFiles"
    ]
  },
  "reviewAndAcceptance": {
    "requiredReviewRoles": ["devops-automation-engineer", "architect"],
    "acceptanceOwner": "Codex orchestrator gate after worker PR"
  },
  "budgets": {
    "maxFiles": 12,
    "maxLinesChanged": 500,
    "softTimeMinutes": 30,
    "hardTimeMinutes": 60
  },
  "complexityAssessment": {
    "level": "medium",
    "drivers": ["API contract compliance", "test coverage"],
    "splitRecommendation": null
  },
  "stragglerPolicy": {
    "action": "open_pr_or_comment_blocker",
    "publishPartial": true,
    "maxExtensionMinutes": 15
  },
  "pmPhase": "feature-wave-1"
}
```

---

## Field Comparison by Worker Tier

| Field | Foundation | Health | Docs | Feature |
|---|---|---|---|---|
| `risk` | high | medium | low | medium |
| `blockedBy` | `[]` | `[foundation]` | `[foundation, health]` | `[foundation, health, docs]` |
| `mainHealthPolicy` | gate-all | gate-all | gate-docs-only | gate-all |
| `generatedCodePolicy` | allow-with-regenerate-note | forbid | forbid | forbid |
| `conflictGroup` | runtime-foundation | health-diagnostics | ai-native-docs | feature-{module} |

---

## Escalation Rules

1. **Foundation worker fails** → All downstream workers in `blockedBy` must pause. Health and docs workers cannot proceed until runtime is green.
2. **Health worker fails** → Feature workers must not start. Docs worker may proceed if health gate script is unchanged.
3. **Feature worker needs schema change** → Must stop and open a separate migration worker task with `generatedCodePolicy: "allow-with-regenerate-note"`.
4. **Any worker exceeds `hardTimeMinutes`** → Follow `stragglerPolicy`: publish partial PR and comment blocker on the issue.
