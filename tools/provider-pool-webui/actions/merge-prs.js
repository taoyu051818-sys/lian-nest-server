"use strict";

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const MERGE_SCRIPT = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "ai",
  "webui-merge-control.ps1"
);

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload must be an object");
  }
  const { prNumbers } = payload;
  if (!Array.isArray(prNumbers) || prNumbers.length === 0) {
    throw new Error("prNumbers must be a non-empty array of PR numbers");
  }
  for (const pr of prNumbers) {
    if (!Number.isInteger(pr) || pr <= 0) {
      throw new Error("Each PR number must be a positive integer, got: " + pr);
    }
  }
}

function resolveRepo(payload) {
  const repo = payload.repo || process.env.GH_REPO;
  if (!repo || typeof repo !== "string") {
    throw new Error(
      "Repository not specified. Pass repo in payload or set GH_REPO env var."
    );
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("Repository must be in OWNER/NAME format, got: " + repo);
  }
  return repo;
}

function runMergeScript(prNumbers, repo, isExecute) {
  if (!fs.existsSync(MERGE_SCRIPT)) {
    throw new Error("Merge control script not found: " + MERGE_SCRIPT);
  }

  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-File",
    MERGE_SCRIPT,
    "-PRs",
    prNumbers.join(","),
    "-Repo",
    repo,
    "-Force",
  ];

  if (isExecute) {
    args.push("-Execute");
  }

  try {
    const stdout = execFileSync("pwsh", args, {
      encoding: "utf-8",
      timeout: 60000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout };
  } catch (err) {
    const exitCode = err.status || 1;
    const stdout = err.stdout || "";
    return {
      exitCode,
      stdout,
      error: "Merge script exited with code " + exitCode,
    };
  }
}

function extractManifest(stdout) {
  // Look for manifest path in output and read it
  const manifestMatch = stdout.match(
    /Manifest written to:\s*(.+\.json)/i
  );
  if (manifestMatch) {
    const manifestPath = manifestMatch[1].trim();
    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      // Manifest may not be parseable — fall through
    }
  }
  return null;
}

function buildPreviewResult(payload) {
  const prNumbers = payload.prNumbers;
  const repo = resolveRepo(payload);

  // Run in dry-run mode (no -Execute flag)
  const result = runMergeScript(prNumbers, repo, false);

  const manifest = extractManifest(result.stdout);

  return {
    ok: result.exitCode === 0,
    mode: "preview",
    prNumbers,
    repository: repo,
    healthGate: "skipped",
    guards: "skipped",
    manifest,
    message:
      "Dry-run preview completed. No PRs were merged. " +
      "Pass confirm:true to execute.",
  };
}

function buildExecuteResult(payload) {
  const prNumbers = payload.prNumbers;
  const repo = resolveRepo(payload);

  // Run in execute mode (-Execute flag, -Force to skip interactive prompt)
  const result = runMergeScript(prNumbers, repo, true);

  const manifest = extractManifest(result.stdout);

  if (result.exitCode !== 0) {
    return {
      ok: false,
      mode: "execute",
      prNumbers,
      repository: repo,
      error: result.error || "Merge failed",
      manifest,
    };
  }

  return {
    ok: true,
    mode: "execute",
    prNumbers,
    repository: repo,
    healthGate: manifest ? manifest.healthGate : "unknown",
    guards: manifest ? manifest.guards : "unknown",
    manifest,
    message: "Merge batch completed for PRs: " + prNumbers.join(", "),
  };
}

module.exports = {
  id: "merge-prs",
  label: "Merge PRs",
  description:
    "Merge an explicit allowlist of PRs with health gate and guard checks.",
  dangerous: true,

  preview(payload) {
    validatePayload(payload);
    return buildPreviewResult(payload);
  },

  execute(payload) {
    validatePayload(payload);
    return buildExecuteResult(payload);
  },
};
