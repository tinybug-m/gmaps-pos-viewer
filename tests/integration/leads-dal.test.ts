import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultLeadQuery, parseLeadQuery } from "@/lib/lead-query";
import type { Viewer } from "@/lib/permissions";
import { getLeadForViewer, listLeadsForViewer, queryForViewer } from "@/server/dal/leads";
import { followUps, leads, users } from "@/server/db/schema";
import { createTestDb, describeDb, type TestDb } from "../support/db";
import { insertLead, insertUser } from "../support/factories";

const NOW = new Date("2026-03-10T12:00:00Z");
const MISSING = "00000000-0000-4000-8000-000000000000";

describeDb("lead visibility", () => {
  let t: TestDb;
  let admin: Viewer;
  let supervisor: Viewer;
  let alice: Viewer;
  let bob: Viewer;
  let ids: { alice1: string; alice2: string; aliceArchived: string; bob1: string; unassigned: string; archived: string };

  beforeAll(async () => {
    t = await createTestDb();
    const as = async (role: Viewer["role"], name?: string) => {
      const u = await insertUser(t.db, role, name ? { name } : {});
      return { id: u.id, role };
    };
    admin = await as("admin");
    supervisor = await as("supervisor");
    alice = await as("caller", "Alice Caller");
    bob = await as("caller", "Bob Caller");

    const archivedAt = new Date("2026-01-01T00:00:00Z");
    const lead = async (overrides: Parameters<typeof insertLead>[1]) => (await insertLead(t.db, overrides)).id;
    ids = {
      alice1: await lead({ assignedTo: alice.id, pipelineStatus: "callback" }),
      alice2: await lead({ assignedTo: alice.id }),
      aliceArchived: await lead({ assignedTo: alice.id, archivedAt, archivedBy: admin.id }),
      bob1: await lead({ assignedTo: bob.id }),
      unassigned: await lead({}),
      archived: await lead({ archivedAt, archivedBy: admin.id }),
    };

    await t.db.insert(followUps).values([
      { leadId: ids.alice1, dueAt: new Date(NOW.getTime() - 3600_000), createdBy: alice.id },
      // A completed follow-up isn't the lead's next one.
      { leadId: ids.alice2, dueAt: new Date(NOW.getTime() - 3600_000), createdBy: alice.id, completedAt: NOW, completedBy: alice.id },
    ]);
  });
  afterAll(async () => {
    await t?.drop();
  });

  const list = (viewer: Viewer, qs = "status=all") => listLeadsForViewer(t.db, viewer, parseLeadQuery(new URLSearchParams(qs)), NOW);
  const listedIds = async (viewer: Viewer, qs?: string) => (await list(viewer, qs)).rows.map((r) => r.id).sort();

  describe("listLeadsForViewer", () => {
    it("shows a caller only their own live leads", async () => {
      expect(await listedIds(alice)).toEqual([ids.alice1, ids.alice2].sort());
      expect(await listedIds(bob)).toEqual([ids.bob1]);
      const res = await list(alice);
      expect(res).toMatchObject({ total: 2, matching: 2 });
    });

    it("ignores a caller's attempts to widen the list through the URL", async () => {
      expect(await listedIds(alice, `status=all&assignee=${bob.id}`)).toEqual([ids.alice1, ids.alice2].sort());
      expect(await listedIds(alice, "status=all&assignee=unassigned")).toEqual([ids.alice1, ids.alice2].sort());
      expect(await listedIds(alice, "status=all&archived=1")).toEqual([ids.alice1, ids.alice2].sort());
    });

    it("gives callers no assignee options, so other callers' names aren't exposed", async () => {
      expect((await list(alice)).options.assignees).toEqual([]);
    });

    it("shows supervisors every live lead, but not archived ones", async () => {
      expect(await listedIds(supervisor)).toEqual([ids.alice1, ids.alice2, ids.bob1, ids.unassigned].sort());
      expect(await listedIds(supervisor, "status=all&archived=1")).toEqual(
        [ids.alice1, ids.alice2, ids.bob1, ids.unassigned].sort(),
      );
    });

    it("lets admins see archived leads in their own view", async () => {
      expect(await listedIds(admin, "status=all&archived=1")).toEqual([ids.aliceArchived, ids.archived].sort());
    });

    it("filters admins' and supervisors' lists by assignee", async () => {
      expect(await listedIds(supervisor, "status=all&assignee=unassigned")).toEqual([ids.unassigned]);
      expect(await listedIds(supervisor, `status=all&assignee=${alice.id}`)).toEqual([ids.alice1, ids.alice2].sort());
      const res = await list(supervisor);
      expect(res.options.assignees.map((a) => a.name)).toEqual(["Alice Caller", "Bob Caller"]);
    });

    it("attaches the open follow-up, bucketed against the request time", async () => {
      const rows = (await list(alice)).rows;
      expect(rows.find((r) => r.id === ids.alice1)?.workflow.followUp).toMatchObject({ bucket: "overdue" });
      expect(rows.find((r) => r.id === ids.alice2)?.workflow.followUp).toBeNull();
      expect(await listedIds(alice, "status=all&due=overdue")).toEqual([ids.alice1]);
    });

    it("never sends the search index to the browser", async () => {
      const [row] = (await list(alice)).rows;
      expect(row).not.toHaveProperty("searchText");
    });

    it("flags leads still assigned to a deactivated user", async () => {
      await t.db.update(users).set({ isActive: false }).where(eq(users.id, bob.id));
      try {
        const row = (await list(admin)).rows.find((r) => r.id === ids.bob1);
        expect(row?.workflow.assignee).toEqual({ id: bob.id, name: "Bob Caller", isActive: false });
      } finally {
        await t.db.update(users).set({ isActive: true }).where(eq(users.id, bob.id));
      }
    });
  });

  describe("getLeadForViewer", () => {
    const get = (viewer: Viewer, id: unknown) => getLeadForViewer(t.db, viewer, id, NOW);

    it("returns a caller's own lead", async () => {
      expect((await get(alice, ids.alice1))?.id).toBe(ids.alice1);
    });

    it("returns null, not an error, for anything a caller may not see", async () => {
      for (const id of [ids.bob1, ids.unassigned, ids.aliceArchived, ids.archived, MISSING, "not-a-uuid", 42, null]) {
        expect(await get(alice, id)).toBeNull();
      }
    });

    it("stops returning a lead to its old caller once it's reassigned", async () => {
      await t.db.update(leads).set({ assignedTo: bob.id }).where(eq(leads.id, ids.alice2));
      try {
        expect(await get(alice, ids.alice2)).toBeNull();
        expect((await get(bob, ids.alice2))?.id).toBe(ids.alice2);
      } finally {
        await t.db.update(leads).set({ assignedTo: alice.id }).where(eq(leads.id, ids.alice2));
      }
    });

    it("hides archived leads from supervisors but not admins", async () => {
      expect((await get(supervisor, ids.bob1))?.id).toBe(ids.bob1);
      expect(await get(supervisor, ids.archived)).toBeNull();
      expect((await get(admin, ids.archived))?.workflow.archived).toBe(true);
    });
  });

  describe("queryForViewer", () => {
    it("drops the assignee and archived options for those who can't use them", () => {
      const asked = { ...defaultLeadQuery(), assignee: "unassigned", archived: true };
      expect(queryForViewer(alice, asked)).toMatchObject({ assignee: null, archived: false });
      expect(queryForViewer(supervisor, asked)).toMatchObject({ assignee: "unassigned", archived: false });
      expect(queryForViewer(admin, asked)).toMatchObject({ assignee: "unassigned", archived: true });
    });
  });
});
