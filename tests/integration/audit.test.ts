import { afterAll, beforeAll, expect, it } from "vitest";
import type { Viewer } from "@/lib/permissions";
import { listAudit, writeAudit } from "@/server/dal/audit";
import { createTestDb, describeDb, type TestDb } from "../support/db";
import { insertUser } from "../support/factories";

describeDb("audit log viewer", () => {
  let t: TestDb;
  let admin: Viewer;
  let supervisor: Viewer;
  let caller: Viewer;

  beforeAll(async () => {
    t = await createTestDb();
    const as = async (role: Viewer["role"]) => ({ id: (await insertUser(t.db, role)).id, role });
    admin = await as("admin");
    supervisor = await as("supervisor");
    caller = await as("caller");
    await writeAudit(t.db, [
      { actorId: caller.id, action: "auth.login", entityType: "user", entityId: caller.id },
      { actorId: admin.id, action: "user.created", entityType: "user", entityId: caller.id, after: { role: "caller" } },
      { actorId: admin.id, action: "lead.assigned", entityType: "lead", entityId: "lead-1" },
      { actorId: null, action: "auth.login_failed", entityType: "user", after: { reason: "unknown_email" } },
      { actorId: admin.id, action: "lead.unassigned", entityType: "lead", entityId: "lead-1" },
    ]);
  });
  afterAll(async () => {
    await t?.drop();
  });

  it("is admin only", async () => {
    expect(await listAudit(t.db, supervisor)).toBeNull();
    expect(await listAudit(t.db, caller)).toBeNull();
  });

  it("lists newest first with the actor's name, and null for anonymous events", async () => {
    const page = await listAudit(t.db, admin);
    expect(page?.rows.map((r) => r.action)).toEqual(["lead.unassigned", "auth.login_failed", "lead.assigned", "user.created", "auth.login"]);
    expect(page?.rows[1].actor).toBeNull();
    expect(page?.rows[0].actor?.id).toBe(admin.id);
    expect(page?.nextBeforeId).toBeNull();
  });

  it("filters by category, actor and entity", async () => {
    expect((await listAudit(t.db, admin, { category: "auth" }))?.rows.map((r) => r.action)).toEqual(["auth.login_failed", "auth.login"]);
    expect((await listAudit(t.db, admin, { actorId: caller.id }))?.rows.map((r) => r.action)).toEqual(["auth.login"]);
    expect((await listAudit(t.db, admin, { entityId: "lead-1" }))?.rows).toHaveLength(2);
  });

  it("pages backwards without gaps or repeats", async () => {
    const first = await listAudit(t.db, admin, { limit: 2 });
    expect(first?.rows).toHaveLength(2);
    const second = await listAudit(t.db, admin, { limit: 2, beforeId: first!.nextBeforeId! });
    const third = await listAudit(t.db, admin, { limit: 2, beforeId: second!.nextBeforeId! });
    expect(third?.nextBeforeId).toBeNull();
    const all = [...first!.rows, ...second!.rows, ...third!.rows].map((r) => r.id);
    expect(new Set(all).size).toBe(5);
  });
});
