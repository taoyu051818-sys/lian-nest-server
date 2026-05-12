"use strict";

/**
 * command-steward-brief — WebUI action module for Command Steward brief preview.
 *
 * Wraps scripts/ai/emit-command-steward-brief.js in preview mode to produce
 * a sanitized Command Steward brief JSON without side effects.
 *
 * Safety policy:
 *   - Read-only. No mutations, no file writes.
 *   - Returns sanitized JSON only. No raw stdout/stderr in output.
 *   - Missing script or invalid JSON returns safe error.
 */

const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const BRIEF_SCRIPT = path.join(REPO_ROOT, "scripts/ai/emit-command-steward-brief.js");

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

// ── Run the emit script ──────────────────────────────────────────────────────

function runBriefScript() {
  if (!fs.existsSync(BRIEF_SCRIPT)) {
    return { ok: false, error: "emit-command-steward-brief.js not found" };
  }

  try {
    const stdout = execSync(`node "${BRIEF_SCRIPT}" --stdout`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
      cwd: REPO_ROOT,
    });

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return { ok: false, error: "Script returned invalid JSON" };
    }

    return { ok: true, brief: sanitizeObject(parsed) };
  } catch (err) {
    const stderr = (err.stderr || "").trim();
    return {
      ok: false,
      error: "Script execution failed",
      detail: stderr ? stderr.slice(0, 200) : undefined,
    };
  }
}

// ── Action module contract ───────────────────────────────────────────────────

module.exports = {
  id: "command-steward-brief",
  label: "Command Steward Brief",
  description:
    "Preview the Command Steward daily brief. Read-only — no mutations or side effects.",
  dangerous: false,

  /**
   * Preview — runs emit-command-steward-brief.js --stdout and returns sanitized JSON.
   */
  preview() {
    return runBriefScript();
  },

  /**
   * Execute — identical to preview. This action is read-only.
   */
  execute() {
    return runBriefScript();
  },
};
