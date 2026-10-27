import { expect, test } from "@playwright/test";
import { signIn, state } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page, "supervisor");
});

test("a supervisor reads any lead but gets no call, status or assign controls", async ({ page }) => {
  await page.goto(`/leads/${state.leads.callerB[0]}`);
  await expect(page.getByRole("heading", { name: "E2E Plumbing 4" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add a note" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Log a call" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Change status" })).toHaveCount(0);
});

test("the leads list shows every lead without selection for bulk assign", async ({ page }) => {
  await page.goto("/leads");
  for (const n of [1, 4, 6]) await expect(page.getByText(`E2E Plumbing ${n}`).first()).toBeVisible();
  await expect(page.getByLabel("Select all leads on this page")).toHaveCount(0);
  await expect(page.getByLabel(/^Select E2E Plumbing/)).toHaveCount(0);
});
