/**
 * Applies the SQL migrations in ./drizzle to DATABASE_URL.
 *
 *   pnpm db:migrate                       local database (localhost / 127.0.0.1)
 *   pnpm db:migrate --confirm=<dbname>    any other host, e.g. a Neon branch
 *
 * Migrations are never run by `next build` or a deploy; someone runs this on
 * purpose, against a database they name. Rehearse on a Neon branch first.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { requireConfirmedTarget, requireDatabaseUrl } from "./lib/target";

async function main() {
  const url = requireDatabaseUrl({ preferUnpooled: true });
  requireConfirmedTarget(url, "migrate");

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
