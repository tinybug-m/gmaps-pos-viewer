import { expect, test } from "@playwright/test";
import { signIn, sql, state } from "./helpers";

test("an admin imports a new file straight to a team member", async ({ page, browser }) => {
  const records = [1, 2].map((n) => ({
    name: `E2E File Business ${n}`,
    city: "Testville",
    mapsUrl: `https://www.google.com/maps/place/?cid=${9_000_000 + n}`,
    websiteUrl: `https://file-business-${n}.example.com`,
    seoScore: 40,
    seoStatus: "POOR",
    issues: ["Missing meta description"],
  }));

  await signIn(page, "admin");
  await page.goto("/admin/assign-file");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Export file").setInputFiles({
    name: "new-batch.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(records)),
  });
  await page.getByLabel("Assign to").selectOption({ label: "Blake Caller" });
  await page.getByRole("button", { name: "Check file" }).click();

  // The businesses aren't in the system yet, and the page offers to import them.
  await expect(page.getByText("Nothing has been assigned yet")).toBeVisible();
  const importBox = page.getByLabel(/Also import the 2 businesses/);
  await expect(importBox).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Assign 2 leads to Blake Caller" }).click();
  await expect(page.getByText(/Assigned 2 leads \(2 newly imported\) from new-batch.json to Blake Caller/)).toBeVisible();

  const rows = await sql("select 1 from leads where name like 'E2E File Business %' and assigned_to = $1", [state.accounts.callerB.id]);
  expect(rows).toHaveLength(2);

  const blake = await browser.newContext();
  const blakePage = await blake.newPage();
  await signIn(blakePage, "callerB");
  await expect(blakePage.getByRole("link", { name: "E2E File Business 1" }).first()).toBeVisible();
  await blake.close();
});

test("leads can be sorted by when they were added and by last call", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/leads");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Sort by").selectOption({ label: "Date imported" });
  await expect(page).toHaveURL(/sort=added&dir=desc/);
  await page.getByRole("button", { name: /Last call/ }).click();
  await expect(page).toHaveURL(/sort=lastCall/);
  await expect(page.getByRole("columnheader", { name: /Date imported/ })).toBeVisible();
});
