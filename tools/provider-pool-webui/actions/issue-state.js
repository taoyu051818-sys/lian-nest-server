"use strict";

/**
 * issue-state — WebUI action module for issue reconcile and close-done preview.
 *
 * Wraps issue lifecycle control behind the WebUI action module contract:
 *   - preview(payload)  → dry-run drift report (read-only)
 *   - execute(payload)  → close eligible issues (mutating, requires allowlist)
 *
 * Safety policy:
 *   - Default to preview/dry-run. Execute requires confirm via server gate.
 *   - Explicit issue allowlist required. No mass-close.
 *   - Umbrella and human-required issues are refused.
 *   - Returns sanitized JSON. No raw stdout/stderr in output.
 */

const { execSync } = require("node:child_process");

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ISSUES = 20;
const UMBRELLA_PATTERN = /umbrella/i;
const CLOSE_AUDIT_MARKER_BEGIN = "<!-- ai-webui-issue-control:begin -->";
const CLOSE_AUDIT_MARKER_END = "<!-- ai-webui-issue-control:end -->";

// ── Helpers ───────────────────────────────────────────────────────────────────

function runGh(args) {
  try {
    const out = execSync(`gh ${args}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });
    return { ok: true, stdout: out.trim() };
  } catch (err) {
    return { ok: false, error: err.message, stderr: (err.stderr || "").trim() };
  }
}

function parseIssueView(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function getIssue(number) {
  const res = runGh(`issue view ${number} --json number,title,state,labels`);
  if (!res.ok) return { ok: false, error: `Cannot fetch issue #${number}: ${res.error}` };
  const data = parseIssueView(res.stdout);
  if (!data) return { ok: false, error: `Invalid JSON for issue #${number}` };
  return { ok: true, issue: data };
}

function getMergedPRs() {
  const res = runGh(
    "pr list --state merged --limit 50 --json number,title,body,mergedAt"
  );
  if (!res.ok) return [];
  try {
    return JSON.parse(res.stdout);
  } catch {
    return [];
  }
}

function findLinkedPR(issueNumber, mergedPRs) {
  const ref = `#${issueNumber}`;
  return mergedPRs.filter(
    (pr) =>
      (pr.title && pr.title.includes(ref)) ||
      (pr.body && pr.body.includes(ref))
  );
}

function hasLabel(issue, labelName) {
  if (!issue.labels) return false;
  return issue.labels.some((l) => {
    const name = typeof l === "string" ? l : l.name;
    return name === labelName;
  });
}

function hasAgentLabel(issue) {
  if (!issue.labels) return false;
  return issue.labels.some((l) => {
    const name = typeof l === "string" ? l : l.name;
    return name.startsWith("agent:");
  });
}

function isRefused(issue) {
  if (UMBRELLA_PATTERN.test(issue.title || "")) {
    return { refused: true, reason: "umbrella issue" };
  }
  if (hasLabel(issue, "human-required")) {
    return { refused: true, reason: "human-required" };
  }
  return { refused: false };
}

function classifyIssue(issue, mergedPRs) {
  const linked = findLinkedPR(issue.number, mergedPRs);
  const mergedLinked = linked.filter((pr) => pr.mergedAt);
  const state = (issue.state || "").toUpperCase();
  const agentDone = hasLabel(issue, "agent:done");
  const agentRunning = hasLabel(issue, "agent:running");

  // merged-pr-open-issue: merged PR exists, issue still open
  if (mergedLinked.length > 0 && state === "OPEN") {
    return {
      rule: "merged-pr-open-issue",
      severity: "error",
      action: "close",
      mergedPR: mergedLinked[0].number,
      detail: `PR #${mergedLinked[0].number} merged; issue #${issue.number} still open`,
    };
  }

  // merged-pr-stale-label: merged PR but label is not agent:done
  if (mergedLinked.length > 0 && !agentDone && state === "OPEN") {
    return {
      rule: "merged-pr-stale-label",
      severity: "error",
      action: "label",
      mergedPR: mergedLinked[0].number,
      detail: `PR #${mergedLinked[0].number} merged; issue #${issue.number} label should be agent:done`,
    };
  }

  // done-without-merge: agent:done but no merged PR
  if (agentDone && mergedLinked.length === 0 && state === "OPEN") {
    return {
      rule: "done-without-merge",
      severity: "error",
      action: "review",
      detail: `Issue #${issue.number} has agent:done but no merged PR`,
    };
  }

  // stale-running: agent:running with no linked PRs at all
  if (agentRunning && linked.length === 0) {
    return {
      rule: "stale-running",
      severity: "warning",
      action: "review",
      detail: `Issue #${issue.number} is agent:running with no linked PRs`,
    };
  }

  return {
    rule: "no-drift",
    severity: "info",
    action: "none",
    detail: `Issue #${issue.number} has no detected drift`,
  };
}

// ── Main logic ────────────────────────────────────────────────────────────────

function runReconcile(payload) {
  const issueNumbers = payload.issueNumbers;
  if (!Array.isArray(issueNumbers) || issueNumbers.length === 0) {
    return { ok: false, error: "issueNumbers array is required" };
  }
  if (issueNumbers.length > MAX_ISSUES) {
    return { ok: false, error: `issueNumbers exceeds max of ${MAX_ISSUES}` };
  }

  // Validate issue numbers are positive integers
  for (const n of issueNumbers) {
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, error: `Invalid issue number: ${n}` };
    }
  }

  const mergedPRs = getMergedPRs();
  const results = [];
  const refused = [];
  const eligible = [];

  for (const num of issueNumbers) {
    const res = getIssue(num);
    if (!res.ok) {
      results.push({ number: num, status: "error", detail: res.error });
      continue;
    }

    const issue = res.issue;
    const refuseCheck = isRefused(issue);
    if (refuseCheck.refused) {
      refused.push({
        number: num,
        title: issue.title,
        reason: refuseCheck.reason,
      });
      results.push({
        number: num,
        status: "refused",
        title: issue.title,
        detail: refuseCheck.reason,
      });
      continue;
    }

    const classification = classifyIssue(issue, mergedPRs);
    const entry = {
      number: num,
      title: issue.title,
      state: (issue.state || "").toUpperCase(),
      ...classification,
    };
    results.push(entry);

    if (classification.action === "close") {
      eligible.push(entry);
    }
  }

  return {
    ok: true,
    version: 1,
    capturedAt: new Date().toISOString(),
    totalIssues: issueNumbers.length,
    eligible: eligible.length,
    refusedCount: refused.length,
    results,
    refused,
    eligibleIssues: eligible.map((e) => ({
      number: e.number,
      title: e.title,
      mergedPR: e.mergedPR,
    })),
  };
}

