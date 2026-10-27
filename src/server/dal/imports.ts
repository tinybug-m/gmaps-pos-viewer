import "server-only";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { dedupeKey } from "@/lib/dedupe";
import { computeSource, legacySlug } from "@/lib/leads";
import { can, type Viewer } from "@/lib/permissions";
import { LeadDataError, parseLeadFile } from "@/lib/validation";
import type { RawLead } from "@/types/lead";
import type { Db, DbOrTx } from "../db/client";
import { importBatches, leads, users } from "../db/schema";
import { fail, type Result } from "../result";
import { firstIssue, importInput, MAX_IMPORT_RECORDS } from "../validation";
import { writeAudit, type AuditEntry } from "./audit";

const FORBIDDEN = fail("forbidden", "Only an admin can import leads.");
/** Rows per INSERT/UPDATE statement, well under Postgres's parameter limit. */
const CHUNK = 500;
/** Problem rows listed back to the admin. The counts always cover every record. */
export const MAX_LISTED_PROBLEMS = 200;

export interface ImportProblem {
  /** 1-based position in the file. */
  row: number;
  message: string;
}

export interface ImportPreview {
  fileName: string;
  total: number;
  /** New businesses. */
  inserted: number;
  /** Businesses already in the database whose data differs. */
  updated: number;
  unchanged: number;
  invalid: number;
  /** Rows for a business that appears earlier in the same file. The first one wins. */
  duplicates: number;
  /** Of `updated` and `unchanged`: leads an admin archived. Their data is refreshed; they stay archived. */
  archived: number;
  problems: ImportProblem[];
}

export interface ImportBatchDTO {
  id: string;
  fileName: string;
  importedBy: string;
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  invalid: number;
  duplicates: number;
  createdAt: Date;
}

interface Plan {
  preview: ImportPreview;
  inserts: { index: number; key: string; raw: RawLead }[];
  updates: { id: string; raw: RawLead; before: Record<string, unknown> }[];
}

