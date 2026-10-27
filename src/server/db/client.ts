import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { schema } from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A Drizzle transaction handle; DAL helpers accept either this or a `Db`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export function createDb(connectionString: string, max = 5): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString, max, idleTimeoutMillis: 10_000 });
  return { db: drizzle({ client: pool, schema }), pool };
}

// One pool per server instance. On Vercel Fluid compute an instance serves
// many requests, so the pool lives at module scope; attachDatabasePool keeps
// the instance alive until idle connections are closed before suspension
// (it is a no-op outside Vercel). globalThis survives dev-server reloads.
const cache = globalThis as unknown as { __leadsDb?: Db };

/** The app database. Created on first use so `next build` doesn't need DATABASE_URL. */
export function getDb(): Db {
  if (cache.__leadsDb) return cache.__leadsDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  const { db, pool } = createDb(url);
  attachDatabasePool(pool);
  cache.__leadsDb = db;
  return db;
}
