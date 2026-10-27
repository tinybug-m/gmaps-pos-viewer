import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { e2eDatabaseUrl, readState, type E2EState } from "./env";

// Read on first use inside a test: spec files can be loaded before the
// webServer command has re-seeded the database and rewritten the file.
let cached: E2EState | undefined;
export const state = new Proxy({} as E2EState, {
  get: (_target, key: keyof E2EState) => (cached ??= readState())[key],
});
export type AccountKey = keyof E2EState["accounts"];

export async function signIn(page: Page, who: AccountKey) {
  const { email, password } = state.accounts[who];
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** Read-only checks against the seeded E2E database. */
export async function sql<T extends Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: e2eDatabaseUrl() });
  await c.connect();
  try {
    return (await c.query<T>(text, values)).rows;
  } finally {
    await c.end();
  }
}

export async function callCount(leadId: string): Promise<number> {
  const [row] = await sql<{ n: string }>("select count(*) as n from call_logs where lead_id = $1", [leadId]);
  return Number(row.n);
}

export async function leadVersion(leadId: string): Promise<number> {
  const [row] = await sql<{ version: number }>("select version from leads where id = $1", [leadId]);
  return row.version;
}
