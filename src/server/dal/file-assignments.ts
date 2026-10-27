import "server-only";
import { eq, inArray } from "drizzle-orm";
import { dedupeKey } from "@/lib/dedupe";
import { can, type Viewer } from "@/lib/permissions";
import { LeadDataError, parseLeadFile } from "@/lib/validation";
import type { Db, DbOrTx } from "../db/client";
import { leads, users } from "../db/schema";
import { fail, type Failure, type Result } from "../result";
import { assignFileInput, firstIssue, MAX_IMPORT_RECORDS } from "../validation";
import { ASSIGNABLE_ROLES, assignInTx, type AssignProblem } from "./assignments";
import { writeAudit } from "./audit";
import { MAX_LISTED_PROBLEMS, type ImportProblem } from "./imports";

const FORBIDDEN = fail("forbidden", "Only an admin can assign leads.");
/** Keys per SELECT, well under Postgres's parameter limit. */
const CHUNK = 500;

export interface FileAssignPreview {
  fileName: string;
  total: number;
  assignee: { id: string; name: string };
  /** Unassigned leads that will be given to the assignee. */
  toAssign: number;
  /** Already the assignee's: nothing to do. */
  alreadyAssigned: number;
  /** Assigned to someone else. Left alone: a file never takes a lead from its owner. */
  ownedByOthers: number;
  archived: number;
  /** Valid records with no lead in the system yet. They need importing first. */
  notImported: number;
  invalid: number;
  /** Rows for a business that appears earlier in the same file. The first one wins. */
  duplicates: number;
  problems: ImportProblem[];
}

interface Plan {
  preview: FileAssignPreview;
  /** Lead id → current assignee (always null), for the assign step's conflict check. */
  expected: Record<string, null>;
}

async function planAssign(db: DbOrTx, input: { fileName: string; json: string; toUserId: string }): Promise<Result<{ plan: Plan }>> {
  let records;
  try {
    records = parseLeadFile(input.json);
  } catch (err) {
    if (err instanceof LeadDataError) return fail("invalid", err.message);
    throw err;
  }
  const total = records.valid.length + records.invalid.length;
  if (total > MAX_IMPORT_RECORDS) {
    return fail("invalid", `That file has ${total.toLocaleString("en-GB")} records; the limit is ${MAX_IMPORT_RECORDS.toLocaleString("en-GB")} per file.`);
  }
  const [user] = await db
    .select({ id: users.id, name: users.name, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, input.toUserId));
  if (!user || !user.isActive) return fail("invalid", "Pick an active team member to assign to.");
  if (!ASSIGNABLE_ROLES.includes(user.role)) {
    return fail("invalid", "Supervisors review leads but don't call them, so leads can't be assigned to them.");
  }
  const assignee = { user: { id: user.id, name: user.name } };

  const problems: ImportProblem[] = records.invalid.map((r) => ({ row: r.index + 1, message: r.message }));
  const firstRow = new Map<string, { index: number; name: string }>();
  const keys: string[] = [];
  for (const { index, raw } of records.valid) {
    const key = dedupeKey(raw);
    const first = firstRow.get(key);
    if (first) {
      problems.push({ row: index + 1, message: `Business #${index + 1} ("${raw.name}") is the same business as #${first.index + 1}, so it was skipped.` });
      continue;
    }
    firstRow.set(key, { index, name: raw.name });
    keys.push(key);
  }

  const found = new Map<string, { id: string; assignedTo: string | null; archived: boolean }>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const rows = await db
      .select({ id: leads.id, key: leads.dedupeKey, assignedTo: leads.assignedTo, archivedAt: leads.archivedAt })
      .from(leads)
      .where(inArray(leads.dedupeKey, keys.slice(i, i + CHUNK)));
    for (const r of rows) found.set(r.key, { id: r.id, assignedTo: r.assignedTo, archived: r.archivedAt !== null });
  }

  const preview: FileAssignPreview = {
    fileName: input.fileName,
    total,
    assignee: assignee.user,
    toAssign: 0,
    alreadyAssigned: 0,
    ownedByOthers: 0,
    archived: 0,
    notImported: 0,
    invalid: records.invalid.length,
    duplicates: records.valid.length - keys.length,
    problems: [],
  };
  const expected: Record<string, null> = {};
  for (const key of keys) {
    const { index, name } = firstRow.get(key)!;
    const lead = found.get(key);
    let why: string | null = null;
    if (!lead) {
      preview.notImported++;
      why = `"${name}" isn't in the system yet. Import the file first.`;
    } else if (lead.archived) {
      preview.archived++;
      why = `"${name}" is archived.`;
    } else if (lead.assignedTo === assignee.user.id) preview.alreadyAssigned++;
    else if (lead.assignedTo) {
      preview.ownedByOthers++;
      why = `"${name}" is already assigned to someone else, so it was left with them.`;
    } else {
      preview.toAssign++;
      expected[lead.id] = null;
    }
    if (why) problems.push({ row: index + 1, message: why });
  }
  preview.problems = problems.sort((a, b) => a.row - b.row).slice(0, MAX_LISTED_PROBLEMS);
  return { ok: true, plan: { preview, expected } };
}

