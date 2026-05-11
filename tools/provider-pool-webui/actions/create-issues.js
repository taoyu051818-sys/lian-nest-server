"use strict";

/**
 * Action module: create-issues
 *
 * Proposes and creates GitHub issues from gap analysis data.
 * Defaults to preview (dry-run) — no GitHub mutations without explicit
 * confirm. Dangerous: requires confirm=true for execute.
 */

const { execSync } = require("node:child_process");

// --- Priority ranking --------------------------------------------------------

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

// --- Helpers -----------------------------------------------------------------

function buildIssueBody(gap) {
  const lines = ["## Goal", gap.goal || "Address gap: " + gap.title, ""];
  lines.push("## Scope");
  lines.push(gap.scope || "Auto-generated from gap analysis.");
  lines.push("");

  lines.push("## CONTROL APPENDIX");
  lines.push("Task type: execution");
  lines.push("Risk: " + (gap.risk || "medium"));
  lines.push("Conflict group: " + (gap.conflictGroup || "gap-fill"));
  lines.push("Allowed files:");
  const files = gap.allowedFiles && gap.allowedFiles.length > 0
    ? gap.allowedFiles
    : ["docs/**"];
  for (const f of files) {
    lines.push("- " + f);
  }
  lines.push("Validation commands:");
  lines.push("- npm run check");
  lines.push("- npm run build");
  if (gap.sliceRef) {
    lines.push("Slice: " + gap.sliceRef);
  }
  lines.push("Mode: dry-run");
  lines.push("Gap key: " + gap.gapKey);
  return lines.join("\n");
}

function deduplicateProposals(proposals, existingIssues) {
  return proposals.filter((p) => {
    const needle = "Gap key: " + p.gapKey;
    return !existingIssues.some((issue) => issue.body && issue.body.includes(needle));
  });
}

function listOpenIssues() {
  try {
    const raw = execSync("gh issue list --state open --limit 200 --json number,title,body", {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function extractIssueNumber(output) {
  if (!output) return null;
  const m = output.match(/\/issues\/(\d+)/);
  return m ? m[1] : null;
}

// --- Preview (dry-run) -------------------------------------------------------

function preview(payload) {
  const p = payload || {};
  const gaps = Array.isArray(p.gaps) ? p.gaps : [];
  const labels = Array.isArray(p.labels) ? p.labels : [];

  if (gaps.length === 0) {
    return {
      ok: true,
      proposals: [],
      summary: { total: 0, valid: 0, duplicatesSkipped: 0, mode: "preview" },
    };
  }

  // Validate required fields
  const validGaps = [];
  const errors = [];
  for (let i = 0; i < gaps.length; i++) {
    const gap = gaps[i];
    if (!gap || typeof gap !== "object") {
      errors.push("gap[" + i + "]: not an object");
      continue;
    }
    if (!gap.title) {
      errors.push("gap[" + i + "]: missing title");
      continue;
    }
    if (!gap.gapKey) {
      errors.push("gap[" + i + "]: missing gapKey");
      continue;
    }
    validGaps.push(gap);
  }

  if (validGaps.length === 0) {
    return {
      ok: false,
      error: "No valid gaps after validation",
      validationErrors: errors,
      summary: { total: gaps.length, valid: 0, duplicatesSkipped: 0, mode: "preview" },
    };
  }

  // Deduplicate against existing open issues
  const existingIssues = listOpenIssues();
  const proposals = [];
  let duplicatesSkipped = 0;

  for (const gap of validGaps) {
    const body = buildIssueBody(gap);
    const proposal = {
      title: gap.title,
      body,
      gapKey: gap.gapKey,
      labels: [...labels],
      priority: gap.priority || "medium",
      risk: gap.risk || "medium",
      conflictGroup: gap.conflictGroup || "gap-fill",
      allowedFiles: gap.allowedFiles || ["docs/**"],
      sliceRef: gap.sliceRef || null,
    };

    const needle = "Gap key: " + gap.gapKey;
    const isDuplicate = existingIssues.some(
      (issue) => issue.body && issue.body.includes(needle)
    );
    if (isDuplicate) {
      duplicatesSkipped++;
      continue;
    }
    proposals.push(proposal);
  }

  // Sort by priority rank
  proposals.sort(
    (a, b) => (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2)
  );

  return {
    ok: true,
    proposals,
    summary: {
      total: gaps.length,
      valid: validGaps.length,
      duplicatesSkipped,
      proposed: proposals.length,
      mode: "preview",
    },
    validationErrors: errors.length > 0 ? errors : undefined,
  };
}

// --- Execute (real mutation) -------------------------------------------------

function execute(payload, options) {
  const p = payload || {};
  const proposals = Array.isArray(p.proposals) ? p.proposals : [];
  const dryRun = p.dryRun !== false;
  const opts = options || {};
  const ghExec = opts.execCommand || defaultGhExec;

  if (proposals.length === 0) {
    return {
      ok: true,
      created: [],
      dryRun,
      summary: { total: 0, created: 0, failed: 0, mode: dryRun ? "dry-run" : "execute" },
    };
  }

  // In dry-run mode, return what would be created without mutation
  if (dryRun) {
    return {
      ok: true,
      created: [],
      wouldCreate: proposals.map((p) => ({
        title: p.title,
        gapKey: p.gapKey,
        labels: p.labels || [],
      })),
      dryRun: true,
      summary: {
        total: proposals.length,
        created: 0,
        failed: 0,
        mode: "dry-run",
      },
    };
  }

  const created = [];
  for (const proposal of proposals) {
    const labels = Array.isArray(proposal.labels) ? proposal.labels : [];
    const labelArgs = labels.map((l) => "--label=" + l).join(" ");
    const cmd =
      'gh issue create --title="' +
      proposal.title.replace(/"/g, '\\"') +
      '" --body-file=- ' +
      labelArgs;
    try {
      const out = ghExec(cmd, proposal.body);
      created.push({
        title: proposal.title,
        gapKey: proposal.gapKey,
        issueNumber: extractIssueNumber(out),
        url: (out || "").trim(),
      });
    } catch (e) {
      return {
        ok: false,
        created,
        error: "Failed to create issue: " + proposal.title + " — " + e.message,
        summary: {
          total: proposals.length,
          created: created.length,
          failed: proposals.length - created.length,
          mode: "execute",
        },
      };
    }
  }

  return {
    ok: true,
    created,
    dryRun: false,
    summary: {
      total: proposals.length,
      created: created.length,
      failed: 0,
      mode: "execute",
    },
  };
}

// --- Default gh executor -----------------------------------------------------

function defaultGhExec(cmd, bodyInput) {
  return execSync(cmd, {
    encoding: "utf-8",
    input: bodyInput,
    timeout: 30000,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
  });
}

// --- Exports -----------------------------------------------------------------

module.exports = {
  id: "create-issues",
  label: "Create Issues",
  description:
    "Propose and create GitHub issues from gap analysis. Defaults to preview (dry-run).",
  dangerous: true,
  preview,
  execute,
};
