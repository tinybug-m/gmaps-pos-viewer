/**
 * Imports a lead export (the same JSON the Import page takes) from the command line.
 *
 *   pnpm db:import --file=export.json --as=admin@company.com                dry run: counts only
 *   pnpm db:import --file=export.json --as=admin@company.com --commit       write (local database)
 *   pnpm db:import --file=… --as=… --commit --confirm=<dbname>              write to any other host
 *
 * Runs the same validation, dedupe and transaction as the Import page and is
 * recorded as an import by the named admin. Re-running it with the same file
 * changes nothing. Invalid rows and in-file duplicates are skipped and listed.
 * The file is only read, never moved or modified.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { and, eq } from "drizzle-orm";
import { createDb } from "../src/server/db/client";
import { users } from "../src/server/db/schema";
import { commitImport, previewImport, type ImportPreview } from "../src/server/dal/imports";
import { describeTarget, requireConfirmedTarget, requireDatabaseUrl } from "./lib/target";

/** Problem rows printed to the terminal; the counts above them always cover the whole file. */
const MAX_PRINTED = 50;

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function report(preview: ImportPreview, committed: boolean) {
  const verb = committed ? "" : "would be ";
  console.log(`\n${preview.fileName}: ${preview.total} records`);
  console.log(`  new           ${preview.inserted} ${verb}added`);
  console.log(`  changed       ${preview.updated} ${verb}updated (imported data only; assignment and history untouched)`);
  console.log(`  unchanged     ${preview.unchanged}`);
  console.log(`  invalid       ${preview.invalid} skipped`);
  console.log(`  duplicates    ${preview.duplicates} skipped (same business earlier in the file)`);
  if (preview.archived) console.log(`  archived      ${preview.archived} matched archived leads, which stay archived`);
  const shown = preview.problems.slice(0, MAX_PRINTED);
  if (shown.length) {
    console.log("\nSkipped rows:");
    for (const p of shown) console.log(`  row ${p.row}: ${p.message}`);
    const more = preview.invalid + preview.duplicates - shown.length;
    if (more > 0) console.log(`  …and ${more} more`);
  }
}

async function main() {
  const file = arg("file");
  const as = arg("as")?.trim().toLowerCase();
  const commit = process.argv.includes("--commit");
  if (!file || !as) {
    console.error("Usage: pnpm db:import --file=<export.json> --as=<admin email> [--commit] [--confirm=<dbname>]");
    process.exit(2);
  }

  const url = requireDatabaseUrl();
  if (commit) requireConfirmedTarget(url, "import into");
  else console.log(`Target: ${describeTarget(url).label} (dry run, nothing is written)`);

  const json = await readFile(file, "utf8");
  const { db, pool } = createDb(url, 1);
  try {
    const [admin] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.email, as), eq(users.isActive, true), eq(users.role, "admin")));
    if (!admin) {
      console.error(`No active admin with the email ${as}.`);
      process.exit(1);
    }

    const input = { fileName: basename(file), json };
    if (!commit) {
      const result = await previewImport(db, admin, input);
      if (!result.ok) throw new Error(result.message);
      report(result.preview, false);
      console.log("\nDry run only. Add --commit to import.");
      return;
    }
    const result = await commitImport(db, admin, input);
    if (!result.ok) throw new Error(result.message);
    report(result.preview, true);
    console.log(`\nImported as batch ${result.batchId}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