/** Dry run: what assigning this file to this user would do. Admin only. */
export async function previewFileAssignment(db: Db, actor: Viewer, input: unknown): Promise<Result<{ preview: FileAssignPreview }>> {
  if (!can(actor, "leads.assign")) return FORBIDDEN;
  const parsed = assignFileInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const planned = await planAssign(db, parsed.data);
  if (!planned.ok) return planned;
  return { ok: true, preview: planned.plan.preview };
}

export type FileAssignResult = Result<{ preview: FileAssignPreview }> | (Failure & { problems: AssignProblem[] });

/**
 * Assigns every unassigned lead in a file to one user, in one transaction.
 * Records are matched to existing leads by dedupe key; nothing is imported.
 * Leads that belong to someone else, archived leads and unknown businesses
 * are skipped and reported, never reassigned. If anything changed since the
 * preview (the count to assign differs, or a lead was taken meanwhile), nothing is written.
 */
export async function commitFileAssignment(
  db: Db,
  actor: Viewer,
  input: unknown,
  ctx: { ip?: string | null } = {},
): Promise<FileAssignResult> {
  if (!can(actor, "leads.assign")) return FORBIDDEN;
  const parsed = assignFileInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { fileName, expectedAssign, toUserId } = parsed.data;

  return db.transaction(async (tx): Promise<FileAssignResult> => {
    const planned = await planAssign(tx, parsed.data);
    if (!planned.ok) return planned;
    const { preview, expected } = planned.plan;
    if (preview.toAssign === 0) return fail("invalid", "There are no unassigned leads in this file to assign.");
    if (expectedAssign !== undefined && expectedAssign !== preview.toAssign) {
      return fail("conflict", `The leads changed since you checked this file: ${preview.toAssign} can be assigned now, not ${expectedAssign}. Nothing was changed. Check the file again.`);
    }
    const result = await assignInTx(
      tx,
      actor,
      { leadIds: Object.keys(expected), toUserId, expected, reason: `Bulk assignment from ${fileName}` },
      ctx,
    );
    // assignInTx only fails before its first write, so there is nothing to undo.
    if (!result.ok) return result;
    await writeAudit(tx, {
      actorId: actor.id,
      action: "lead.file_assigned",
      entityType: "import",
      after: { fileName, assignedTo: toUserId, assigned: result.changed, ownedByOthers: preview.ownedByOthers, archived: preview.archived, notImported: preview.notImported, invalid: preview.invalid, duplicates: preview.duplicates },
      ip: ctx.ip,
    });
    return { ok: true, preview };
  });
}
