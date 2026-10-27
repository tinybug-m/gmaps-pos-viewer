import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { e2eDatabaseUrl } from "./e2e/env";

/**
 * E2E role flows against a production build (`next build && next start`),
 * backed by a freshly seeded local database (e2e/seed.ts). Nothing here
 * touches DATABASE_URL. Run with `pnpm test:e2e`.
 */
const PORT = 3200;
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Specs share one seeded database and some change it, so run them in order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec tsx --conditions=react-server e2e/seed.ts && pnpm exec next build && pnpm exec next start -p ${PORT}`,
    url: `${BASE}/login`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "pipe",
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      BETTER_AUTH_URL: BASE,
      // Per-run secret: sessions from one run never work in the next.
      BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
    },
  },
});
