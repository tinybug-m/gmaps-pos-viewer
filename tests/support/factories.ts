import type { Db } from "@/server/db/client";
import { leads, users } from "@/server/db/schema";
import type { Role } from "@/lib/workflow";
import type { RawLead } from "@/types/lead";

/** Synthetic rows for integration tests. Nothing here resembles a real business or person. */

let seq = 0;
const next = () => ++seq;

export async function insertUser(db: Db, role: Role = "caller", overrides: Partial<typeof users.$inferInsert> = {}) {
  const n = next();
  const [row] = await db
    .insert(users)
    .values({ name: `Test ${role} ${n}`, email: `${role}${n}@example.com`, role, mustChangePassword: false, ...overrides })
    .returning();
  return row;
}

export function rawLead(n = next()): RawLead {
  return {
    name: `Example Plumbing ${n}`,
    city: "Testville",
    mapsUrl: `https://www.google.com/maps/place/?cid=${1000 + n}`,
    websiteUrl: `https://plumbing-${n}.example.com`,
    seoScore: 40,
    seoStatus: "POOR",
    issues: ["Missing meta description"],
  };
}

export async function insertLead(db: Db, overrides: Partial<typeof leads.$inferInsert> = {}) {
  const n = next();
  const raw = rawLead(n);
  const [row] = await db
    .insert(leads)
    .values({ dedupeKey: `test:${n}`, raw, name: raw.name, city: raw.city, source: "google-maps", ...overrides })
    .returning();
  return row;
}

/** The underlying Postgres error (Drizzle wraps it) so tests can assert on code/constraint. */
export async function pgError(promise: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try {
    await promise;
  } catch (err) {
    const e = (err as { cause?: unknown }).cause ?? err;
    const { code, constraint, message } = e as { code?: string; constraint?: string; message: string };
    return { code, constraint, message };
  }
  throw new Error("expected the query to fail");
}
