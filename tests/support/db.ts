import { randomBytes } from "node:crypto";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { describe } from "vitest";
import { createDb, type Db } from "@/server/db/client";

/**
 * Integration tests run against a real Postgres named by TEST_DATABASE_URL
 * (a throwaway local server, never a shared or production database). Each
 * test file gets its own freshly migrated database, dropped afterwards.
 * Without TEST_DATABASE_URL these suites are skipped.
 */
const TEST_URL = process.env.TEST_DATABASE_URL;

export const describeDb = TEST_URL ? describe : describe.skip;

export interface TestDb {
  db: Db;
  url: string;
  drop: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  if (!TEST_URL) throw new Error("TEST_DATABASE_URL is not set");
  const name = `leads_test_${randomBytes(6).toString("hex")}`;
  const admin = new Client({ connectionString: TEST_URL });
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }

  const url = new URL(TEST_URL);
  url.pathname = `/${name}`;
  const { db, pool } = createDb(url.toString(), 10);
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });

  return {
    db,
    url: url.toString(),
    drop: async () => {
      await pool.end();
      const c = new Client({ connectionString: TEST_URL });
      await c.connect();
      try {
        await c.query(`drop database if exists ${name} with (force)`);
      } finally {
        await c.end();
      }
    },
  };
}
