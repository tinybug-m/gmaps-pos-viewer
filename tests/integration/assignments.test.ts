import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Viewer } from "@/lib/permissions";
import { assignLeads, listAssignmentHistory } from "@/server/dal/assignments";
import { getLeadForViewer } from "@/server/dal/leads";
import { updateUser } from "@/server/dal/users";
import { auditLog, leadAssignments, leads, users } from "@/server/db/schema";
import { createTestDb, describeDb, type TestDb } from "../support/db";
import { insertLead, insertUser, pgError } from "../support/factories";

describeDb("lead assignment", () => {
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

  const newLeads = async (n: number) => Promise.all(Array.from({ length: n }, async () => (await insertLead(t.db)).id));
  const unassigned = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, null]));
  const owners = async (ids: string[]) =>
    (await t.db.select({ id: leads.id, assignedTo: leads.assignedTo }).from(leads).where(inArray(leads.id, ids))).reduce(
      (m, r) => ({ ...m, [r.id]: r.assignedTo }),
      {} as Record<string, string | null>,
    );
  const openPeriods = (ids: string[]) =>
    t.db
      .select()
      .from(leadAssignments)
      .where(and(inArray(leadAssignments.leadId, ids), isNull(leadAssignments.endedAt)));

  it("assigns unassigned leads, records the period and audits each lead", async () => {
    const ids = await newLeads(3);
    const res = await assignLeads(t.db, admin, { leadIds: ids, toUserId: alice.id, expected: unassigned(ids), reason: "Spring push" }, { ip: "203.0.113.4" });
    expect(res).toEqual({ ok: true, changed: 3, unchanged: 0 });

    expect(Object.values(await owners(ids))).toEqual([alice.id, alice.id, alice.id]);
    const [lead] = await t.db.select().from(leads).where(eq(leads.id, ids[0]));
    expect(lead.assignedAt).toBeInstanceOf(Date);
    expect(lead.version).toBe(2);

    const periods = await openPeriods(ids);
    expect(periods).toHaveLength(3);
    expect(periods[0]).toMatchObject({ assignedTo: alice.id, assignedBy: admin.id, reason: "Spring push" });

    const audits = await t.db.select().from(auditLog).where(inArray(auditLog.entityId, ids));
    expect(audits).toHaveLength(3);
    expect(audits[0]).toMatchObject({ action: "lead.assigned", actorId: admin.id, before: { assignedTo: null }, ip: "203.0.113.4" });
  });

  it("reassigns: closes the old period, opens a new one, and moves access with it", async () => {
    const [id] = await newLeads(1);
    await assignLeads(t.db, admin, { leadIds: [id], toUserId: alice.id, expected: { [id]: null } });
    expect(await getLeadForViewer(t.db, alice, id)).not.toBeNull();

    const res = await assignLeads(t.db, admin, { leadIds: [id], toUserId: bob.id, expected: { [id]: alice.id } });
    expect(res).toMatchObject({ ok: true, changed: 1 });
    expect(await getLeadForViewer(t.db, alice, id)).toBeNull();
    expect(await getLeadForViewer(t.db, bob, id)).not.toBeNull();

    const history = await listAssignmentHistory(t.db, admin, id);
    expect(history?.map((p) => p.assignee.id)).toEqual([bob.id, alice.id]);
    expect(history?.[0].endedAt).toBeNull();
    expect(history?.[1]).toMatchObject({ endedBy: { id: admin.id } });
    expect(history?.[1].endedAt).toBeInstanceOf(Date);
  });

  it("unassigns, leaving no open period", async () => {
    const [id] = await newLeads(1);
    await assignLeads(t.db, admin, { leadIds: [id], toUserId: alice.id, expected: { [id]: null } });
    const res = await assignLeads(t.db, admin, { leadIds: [id], toUserId: null, expected: { [id]: alice.id } });
    expect(res).toMatchObject({ ok: true, changed: 1 });
    const [lead] = await t.db.select().from(leads).where(eq(leads.id, id));
    expect(lead).toMatchObject({ assignedTo: null, assignedAt: null });
    expect(await openPeriods([id])).toHaveLength(0);
    const [audit] = await t.db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, "lead.unassigned")));
    expect(audit.before).toEqual({ assignedTo: alice.id });
  });

  it("counts leads already with the target as unchanged and writes nothing for them", async () => {
    const ids = await newLeads(2);
    await assignLeads(t.db, admin, { leadIds: [ids[0]], toUserId: alice.id, expected: { [ids[0]]: null } });
    const res = await assignLeads(t.db, admin, {
      leadIds: ids,
      toUserId: alice.id,
      expected: { [ids[0]]: alice.id, [ids[1]]: null },
    });
    expect(res).toEqual({ ok: true, changed: 1, unchanged: 1 });
    expect(await t.db.select().from(leadAssignments).where(eq(leadAssignments.leadId, ids[0]))).toHaveLength(1);
  });

  it("applies nothing when any selected lead changed hands, and lists each problem", async () => {
    const ids = await newLeads(3);
    await assignLeads(t.db, admin, { leadIds: [ids[1]], toUserId: bob.id, expected: { [ids[1]]: null } });
    const [archived] = await newLeads(1);
    await t.db.update(leads).set({ archivedAt: new Date(), archivedBy: admin.id }).where(eq(leads.id, archived));
    const missing = "00000000-0000-4000-8000-000000000000";

    const leadIds = [...ids, archived, missing];
    const res = await assignLeads(t.db, admin, { leadIds, toUserId: alice.id, expected: unassigned(leadIds) });
    expect(res).toMatchObject({ ok: false, code: "invalid", message: expect.stringMatching(/3 of the selected.*Nothing was changed/) });
    if (res.ok || !("problems" in res)) throw new Error("expected problems");
    expect(res.problems.map((p) => [p.leadId, p.reason])).toEqual([
      [ids[1], "changed"],
      [archived, "archived"],
      [missing, "not_found"],
    ]);
    expect(await owners(ids)).toEqual({ [ids[0]]: null, [ids[1]]: bob.id, [ids[2]]: null });
  });

  it("reports a pure race as a conflict", async () => {
    const [id] = await newLeads(1);
    await assignLeads(t.db, admin, { leadIds: [id], toUserId: bob.id, expected: { [id]: null } });
    expect(await assignLeads(t.db, admin, { leadIds: [id], toUserId: alice.id, expected: { [id]: null } })).toMatchObject({
      ok: false,
      code: "conflict",
    });
  });

  it("only assigns to active callers or admins", async () => {
    const [id] = await newLeads(1);
    const gone = await insertUser(t.db, "caller", { isActive: false });
    for (const toUserId of [gone.id, supervisor.id, "00000000-0000-4000-8000-000000000000"]) {
      expect(await assignLeads(t.db, admin, { leadIds: [id], toUserId, expected: { [id]: null } })).toMatchObject({
        ok: false,
        code: "invalid",
      });
    }
    expect(await assignLeads(t.db, admin, { leadIds: [id], toUserId: admin.id, expected: { [id]: null } })).toMatchObject({ ok: true });
  });

  it("is admin only", async () => {
    const [id] = await newLeads(1);
    for (const actor of [supervisor, alice]) {
      expect(await assignLeads(t.db, actor, { leadIds: [id], toUserId: actor.id, expected: { [id]: null } })).toMatchObject({
        ok: false,
        code: "forbidden",
      });
      expect(await assignLeads(t.db, actor, { leadIds: [id], toUserId: null, expected: { [id]: null } })).toMatchObject({ code: "forbidden" });
    }
    expect(await listAssignmentHistory(t.db, alice, id)).toBeNull();
    expect((await owners([id]))[id]).toBeNull();
  });

  it("validates the request shape", async () => {
    const [id] = await newLeads(1);
    const bad = [
      { leadIds: [], toUserId: alice.id, expected: {} },
      { leadIds: [id, id], toUserId: alice.id, expected: { [id]: null } },
      { leadIds: [id], toUserId: alice.id, expected: {} },
      { leadIds: ["nope"], toUserId: alice.id, expected: { nope: null } },
      { leadIds: Array.from({ length: 501 }, () => id), toUserId: alice.id, expected: { [id]: null } },
    ];
    for (const input of bad) expect(await assignLeads(t.db, admin, input)).toMatchObject({ ok: false, code: "invalid" });
    expect(await listAssignmentHistory(t.db, admin, "not-a-uuid")).toEqual([]);
  });

  it("refuses a second open period for the same lead at the database level", async () => {
    const [id] = await newLeads(1);
    await assignLeads(t.db, admin, { leadIds: [id], toUserId: alice.id, expected: { [id]: null } });
    const err = await pgError(t.db.insert(leadAssignments).values({ leadId: id, assignedTo: bob.id, assignedBy: admin.id }));
    expect(err.constraint).toBe("lead_assignments_one_active_uq");
  });

  describe("concurrency", () => {
    it("lets exactly one of two racing assigns over overlapping leads win, with no deadlock", async () => {
      const ids = await newLeads(6);
      // Opposite orders on purpose: ordered locking must still avoid a deadlock.
      const [a, b] = await Promise.all([
        assignLeads(t.db, admin, { leadIds: ids.slice(0, 4), toUserId: alice.id, expected: unassigned(ids.slice(0, 4)) }),
        assignLeads(t.db, admin, { leadIds: ids.slice(2).reverse(), toUserId: bob.id, expected: unassigned(ids.slice(2)) }),
      ]);
      expect([a.ok, b.ok].sort()).toEqual([false, true]);
      const loser = a.ok ? b : a;
      expect(loser).toMatchObject({ code: "conflict" });

      const winner = a.ok ? alice.id : bob.id;
      const winnerIds = a.ok ? ids.slice(0, 4) : ids.slice(2);
      const current = await owners(ids);
      for (const id of ids) expect(current[id]).toBe(winnerIds.includes(id) ? winner : null);
      // One open period per lead, and they agree with leads.assigned_to.
      const periods = await openPeriods(ids);
      expect(periods).toHaveLength(4);
      for (const p of periods) expect(current[p.leadId]).toBe(p.assignedTo);
    });

    it("never assigns to a user who is being deactivated at the same moment", async () => {
      const carol = await insertUser(t.db, "caller");
      const ids = await newLeads(3);
      const [assigned, deactivated] = await Promise.all([
        assignLeads(t.db, admin, { leadIds: ids, toUserId: carol.id, expected: unassigned(ids) }),
        updateUser(t.db, admin, { userId: carol.id, isActive: false }),
      ]);
      expect(deactivated.ok).toBe(true);
      const [row] = await t.db.select({ isActive: users.isActive }).from(users).where(eq(users.id, carol.id));
      expect(row.isActive).toBe(false);
      // Either the assign ran first (and the deactivation reports the leads), or it was refused.
      if (assigned.ok) {
        expect(deactivated.ok && deactivated.user.assignedLeads).toBe(3);
      } else {
        expect(Object.values(await owners(ids))).toEqual([null, null, null]);
      }
    });
  });
});
