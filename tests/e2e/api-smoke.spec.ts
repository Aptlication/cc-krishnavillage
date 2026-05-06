import { test, expect } from "@playwright/test";

const API = "http://localhost:8083/api";

test("GET /api/healthz returns 200 with status ok", async ({ request }) => {
  const res = await request.get(`${API}/healthz`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("ok");
});

test("GET /api/notifications without auth returns 401", async ({ request }) => {
  const res = await request.get(`${API}/notifications`);
  expect(res.status()).toBe(401);
});

test("GET /api/guests without auth returns 401", async ({ request }) => {
  const res = await request.get(`${API}/guests`);
  expect(res.status()).toBe(401);
});

test("GET /api/maintenance without auth returns 401", async ({ request }) => {
  const res = await request.get(`${API}/maintenance`);
  expect(res.status()).toBe(401);
});

test("POST /api/staff/login with wrong password returns 401", async ({ request }) => {
  const res = await request.post(`${API}/staff/login`, {
    data: { username: "admin", password: "definitely-wrong-xyz" },
  });
  expect(res.status()).toBe(401);
});

test("POST /api/staff/login with admin credentials returns token", async ({ request }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD || "admin123";
  const res = await request.post(`${API}/staff/login`, {
    data: { username: "admin", password },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(typeof body.token).toBe("string");
  expect(body.role).toBe("admin");
});

test("POST /api/notifications (legacy) returns 410 Gone", async ({ request }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD || "admin123";
  const loginRes = await request.post(`${API}/staff/login`, {
    data: { username: "admin", password },
  });
  const token = (await loginRes.json()).token;
  const res = await request.post(`${API}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: "test" },
  });
  expect(res.status()).toBe(410);
});

test("GET /api/staff/accounts with valid admin token returns list", async ({ request }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD || "admin123";
  const loginRes = await request.post(`${API}/staff/login`, {
    data: { username: "admin", password },
  });
  const token = (await loginRes.json()).token;
  const res = await request.get(`${API}/staff/accounts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});
