import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/** Shared by playwright.config.ts, the seed script and the specs. No app imports here. */

export const ROOT = path.resolve(__dirname, "..");
export const STATE_FILE = path.join(ROOT, ".local/e2e/state.json");
export const E2E_DB = "leads_e2e";

interface Account {
  id: string;
  email: string;
  password: string;
}

export interface E2EState {
  accounts: Record<"admin" | "callerA" | "callerB" | "supervisor", Account>;
  leads: Record<"callerA" | "callerB" | "unassigned", string[]>;
}

/**
 * The E2E database lives next to the integration-test databases, on the
 * throwaway server named by TEST_DATABASE_URL. Never DATABASE_URL, and never
 * a remote host: the seed drops and recreates it on every run.
 */
export function e2eDatabaseUrl(): string {
  const file = path.join(ROOT, ".env.local");
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, "utf8")).TEST_DATABASE_URL : undefined;
  const base = process.env.TEST_DATABASE_URL ?? fromFile;
  if (!base) throw new Error("TEST_DATABASE_URL is not set (see docs/DEVELOPMENT.md); the E2E suite needs a local Postgres.");
  const url = new URL(base);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("TEST_DATABASE_URL must point at a local server for E2E runs.");
  }
  url.pathname = `/${E2E_DB}`;
  return url.toString();
}

export function readState(): E2EState {
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as E2EState;
}
