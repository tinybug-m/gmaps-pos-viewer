import { expect, test } from "@playwright/test";
import { callCount, signIn, state } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page, "callerA");
});

test("the queue lists only the caller's own leads", async ({ page }) => {
  await page.goto("/queue");
  for (const n of [1, 2, 3]) await expect(page.getByRole("link", { name: `E2E Plumbing ${n}` }).first()).toBeVisible();
  for (const n of [4, 5, 6]) await expect(page.getByRole("link", { name: `E2E Plumbing ${n}` })).toHaveCount(0);
});

test("another caller's lead and unassigned leads are 404s, not 403s", async ({ page }) => {
  for (const id of [state.leads.callerB[0], state.leads.unassigned[0]]) {
    await page.goto(`/leads/${id}`);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.getByText(/E2E Plumbing/)).toHaveCount(0);
  }
});

test("a routine call takes three interactions: open, outcome, save & next", async ({ page }) => {
  await page.goto("/queue");
  const first = state.leads.callerA[0];
  const before = await callCount(first);

  await page.locator(`a[href="/leads/${first}"]`).first().click(); // 1
  await expect(page.getByRole("heading", { name: "Log a call" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^No answer/ }).click(); // 2
  await page.getByRole("button", { name: "Save & next" }).click(); // 3

  await expect(page).not.toHaveURL(new RegExp(first));
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
  expect(await callCount(first)).toBe(before + 1);
});
