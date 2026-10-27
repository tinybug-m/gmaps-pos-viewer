import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Viewer } from "@/lib/permissions";
import type { CallOutcome, PipelineStatus } from "@/lib/workflow";
import { addNote, changeStatus, logCall, setFollowUp, voidEntry } from "@/server/dal/activity";
import { assignLeads } from "@/server/dal/assignments";
import { getDashboard, listFeedbackFor, listOverdueFollowUps, listReviewQueue } from "@/server/dal/metrics";
import { callLogs, leads } from "@/server/db/schema";
import { createTestDb, describeDb, type TestDb } from "../support/db";
import { insertLead, insertUser } from "../support/factories";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/*
 * One fixed scenario; every expected number below is counted by hand from
 * it. "Now" is 27 Oct 2026 10:00 UTC, two days after UK clocks went back,
 * so London is on GMT today but was on BST (UTC+1) on 21 Oct, where the
 * 7-day range starts: 20 Oct 23:00 UTC.
 *
 *   Lead A (alice)  alice no_answer -2h → in_progress; admin no_answer -90m;
 *                   alice no_answer -1h; alice interested -30m → interested
 *   Lead B          alice busy 20 Oct 23:30Z (inside 7d) → in_progress;
 *                   reassigned to bob; bob gatekeeper -3h
 *   Lead C (bob)    bob interested -20m → interested; bob → closed_won -10m;
 *                   supervisor feedback about bob (clears its review flag)
 *   Lead D (alice)  alice voicemail 20 Oct 22:30Z (just outside 7d)
 *   Lead E (alice)  alice interested -40m → interested, call then voided
 *   Lead F (alice)  never called; follow-up overdue since yesterday
 *   Lead G          unassigned, follow-up overdue
 */
