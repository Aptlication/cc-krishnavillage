import { test, expect } from "@playwright/test";

const MOBILE = "http://localhost:18115/";

test("mobile app loads and shows Krishna Village content", async ({ page }) => {
  await page.goto(MOBILE);
  await expect(page.getByText(/Krishna Village/i)).toBeVisible({ timeout: 15_000 });
});

test("mobile app service worker and manifest are present", async ({ request }) => {
  const sw = await request.get(`${MOBILE}sw.js`);
  expect(sw.status()).toBe(200);
  const manifest = await request.get(`${MOBILE}manifest.json`);
  expect(manifest.status()).toBe(200);
});

test("mobile app services page loads", async ({ page }) => {
  await page.goto(`${MOBILE}services`);
  await expect(page.getByText(/Driver|Housekeeping|Transport/i)).toBeVisible({ timeout: 15_000 });
});
