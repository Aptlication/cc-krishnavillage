/**
 * Staff auth integration tests
 * Run with: node artifacts/api-server/tests/auth-integration.mjs
 * Requires the API server running on port 8083 and a seeded admin account.
 */

const BASE = "http://localhost:8083/api";
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

async function post(path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function get(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE}${path}`, { headers });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function patch(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${BASE}${path}`, { method: "PATCH", headers });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function run() {
  console.log("\nStaff Auth Integration Tests\n");

  // --- Login ---
  console.log("1. Login");
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || "admin123";
  const loginOk = await post("/staff/login", { username: "admin", password: adminPassword });
  ok("admin login returns 200", loginOk.status === 200);
  ok("admin login returns token", typeof loginOk.data?.token === "string");
  ok("admin login returns role=admin", loginOk.data?.role === "admin");
  const adminToken = loginOk.data?.token;

  const loginBad = await post("/staff/login", { username: "admin", password: "wrong" });
  ok("wrong password returns 401", loginBad.status === 401);

  // --- Legacy endpoint tombstone ---
  console.log("\n2. Legacy POST /api/notifications returns 410");
  const legacy = await post("/notifications", { title: "test" }, adminToken);
  ok("POST /api/notifications returns 410", legacy.status === 410);

  // --- Staff management (admin only) ---
  console.log("\n3. Admin can create a housekeeper account");
  const timestamp = Date.now();
  const hkUsername = `hk_${timestamp}`;
  const createRes = await post("/staff/accounts", {
    username: hkUsername,
    password: "test1234",
    displayName: "Test Housekeeper",
    role: "housekeeper",
  }, adminToken);
  ok("create account returns 201", createRes.status === 201);
  const hkId = createRes.data?.id;
  ok("create returns account id", typeof hkId === "number");

  // --- Housekeeper cannot manage staff ---
  console.log("\n4. Housekeeper cannot manage staff (admin-only endpoint)");
  const hkLogin = await post("/staff/login", { username: hkUsername, password: "test1234" });
  ok("housekeeper login succeeds", hkLogin.status === 200);
  const hkToken = hkLogin.data?.token;

  const hkListStaff = await get("/staff/accounts", hkToken);
  ok("housekeeper GET /staff/accounts returns 403", hkListStaff.status === 403);

  const hkCreateStaff = await post("/staff/accounts", {
    username: `hk2_${timestamp}`,
    password: "test1234",
    displayName: "Another HK",
  }, hkToken);
  ok("housekeeper POST /staff/accounts returns 403", hkCreateStaff.status === 403);

  // --- Deactivation revocation ---
  console.log("\n5. Deactivated account token is denied immediately");
  const deactivate = await patch(`/staff/accounts/${hkId}/deactivate`, adminToken);
  ok("deactivate returns 200", deactivate.status === 200);
  ok("deactivated account is marked inactive", deactivate.data?.active === false);

  const deactivatedRequest = await get("/staff/accounts", hkToken);
  ok("deactivated token returns 401 on next request", deactivatedRequest.status === 401);

  // --- Reactivation ---
  console.log("\n6. Reactivated account can log in again");
  const reactivate = await patch(`/staff/accounts/${hkId}/activate`, adminToken);
  ok("reactivate returns 200", reactivate.status === 200);
  ok("reactivated account is marked active", reactivate.data?.active === true);

  const relogin = await post("/staff/login", { username: hkUsername, password: "test1234" });
  ok("reactivated account can log in", relogin.status === 200);

  // Cleanup: deactivate test account
  if (hkId) await patch(`/staff/accounts/${hkId}/deactivate`, adminToken);

  // --- Summary ---
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