describeDb("dashboard metrics", () => {
  let t: TestDb;
  let admin: Viewer;
  let supervisor: Viewer;
  let alice: Viewer;
  let bob: Viewer;
  const now = new Date("2026-10-27T10:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const ids: Record<"A" | "B" | "C" | "D" | "E" | "F" | "G", string> = {} as never;

  const version = async (id: string) => (await t.db.select().from(leads).where(eq(leads.id, id)))[0].version;
  async function call(by: Viewer, leadId: string, outcome: CallOutcome, newStatus: PipelineStatus, at: Date) {
    const res = await logCall(t.db, by, { leadId, outcome, newStatus, version: await version(leadId) }, { now: at });
    if (!res.ok) throw new Error(res.message);
    return res.callId;
  }
  async function assign(leadId: string, to: Viewer, from: Viewer | null = null) {
    const res = await assignLeads(t.db, admin, { leadIds: [leadId], toUserId: to.id, expected: { [leadId]: from?.id ?? null } });
    if (!res.ok) throw new Error(res.message);
  }

  beforeAll(async () => {
    t = await createTestDb();
    const as = async (role: Viewer["role"]) => ({ id: (await insertUser(t.db, role)).id, role });
    admin = await as("admin");
    supervisor = await as("supervisor");
    alice = await as("caller");
    bob = await as("caller");
    for (const k of Object.keys({ A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 }) as (keyof typeof ids)[]) {
      ids[k] = (await insertLead(t.db)).id;
    }
    for (const k of ["A", "B", "D", "E", "F"] as const) await assign(ids[k], alice);
    await assign(ids.C, bob);

    await call(alice, ids.A, "no_answer", "in_progress", ago(2 * HOUR));
    await call(admin, ids.A, "no_answer", "in_progress", ago(90 * MIN));
    await call(alice, ids.A, "no_answer", "in_progress", ago(HOUR));
    await call(alice, ids.A, "interested", "interested", ago(30 * MIN));

    await call(alice, ids.B, "busy", "in_progress", new Date("2026-10-20T23:30:00Z"));
    await assign(ids.B, bob, alice);
    await call(bob, ids.B, "gatekeeper", "in_progress", ago(3 * HOUR));

    await call(bob, ids.C, "interested", "interested", ago(20 * MIN));
    const won = await changeStatus(t.db, bob, { leadId: ids.C, toStatus: "closed_won", reason: "Signed up", version: await version(ids.C) }, { now: ago(10 * MIN) });
    if (!won.ok) throw new Error(won.message);
    await addNote(t.db, supervisor, { leadId: ids.C, kind: "feedback", body: "Nice close." }, { now: ago(5 * MIN) });

    await call(alice, ids.D, "voicemail", "in_progress", new Date("2026-10-20T22:30:00Z"));

    const mistake = await call(alice, ids.E, "interested", "interested", ago(40 * MIN));
    await voidEntry(t.db, admin, { type: "call", entryId: mistake, reason: "Logged on the wrong lead" }, { now: ago(35 * MIN) });

    // Follow-ups booked two days ago for yesterday, so they're overdue now.
    for (const k of ["F", "G"] as const) {
      const res = await setFollowUp(t.db, admin, { leadId: ids[k], dueAt: ago(DAY) }, { now: ago(2 * DAY) });
      if (!res.ok) throw new Error(res.message);
    }
  });
  afterAll(async () => {
    await t?.drop();
  });

  const row = (d: Awaited<ReturnType<typeof getDashboard>>, v: Viewer) => d.people.find((p) => p.id === v.id);

  describe("today, team view", () => {
    it("counts calls per caller, and repeated calls to one lead as one lead contacted", async () => {
      const d = await getDashboard(t.db, supervisor, "today", now);
      expect(d.scope).toBe("team");
      expect(row(d, alice)).toMatchObject({ calls: 3, leadsContacted: 1, connects: 1, interested: 1, won: 0 });
      expect(row(d, bob)).toMatchObject({ calls: 2, leadsContacted: 2, connects: 2, interested: 1, won: 1 });
      expect(row(d, admin)).toMatchObject({ calls: 1, leadsContacted: 1, connects: 0 });
    });

    it("counts team leads contacted across people, not as a sum", async () => {
      const { totals } = await getDashboard(t.db, admin, "today", now);
      // Alice and the admin both called A: 1 + 2 + 1 per person, but 3 distinct leads.
      expect(totals).toMatchObject({ calls: 6, leadsContacted: 3, connects: 3, interested: 2, won: 1 });
    });

    it("leaves out voided calls and the status moves they recorded", async () => {
      const [voided] = await t.db.select().from(callLogs).where(eq(callLogs.leadId, ids.E));
      expect(voided.voidedAt).not.toBeNull();
      const d = await getDashboard(t.db, admin, "today", now);
      expect(row(d, alice)?.interested).toBe(1); // A only, not E
    });

    it("shows current workload, unassigned leads, overdue follow-ups and the review backlog", async () => {
      const d = await getDashboard(t.db, admin, "today", now);
      // Alice: A, D, E, F open; E is untouched again once its only call was voided. C is won, so bob keeps only B.
      expect(row(d, alice)).toMatchObject({ openLeads: 4, untouched: 2, overdue: 1 });
      expect(row(d, bob)).toMatchObject({ openLeads: 1, untouched: 0, overdue: 0 });
      expect(d.totals).toMatchObject({ openLeads: 5, untouched: 2, overdue: 2, unassigned: 1, awaitingReview: 2 });
    });

    it("lists supervisors only when they did calling work, and tracks last activity", async () => {
      const d = await getDashboard(t.db, admin, "today", now);
      expect(row(d, supervisor)).toBeUndefined();
      expect(row(d, alice)?.lastActivityAt).toEqual(ago(30 * MIN)); // the voided -40m call doesn't count
      expect(row(d, bob)?.lastActivityAt).toEqual(ago(20 * MIN));
    });
  });

  describe("ranges", () => {
    it("keeps credit for a call with the caller after the lead is reassigned", async () => {
      const d = await getDashboard(t.db, admin, "7d", now);
      expect(row(d, alice)).toMatchObject({ calls: 4, leadsContacted: 2 }); // A ×3 + B
      expect(row(d, bob)).toMatchObject({ calls: 2, leadsContacted: 2 });
    });

    it("starts the 7-day range at local midnight, on BST, before the clocks changed", async () => {
      const d = await getDashboard(t.db, admin, "7d", now);
      expect(d.range.from).toEqual(new Date("2026-10-20T23:00:00Z"));
      expect(d.range.to).toEqual(new Date("2026-10-28T00:00:00Z"));
      // D's call at 22:30 UTC was 23:30 on 20 Oct in London, so it's outside.
      expect(d.totals).toMatchObject({ calls: 7, leadsContacted: 3 });
    });

    it("includes older calls in 30 days", async () => {
      const d = await getDashboard(t.db, admin, "30d", now);
      expect(row(d, alice)).toMatchObject({ calls: 5, leadsContacted: 3 });
      expect(d.totals).toMatchObject({ calls: 8, leadsContacted: 4 });
    });
  });

  describe("caller view", () => {
    it("returns only the caller's own row and own totals", async () => {
      const d = await getDashboard(t.db, alice, "today", now);
      expect(d.scope).toBe("self");
      expect(d.people.map((p) => p.id)).toEqual([alice.id]);
      expect(d.totals).toMatchObject({ calls: 3, leadsContacted: 1, openLeads: 4, untouched: 2, overdue: 1, unassigned: 0, awaitingReview: 0 });
    });

    it("lists only their own overdue follow-ups", async () => {
      expect((await listOverdueFollowUps(t.db, alice, now)).map((f) => f.leadId)).toEqual([ids.F]);
      expect(await listOverdueFollowUps(t.db, bob, now)).toEqual([]);
    });

    it("can't see the review queue", async () => {
      expect(await listReviewQueue(t.db, alice)).toBeNull();
    });
  });

  describe("lists", () => {
    it("shows leads awaiting review oldest first, and feedback clears them", async () => {
      const queue = await listReviewQueue(t.db, supervisor);
      expect(queue?.map((r) => r.leadId)).toEqual([ids.E, ids.A]);
      expect(queue?.[1]).toMatchObject({ status: "interested", assignee: { id: alice.id } });
    });

    it("shows every overdue follow-up to the team, including unassigned leads", async () => {
      const list = await listOverdueFollowUps(t.db, supervisor, now);
      expect(list.map((f) => f.leadId).sort()).toEqual([ids.F, ids.G].sort());
      expect(list.find((f) => f.leadId === ids.G)?.assignee).toBeNull();
    });

    it("gives a caller the feedback written about them", async () => {
      const mine = await listFeedbackFor(t.db, bob);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ leadId: ids.C, body: "Nice close.", stillYours: true });
      expect(await listFeedbackFor(t.db, alice)).toEqual([]);
    });
  });
});