function runCloseDone(payload) {
  const issueNumbers = payload.issueNumbers;
  if (!Array.isArray(issueNumbers) || issueNumbers.length === 0) {
    return { ok: false, error: "issueNumbers array is required" };
  }
  if (issueNumbers.length > MAX_ISSUES) {
    return { ok: false, error: `issueNumbers exceeds max of ${MAX_ISSUES}` };
  }

  for (const n of issueNumbers) {
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, error: `Invalid issue number: ${n}` };
    }
  }

  const mergedPRs = getMergedPRs();
  const closed = [];
  const skipped = [];
  const errors = [];

  for (const num of issueNumbers) {
    const res = getIssue(num);
    if (!res.ok) {
      errors.push({ number: num, detail: res.error });
      continue;
    }

    const issue = res.issue;
    const refuseCheck = isRefused(issue);
    if (refuseCheck.refused) {
      skipped.push({ number: num, title: issue.title, reason: refuseCheck.reason });
      continue;
    }

    const classification = classifyIssue(issue, mergedPRs);
    if (classification.action !== "close") {
      skipped.push({
        number: num,
        title: issue.title,
        reason: classification.detail,
      });
      continue;
    }

    // Post closing comment
    const commentBody = [
      CLOSE_AUDIT_MARKER_BEGIN,
      `Auto-closed via WebUI issue-state action.`,
      `Linked PR #${classification.mergedPR} has been merged into main.`,
      CLOSE_AUDIT_MARKER_END,
    ].join("\n");

    const commentRes = runGh(
      `issue comment ${num} --body ${JSON.stringify(commentBody)}`
    );
    if (!commentRes.ok) {
      errors.push({ number: num, detail: `Comment failed: ${commentRes.error}` });
      continue;
    }

    // Remove agent:* labels
    const labels = issue.labels || [];
    for (const label of labels) {
      const name = typeof label === "string" ? label : label.name;
      if (name.startsWith("agent:")) {
        runGh(`issue edit ${num} --remove-label ${JSON.stringify(name)}`);
      }
    }

    // Close the issue
    const closeRes = runGh(`issue close ${num}`);
    if (!closeRes.ok) {
      errors.push({ number: num, detail: `Close failed: ${closeRes.error}` });
      continue;
    }

    closed.push({ number: num, title: issue.title, mergedPR: classification.mergedPR });
  }

  return {
    ok: true,
    version: 1,
    capturedAt: new Date().toISOString(),
    mode: "execute",
    totalRequested: issueNumbers.length,
    closed: closed.length,
    skipped: skipped.length,
    errors: errors.length,
    closedIssues: closed,
    skippedIssues: skipped,
    errors: errors,
  };
}

// ── Action module contract ────────────────────────────────────────────────────

module.exports = {
  id: "issue-state",
  label: "Issue State Control",
  description:
    "Reconcile issue labels/PRs and close done issues. Preview shows drift; execute closes eligible issues.",
  dangerous: true,

  /**
   * Preview (dry-run) — shows what would happen without mutation.
   */
  preview(payload) {
    const p = payload || {};
    return runReconcile(p);
  },

  /**
   * Execute — closes eligible issues. Requires explicit issue allowlist.
   * The server enforces confirm:true for dangerous actions.
   */
  execute(payload) {
    const p = payload || {};
    return runCloseDone(p);
  },
};
