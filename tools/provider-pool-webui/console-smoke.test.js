#!/usr/bin/env node

/**
 * console-smoke.test.js
 *
 * End-to-end smoke test for the full WebUI console.
 * Starts the server on an ephemeral port, exercises the dashboard,
 * planning-loop endpoints, action preview/execute flow, audit trail,
 * and validates no secret leaks. No external test framework.
 *
 * Run: node tools/provider-pool-webui/console-smoke.test.js
 */

const { spawn } = require("child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log("  PASS  " + name);
  } else {
    failed++;
    console.error("  FAIL  " + name);
  }
}

// --- Helpers ---------------------------------------------------------------

const serverScript = path.resolve(__dirname, "server.js");

function request(url, opts) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: (opts && opts.method) || "GET",
      headers: { "Content-Type": "application/json" },
    };
    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    if (opts && opts.body) {
      req.write(typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body));
    }
    req.end();
  });
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverScript, "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let started = false;
    child.stdout.on("data", (data) => {
      if (!started && data.toString().includes("listening")) {
        started = true;
        resolve(child);
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!started) reject(new Error("server exited with code " + code));
    });
    setTimeout(() => {
      if (!started) {
        child.kill();
        reject(new Error("server did not start within 5s"));
      }
    }, 5000);
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    child.on("exit", resolve);
    child.kill();
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const net = require("node:net");
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const SECRET_PATTERNS = [
  /sk-ant-/,
  /ANTHROPIC_API_KEY/,
  /OPENAI_API_KEY/,
  /ghp_[A-Za-z0-9]+/,
  /gho_[A-Za-z0-9]+/,
  /Bearer\s+\S+/i,
  /-----BEGIN.*PRIVATE KEY-----/,
];

function assertNoSecrets(json, label) {
  const raw = typeof json === "string" ? json : JSON.stringify(json);
  for (const pattern of SECRET_PATTERNS) {
    assert(!pattern.test(raw), label + ": no match for " + pattern.source);
  }
}

// --- Main ------------------------------------------------------------------

