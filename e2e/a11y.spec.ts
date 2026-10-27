import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn, state, type AccountKey } from "./helpers";

/** Automated WCAG 2.1 A/AA checks on every page each role uses. Read-only. */

async function scan(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect.soft(summary, `${path}`).toEqual([]);
}

test("sign-in page", async ({ page }) => {
  await scan(page, "/login");
});

const pages: Record<Exclude<AccountKey, "callerB">, (s: typeof state) => string[]> = {
  callerA: (s) => ["/queue", `/leads/${s.leads.callerA[0]}`, "/dashboard", "/account/password"],
  supervisor: (s) => ["/leads", `/leads/${s.leads.callerA[0]}`, "/dashboard"],
  admin: () => ["/leads", "/admin/users", "/admin/import", "/admin/audit", "/dashboard"],
};

for (const [who, paths] of Object.entries(pages) as [Exclude<AccountKey, "callerB">, (s: typeof state) => string[]][]) {
  test(`pages for ${who}`, async ({ page }) => {
    await signIn(page, who);
    for (const path of paths(state)) await scan(page, path);
  });
}
