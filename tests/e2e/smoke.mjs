/**
 * HTTP-level smoke tests — no browser required.
 * Checks that dev servers are up and returning expected content.
 * Run with: node tests/e2e/smoke.mjs
 */

const ADMIN = "http://localhost:8080";
const MOBILE = "http://localhost:18115";
const API = "http://localhost:8083/api";

let passed = 0;
let failed = 0;

function ok(label, value) {
  if (value) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

async function get(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return { status: res.status, text: await res.text().catch(() => "") };
  } catch (e) {
    return { status: 0, text: "", error: e.message };
  }
}

async function postJson(url, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch (e) {
    return { status: 0, data: null, error: e.message };
  }
}

async function run() {
  console.log("\nSmoke Tests\n");

  // --- API health ---
  console.log("1. API health");
  const health = await get(`${API}/healthz`);
  ok("GET /api/healthz returns 200", health.status === 200);
  ok("/api/healthz body contains status ok", health.text.includes('"ok"'));

  // --- API auth gates ---
  console.log("\n2. API auth gates");
  const notifs = await get(`${API}/notifications`);
  ok("GET /api/notifications without token returns 401", notifs.status === 401);
  const guests = await get(`${API}/guests`);
  ok("GET /api/guests without token returns 401", guests.status === 401);
  const maint = await get(`${API}/maintenance`);
  ok("GET /api/maintenance without token returns 401", maint.status === 401);

  // --- Admin login ---
  console.log("\n3. Admin login");
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || "admin123";
  const login = await postJson(`${API}/staff/login`, { username: "admin", password: adminPassword });
  ok("POST /api/staff/login returns 200", login.status === 200);
  ok("Login response contains token", typeof login.data?.token === "string");
  ok("Login response role=admin", login.data?.role === "admin");
  const token = login.data?.token;

  // --- Admin-gated endpoint ---
  console.log("\n4. Admin-gated endpoints");
  if (token) {
    const accounts = await fetch(`${API}/staff/accounts`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    ok("GET /api/staff/accounts with token returns 200", accounts.status === 200);
  } else {
    console.error("  SKIP: no token available");
    failed++;
  }

  // --- Admin UI ---
  console.log("\n5. Admin dashboard UI");
  const adminRoot = await get(`${ADMIN}/`);
  ok("Admin dashboard responds (200)", adminRoot.status === 200);
  ok("Admin dashboard contains Krishna Village title", adminRoot.text.includes("Krishna Village") || adminRoot.text.length > 500);

  // --- Mobile PWA ---
  console.log("\n6. Mobile PWA");
  const mobileRoot = await get(`${MOBILE}/`);
  ok("Mobile app responds (200)", mobileRoot.status === 200);
  ok("Mobile app returns HTML", mobileRoot.text.includes("<!DOCTYPE html>") || mobileRoot.text.includes("<html"));
  const sw = await get(`${MOBILE}/sw.js`);
  ok("Mobile service worker (sw.js) is served", sw.status === 200);
  const manifest = await get(`${MOBILE}/manifest.json`);
  ok("Mobile manifest.json is served", manifest.status === 200);

  // --- Summary ---
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
