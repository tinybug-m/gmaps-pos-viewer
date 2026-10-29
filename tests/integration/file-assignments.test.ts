import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { Viewer } from "@/lib/permissions";
import { commitFileAssignment, previewFileAssignment } from "@/server/dal/file-assignments";
import { commitImport } from "@/server/dal/imports";
import { auditLog, leadAssignments, leads, users } from "@/server/db/schema";
import { createTestDb, describeDb, type TestDb } from "../support/db";
import { insertUser, rawLead } from "../support/factories";

// Lets one test make the final audit write fail, to prove the whole assignment rolls back.
const audit = vi.hoisted(() => ({ failOn: null as string | null }));
vi.mock("@/server/dal/audit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/dal/audit")>();
  return {
    ...real,
    writeAudit: (db: Parameters<typeof real.writeAudit>[0], entry: Parameters<typeof real.writeAudit>[1]) => {
      if (audit.failOn && !Array.isArray(entry) && entry.action === audit.failOn) throw new Error("audit unavailable");
      return real.writeAudit(db, entry);
    },
  };
});

const file = (records: unknown[], toUserId: string, extra: object = {}) => ({
  fileName: "batch.json",
  json: JSON.stringify(records),
  toUserId,
  ...extra,
});

describeDb("assigning a lead file", () => {
  let t: TestDb;
  let admin: Viewer;
  let supervisor: Viewer;
  let alice: Viewer;
  let bob: Viewer;

  beforeAll(async () => {
    t = await createTestDb();
    const as = async (role: Viewer["role"]) => ({ id: (await insertUser(t.db, role)).id, role });
    admin = await as("admin");
    supervisor = await as("supervisor");
    alice = await as("caller");
    bob = await as("caller");
  });
  afterAll(async () => {
    await t?.drop();
  });
  beforeEach(async () => {
    audit.failOn = null;
    await t.db.update(users).set({ isActive: true });
  });

  /** Imports n fresh businesses. Each test uses its own, because assignment history and the audit log are append-only. */
  const seed = async (n: number) => {
    const records = Array.from({ length: n }, () => rawLead());
    const res = await commitImport(t.db, admin, { fileName: "seed.json", json: JSON.stringify(records) });
    if (!res.ok) throw new Error(res.message);
    const rows = await t.db.select().from(leads).where(inArray(leads.name, records.map((r) => r.name)));
    const idOf = (name: string) => rows.find((r) => r.name === name)!.id;
    return { records, ids: records.map((r) => idOf(r.name)) };
  };
  /** Current assignee of each lead, in the order of `ids`. */
  const owners = async (ids: string[]) => {
    const rows = await t.db.select({ id: leads.id, assignedTo: leads.assignedTo }).from(leads).where(inArray(leads.id, ids));
    return ids.map((id) => rows.find((r) => r.id === id)!.assignedTo);
  };
  const openPeriods = (ids: string[]) =>
    t.db.select().from(leadAssignments).where(and(inArray(leadAssignments.leadId, ids), isNull(leadAssignments.endedAt)));
  const give = (id: string, to: Viewer) => t.db.update(leads).set({ assignedTo: to.id, assignedAt: new Date() }).where(eq(leads.id, id));

  it("denies everyone but an admin, for both the check and the assignment", async () => {
    const { records, ids } = await seed(1);
    for (const actor of [supervisor, alice]) {
      expect(await previewFileAssignment(t.db, actor, file(records, alice.id))).toMatchObject({ ok: false, code: "forbidden" });
      expect(await commitFileAssignment(t.db, actor, file(records, alice.id))).toMatchObject({ ok: false, code: "forbidden" });
    }
    expect(await owners(ids)).toEqual([null]);
    expect(await openPeriods(ids)).toHaveLength(0);
  });

  it("previews without writing anything", async () => {
    const { records, ids } = await seed(2);
    const res = await previewFileAssignment(t.db, admin, file(records, alice.id));
    expect(res).toMatchObject({ ok: true, preview: { total: 2, toAssign: 2, assignee: { id: alice.id } } });
    expect(await owners(ids)).toEqual([null, null]);
    expect(await openPeriods(ids)).toHaveLength(0);
  });

  it("assigns every unassigned lead to the user with history and an audit trail", async () => {
    const { records, ids } = await seed(2);
    const [before] = await t.db.select().from(leads).where(eq(leads.id, ids[0]));
    const res = await commitFileAssignment(t.db, admin, file(records, alice.id, { expectedAssign: 2 }), { ip: "203.0.113.7" });
    expect(res).toMatchObject({ ok: true, preview: { toAssign: 2 } });

    const [after] = await t.db.select().from(leads).where(eq(leads.id, ids[0]));
    expect(after).toMatchObject({ assignedTo: alice.id, raw: before.raw, pipelineStatus: before.pipelineStatus, version: before.version + 1 });
    expect(await owners(ids)).toEqual([alice.id, alice.id]);
    const periods = await openPeriods(ids);
    expect(periods).toHaveLength(2);
    expect(periods.every((p) => p.assignedTo === alice.id && p.assignedBy === admin.id && p.reason === "Bulk assignment from batch.json")).toBe(true);

    const perLead = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "lead.assigned"), inArray(auditLog.entityId, ids)));
    expect(perLead).toHaveLength(2);
    const summary = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "lead.file_assigned"), eq(auditLog.ip, "203.0.113.7")));
    expect(summary[0]).toMatchObject({ actorId: admin.id, after: { assigned: 2, assignedTo: alice.id } });
  });

  it("never takes a lead from its owner, and skips archived leads and unknown businesses", async () => {
    const { records, ids } = await seed(3);
    await give(ids[1], bob);
    await t.db.update(leads).set({ archivedAt: new Date(), archivedBy: admin.id }).where(eq(leads.id, ids[2]));
    const unknown = rawLead();

    const res = await commitFileAssignment(t.db, admin, file([...records, unknown], alice.id));
    expect(res).toMatchObject({ ok: true, preview: { total: 4, toAssign: 1, ownedByOthers: 1, archived: 1, notImported: 1 } });
    expect(res.ok && res.preview.problems.map((p) => p.row)).toEqual([2, 3, 4]);
    expect(await owners(ids)).toEqual([alice.id, bob.id, null]);
    expect(await t.db.select().from(leadAssignments).where(and(inArray(leadAssignments.leadId, ids), eq(leadAssignments.assignedTo, bob.id)))).toHaveLength(0);
  });

  it("counts leads the user already has as unchanged", async () => {
    const { records, ids } = await seed(2);
    await give(ids[0], alice);
    const res = await commitFileAssignment(t.db, admin, file(records, alice.id));
    expect(res).toMatchObject({ ok: true, preview: { toAssign: 1, alreadyAssigned: 1 } });
    expect(await openPeriods(ids)).toHaveLength(1);
  });

  it("reports invalid records and in-file duplicates, and assigns the valid rest once", async () => {
    const { records, ids } = await seed(2);
    const res = await commitFileAssignment(t.db, admin, file([records[0], { nonsense: true }, records[0], records[1]], alice.id));
    expect(res).toMatchObject({ ok: true, preview: { total: 4, toAssign: 2, invalid: 1, duplicates: 1 } });
    expect(await openPeriods(ids)).toHaveLength(2);
  });

  it("rejects a file that isn't a JSON array of leads", async () => {
    const { ids } = await seed(1);
    for (const json of ["not json", "{}", "[]"]) {
      expect(await commitFileAssignment(t.db, admin, { fileName: "bad.json", json, toUserId: alice.id })).toMatchObject({ ok: false });
    }
    expect(await owners(ids)).toEqual([null]);
  });

  it("refuses when nothing in the file can be assigned", async () => {
    const { records, ids } = await seed(1);
    await give(ids[0], bob);
    expect(await commitFileAssignment(t.db, admin, file(records, alice.id))).toMatchObject({ ok: false, code: "invalid" });
  });

  it("refuses supervisors, deactivated users and unknown users as the target", async () => {
    const { records, ids } = await seed(1);
    await t.db.update(users).set({ isActive: false }).where(eq(users.id, bob.id));
    for (const id of [supervisor.id, bob.id, crypto.randomUUID()]) {
      expect(await commitFileAssignment(t.db, admin, file(records, id))).toMatchObject({ ok: false, code: "invalid" });
      expect(await previewFileAssignment(t.db, admin, file(records, id))).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(await owners(ids)).toEqual([null]);
  });

  it("changes nothing when the confirmed count no longer matches", async () => {
    const { records, ids } = await seed(2);
    await give(ids[1], bob); // taken after the admin previewed 2
    const res = await commitFileAssignment(t.db, admin, file(records, alice.id, { expectedAssign: 2 }));
    expect(res).toMatchObject({ ok: false, code: "conflict" });
    expect(await openPeriods(ids)).toHaveLength(0);
    expect((await owners(ids)).includes(alice.id)).toBe(false);
  });

  it("rolls everything back when the transaction fails part-way", async () => {
    const { records, ids } = await seed(2);
    audit.failOn = "lead.file_assigned";
    await expect(commitFileAssignment(t.db, admin, file(records, alice.id))).rejects.toThrow("audit unavailable");
    expect(await owners(ids)).toEqual([null, null]);
    expect(await openPeriods(ids)).toHaveLength(0);
    expect(await t.db.select().from(auditLog).where(and(eq(auditLog.action, "lead.assigned"), inArray(auditLog.entityId, ids)))).toHaveLength(0);
  });
  it("imports businesses that aren't in the system yet and assigns them, when asked", async () => {
    const known = await seed(1);
    const fresh = [rawLead(), rawLead()];
    const records = [...known.records, ...fresh];
    const names = fresh.map((r) => r.name);

    // Without the option the new ones are skipped.
    expect(await previewFileAssignment(t.db, admin, file(records, alice.id))).toMatchObject({ ok: true, preview: { toAssign: 1, notImported: 2 } });

    const res = await commitFileAssignment(t.db, admin, file(records, alice.id, { importMissing: true, expectedAssign: 3 }));
    expect(res).toMatchObject({ ok: true, preview: { toAssign: 3, notImported: 0 } });
    const rows = await t.db.select().from(leads).where(inArray(leads.name, names));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.assignedTo === alice.id && r.firstImportId !== null)).toBe(true);
    expect(await owners(known.ids)).toEqual([alice.id]);
  });

  it("leaves existing leads untouched when importing the missing ones", async () => {
    const { records, ids } = await seed(1);
    const [before] = await t.db.select().from(leads).where(eq(leads.id, ids[0]));
    const changed = [{ ...records[0], name: `${records[0].name} renamed` }, rawLead()];
    const res = await commitFileAssignment(t.db, admin, file(changed, alice.id, { importMissing: true }));
    expect(res).toMatchObject({ ok: true });
    const [after] = await t.db.select().from(leads).where(eq(leads.id, ids[0]));
    expect(after.name).toBe(before.name);
    expect(after.assignedTo).toBe(alice.id);
  });

  it("undoes the import when the assignment then fails", async () => {
    const known = await seed(1);
    const fresh = rawLead();
    const res = await commitFileAssignment(t.db, admin, file([...known.records, fresh], alice.id, { importMissing: true, expectedAssign: 99 }));
    expect(res).toMatchObject({ ok: false, code: "conflict" });
    expect(await t.db.select().from(leads).where(eq(leads.name, fresh.name))).toHaveLength(0);
    expect(await owners(known.ids)).toEqual([null]);
  });
});
