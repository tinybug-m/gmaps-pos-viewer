import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Viewer } from "@/lib/permissions";
import { addNote, cancelFollowUp, changeStatus, getLeadActivity, logCall, setFollowUp, voidEntry } from "@/server/dal/activity";
import { assignLeads } from "@/server/dal/assignments";
import { getQueue } from "@/server/dal/leads";
import { auditLog, callLogs, followUps, leads, leadStatusChanges } from "@/server/db/schema";
import { createTestDb, describeDb, type TestDb } from "../support/db";
import { insertLead, insertUser, pgError } from "../support/factories";

const HOUR = 60 * 60 * 1000;

describeDb("lead activity", () => {
  let t: TestDb;
  let admin: Viewer;
  let supervisor: Viewer;
  let alice: Viewer;
  let bob: Viewer;
  const now = new Date("2026-10-27T10:00:00Z");

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

  /** A lead assigned to `owner` through the real assignment path. */
  async function leadFor(owner: Viewer | null = alice) {
    const lead = await insertLead(t.db);
    if (owner) await assignLeads(t.db, admin, { leadIds: [lead.id], toUserId: owner.id, expected: { [lead.id]: null } });
    const [row] = await t.db.select().from(leads).where(eq(leads.id, lead.id));
    return row;
  }
  const reload = async (id: string) => (await t.db.select().from(leads).where(eq(leads.id, id)))[0];
  const openFollowUps = (leadId: string) =>
    t.db
      .select()
      .from(followUps)
      .where(and(eq(followUps.leadId, leadId), isNull(followUps.completedAt), isNull(followUps.cancelledAt)));

  describe("logCall", () => {
    it("records the call, bumps attempts and version, and only changes status as chosen", async () => {
      const lead = await leadFor();
      const res = await logCall(t.db, alice, { leadId: lead.id, outcome: "no_answer", newStatus: "new", version: lead.version }, { now });
      expect(res).toMatchObject({ ok: true, status: "new", version: lead.version + 1 });

      const after = await reload(lead.id);
      expect(after).toMatchObject({ pipelineStatus: "new", attemptCount: 1, lastOutcome: "no_answer", lastCallAt: now });
      expect(await t.db.select().from(leadStatusChanges).where(eq(leadStatusChanges.leadId, lead.id))).toHaveLength(0);
      const [call] = await t.db.select().from(callLogs).where(eq(callLogs.leadId, lead.id));
      expect(call).toMatchObject({ userId: alice.id, outcome: "no_answer", statusBefore: "new", statusAfter: "new" });
    });

    it("writes a status change tied to the call when the status moves", async () => {
      const lead = await leadFor();
      const res = await logCall(t.db, alice, { leadId: lead.id, outcome: "interested", newStatus: "interested", notes: "Wants a quote", version: lead.version }, { now });
      expect(res.ok).toBe(true);
      const [change] = await t.db.select().from(leadStatusChanges).where(eq(leadStatusChanges.leadId, lead.id));
      expect(change).toMatchObject({ fromStatus: "new", toStatus: "interested", changedBy: alice.id });
      expect(change.callLogId).toBe(res.ok ? res.callId : null);
      expect((await reload(lead.id)).reviewRequestedAt).toEqual(now);
    });

    it("rejects a stale version, so a double submit logs one call", async () => {
      const lead = await leadFor();
      const input = { leadId: lead.id, outcome: "busy", newStatus: "in_progress", version: lead.version };
      const [a, b] = await Promise.all([logCall(t.db, alice, input, { now }), logCall(t.db, alice, input, { now })]);
      expect([a.ok, b.ok].sort()).toEqual([false, true]);
      expect([a, b].find((r) => !r.ok)).toMatchObject({ code: "conflict" });
      expect((await reload(lead.id)).attemptCount).toBe(1);
    });

    it("requires a follow-up date for a callback, in the future and within a year", async () => {
      const lead = await leadFor();
      const base = { leadId: lead.id, outcome: "callback_requested", newStatus: "callback", version: lead.version };
      expect(await logCall(t.db, alice, base, { now })).toMatchObject({ ok: false, code: "invalid" });
      expect(await logCall(t.db, alice, { ...base, followUpAt: new Date(now.getTime() - HOUR) }, { now })).toMatchObject({
        ok: false,
        message: "The follow-up must be in the future.",
      });
      expect(
        await logCall(t.db, alice, { ...base, followUpAt: new Date(now.getTime() + 400 * 24 * HOUR) }, { now }),
      ).toMatchObject({ ok: false, code: "invalid" });

      const due = new Date(now.getTime() + 2 * HOUR);
      expect(await logCall(t.db, alice, { ...base, followUpAt: due }, { now })).toMatchObject({ ok: true });
      const open = await openFollowUps(lead.id);
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ dueAt: due, createdBy: alice.id });
    });

    it("completes the open follow-up with the next call", async () => {
      const lead = await leadFor();
      const first = await logCall(
        t.db,
        alice,
        { leadId: lead.id, outcome: "callback_requested", newStatus: "callback", followUpAt: new Date(now.getTime() + HOUR), version: lead.version },
        { now },
      );
      if (!first.ok) throw new Error(first.message);
      const later = new Date(now.getTime() + 2 * HOUR);
      const second = await logCall(t.db, alice, { leadId: lead.id, outcome: "interested", newStatus: "interested", version: first.version }, { now: later });
      expect(second.ok).toBe(true);
      expect(await openFollowUps(lead.id)).toHaveLength(0);
      const [done] = await t.db.select().from(followUps).where(eq(followUps.leadId, lead.id));
      expect(done).toMatchObject({ completedBy: alice.id, completedAt: later, completedByCallId: second.ok ? second.callId : null });
    });

    it("refuses callers on leads that aren't theirs, and supervisors everywhere", async () => {
      const lead = await leadFor(bob);
      const input = { leadId: lead.id, outcome: "no_answer", newStatus: "in_progress", version: lead.version };
      expect(await logCall(t.db, alice, input)).toMatchObject({ ok: false, code: "not_found" });
      expect(await logCall(t.db, supervisor, input)).toMatchObject({ ok: false, code: "forbidden" });
      expect(await logCall(t.db, alice, { ...input, leadId: crypto.randomUUID() })).toMatchObject({ code: "not_found" });
      expect((await reload(lead.id)).attemptCount).toBe(0);
    });

    it("rejects a caller whose lead was reassigned while the form was open", async () => {
      const lead = await leadFor(alice);
      await assignLeads(t.db, admin, { leadIds: [lead.id], toUserId: bob.id, expected: { [lead.id]: alice.id } });
      const res = await logCall(t.db, alice, { leadId: lead.id, outcome: "no_answer", newStatus: "in_progress", version: lead.version });
      expect(res).toMatchObject({ ok: false, code: "not_found" });
    });

    it("keeps closed leads closed for callers; only an admin reopens", async () => {
      const lead = await leadFor();
      const closed = await logCall(t.db, alice, { leadId: lead.id, outcome: "wrong_number", newStatus: "invalid", version: lead.version }, { now });
      if (!closed.ok) throw new Error(closed.message);
      expect(await logCall(t.db, alice, { leadId: lead.id, outcome: "no_answer", newStatus: "invalid", version: closed.version })).toMatchObject({
        ok: false,
        code: "invalid",
      });
      expect(await changeStatus(t.db, alice, { leadId: lead.id, toStatus: "in_progress", reason: "Found the right number", version: closed.version })).toMatchObject({
        ok: false,
        code: "forbidden",
      });
      const reopened = await changeStatus(
        t.db,
        admin,
        { leadId: lead.id, toStatus: "in_progress", reason: "Found the right number", version: closed.version },
        { now, ip: "203.0.113.9" },
      );
      expect(reopened).toMatchObject({ ok: true, changed: true });
      const [audit] = await t.db.select().from(auditLog).where(and(eq(auditLog.entityId, lead.id), eq(auditLog.action, "lead.reopened")));
      expect(audit).toMatchObject({ actorId: admin.id, before: { status: "invalid" }, ip: "203.0.113.9" });
    });
  });

  describe("changeStatus", () => {
    it("needs a reason to close, and cancels the open follow-up", async () => {
      const lead = await leadFor();
      const parked = await changeStatus(
        t.db,
        alice,
        { leadId: lead.id, toStatus: "callback", followUpAt: new Date(now.getTime() + HOUR), version: lead.version },
        { now },
      );
      if (!parked.ok) throw new Error(parked.message);
      expect(await openFollowUps(lead.id)).toHaveLength(1);

      expect(await changeStatus(t.db, alice, { leadId: lead.id, toStatus: "closed_lost", version: parked.version })).toMatchObject({
        ok: false,
        message: "Say why the lead is being closed.",
      });
      const closed = await changeStatus(t.db, alice, { leadId: lead.id, toStatus: "closed_lost", reason: "Went with a competitor", version: parked.version }, { now });
      expect(closed).toMatchObject({ ok: true, changed: true });
      expect(await openFollowUps(lead.id)).toHaveLength(0);
      const changes = await t.db.select().from(leadStatusChanges).where(eq(leadStatusChanges.leadId, lead.id));
      expect(changes.map((c) => c.toStatus).sort()).toEqual(["callback", "closed_lost"]);
      expect(changes.find((c) => c.toStatus === "closed_lost")?.reason).toBe("Went with a competitor");
    });

    it("is a no-op for the same status and stops supervisors", async () => {
      const lead = await leadFor();
      expect(await changeStatus(t.db, alice, { leadId: lead.id, toStatus: "new", version: lead.version })).toEqual({
        ok: true,
        changed: false,
        version: lead.version,
      });
      expect(await changeStatus(t.db, supervisor, { leadId: lead.id, toStatus: "in_progress", version: lead.version })).toMatchObject({
        code: "forbidden",
      });
    });
  });

  describe("notes and feedback", () => {
    it("lets the owner, admins and supervisors add notes; other callers get not_found", async () => {
      const lead = await leadFor();
      for (const who of [alice, admin, supervisor]) {
        expect(await addNote(t.db, who, { leadId: lead.id, body: `From ${who.role}`, kind: "note" })).toMatchObject({ ok: true });
      }
      expect(await addNote(t.db, bob, { leadId: lead.id, body: "Not mine", kind: "note" })).toMatchObject({ code: "not_found" });
    });

    it("addresses feedback to the owner by default and clears the review flag", async () => {
      const lead = await leadFor();
      await logCall(t.db, alice, { leadId: lead.id, outcome: "interested", newStatus: "interested", version: lead.version }, { now });
      expect((await reload(lead.id)).reviewRequestedAt).not.toBeNull();

      expect(await addNote(t.db, alice, { leadId: lead.id, body: "Self review", kind: "feedback" })).toMatchObject({ code: "forbidden" });
      expect(await addNote(t.db, supervisor, { leadId: lead.id, body: "Good pitch, confirm budget next time", kind: "feedback" })).toMatchObject({ ok: true });
      expect((await reload(lead.id)).reviewRequestedAt).toBeNull();

      const activity = await getLeadActivity(t.db, alice, lead.id);
      const feedback = activity?.entries.find((e) => e.kind === "feedback");
      expect(feedback).toMatchObject({ by: { id: supervisor.id }, about: { id: alice.id }, body: "Good pitch, confirm budget next time" });
    });

    it("only addresses feedback to someone who has worked the lead", async () => {
      const lead = await leadFor(alice);
      const stranger = await insertUser(t.db, "caller");
      expect(await addNote(t.db, supervisor, { leadId: lead.id, body: "Not theirs", kind: "feedback", aboutUserId: stranger.id })).toMatchObject({
        ok: false,
        code: "invalid",
      });
      expect(await addNote(t.db, supervisor, { leadId: lead.id, body: "Unknown", kind: "feedback", aboutUserId: "00000000-0000-4000-8000-000000000000" })).toMatchObject({
        ok: false,
        code: "invalid",
      });

      await assignLeads(t.db, admin, { leadIds: [lead.id], toUserId: bob.id, expected: { [lead.id]: alice.id } });
      expect(await addNote(t.db, supervisor, { leadId: lead.id, body: "For the previous owner", kind: "feedback", aboutUserId: alice.id })).toMatchObject({ ok: true });
      expect(await addNote(t.db, supervisor, { leadId: lead.id, body: "For the current owner", kind: "feedback", aboutUserId: bob.id })).toMatchObject({ ok: true });
    });

    it("shows a caller only feedback for them or for nobody in particular; staff see all of it", async () => {
      const lead = await leadFor(alice);
      await addNote(t.db, supervisor, { leadId: lead.id, body: "Alice: slow down on the intro", kind: "feedback" });
      await assignLeads(t.db, admin, { leadIds: [lead.id], toUserId: bob.id, expected: { [lead.id]: alice.id } });
      await addNote(t.db, supervisor, { leadId: lead.id, body: "Bob: good recovery", kind: "feedback" });
      await addNote(t.db, admin, { leadId: lead.id, body: "Team note", kind: "note" });

      const bodies = async (v: Viewer) =>
        (await getLeadActivity(t.db, v, lead.id))!.entries.filter((e) => e.kind === "feedback" || e.kind === "note").map((e) => "body" in e && e.body);
      expect((await bodies(bob)).sort()).toEqual(["Bob: good recovery", "Team note"]);
      expect((await bodies(supervisor)).sort()).toEqual(["Alice: slow down on the intro", "Bob: good recovery", "Team note"]);
      expect((await bodies(admin)).sort()).toEqual(["Alice: slow down on the intro", "Bob: good recovery", "Team note"]);
    });

    it("doesn't bump the version, so an open call form stays valid", async () => {
      const lead = await leadFor();
      await addNote(t.db, supervisor, { leadId: lead.id, body: "Try the owner directly", kind: "note" });
      expect((await reload(lead.id)).version).toBe(lead.version);
    });
  });

  describe("follow-ups", () => {
    it("reschedules by cancelling the old one; one open follow-up at most", async () => {
      const lead = await leadFor();
      const a = await setFollowUp(t.db, supervisor, { leadId: lead.id, dueAt: new Date(now.getTime() + HOUR) }, { now });
      const b = await setFollowUp(t.db, alice, { leadId: lead.id, dueAt: new Date(now.getTime() + 3 * HOUR), note: "After lunch" }, { now });
      expect(a.ok && b.ok).toBe(true);
      const open = await openFollowUps(lead.id);
      expect(open).toHaveLength(1);
      expect(open[0].note).toBe("After lunch");

      const dup = t.db.insert(followUps).values({ leadId: lead.id, dueAt: now, createdBy: admin.id });
      expect((await pgError(dup)).constraint).toBe("follow_ups_one_open_uq");
    });

    it("won't cancel the date of a lead parked as a callback", async () => {
      const lead = await leadFor();
      const parked = await changeStatus(t.db, alice, { leadId: lead.id, toStatus: "callback", followUpAt: new Date(now.getTime() + HOUR), version: lead.version }, { now });
      expect(parked.ok).toBe(true);
      const [open] = await openFollowUps(lead.id);
      expect(await cancelFollowUp(t.db, alice, { followUpId: open.id })).toMatchObject({ ok: false, code: "invalid" });

      const other = await leadFor();
      const set = await setFollowUp(t.db, alice, { leadId: other.id, dueAt: new Date(now.getTime() + HOUR) }, { now });
      if (!set.ok) throw new Error(set.message);
      expect(await cancelFollowUp(t.db, bob, { followUpId: set.followUpId })).toMatchObject({ code: "not_found" });
      expect(await cancelFollowUp(t.db, alice, { followUpId: set.followUpId })).toEqual({ ok: true });
      expect(await cancelFollowUp(t.db, alice, { followUpId: set.followUpId })).toMatchObject({ code: "conflict" });
    });
  });

  describe("voiding", () => {
    it("keeps the row, recounts attempts and is admin-only", async () => {
      const lead = await leadFor();
      const first = await logCall(t.db, alice, { leadId: lead.id, outcome: "no_answer", newStatus: "in_progress", version: lead.version }, { now });
      if (!first.ok) throw new Error(first.message);
      const later = new Date(now.getTime() + HOUR);
      const second = await logCall(t.db, alice, { leadId: lead.id, outcome: "busy", newStatus: "in_progress", version: first.version }, { now: later });
      if (!second.ok) throw new Error(second.message);

      expect(await voidEntry(t.db, supervisor, { type: "call", entryId: second.callId, reason: "Wrong lead" })).toMatchObject({ code: "forbidden" });
      expect(await voidEntry(t.db, admin, { type: "call", entryId: second.callId, reason: "Logged on the wrong lead" })).toEqual({ ok: true });
      expect(await voidEntry(t.db, admin, { type: "call", entryId: second.callId, reason: "Again" })).toMatchObject({ code: "conflict" });

      expect(await reload(lead.id)).toMatchObject({ attemptCount: 1, lastOutcome: "no_answer", lastCallAt: now });
      const activity = await getLeadActivity(t.db, admin, lead.id);
      expect(activity?.liveCalls).toBe(1);
      const voided = activity?.entries.find((e) => e.kind === "call" && e.id === second.callId);
      expect(voided).toMatchObject({ voided: { by: { id: admin.id }, reason: "Logged on the wrong lead" } });
    });

    it("hides the text of voided calls and notes from everyone who can't void", async () => {
      const lead = await leadFor(alice);
      const call = await logCall(t.db, alice, { leadId: lead.id, outcome: "busy", newStatus: "in_progress", notes: "Typed into the wrong lead", version: lead.version }, { now });
      const note = await addNote(t.db, alice, { leadId: lead.id, body: "Also the wrong lead", kind: "note" });
      if (!call.ok || !note.ok) throw new Error("setup failed");
      await voidEntry(t.db, admin, { type: "call", entryId: call.callId, reason: "Wrong lead" });
      await voidEntry(t.db, admin, { type: "note", entryId: note.noteId, reason: "Wrong lead" });

      for (const v of [alice, supervisor]) {
        const entries = (await getLeadActivity(t.db, v, lead.id))!.entries;
        expect(entries.find((e) => e.kind === "call")).toMatchObject({ notes: null, voided: { reason: "Wrong lead" } });
        expect(entries.find((e) => e.kind === "note")).toMatchObject({ body: null, voided: { reason: "Wrong lead" } });
      }
      const forAdmin = (await getLeadActivity(t.db, admin, lead.id))!.entries;
      expect(forAdmin.find((e) => e.kind === "call")).toMatchObject({ notes: "Typed into the wrong lead" });
      expect(forAdmin.find((e) => e.kind === "note")).toMatchObject({ body: "Also the wrong lead" });
    });

    it("can't be bypassed by editing call rows directly", async () => {
      const lead = await leadFor();
      const res = await logCall(t.db, alice, { leadId: lead.id, outcome: "no_answer", newStatus: "in_progress", version: lead.version });
      if (!res.ok) throw new Error(res.message);
      const edit = t.db.update(callLogs).set({ outcome: "interested" }).where(eq(callLogs.id, res.callId));
      expect((await pgError(edit)).message).toMatch(/history_append_only/);
    });
  });

  describe("timeline and queue", () => {
    it("shows the new owner the previous owner's calls, but only staff see assignments", async () => {
      const lead = await leadFor(alice);
      await logCall(t.db, alice, { leadId: lead.id, outcome: "gatekeeper", newStatus: "in_progress", notes: "Ask for Sam", version: lead.version }, { now });
      await assignLeads(t.db, admin, { leadIds: [lead.id], toUserId: bob.id, expected: { [lead.id]: alice.id } });

      const forBob = await getLeadActivity(t.db, bob, lead.id);
      expect(forBob?.entries.find((e) => e.kind === "call")).toMatchObject({ by: { id: alice.id }, notes: "Ask for Sam" });
      expect(forBob?.entries.some((e) => e.kind === "assignment")).toBe(false);
      expect(await getLeadActivity(t.db, alice, lead.id)).toBeNull();

      const forAdmin = await getLeadActivity(t.db, admin, lead.id);
      expect(forAdmin?.entries.filter((e) => e.kind === "assignment").map((e) => e.kind === "assignment" && e.to?.id)).toEqual([bob.id, alice.id]);

      await assignLeads(t.db, admin, { leadIds: [lead.id], toUserId: null, expected: { [lead.id]: bob.id } });
      const [latest] = (await getLeadActivity(t.db, admin, lead.id))!.entries.filter((e) => e.kind === "assignment");
      expect(latest).toMatchObject({ to: null, by: { id: admin.id } });
    });

    it("orders a caller's queue: overdue, today, fresh, in progress, later; closed leads drop out", async () => {
      const carol: Viewer = { id: (await insertUser(t.db, "caller")).id, role: "caller" };
      const make = async () => leadFor(carol);
      const [overdue, today, fresh, progress, later, closed] = await Promise.all([make(), make(), make(), make(), make(), make()]);
      const past = new Date(now.getTime() - 26 * HOUR);
      await setFollowUp(t.db, carol, { leadId: overdue.id, dueAt: new Date(past.getTime() + HOUR) }, { now: past });
      await setFollowUp(t.db, carol, { leadId: today.id, dueAt: new Date(now.getTime() + HOUR) }, { now });
      await setFollowUp(t.db, carol, { leadId: later.id, dueAt: new Date(now.getTime() + 72 * HOUR) }, { now });
      await logCall(t.db, carol, { leadId: progress.id, outcome: "no_answer", newStatus: "in_progress", version: progress.version }, { now });
      await logCall(t.db, carol, { leadId: closed.id, outcome: "do_not_call", newStatus: "do_not_call", version: closed.version }, { now });

      const queue = await getQueue(t.db, carol, carol.id, now);
      expect(queue && Object.fromEntries(Object.entries(queue).map(([k, v]) => [k, v.map((l) => l.id)]))).toEqual({
        overdue: [overdue.id],
        today: [today.id],
        fresh: [fresh.id],
        inProgress: [progress.id],
        later: [later.id],
      });
      expect(await getQueue(t.db, alice, carol.id, now)).toBeNull();
      expect(await getQueue(t.db, supervisor, carol.id, now)).not.toBeNull();
    });
  });
});
