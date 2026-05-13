# Pluggable Tool Registry — Investigation

Investigation of SWE-agent's config-driven tool registry pattern and
its applicability to LIAN's self-cycle loop.

> **Closes:** [#1440](https://github.com/taoyu051818-sys/lian-nest-server/issues/1440)
>
> **Source:** [SWE-agent default.yaml](https://github.com/SWE-agent/SWE-agent/blob/main/config/default.yaml)
> (external-doc, reliability B)
>
> **See also:**
> [control-skill-registry.md](control-skill-registry.md)
> for the existing governance-layer skill model,
> [external-research-sources.md](external-research-sources.md)
> for source classification.

---

## 1. SWE-Agent Pattern

SWE-agent defines tools as YAML config entries. Each tool bundle has:

- A **name** (stable identifier).
- A **CLI command** or API endpoint the agent invokes.
- An **input schema** (typed parameters the agent must fill).
- An **output schema** (expected return shape).
- A **description** the agent uses for tool selection.

The agent loop loads all tools from the registry at startup. Adding a
new tool means adding a YAML file — no edits to the loop script. Tools
are first-class citizens with typed interfaces, not ad-hoc shell
commands.

Key properties:

- **Config-driven:** tool definitions live in files, not code.
- **Schema-validated:** inputs and outputs are typed.
- **Discoverable:** the agent reads all available tools at startup.
- **Decoupled:** the loop script does not reference individual tools.

---

## 2. Current LIAN State

LIAN's tool registration has three layers, all hardcoded:

### 2a. PowerShell orchestrator (`run-self-cycle.ps1`)

The self-cycle loop invokes tools via hardcoded `$SCRIPT_DIR`-relative
paths (lines 151–157):

```powershell
$RECONCILER   = Join-Path $SCRIPT_DIR "state-reconciler.ps1"
$HEALTH_WRITER = Join-Path $SCRIPT_DIR "write-main-health-state.ps1"
$LAUNCH_GATE  = Join-Path $SCRIPT_DIR "check-launch-gate.ps1"
$BATCH_LAUNCH = Join-Path $SCRIPT_DIR "batch-launch.ps1"
$COMPILER     = Join-Path $SCRIPT_DIR "compile-issue-to-task-json.ps1"
$PLANNER      = Join-Path $SCRIPT_DIR "plan-next-batch.ps1"
```

Each step is a direct `& pwsh -NoProfile -File $SCRIPT_NAME` call.
Adding a new step requires editing the script.

### 2b. Static action registry (`action-registry.js`)

A frozen JavaScript array in `tools/provider-pool-webui/lib/`.
Each entry declares `id`, `label`, `risk`, `requiredFields`,
`script` path, and `confirmMessage`. Manually maintained — not
config-driven.

### 2c. Dynamic action modules (`actions/*.js`)

The WebUI server discovers modules at runtime via filesystem scan.
Each module exports `id`, `label`, `dangerous`, `preview()`,
`execute()`. This is the only semi-pluggable pattern in the repo.

### 2d. Control skill registry (`emit-control-skill-registry.js`)

Emits a JSON snapshot of all control skills. The catalogue is a
hardcoded 380-line JavaScript constant — it does not introspect the
actual modules or registry. The JSON schema
(`schemas/control-skill-registry.schema.json`) defines the entry shape
but is used for documentation, not runtime loading.

---

## 3. Gap Analysis

| SWE-agent Property | LIAN Current State | Gap |
|--------------------|--------------------|-----|
| Tools declared in config files | Tools hardcoded in JS/PS1 source | **Full gap** |
| Input/output schemas per tool | `inputSchema` exists in schema but not populated per tool | **Partial gap** |
| Loop loads tools from registry at startup | Loop has hardcoded script paths | **Full gap** |
| Adding a tool = adding a file | Adding a tool = editing source code | **Full gap** |
| Tools are discoverable | WebUI modules are discoverable; PS1 scripts are not | **Partial gap** |

---

## 4. Feasibility Assessment

### What a pluggable registry would require

A JSON or YAML registry file (e.g. `tools/self-cycle-registry.json`)
where each entry declares:

```json
{
  "toolId": "state-reconciler",
  "label": "State Reconciler",
  "description": "Reconcile AI state files with GitHub issue state.",
  "cli": "pwsh",
  "args": ["-NoProfile", "-File", "scripts/ai/state-reconciler.ps1"],
  "inputSchema": {
    "required": ["repo"],
    "optional": ["dryRun"],
    "properties": {
      "repo": { "type": "string" },
      "dryRun": { "type": "boolean", "default": false }
    }
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "reconciled": { "type": "number" },
      "skipped": { "type": "number" }
    }
  },
  "riskLevel": "low",
  "category": "state"
}
```

The loop script would read this registry at startup, iterate entries,
and invoke each tool by its declared CLI + args.

### Complexity estimate

- **Registry file + schema:** Low complexity. The existing
  `control-skill-registry.schema.json` already models most fields.
- **Loop refactor:** Medium complexity. `run-self-cycle.ps1` would
  need a generic "invoke tool from registry" function. Step ordering
  and dependencies would need to be declared in the registry or in a
  separate pipeline config.
- **Migration:** Medium risk. Each hardcoded step has unique
  parameter passing, error handling, and output parsing. Extracting
  these into a generic invocation pattern requires careful testing.

### Risks

- **Over-abstraction:** The self-cycle loop has 6 steps with
  heterogeneous contracts (some read stdin, some write files, some
  call `gh`). A generic registry may not capture these differences
  without becoming as complex as the original script.
- **Governance drift:** The control-skill-registry already exists as
  a governance layer. Adding a second registry for the self-cycle
  loop risks fragmentation.
- **Maintenance burden:** A config file must be kept in sync with the
  actual scripts. The existing `emit-control-skill-registry.js`
  already has this problem (hardcoded constant drifting from reality).

---

## 5. Recommendation

**Close #1440 with findings.** The SWE-agent pattern is architecturally
sound but the ROI for LIAN is low because:

1. **LIAN's tools are not generic.** Each step in `run-self-cycle.ps1`
   has unique contracts (provider pool preflight reads JSON, batch
   launch orchestrates worktrees, state reconciler calls `gh`).
   A generic "CLI + args" registry would still need per-tool adapters.

2. **The governance layer already exists.** The control-skill-registry
   schema and policy document cover the same ground (identity, input
   schema, risk, human gates). A pluggable runtime registry would
   duplicate this.

3. **The loop is stable.** `run-self-cycle.ps1` changes infrequently.
   The cost of hardcoding new steps is low; the cost of maintaining a
   generic registry is higher.

### If revisited later

If the self-cycle loop grows beyond ~10 steps, or if external
contributors need to add tools without editing the loop script, revisit
with a bounded design:

- Extend the existing `control-skill-registry.schema.json` with
  `cli`, `args`, `outputSchema` fields.
- Build a PowerShell loader that reads the registry and invokes tools.
- Migrate steps one at a time, starting with the simplest
  (`write-main-health-state.ps1`).

---

## 6. Artifacts Produced

- This document: `docs/ai-native/pluggable-tool-registry-investigation.md`
- No code changes. No schema changes. No script changes.
