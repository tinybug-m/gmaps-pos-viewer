import { expect, test } from "@playwright/test";
import { signIn, sql, state } from "./helpers";

test("an admin bulk-assigns unassigned leads and the new owner sees them", async ({ page, browser }) => {
  await signIn(page, "admin");
  await page.goto("/leads");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Select E2E Plumbing 5").check();
  await page.getByLabel("Select E2E Plumbing 6").check();

  const bar = page.getByRole("region", { name: "Assign selected leads" });
  await expect(bar.getByText("2 leads selected")).toBeVisible();
  await bar.getByLabel("Assign to").selectOption({ label: "Blake Caller" });
  await bar.getByRole("button", { name: "Continue" }).click();
  await bar.getByRole("button", { name: "Assign 2 leads to Blake Caller" }).click();

  await expect
    .poll(async () => (await sql("select id from leads where assigned_to = $1", [state.accounts.callerB.id])).length)
    .toBe(3);
  const history = await sql("select 1 from lead_assignments where lead_id = any($1) and ended_at is null and assigned_to = $2", [
    state.leads.unassigned,
    state.accounts.callerB.id,
  ]);
  expect(history).toHaveLength(2);

  const blake = await browser.newContext();
  const blakePage = await blake.newPage();
  await signIn(blakePage, "callerB");
  for (const n of [4, 5, 6]) await expect(blakePage.getByRole("link", { name: `E2E Plumbing ${n}` }).first()).toBeVisible();
  await blake.close();
});
