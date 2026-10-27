import { expect, test } from "@playwright/test";
import { mainNav, signIn, state } from "./helpers";

test("anonymous visitors are sent to sign in, keeping where they were going", async ({ page }) => {
  await page.goto("/leads");
  await expect(page).toHaveURL(/\/login\?next=%2Fleads$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("lead pages are not served without a session", async ({ request }) => {
  const res = await request.get(`/leads/${state.leads.callerA[0]}`, { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers().location).toContain("/login");
});

test("a wrong password shows one generic error", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(state.accounts.callerA.email);
  await page.getByLabel("Password").fill("not-the-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Couldn't sign in with those details.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a crafted ?next= can't send someone to another site after signing in", async ({ page, baseURL }) => {
  const { email, password } = state.accounts.callerA;
  await page.goto(`/login?next=${encodeURIComponent("/\t/evil.example/")}`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/queue$/);
  expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin);
});

test("a caller lands on their queue and sees no admin pages", async ({ page }) => {
  await signIn(page, "callerA");
  await expect(page).toHaveURL(/\/queue$/);
  await expect(page.getByRole("heading", { name: "My queue" })).toBeVisible();
  for (const hidden of ["Import", "Users", "Audit"]) {
    await expect(mainNav(page).getByRole("link", { name: hidden })).toHaveCount(0);
  }
  await page.goto("/admin/users");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("a supervisor lands on the leads list without admin pages", async ({ page }) => {
  await signIn(page, "supervisor");
  await expect(page).toHaveURL(/\/leads$/);
  await expect(mainNav(page).getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(mainNav(page).getByRole("link", { name: "Users" })).toHaveCount(0);
  await page.goto("/admin/audit");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("an admin sees every admin page", async ({ page }) => {
  await signIn(page, "admin");
  await expect(page).toHaveURL(/\/leads$/);
  for (const item of ["Import", "Users", "Audit"]) {
    await expect(mainNav(page).getByRole("link", { name: item })).toBeVisible();
  }
});
