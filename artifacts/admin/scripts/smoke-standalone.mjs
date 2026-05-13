/**
 * Smoke test for the admin server running in standalone (root-path) mode.
 *
 * Starts the server on a random port with STANDALONE=true and verifies:
 *   1. GET /         → 200 with HTML containing root-relative asset paths
 *   2. GET /assets/  → 200 for a real JS/CSS asset
 *   3. GET /nonexistent → 200 (SPA fallback to index.html)
 *   4. Bypass token acquisition is attempted (logged)
 *
 * Usage:
 *   node artifacts/admin/scripts/smoke-standalone.mjs
 */

import { spawn } from "child_process";
import { createConnection } from "net";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { readdir } from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_MJS = resolve(__dirname, "..", "server.mjs");
const DIST_DIR = resolve(__dirname, "..", "dist", "public", "assets");

// Pick a random high port to avoid conflicts
const PORT = 19800 + Math.floor(Math.random() * 200);

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}${detail ? ": " + detail : ""}`);
    failed++;
  }
}

async function waitForPort(port, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await new Promise((r) => {
      const sock = createConnection(port, "127.0.0.1");
      sock.on("connect", () => { sock.destroy(); r(true); });
      sock.on("error", () => { sock.destroy(); r(false); });
    }).then((ok) => ok ? Promise.resolve() : new Promise((r) => setTimeout(r, 150)));
    const sock = createConnection(port, "127.0.0.1");
    const connected = await new Promise((r) => {
      sock.on("connect", () => { sock.destroy(); r(true); });
      sock.on("error", () => { sock.destroy(); r(false); });
    });
    if (connected) return;
  }
  throw new Error(`Server did not start on port ${PORT} within ${timeout}ms`);
}

async function get(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  const text = await res.text();
  return { status: res.status, body: text, contentType: res.headers.get("content-type") ?? "" };
}

async function main() {
  // Find a real asset filename from the dist
  let assetFile = "";
  try {
    const files = await readdir(DIST_DIR);
    assetFile = "/assets/" + (files.find((f) => f.endsWith(".js")) ?? "");
  } catch {
    console.warn("Could not read dist/assets — asset existence test will be skipped");
  }

  console.log(`Starting admin server in STANDALONE mode on port ${PORT}…`);

  const proc = spawn(
    process.execPath,
    [SERVER_MJS],
    {
      env: {
        ...process.env,
        PORT: String(PORT),
        STANDALONE: "true",
        // No API_URL or ADMIN_BYPASS_SECRET — bypass will warn but not crash
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const logs = [];
  proc.stdout.on("data", (d) => logs.push(d.toString()));
  proc.stderr.on("data", (d) => logs.push(d.toString()));
  proc.on("error", (err) => { console.error("Failed to start server:", err.message); process.exit(1); });

  try {
    await waitForPort(PORT);
    console.log("Server is up. Running checks…\n");

    // 1. Root path serves index.html
    const root = await get("/");
    assert("GET / → 200", root.status === 200, `got ${root.status}`);
    assert("GET / → Content-Type: text/html", root.contentType.includes("text/html"), root.contentType);
    assert(
      "GET / → index.html references root-relative assets (/assets/)",
      root.body.includes('src="/assets/') || root.body.includes('href="/assets/'),
      "no /assets/ reference found — dist may have been built with wrong BASE_PATH",
    );
    assert(
      "GET / → no /admin/ asset prefix (standalone build verified)",
      !root.body.includes('src="/admin/') && !root.body.includes('href="/admin/'),
      "found /admin/ prefix in asset URLs — dist was NOT built with BASE_PATH=/",
    );

    // 2. SPA fallback for unknown routes
    const spa = await get("/guests");
    assert("GET /guests → 200 (SPA fallback)", spa.status === 200, `got ${spa.status}`);
    assert("GET /guests → index.html served", spa.body.includes("<div id=\"root\">"), "root div not found");

    // 3. Real asset file (if dist present)
    if (assetFile) {
      const asset = await get(assetFile);
      assert(`GET ${assetFile} → 200`, asset.status === 200, `got ${asset.status}`);
      assert(`GET ${assetFile} → JavaScript`, asset.contentType.includes("javascript"), asset.contentType);
    }

    // 4. API proxy path (will fail to connect but should not 500 — it returns 502)
    const api = await get("/api/staff/login");
    assert("GET /api/* → does not 500 (proxied correctly)", api.status !== 500, `got ${api.status}`);

    // 5. Bypass attempted — give the async initBypassToken a moment to log
    await new Promise((r) => setTimeout(r, 500));
    const fullLog = logs.join("");
    const bypassAttempted = fullLog.includes("bypass") || fullLog.includes("Bypass") || fullLog.includes("ADMIN_BYPASS_SECRET");
    assert("Bypass token acquisition was attempted on startup", bypassAttempted, "no bypass log line found");

    console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  } finally {
    proc.kill();
  }

  if (failed > 0) {
    console.error("Some checks failed.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Smoke test error:", err.message);
  process.exit(1);
});
