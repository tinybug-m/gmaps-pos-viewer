/** Postgres error helpers. Drizzle wraps driver errors, so look through `cause`. */

interface PgError {
  code?: string;
  constraint?: string;
}

function pgError(err: unknown): PgError | null {
  for (let e: unknown = err; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ("code" in e && typeof (e as PgError).code === "string") return e as PgError;
  }
  return null;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = pgError(err);
  return e?.code === "23505" && (constraint === undefined || e.constraint === constraint);
}
