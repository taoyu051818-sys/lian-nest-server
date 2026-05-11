#!/usr/bin/env node

/**
 * server.test.js
 *
 * Smoke tests for the Provider Pool WebUI server.
 * Starts the server on an ephemeral port, exercises all endpoints, and
 * validates CLI behaviour. No external test framework.
 *
 * Run: node tools/provider-pool-webui/server.test.js
 */

const { spawn, execSync } = require("child_process");
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

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
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
      if (!started) reject(new Error(`server exited with code ${code}`));
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

// --- CLI tests (no server needed) ------------------------------------------

console.log("\nserver.js CLI tests\n");

{
  try {
    const out = execSync(`node "${serverScript}" --help`, { encoding: "utf-8", stdio: "pipe" });
    assert(out.includes("USAGE"), "CLI --help shows usage");
    assert(out.includes("--port"), "CLI --help mentions --port");
    assert(out.includes("--help"), "CLI --help mentions --help");
    assert(out.includes("ENDPOINTS"), "CLI --help lists endpoints");
  } catch {
    assert(false, "CLI --help exits 0");
  }
}

{
  try {
    execSync(`node "${serverScript}" --unknown-flag`, { encoding: "utf-8", stdio: "pipe" });
    assert(false, "CLI unknown flag should exit non-zero");
  } catch (err) {
    assert(err.status === 2, "CLI unknown flag exits with code 2");
    assert(err.stderr.includes("unknown flag"), "CLI unknown flag shows error message");
  }
}

{
  try {
    execSync(`node "${serverScript}" --port not-a-number`, { encoding: "utf-8", stdio: "pipe" });
    assert(false, "CLI invalid port should exit non-zero");
  } catch (err) {
    assert(err.status === 2, "CLI invalid port exits with code 2");
    assert(err.stderr.includes("valid port"), "CLI invalid port shows error message");
  }
}

{
  try {
    execSync(`node "${serverScript}" --port 0`, { encoding: "utf-8", stdio: "pipe" });
    assert(false, "CLI port 0 should exit non-zero");
  } catch (err) {
    assert(err.status === 2, "CLI port 0 exits with code 2");
  }
}

{
  try {
    execSync(`node "${serverScript}" --port 99999`, { encoding: "utf-8", stdio: "pipe" });
    assert(false, "CLI port >65535 should exit non-zero");
  } catch (err) {
    assert(err.status === 2, "CLI port >65535 exits with code 2");
  }
}

// --- EADDRINUSE test -------------------------------------------------------

console.log("\nEADDRINUSE tests\n");

(async () => {
  const net = require("node:net");
  const blocker = net.createServer();

  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const blockedPort = blocker.address().port;

  try {
    execSync(`node "${serverScript}" --port ${blockedPort}`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 3000,
    });
    assert(false, "EADDRINUSE should exit non-zero");
  } catch (err) {
    assert(err.status === 1, "EADDRINUSE exits with code 1");
    assert(err.stderr.includes("already in use"), "EADDRINUSE shows error message");
  }

  blocker.close();

  // --- HTTP endpoint tests -------------------------------------------------

  console.log("\nHTTP endpoint tests\n");

  const port = await findFreePort();
  let child;

  try {
    child = await startServer(port);
    assert(child.pid > 0, "server starts successfully");

    // GET / (dashboard)
    {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      assert(res.status === 200, "GET / returns 200");
      assert(res.headers["content-type"].includes("text/html"), "GET / content-type is text/html");
      assert(res.body.includes("Provider Pool Dashboard"), "GET / contains dashboard title");
      assert(res.body.includes("</html>"), "GET / returns complete HTML");
    }

    // GET /index.html (alias)
    {
      const res = await fetch(`http://127.0.0.1:${port}/index.html`);
      assert(res.status === 200, "GET /index.html returns 200");
    }

    // GET /api/health
    {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert(res.status === 200, "GET /api/health returns 200");
      const data = JSON.parse(res.body);
      assert(data.ok === true, "GET /api/health returns ok:true");
      assert(typeof data.uptime === "number", "GET /api/health includes uptime");
    }

    // GET /api/state
    {
      const res = await fetch(`http://127.0.0.1:${port}/api/state`);
      // State file may or may not exist — accept 200 or 503
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        assert(typeof data === "object", "GET /api/state returns JSON object");
        assert(Array.isArray(data.providers), "GET /api/state has providers array");
      } else {
        assert(res.status === 503, "GET /api/state returns 503 when state file missing");
        const data = JSON.parse(res.body);
        assert(data.error.includes("not available"), "GET /api/state error message");
      }
    }

    // GET /api/policy
    {
      const res = await fetch(`http://127.0.0.1:${port}/api/policy`);
      if (res.status === 200) {
        const data = JSON.parse(res.body);
        assert(typeof data === "object", "GET /api/policy returns JSON object");
        // Verify secrets are stripped
        if (Array.isArray(data.providers)) {
          const hasSourcePath = data.providers.some((p) => p.sourcePath !== undefined);
          assert(!hasSourcePath, "GET /api/policy strips sourcePath from providers");
        }
        assert(data.secretSources === undefined, "GET /api/policy strips secretSources");
      } else {
        assert(res.status === 503, "GET /api/policy returns 503 when policy file missing");
      }
    }

    // GET /api/nonexistent
    {
      const res = await fetch(`http://127.0.0.1:${port}/api/nonexistent`);
      assert(res.status === 404, "GET unknown route returns 404");
      const data = JSON.parse(res.body);
      assert(data.error === "Not found", "GET unknown route error message");
    }

    // Security headers
    {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert(res.headers["x-content-type-options"] === "nosniff", "sets X-Content-Type-Options: nosniff");
      assert(res.headers["access-control-allow-origin"] !== undefined, "sets CORS header");
    }
  } finally {
    await stopServer(child);
  }

  // --- Summary -------------------------------------------------------------

  console.log("\n" + passed + " passed, " + failed + " failed\n");
  process.exit(failed > 0 ? 1 : 0);
})();