/** JSON with sorted keys and no `undefined`, so a record read back from jsonb compares equal to the same input. */
function canonical(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Old values of the top-level fields that differ. Empty when nothing changed. */
function changedFields(before: RawLead, after: RawLead): Record<string, unknown> {
  const old = before as unknown as Record<string, unknown>;
  const next = after as unknown as Record<string, unknown>;
  const changed: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
    if (canonical(old[key]) !== canonical(next[key])) changed[key] = old[key] ?? null;
  }
  return changed;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Works out what importing a file would do, without writing anything.
 * Records are matched to existing leads by dedupe key. Invalid records and
 * in-file duplicates are skipped and reported, never imported.
 */
async function planImport(db: DbOrTx, fileName: string, json: string): Promise<Result<{ plan: Plan }>> {
  let records;
  try {
    records = parseLeadFile(json);
  } catch (err) {
    if (err instanceof LeadDataError) return fail("invalid", err.message);
    throw err;
  }
  const total = records.valid.length + records.invalid.length;
  if (total > MAX_IMPORT_RECORDS) {
    return fail("invalid", `That file has ${total.toLocaleString("en-GB")} records; the limit is ${MAX_IMPORT_RECORDS.toLocaleString("en-GB")} per import.`);
  }

  const problems: ImportProblem[] = records.invalid.map((r) => ({ row: r.index + 1, message: r.message }));
  const firstRow = new Map<string, number>();
  const unique: Plan["inserts"] = [];
  for (const { index, raw } of records.valid) {
    const key = dedupeKey(raw);
    const first = firstRow.get(key);
    if (first !== undefined) {
      problems.push({
        row: index + 1,
        message: `Business #${index + 1} ("${raw.name}") is the same business as #${first + 1}, so it was skipped.`,
      });
      continue;
    }
    firstRow.set(key, index);
    unique.push({ index, key, raw });
  }

  const existing = new Map<string, { id: string; raw: RawLead; archived: boolean }>();
  for (const keys of chunks(unique.map((u) => u.key), CHUNK)) {
    const rows = await db
      .select({ id: leads.id, key: leads.dedupeKey, raw: leads.raw, archivedAt: leads.archivedAt })
      .from(leads)
      .where(inArray(leads.dedupeKey, keys));
    for (const r of rows) existing.set(r.key, { id: r.id, raw: r.raw, archived: r.archivedAt !== null });
  }

  const plan: Plan = {
    inserts: [],
    updates: [],
    preview: {
      fileName,
      total,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      invalid: records.invalid.length,
      duplicates: records.valid.length - unique.length,
      archived: 0,
      problems: problems.sort((a, b) => a.row - b.row).slice(0, MAX_LISTED_PROBLEMS),
    },
  };
  for (const record of unique) {
    const match = existing.get(record.key);
    if (!match) {
      plan.inserts.push(record);
      continue;
    }
    if (match.archived) plan.preview.archived++;
    const before = changedFields(match.raw, record.raw);
    if (Object.keys(before).length === 0) plan.preview.unchanged++;
    else plan.updates.push({ id: match.id, raw: record.raw, before });
  }
  plan.preview.inserted = plan.inserts.length;
  plan.preview.updated = plan.updates.length;
  return { ok: true, plan };
}

/** Dry run: what importing this file would do. Admin only. */
export async function previewImport(db: Db, actor: Viewer, input: unknown): Promise<Result<{ preview: ImportPreview }>> {
  if (!can(actor, "leads.import")) return FORBIDDEN;
  const parsed = importInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const planned = await planImport(db, parsed.data.fileName, parsed.data.json);
  if (!planned.ok) return planned;
  return { ok: true, preview: planned.plan.preview };
}

/**
 * Imports a file in one transaction. New businesses become unassigned `new`
 * leads. Businesses already in the database get their imported data
 * refreshed (raw, name, city, source), and nothing else: assignment, status,
 * calls and notes are never touched, so importing the same file twice
 * changes nothing. Unchanged leads aren't written at all, so `last_import_id`
 * is the last import that inserted or changed the lead.
 */
export async function commitImport(
  db: Db,
  actor: Viewer,
  input: unknown,
  ctx: { ip?: string | null } = {},
): Promise<Result<{ batchId: string; preview: ImportPreview }>> {
  if (!can(actor, "leads.import")) return FORBIDDEN;
  const parsed = importInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { fileName, json } = parsed.data;

  return db.transaction(async (tx) => {
    // One import at a time: two overlapping files are applied one after the
    // other instead of racing on the same dedupe keys.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('leads.import'))`);
    const planned = await planImport(tx, fileName, json);
    if (!planned.ok) return planned;
    const { preview, inserts, updates } = planned.plan;
    if (preview.inserted + preview.updated + preview.unchanged === 0) {
      return fail("invalid", "None of the records in this file can be imported.");
    }

    const [batch] = await tx
      .insert(importBatches)
      .values({
        importedBy: actor.id,
        fileName,
        total: preview.total,
        inserted: preview.inserted,
        updated: preview.updated,
        unchanged: preview.unchanged,
        invalid: preview.invalid,
        duplicates: preview.duplicates,
      })
      .returning({ id: importBatches.id });

    for (const chunk of chunks(inserts, CHUNK)) {
      await tx.insert(leads).values(
        chunk.map(({ index, key, raw }) => ({
          dedupeKey: key,
          legacySlug: legacySlug(raw.name, index),
          raw,
          name: raw.name,
          city: raw.city,
          source: computeSource(raw),
          firstImportId: batch.id,
          lastImportId: batch.id,
        })),
      );
    }

    for (const chunk of chunks(updates, CHUNK)) {
      const rows = chunk.map((u) => ({ id: u.id, raw: u.raw, name: u.raw.name, city: u.raw.city, source: computeSource(u.raw) }));
      await tx.execute(sql`
        update ${leads}
        set raw = x.raw, name = x.name, city = x.city, source = x.source,
            last_import_id = ${batch.id}, updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(id uuid, raw jsonb, name text, city text, source text)
        where ${leads.id} = x.id`);
    }

    const { total, inserted, updated, unchanged, invalid, duplicates, archived } = preview;
    const audit: AuditEntry[] = [
      {
        actorId: actor.id,
        action: "import.committed",
        entityType: "import",
        entityId: batch.id,
        after: { fileName, total, inserted, updated, unchanged, invalid, duplicates, archived },
        ip: ctx.ip,
      },
      // Only the fields that changed, and their previous values, so the
      // log shows what an import overwrote without copying whole records.
      ...updates.map(
        (u): AuditEntry => ({
          actorId: actor.id,
          action: "lead.reimported",
          entityType: "lead",
          entityId: u.id,
          before: u.before,
          after: { importId: batch.id, fields: Object.keys(u.before) },
          ip: ctx.ip,
        }),
      ),
    ];
    for (const chunk of chunks(audit, CHUNK)) await writeAudit(tx, chunk);

    return { ok: true, batchId: batch.id, preview };
  });
}

export async function listImportBatches(db: Db, actor: Viewer, limit = 20): Promise<ImportBatchDTO[] | null> {
  if (!can(actor, "leads.import")) return null;
  return db
    .select({
      id: importBatches.id,
      fileName: importBatches.fileName,
      importedBy: users.name,
      total: importBatches.total,
      inserted: importBatches.inserted,
      updated: importBatches.updated,
      unchanged: importBatches.unchanged,
      invalid: importBatches.invalid,
      duplicates: importBatches.duplicates,
      createdAt: importBatches.createdAt,
    })
    .from(importBatches)
    .innerJoin(users, eq(users.id, importBatches.importedBy))
    .orderBy(desc(importBatches.createdAt))
    .limit(limit);
}
