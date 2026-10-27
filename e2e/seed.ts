/**
 * Builds the database the E2E suite runs against: drops and recreates
 * `leads_e2e` on the local test server (TEST_DATABASE_URL), migrates it, and
 * seeds synthetic accounts and leads. Passwords are random per run and only
 * written to .local/e2e/state.json (git-ignored, mode 600), never printed.
 *
 * Run by the Playwright webServer command before the app starts; see
 * playwright.config.ts. Refuses anything but a local server.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import type { Role } from "../src/lib/workflow";
import { assignLeads } from "../src/server/dal/assignments";
import { commitImport } from "../src/server/dal/imports";
import { bootstrapAdmin, createUser } from "../src/server/dal/users";
import { createDb } from "../src/server/db/client";
import { leads, users } from "../src/server/db/schema";
import type { RawLead } from "../src/types/lead";
import { e2eDatabaseUrl, STATE_FILE, type E2EState } from "./env";

const password = () => randomBytes(18).toString("base64url");

/** Invented businesses on reserved example domains and Ofcom drama numbers. */
function syntheticLeads(): RawLead[] {
  return Array.from({ length: 6 }, (_, i) => ({
    name: `E2E Plumbing ${i + 1}`,
    city: "Testville",
    mapsUrl: `https://www.google.com/maps/place/?cid=${900_000 + i}`,
    websiteUrl: `https://e2e-plumbing-${i + 1}.example.com`,
    seoScore: 35 + i,
    seoStatus: "POOR",
    issues: ["Missing meta description"],
    outreach: { phone: `+44 20 7946 0${100 + i}` },
  })) as RawLead[];
}

async function main() {
  const url = e2eDatabaseUrl();
  const name = new URL(url).pathname.slice(1);
  const server = new URL(url);
  server.pathname = "/postgres";

  const c = new Client({ connectionString: server.toString() });
  await c.connect();
  try {
    await c.query(`drop database if exists ${name} with (force)`);
    await c.query(`create database ${name}`);
  } finally {
    await c.end();
  }

  const { db, pool } = createDb(url, 2);
  try {
    await migrate(db, { migrationsFolder: path.resolve(__dirname, "../drizzle") });

    const adminPassword = password();
    const boot = await bootstrapAdmin(db, { email: "e2e.admin@example.com", name: "Avery Admin", password: adminPassword });
    if (!boot.ok) throw new Error(boot.message);
    const admin = { id: boot.userId, role: "admin" as Role };

    const account = async (role: Role, email: string, displayName: string) => {
      const res = await createUser(db, admin, { email, name: displayName, role });
      if (!res.ok) throw new Error(res.message);
      // Skip the forced password change: these accounts exist for one run.
      await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, res.user.id));
      return { id: res.user.id, email, password: res.tempPassword };
    };
    const callerA = await account("caller", "e2e.caller.a@example.com", "Casey Caller");
    const callerB = await account("caller", "e2e.caller.b@example.com", "Blake Caller");
    const supervisor = await account("supervisor", "e2e.supervisor@example.com", "Sam Supervisor");

    const imported = await commitImport(db, admin, { fileName: "e2e.json", json: JSON.stringify(syntheticLeads()) });
    if (!imported.ok) throw new Error(imported.message);
    const rows = await db.select({ id: leads.id, name: leads.name }).from(leads).orderBy(asc(leads.name));
    const ids = rows.map((r) => r.id);

    const assign = async (leadIds: string[], toUserId: string) => {
      const res = await assignLeads(db, admin, { leadIds, toUserId, expected: Object.fromEntries(leadIds.map((id) => [id, null])) });
      if (!res.ok) throw new Error(res.message);
    };
    // Leads 1-3 → Casey, 4 → Blake, 5-6 unassigned.
    await assign(ids.slice(0, 3), callerA.id);
    await assign(ids.slice(3, 4), callerB.id);

    const state: E2EState = {
      accounts: {
        admin: { id: admin.id, email: "e2e.admin@example.com", password: adminPassword },
        callerA,
        callerB,
        supervisor,
      },
      leads: {
        callerA: ids.slice(0, 3),
        callerB: ids.slice(3, 4),
        unassigned: ids.slice(4),
      },
    };
    mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 });
    writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
    console.log(`E2E database ${name} seeded: 4 accounts, ${ids.length} synthetic leads.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
