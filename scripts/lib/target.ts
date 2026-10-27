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