(async () => {
  const port = await findFreePort();
  let child;

  try {
    child = await startServer(port);
    const base = "http://127.0.0.1:" + port;

    // === 1. Dashboard ========================================================

    console.log("\n1. Dashboard\n");

    {
      const res = await request(base + "/");
      assert(res.status === 200, "GET / returns 200");
      assert(res.headers["content-type"].includes("text/html"), "GET / content-type is text/html");
      assert(res.body.includes("Provider Pool Dashboard"), "dashboard contains title");
      assert(res.body.includes("</html>"), "dashboard returns complete HTML");
      assert(res.body.includes("fetch('/api/state')"), "dashboard fetches state via API");
    }

    {
      const res = await request(base + "/index.html");
      assert(res.status === 200, "GET /index.html returns 200");
    }

    // === 2. Health ============================================================

    console.log("\n2. Health\n");

    {
      const res = await request(base + "/api/health");
      assert(res.status === 200, "GET /api/health returns 200");
      const data = JSON.parse(res.body);
      assert(data.ok === true, "health returns ok:true");
      assert(typeof data.uptime === "number", "health includes uptime");
      assert(Object.keys(data).length <= 3, "health response has minimal fields");
    }

    // === 3. Planning loop visibility — state, workers, resources, queue =======

    console.log("\n3. Planning loop visibility\n");

    // State
    {
      const res = await request(base + "/api/state");
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        assert(typeof data === "object", "state returns JSON object");
        assert(Array.isArray(data.providers), "state has providers array");
        assert(data.global !== undefined, "state has global summary");
      } else {
        assert(res.status === 503, "state returns 503 when file missing");
      }
    }

    // Workers
    {
      const res = await request(base + "/api/workers");
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        assert(Array.isArray(data.workers), "workers has workers array");
        assert(data.summary !== undefined, "workers has summary");
        assert(typeof data.summary.totalActive === "number", "workers summary has totalActive");
      } else {
        assert(res.status === 503, "workers returns 503 when state missing");
      }
    }

    // Resources
    {
      const res = await request(base + "/api/resources");
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        assert(data.concurrency !== undefined, "resources has concurrency");
        assert(data.utilization !== undefined, "resources has utilization");
        assert(typeof data.utilization.percentage === "number", "utilization has percentage");
        assert(["normal", "elevated", "critical"].includes(data.utilization.level), "utilization level is valid");
      } else {
        assert(res.status === 503, "resources returns 503 when files missing");
      }
    }

    // Queue
    {
      const res = await request(base + "/api/queue");
      assert(res.status === 200, "GET /api/queue returns 200");
      const data = JSON.parse(res.body);
      assert(Array.isArray(data.entries), "queue has entries array");
      assert(data.summary !== undefined, "queue has summary");
      assert(typeof data.summary.queued === "number", "queue summary has queued count");
    }

    // Policy
    {
      const res = await request(base + "/api/policy");
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        assert(typeof data === "object", "policy returns JSON object");
        if (Array.isArray(data.providers)) {
          const hasSourcePath = data.providers.some((p) => p.sourcePath !== undefined);
          assert(!hasSourcePath, "policy strips sourcePath from providers");
        }
        assert(data.secretSources === undefined, "policy strips secretSources");
      } else {
        assert(res.status === 503, "policy returns 503 when file missing");
      }
    }

    // === 4. Action registry ===================================================

    console.log("\n4. Action registry\n");

    {
      const res = await request(base + "/api/actions");
      assert(res.status === 200, "GET /api/actions returns 200");
      const data = JSON.parse(res.body);
      assert(Array.isArray(data.actions), "actions has actions array");
      // Actions may or may not be installed
      if (data.actions.length > 0) {
        const first = data.actions[0];
        assert(typeof first.id === "string", "action has string id");
        assert(typeof first.label === "string", "action has string label");
        assert(typeof first.description === "string", "action has string description");
        assert(typeof first.dangerous === "boolean", "action has boolean dangerous flag");
      }
    }

    // === 5. Action preview (dry-run) ==========================================

    console.log("\n5. Action preview\n");

    // Preview with missing actionId
    {
      const res = await request(base + "/api/actions/preview", {
        method: "POST",
        body: { payload: {} },
      });
      assert(res.status === 400, "preview missing actionId returns 400");
      const data = JSON.parse(res.body);
      assert(data.error.includes("Missing actionId"), "error mentions missing actionId");
    }

    // Preview with unknown actionId
    {
      const res = await request(base + "/api/actions/preview", {
        method: "POST",
        body: { actionId: "nonexistent.action", payload: {} },
      });
      assert(res.status === 404, "preview unknown actionId returns 404");
      const data = JSON.parse(res.body);
      assert(data.error.includes("not found"), "error mentions not found");
    }

    // Preview with invalid JSON body
    {
      const res = await request(base + "/api/actions/preview", {
        method: "POST",
        body: "not-json",
      });
      assert(res.status === 400, "preview invalid JSON returns 400");
    }

    // === 6. Execute refusal (no confirm) ======================================

    console.log("\n6. Execute refusal\n");

    // Execute with missing actionId
    {
      const res = await request(base + "/api/actions/execute", {
        method: "POST",
        body: { payload: {} },
      });
      assert(res.status === 400, "execute missing actionId returns 400");
    }

    // Execute with unknown actionId
    {
      const res = await request(base + "/api/actions/execute", {
        method: "POST",
        body: { actionId: "nonexistent.action", payload: {} },
      });
      assert(res.status === 404, "execute unknown actionId returns 404");
    }

    // === 7. Audit trail =======================================================

    console.log("\n7. Audit trail\n");

    {
      const res = await request(base + "/api/audit");
      assert(res.status === 200, "GET /api/audit returns 200");
      const data = JSON.parse(res.body);
      assert(Array.isArray(data.entries), "audit has entries array");
      assert(typeof data.total === "number", "audit has total count");
      // No executions in this test, so entries should be empty or from prior runs
    }

    // === 7b. Audit filters ====================================================

    console.log("\n7b. Audit filters\n");

    // actionId filter
    {
      const res = await request(base + "/api/audit?actionId=provider-rotation");
      assert(res.status === 200, "GET /api/audit?actionId returns 200");
      const data = JSON.parse(res.body);
      assert(Array.isArray(data.entries), "actionId filter has entries array");
    }

    // status filter
    {
      const res = await request(base + "/api/audit?status=success");
      assert(res.status === 200, "GET /api/audit?status returns 200");
      const data = JSON.parse(res.body);
      assert(Array.isArray(data.entries), "status filter has entries array");
    }

    // limit filter
    {
      const res = await request(base + "/api/audit?limit=5");
      assert(res.status === 200, "GET /api/audit?limit=5 returns 200");
      const data = JSON.parse(res.body);
      assert(Array.isArray(data.entries), "limit filter has entries array");
    }

    // invalid limit → 400
    {
      const res = await request(base + "/api/audit?limit=abc");
      assert(res.status === 400, "GET /api/audit?limit=abc returns 400");
    }

    // combined filters
    {
      const res = await request(base + "/api/audit?actionId=compile-tasks&status=success&limit=10");
      assert(res.status === 200, "GET /api/audit combined filters returns 200");
      const data = JSON.parse(res.body);
      assert(data.filters !== undefined, "combined filters response includes filters object");
      assert(data.filters.actionId === "compile-tasks", "combined filters echoes actionId");
      assert(data.filters.status === "success", "combined filters echoes status");
      assert(data.filters.limit === 10, "combined filters echoes limit");
    }

    // === 8. Secret isolation ==================================================

    console.log("\n8. Secret isolation\n");

    // Health endpoint
    {
      const res = await request(base + "/api/health");
      const data = JSON.parse(res.body);
      assertNoSecrets(data, "health");
    }

    // State endpoint
    {
      const res = await request(base + "/api/state");
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        assertNoSecrets(data, "state");
        // Verify no apiKey or token fields in providers
        const raw = JSON.stringify(data);
        assert(!/apiKey/.test(raw), "state: no apiKey field");
      } else {
        assert(true, "secret isolation: state file not present, skip");
      }
    }

    // Policy endpoint
    {
      const res = await request(base + "/api/policy");
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        assertNoSecrets(data, "policy");
      } else {
        assert(true, "secret isolation: policy file not present, skip");
      }
    }

    // Workers endpoint
    {
      const res = await request(base + "/api/workers");
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        assertNoSecrets(data, "workers");
      } else {
        assert(true, "secret isolation: workers state not present, skip");
      }
    }

    // Resources endpoint
    {
      const res = await request(base + "/api/resources");
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        assertNoSecrets(data, "resources");
      } else {
        assert(true, "secret isolation: resources state not present, skip");
      }
    }

    // Queue endpoint
    {
      const res = await request(base + "/api/queue");
      const data = JSON.parse(res.body);
      assertNoSecrets(data, "queue");
    }

    // Actions endpoint
    {
      const res = await request(base + "/api/actions");
      const data = JSON.parse(res.body);
      assertNoSecrets(data, "actions");
    }

    // Planning endpoint
    {
      const res = await request(base + "/api/planning");
      assert(res.status === 200, "planning: returns 200");
      const data = JSON.parse(res.body);
      assertNoSecrets(data, "planning");
      assert(typeof data === "object", "planning returns JSON object");
      // launch plan structure may or may not be present
      if (data.launchPlan) {
        assert(Array.isArray(data.launchPlan.selectedTasks) || data.launchPlan.selectedTasks === undefined,
          "launchPlan has selectedTasks array or undefined");
        assert(Array.isArray(data.launchPlan.rejectedTasks) || data.launchPlan.rejectedTasks === undefined,
          "launchPlan has rejectedTasks array or undefined");
        assert(Array.isArray(data.launchPlan.locksAcquired) || data.launchPlan.locksAcquired === undefined,
          "launchPlan has locksAcquired array or undefined");
        assert(typeof data.launchPlan.allAllowed === "boolean" || data.launchPlan.allAllowed === undefined,
          "launchPlan has allAllowed boolean or undefined");
      }
    }

    // Audit endpoint
    {
      const res = await request(base + "/api/audit");
      const data = JSON.parse(res.body);
      assertNoSecrets(data, "audit");
    }

    // Dashboard HTML
    {
      const res = await request(base + "/");
      assertNoSecrets(res.body, "dashboard HTML");
    }

    // === 9. Security headers ==================================================

    console.log("\n9. Security headers\n");

    {
      const res = await request(base + "/api/health");
      assert(res.headers["x-content-type-options"] === "nosniff", "X-Content-Type-Options: nosniff");
      assert(res.headers["access-control-allow-origin"] !== undefined, "CORS header present");
      assert(res.headers["access-control-allow-origin"] === "http://127.0.0.1", "CORS restricted to localhost");
      assert(res.headers["access-control-allow-origin"] !== "*", "CORS is not wildcard");
    }

    // === 10. Localhost binding ================================================

    console.log("\n10. Localhost binding\n");

    {
      const res = await request(base + "/api/health");
      assert(res.status === 200, "server responds on 127.0.0.1");
    }

    // === 11. Unknown route ====================================================

    console.log("\n11. Unknown route\n");

    // === 12. Confirmation copy enhancement =====================================

    console.log("\n12. Confirmation copy enhancement\n");

    // Verify app.js source contains confirmation warning infrastructure
    {
      const appJsPath = path.resolve(__dirname, "public", "app.js");
      const appJs = fs.readFileSync(appJsPath, "utf-8");
      assert(appJs.includes("RISK_DESCRIPTIONS"), "app.js contains RISK_DESCRIPTIONS map");
      assert(appJs.includes("confirmationWarningBanner"), "app.js contains confirmationWarningBanner function");
      assert(appJs.includes("confirm-warning"), "app.js references confirm-warning CSS class");
      assert(appJs.includes("execute-confirm__reason"), "app.js references reason input classes");
      // Verify risk-specific descriptions exist
      assert(appJs.includes("provider.retry"), "RISK_DESCRIPTIONS includes provider.retry");
      assert(appJs.includes("provider.disable"), "RISK_DESCRIPTIONS includes provider.disable");
      assert(appJs.includes("queue.clearStale"), "RISK_DESCRIPTIONS includes queue.clearStale");
      assert(appJs.includes("global.refreshState"), "RISK_DESCRIPTIONS includes global.refreshState");
      // Verify confirmation prompt includes action label
      assert(appJs.includes("to confirm execution of"), "confirmation prompt includes action label context");
      // Verify reason validation logic exists
      assert(appJs.includes("needsReason"), "app.js has reason validation logic");
      assert(appJs.includes("validateConfirm"), "app.js has validateConfirm function");
    }

    // Verify styles.css source contains confirmation warning styles
    {
      const stylesPath = path.resolve(__dirname, "public", "styles.css");
      const styles = fs.readFileSync(stylesPath, "utf-8");
      assert(styles.includes("confirm-warning--high"), "styles.css contains high-risk warning style");
      assert(styles.includes("confirm-warning--medium"), "styles.css contains medium-risk warning style");
      assert(styles.includes("confirm-warning__body"), "styles.css contains warning body style");
      assert(styles.includes("confirm-warning__notice"), "styles.css contains warning notice style");
      assert(styles.includes("execute-confirm__reason"), "styles.css contains reason input style");
      assert(styles.includes("confirm-warning__icon"), "styles.css contains warning icon style");
    }

    {
      const res = await request(base + "/api/nonexistent");
      assert(res.status === 404, "unknown route returns 404");
      const data = JSON.parse(res.body);
      assert(data.error === "Not found", "unknown route error message");
    }

    // === 12. Console readiness summary ========================================

    console.log("\n12. Console readiness\n");

    {
      // Verify all expected API routes respond (even if with 503)
      const endpoints = [
        "/api/health",
        "/api/state",
        "/api/policy",
        "/api/workers",
        "/api/resources",
        "/api/queue",
        "/api/actions",
        "/api/audit",
        "/api/planning",
      ];
      let allReachable = true;
      for (const ep of endpoints) {
        const res = await request(base + ep);
        if (res.status !== 200 && res.status !== 503) {
          allReachable = false;
          assert(false, ep + " is reachable (got " + res.status + ")");
        }
      }
      assert(allReachable, "all console API endpoints are reachable");
    }

    {
      // Verify dashboard serves client-side JS that hits all key endpoints
      const res = await request(base + "/");
      assert(res.body.includes("api/state"), "dashboard JS references /api/state");
    }

  } finally {
    await stopServer(child);
  }

  // --- Summary ---------------------------------------------------------------

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed > 0 ? 1 : 0);
})();
