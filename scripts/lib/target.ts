/** Shared helpers for the operational scripts. Never prints credentials. */

/**
 * The connection string for a script. Schema changes prefer Neon's direct
 * (unpooled) endpoint, which the Vercel integration provides as
 * DATABASE_URL_UNPOOLED; everything else uses DATABASE_URL.
 */
export function requireDatabaseUrl(opts: { preferUnpooled?: boolean } = {}): string {
  const name = opts.preferUnpooled && process.env.DATABASE_URL_UNPOOLED ? "DATABASE_URL_UNPOOLED" : "DATABASE_URL";
  const url = process.env[name];
  if (!url) {
    console.error("DATABASE_URL is not set. Put it in .env.local or export it for this command.");
    process.exit(2);
  }
  console.log(`Using ${name}`);
  return url;
}

export function describeTarget(url: string): { host: string; database: string; label: string } {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "postgres";
  return { host, database, label: `${host}${parsed.port ? `:${parsed.port}` : ""}/${database}` };
}

export function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

/**
 * Scripts that change data run freely against a local database. Anything
 * else (a Neon branch, production) must be named on the command line with
 * --confirm=<database name>, so nobody writes to the wrong place by accident.
 */
export function requireConfirmedTarget(url: string, verb: string): void {
  const target = describeTarget(url);
  console.log(`Target: ${target.label}`);
  const confirm = process.argv.find((a) => a.startsWith("--confirm="))?.slice("--confirm=".length);
  if (!isLocalHost(target.host) && confirm !== target.database) {
    console.error(`Refusing to ${verb} a non-local database without --confirm=${target.database}`);
    process.exit(2);
  }
}
