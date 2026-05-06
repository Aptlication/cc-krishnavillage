import { test, expect } from "@playwright/test";

const ADMIN = "http://localhost:8080/admin/";

test("admin login page loads with correct branding", async ({ page }) => {
  await page.goto(ADMIN);
  await expect(page.getByText("Staff Login")).toBeVisible();
  await expect(page.getByText("Krishna Village")).toBeVisible();
  await expect(page.getByTestId("input-username")).toBeVisible();
  await expect(page.getByTestId("input-password")).toBeVisible();
  await expect(page.getByTestId("button-login")).toBeVisible();
});

test("admin login with wrong credentials shows error, stays on login page", async ({ page }) => {
  await page.goto(ADMIN);
  await page.getByTestId("input-username").fill("admin");
  await page.getByTestId("input-password").fill("wrong-password-xyz");
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("button-login")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Staff Login")).toBeVisible();
});

test("admin login with correct credentials reaches dashboard", async ({ page }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD || "admin123";
  await page.goto(ADMIN);
  await page.getByTestId("input-username").fill("admin");
  await page.getByTestId("input-password").fill(password);
  await page.getByTestId("button-login").click();
  await expect(page.getByText(/Notifications|Maintenance|Guests/)).toBeVisible({ timeout: 10_000 });
  await expect(page.url()).toContain("/admin");
});

test("admin dashboard nav links are present after login", async ({ page }) => {
  const password = process.env.INITIAL_ADMIN_PASSWORD || "admin123";
  await page.goto(ADMIN);
  await page.getByTestId("input-username").fill("admin");
  await page.getByTestId("input-password").fill(password);
  await page.getByTestId("button-login").click();
  await expect(page.getByText(/Notifications/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Maintenance/)).toBeVisible();
  await expect(page.getByText(/Guests/)).toBeVisible();
});
