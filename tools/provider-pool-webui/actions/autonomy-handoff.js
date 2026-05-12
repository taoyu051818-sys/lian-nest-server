"use strict";

/**
 * autonomy-handoff — WebUI action module for autonomy handoff summary.
 *
 * Aggregates handoff facts and exit readiness from control-plane state
 * projections without mutating GitHub or any external system.
 *
 * Safety policy:
 *   - Read-only. No mutations, no file writes, no GitHub calls.
 *   - Returns sanitized JSON only. No raw stdout/stderr in output.
 *   - Missing state files produce conservative defaults.
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const STATE_DIR = path.join(REPO_ROOT, ".github", "ai-state");

const HEALTH_PATH = path.join(STATE_DIR, "main-health.json");
const PROVIDER_POOL_PATH = path.join(STATE_DIR, "provider-pool.json");
const ACTIVE_WORKERS_PATH = path.join(STATE_DIR, "active-workers.json");
const META_SIGNALS_PATH = path.join(STATE_DIR, "meta-signals.json");
const EXIT_READINESS_PATH = path.join(STATE_DIR, "codex-exit-readiness.json");

// ── Secret patterns to strip from output ─────────────────────────────────────

const SECRET_PATTERNS = [
  /token/i,
  /secret/i,
  /key/i,
  /password/i,
  /credential/i,
  /auth/i,
  /bearer/i,
];

function sanitizeValue(value) {
  if (typeof value === "string") {
    if (value.length > 500) return value.slice(0, 500) + "...";
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === "object") return sanitizeObject(value);
  return value;
}

function sanitizeObject(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_PATTERNS.some((p) => p.test(k))) continue;
    result[k] = sanitizeValue(v);
  }
  return result;
}

// ── State readers ────────────────────────────────────────────────────────────

function readJson(filePath) {
  try {
    let raw = fs.readFileSync(filePath, "utf-8");
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Handoff fact aggregation ─────────────────────────────────────────────────

function readHealth() {
  const data = readJson(HEALTH_PATH);
  if (!data || !data.state) {
    return { loaded: false, state: "unknown", blocked: true };
  }
  const blocked = data.state === "red" || data.state === "black";
  const result = sanitizeObject(data);
  result.loaded = true;
  result.blocked = blocked;
  return result;
}

function readProviderPool() {
  const data = readJson(PROVIDER_POOL_PATH);
  if (!data || !Array.isArray(data.providers)) {
    return { loaded: false, available: 0, total: 0, hasCapacity: false };
  }

  let available = 0;
  let atCapacity = 0;
  let exhausted = 0;
  let disabled = 0;

  for (const p of data.providers) {
    const isAtCapacity = (p.currentConcurrency || 0) >= (p.maxConcurrency || 0);
    switch (p.status) {
      case "available":
        if (isAtCapacity) { atCapacity++; } else { available++; }
        break;
      case "exhausted":
        exhausted++;
        break;
      case "disabled":
        disabled++;
        break;
    }
  }

  const total = data.providers.length;
  const hasCapacity = available > 0;

  return {
    loaded: true,
    available,
    atCapacity,
    exhausted,
    disabled,
    total,
    hasCapacity,
    stateVersion: data.stateVersion || null,
  };
}

function readActiveWorkers() {
  const data = readJson(ACTIVE_WORKERS_PATH);
  if (!data || !Array.isArray(data.workers)) {
    return { loaded: false, count: 0, workers: [] };
  }
  const workers = data.workers.map(function (w) {
    return sanitizeObject({
      id: w.id || null,
      issueNumber: w.issueNumber || null,
      state: w.state || null,
      startedAt: w.startedAt || null,
    });
  });
  return { loaded: true, count: workers.length, workers };
}

function readMetaSignals() {
  const data = readJson(META_SIGNALS_PATH);
  if (!data || !data.signals) {
    return { loaded: false, signals: null };
  }
  return { loaded: true, signals: sanitizeObject(data.signals) };
}

function readExitReadiness() {
  const data = readJson(EXIT_READINESS_PATH);
  if (!data) {
    return { loaded: false, verdict: "not_ready", gates: [], blockers: [] };
  }
  return {
    loaded: true,
    verdict: data.verdict || "not_ready",
    passedBlocking: data.passedBlocking || 0,
    totalBlocking: data.totalBlocking || 0,
    gates: Array.isArray(data.gates)
      ? data.gates.map(function (g) {
          return {
            id: g.id,
            name: g.name,
            pass: !!g.pass,
            blocking: !!g.blocking,
          };
        })
      : [],
    blockers: Array.isArray(data.blockers) ? data.blockers : [],
  };
}

// ── Pre-handoff checklist ────────────────────────────────────────────────────

function evaluatePreHandoffChecklist(health, pool, workers) {
  return [
    {
      id: "pre-1",
      name: "Main health is GREEN",
      pass: health.loaded && health.state === "green",
      detail: health.loaded
        ? "Health state: " + health.state
        : "Health marker not found",
    },
    {
      id: "pre-2",
      name: "Health marker exists",
      pass: health.loaded,
      detail: health.loaded
        ? "Marker present, captured at " + (health.capturedAt || "unknown")
        : "main-health.json not found",
    },
    {
      id: "pre-3",
      name: "Provider pool has capacity",
      pass: pool.loaded && pool.hasCapacity,
      detail: pool.loaded
        ? pool.available + " available, " + pool.total + " total"
        : "Provider pool state not found",
    },
    {
      id: "pre-4",
      name: "No stale active workers",
      pass: workers.loaded && workers.count === 0,
      detail: workers.loaded
        ? workers.count + " active worker(s)"
        : "Active workers state not found",
    },
  ];
}

// ── Retirement checklist snapshot ────────────────────────────────────────────

function evaluateRetirementChecklist(exitReadiness) {
  // Map exit readiness gates to retirement checklist items
  var gateMap = {};
  for (var i = 0; i < exitReadiness.gates.length; i++) {
    gateMap[exitReadiness.gates[i].id] = exitReadiness.gates[i].pass;
  }

  return [
    {
      id: "ret-1",
      name: "Self-cycle runner launches workers autonomously",
      pass: !!gateMap["gate-1"],
      blocking: true,
    },
    {
      id: "ret-2",
      name: "Launch gate runs unattended",
      pass: !!gateMap["gate-2"],
      blocking: true,
    },
    {
      id: "ret-3",
      name: "Health gate operational",
      pass: !!gateMap["gate-3"],
      blocking: true,
    },
    {
      id: "ret-4",
      name: "Recovery path defined",
      pass: !!gateMap["gate-4"],
      blocking: true,
    },
    {
      id: "ret-5",
      name: "Merge control enforced",
      pass: !!gateMap["gate-5"],
      blocking: true,
    },
    {
      id: "ret-6",
      name: "Human-owned boundaries enforced",
      pass: !!gateMap["gate-6"],
      blocking: true,
    },
    {
      id: "ret-7",
      name: "Observability operational",
      pass: !!gateMap["gate-7"],
      blocking: true,
    },
  ];
}

// ── Build summary ────────────────────────────────────────────────────────────

function buildSummary() {
  var health = readHealth();
  var pool = readProviderPool();
  var workers = readActiveWorkers();
  var meta = readMetaSignals();
  var exitReadiness = readExitReadiness();
  var preHandoff = evaluatePreHandoffChecklist(health, pool, workers);
  var retirement = evaluateRetirementChecklist(exitReadiness);

  var preHandoffPass = preHandoff.every(function (c) { return c.pass; });
  var retirementPass = retirement.every(function (c) { return c.pass; });
  var ready = preHandoffPass && exitReadiness.verdict === "ready";

  return {
    ok: true,
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    verdict: ready ? "ready" : preHandoffPass ? "partial" : "not_ready",
    health: sanitizeObject(health),
    providerPool: sanitizeObject(pool),
    activeWorkers: sanitizeObject(workers),
    metaSignals: meta.loaded ? sanitizeObject(meta.signals) : null,
    exitReadiness: sanitizeObject(exitReadiness),
    preHandoffChecklist: preHandoff,
    retirementChecklist: retirement,
    summary: {
      preHandoffPass: preHandoffPass,
      retirementPass: retirementPass,
      exitVerdict: exitReadiness.verdict,
      ready: ready,
    },
    message: ready
      ? "All handoff prerequisites met. Codex can exit routine orchestration."
      : preHandoffPass
        ? "Pre-handoff checks pass but exit readiness is " + exitReadiness.verdict + "."
        : "Pre-handoff checks incomplete. Resolve blockers before handoff.",
  };
}

// ── Action module contract ───────────────────────────────────────────────────

module.exports = {
  id: "autonomy-handoff",
  label: "Autonomy Handoff Summary",
  description:
    "Summarize handoff facts and exit readiness. Read-only — no mutations, no GitHub calls, no side effects.",
  dangerous: false,

  /**
   * Preview — aggregates handoff facts from state files and returns sanitized JSON.
   */
  preview() {
    return buildSummary();
  },

  /**
   * Execute — identical to preview. This action is read-only.
   */
  execute() {
    return buildSummary();
  },
};
