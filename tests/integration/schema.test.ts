import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  auditLog,
  callLogs,
  followUps,
  leadAssignments,
  leadNotes,
  leadStatusChanges,
  leads,
  users,
} from "@/server/db/schema";
import { createTestDb, describeDb, type TestDb } from "../support/db";
import { insertLead, insertUser, pgError } from "../support/factories";

describeDb("schema constraints and history guards", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t?.drop();
  });

  it("allows only one active assignment per lead", async () => {
    const admin = await insertUser(t.db, "admin");
    const [a, b] = [await insertUser(t.db), await insertUser(t.db)];
    const lead = await insertLead(t.db);

    await t.db.insert(leadAssignments).values({ leadId: lead.id, assignedTo: a.id, assignedBy: admin.id });
    const err = await pgError(
      t.db.insert(leadAssignments).values({ leadId: lead.id, assignedTo: b.id, assignedBy: admin.id }),
    );
    expect(err.constraint).toBe("lead_assignments_one_active_uq");

    // Closing the open row frees the slot.
    await t.db
      .update(leadAssignments)
      .set({ endedAt: new Date(), endedBy: admin.id })
      .where(eq(leadAssignments.leadId, lead.id));
    await t.db.insert(leadAssignments).values({ leadId: lead.id, assignedTo: b.id, assignedBy: admin.id });
  });

  it("allows only one open follow-up per lead", async () => {
    const user = await insertUser(t.db);
    const lead = await insertLead(t.db);
    const dueAt = new Date(Date.now() + 86_400_000);
    await t.db.insert(followUps).values({ leadId: lead.id, dueAt, createdBy: user.id });
    const err = await pgError(t.db.insert(followUps).values({ leadId: lead.id, dueAt, createdBy: user.id }));
    expect(err.constraint).toBe("follow_ups_one_open_uq");
  });

  it("rejects malformed rows with check constraints", async () => {
    const user = await insertUser(t.db);
    expect((await pgError(insertUser(t.db, "caller", { email: "Mixed@Example.com" }))).constraint).toBe(
      "users_email_lowercase",
    );
    expect((await pgError(insertLead(t.db, { source: "facebook" }))).constraint).toBe("leads_source_known");
    expect((await pgError(insertLead(t.db, { assignedTo: user.id }))).constraint).toBe("leads_assignment_pair");
    expect((await pgError(insertLead(t.db, { attemptCount: -1 }))).constraint).toBe("leads_attempts_nonneg");

    const lead = await insertLead(t.db);
    const sameStatus = t.db
      .insert(leadStatusChanges)
      .values({ leadId: lead.id, fromStatus: "new", toStatus: "new", changedBy: user.id });
    expect((await pgError(sameStatus)).constraint).toBe("lead_status_changes_differs");

    const longNote = t.db.insert(leadNotes).values({ leadId: lead.id, authorId: user.id, body: "x".repeat(5001) });
    expect((await pgError(longNote)).constraint).toBe("lead_notes_body_length");

    const misplacedAbout = t.db
      .insert(leadNotes)
      .values({ leadId: lead.id, authorId: user.id, body: "ok", kind: "note", aboutUserId: user.id });
    expect((await pgError(misplacedAbout)).constraint).toBe("lead_notes_about_only_feedback");
  });

  it("keeps audit_log and lead_status_changes insert-only", async () => {
    const user = await insertUser(t.db);
    const lead = await insertLead(t.db);
    await t.db.insert(auditLog).values({ actorId: user.id, action: "test.event", entityType: "lead", entityId: lead.id });
    await t.db
      .insert(leadStatusChanges)
      .values({ leadId: lead.id, fromStatus: "new", toStatus: "in_progress", changedBy: user.id });

    for (const attempt of [
      t.db.update(auditLog).set({ action: "rewritten" }),
      t.db.delete(auditLog),
      t.db.execute(sql`truncate audit_log`),
      t.db.update(leadStatusChanges).set({ reason: "rewritten" }),
      t.db.delete(leadStatusChanges),
    ]) {
      expect((await pgError(attempt)).message).toMatch(/history_append_only/);
    }
    expect(await t.db.$count(auditLog)).toBeGreaterThan(0);
  });

  it("lets a call log be voided once and never edited or deleted", async () => {
    const [caller, admin] = [await insertUser(t.db), await insertUser(t.db, "admin")];
    const lead = await insertLead(t.db);
    const [call] = await t.db
      .insert(callLogs)
      .values({ leadId: lead.id, userId: caller.id, outcome: "no_answer", statusBefore: "new", statusAfter: "in_progress" })
      .returning();
    const byId = eq(callLogs.id, call.id);

    expect((await pgError(t.db.update(callLogs).set({ notes: "edited" }).where(byId))).message).toMatch(
      /history_append_only/,
    );
    expect((await pgError(t.db.delete(callLogs).where(byId))).message).toMatch(/history_append_only/);

    // A void that also edits another column is rejected.
    const sneaky = t.db
      .update(callLogs)
      .set({ voidedAt: new Date(), voidedBy: admin.id, voidReason: "dupe", outcome: "interested" })
      .where(byId);
    expect((await pgError(sneaky)).message).toMatch(/changed a recorded column/);

    // An incomplete void fails the check constraint.
    expect((await pgError(t.db.update(callLogs).set({ voidedAt: new Date() }).where(byId))).constraint).toBe(
      "call_logs_void_complete",
    );

    await t.db.update(callLogs).set({ voidedAt: new Date(), voidedBy: admin.id, voidReason: "Logged twice" }).where(byId);
    const again = t.db.update(callLogs).set({ voidReason: "changed my mind" }).where(byId);
    expect((await pgError(again)).message).toMatch(/only close an open row once/);

    const [row] = await t.db.select().from(callLogs).where(byId);
    expect(row).toMatchObject({ outcome: "no_answer", voidReason: "Logged twice" });
  });

  it("lets an assignment be closed once and nothing else", async () => {
    const [caller, other, admin] = [await insertUser(t.db), await insertUser(t.db), await insertUser(t.db, "admin")];
    const lead = await insertLead(t.db);
    const [row] = await t.db
      .insert(leadAssignments)
      .values({ leadId: lead.id, assignedTo: caller.id, assignedBy: admin.id })
      .returning();
    const byId = eq(leadAssignments.id, row.id);

    const reattribute = t.db.update(leadAssignments).set({ assignedTo: other.id }).where(byId);
    expect((await pgError(reattribute)).message).toMatch(/history_append_only/);

    await t.db.update(leadAssignments).set({ endedAt: new Date(), endedBy: admin.id }).where(byId);
    const reopen = t.db.update(leadAssignments).set({ endedAt: null, endedBy: null }).where(byId);
    expect((await pgError(reopen)).message).toMatch(/history_append_only/);
    expect((await pgError(t.db.delete(leadAssignments).where(byId))).message).toMatch(/history_append_only/);
  });

  it("lets a follow-up be completed or cancelled once, without moving its due date", async () => {
    const user = await insertUser(t.db);
    const lead = await insertLead(t.db);
    const [fu] = await t.db
      .insert(followUps)
      .values({ leadId: lead.id, dueAt: new Date(Date.now() + 3_600_000), createdBy: user.id })
      .returning();
    const byId = eq(followUps.id, fu.id);

    const moved = t.db.update(followUps).set({ dueAt: new Date() }).where(byId);
    expect((await pgError(moved)).message).toMatch(/changed a recorded column/);

    await t.db.update(followUps).set({ cancelledAt: new Date(), cancelledBy: user.id }).where(byId);
    const complete = t.db.update(followUps).set({ completedAt: new Date(), completedBy: user.id }).where(byId);
    expect((await pgError(complete)).message).toMatch(/only close an open row once/);
  });

  it("doesn't let a lead with history be deleted", async () => {
    const user = await insertUser(t.db);
    const lead = await insertLead(t.db);
    await t.db.insert(leadNotes).values({ leadId: lead.id, authorId: user.id, body: "Spoke to reception" });
    const err = await pgError(t.db.delete(leads).where(eq(leads.id, lead.id)));
    expect(err.code).toBe("23503"); // foreign_key_violation
    expect(await t.db.$count(users)).toBeGreaterThan(0);
  });
});
