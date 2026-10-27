import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

/** Only TEST_* variables are read from .env.local, so tests can never pick up DATABASE_URL. */
function testEnv(): Record<string, string> {
  const file = path.resolve(__dirname, ".env.local");
  const parsed = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
  return Object.fromEntries(
    Object.entries(parsed).filter((e): e is [string, string] => e[0].startsWith("TEST_") && !(e[0] in process.env)),
  );
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Next.js resolves `server-only` itself; outside Next it is a no-op.
      "server-only": path.resolve(__dirname, "tests/support/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: testEnv(),
    // Integration tests create a database and run migrations per file.
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
