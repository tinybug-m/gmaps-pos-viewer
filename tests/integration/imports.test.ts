import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dedupeKey } from "@/lib/dedupe";
import { parseRawLeads } from "@/lib/validation";
import { commitImport, listImportBatches, previewImport } from "@/server/dal/imports";
import { auditLog, importBatches, leads } from "@/server/db/schema";
import { crawledGood, crawledPoor, enrichedTrustpilot, noWebsite } from "../fixtures/leads";
import { createTestDb, describeDb, type TestDb } from "../support/db";
import { insertUser } from "../support/factories";

const file = (records: unknown[], fileName = "export.json") => ({ fileName, json: JSON.stringify(records) });

describeDb("lead import", () => {
  let t: TestDb;
  let admin: { id: string; role: "admin" };

  beforeAll(async () => {
    t = await createTestDb();
    const row = await insertUser(t.db, "admin");
    admin = { id: row.id, role: "admin" };
  });
  afterAll(async () => {
    await t?.drop();
  });
  beforeEach(async () => {
    // audit_log is append-only by design, so tests only ever add to it; leads and batches start empty.
    await t.db.delete(leads);
    await t.db.delete(importBatches);
  });

  const allLeads = () => t.db.select().from(leads).orderBy(asc(leads.name));
  const batchCount = async () => (await t.db.select().from(importBatches)).length;

  it("previews without writing anything", async () => {
    const res = await previewImport(t.db, admin, file([crawledPoor, crawledGood, noWebsite]));
    expect(res).toMatchObject({ ok: true, preview: { total: 3, inserted: 3, updated: 0, unchanged: 0, invalid: 0 } });
    expect(await allLeads()).toHaveLength(0);
    expect(await batchCount()).toBe(0);
  });

  it("inserts new businesses as unassigned new leads with a dedupe key and the legacy id", async () => {
    const res = await commitImport(t.db, admin, file([crawledPoor, noWebsite]), { ip: "203.0.113.9" });
    if (!res.ok) throw new Error(res.message);
    expect(res.preview).toMatchObject({ inserted: 2, updated: 0, unchanged: 0 });

    const rows = await allLeads();
    expect(rows.map((r) => r.name)).toEqual(["Acme Plumbing & Heating", "Delta Dental"]);
    const [acme, delta] = rows;
    expect(acme).toMatchObject({
      legacySlug: "acme-plumbing-heating-0",
      pipelineStatus: "new",
      assignedTo: null,
      attemptCount: 0,
      firstImportId: res.batchId,
      lastImportId: res.batchId,
      city: "Testford",
      source: "google-maps",
    });
    expect(acme.dedupeKey).toBe(dedupeKey(parseRawLeads(JSON.stringify([crawledPoor]))[0]));
    expect(delta.legacySlug).toBe("delta-dental-1");

    const [batch] = await t.db.select().from(importBatches).where(eq(importBatches.id, res.batchId));
    expect(batch).toMatchObject({ importedBy: admin.id, fileName: "export.json", total: 2, inserted: 2 });
    const [audit] = await t.db.select().from(auditLog).where(eq(auditLog.entityId, res.batchId));
    expect(audit).toMatchObject({ action: "import.committed", actorId: admin.id, ip: "203.0.113.9" });
  });

  it("changes nothing when the same file is imported again", async () => {
    const records = [crawledPoor, crawledGood, enrichedTrustpilot];
    const first = await commitImport(t.db, admin, file(records));
    if (!first.ok) throw new Error(first.message);
    const before = await allLeads();

    const second = await commitImport(t.db, admin, file(records));
    expect(second).toMatchObject({ ok: true, preview: { inserted: 0, updated: 0, unchanged: 3 } });
    const after = await allLeads();
    expect(after).toEqual(before);
    expect(after.every((l) => l.lastImportId === first.batchId)).toBe(true);
  });

  it("refreshes imported data on a re-import without touching assignment or workflow", async () => {
    const first = await commitImport(t.db, admin, file([crawledPoor]));
    if (!first.ok) throw new Error(first.message);
    const caller = await insertUser(t.db, "caller");
    const [lead] = await allLeads();
    await t.db
      .update(leads)
      .set({ assignedTo: caller.id, assignedAt: new Date(), pipelineStatus: "callback", attemptCount: 2, version: 4 })
      .where(eq(leads.id, lead.id));

    const res = await commitImport(t.db, admin, file([{ ...crawledPoor, seoScore: 35, city: "Newtown" }], "v2.json"));
    if (!res.ok) throw new Error(res.message);
    expect(res.preview).toMatchObject({ inserted: 0, updated: 1, unchanged: 0 });

    const [after] = await allLeads();
    expect(after).toMatchObject({
      id: lead.id,
      city: "Newtown",
      assignedTo: caller.id,
      pipelineStatus: "callback",
      attemptCount: 2,
      version: 4,
      legacySlug: lead.legacySlug,
      firstImportId: first.batchId,
      lastImportId: res.batchId,
    });
    expect(after.raw.seoScore).toBe(35);

    // The audit keeps only the changed fields' old values, not the whole record.
    const [diff] = await t.db.select().from(auditLog).where(eq(auditLog.entityId, lead.id));
    expect(diff).toMatchObject({ action: "lead.reimported", before: { city: "Testford", seoScore: 22 } });
    expect(Object.keys(diff.before as object).sort()).toEqual(["city", "seoScore"]);
  });

  it("skips invalid rows and later copies of the same business, and lists them", async () => {
    const res = await commitImport(
      t.db,
      admin,
      file([crawledPoor, { ...crawledPoor, name: "" }, { ...crawledPoor, name: "Acme (again)" }, crawledGood]),
    );
    if (!res.ok) throw new Error(res.message);
    expect(res.preview).toMatchObject({ total: 4, inserted: 2, invalid: 1, duplicates: 1 });
    expect(res.preview.problems.map((p) => p.row)).toEqual([2, 3]);
    expect(res.preview.problems[1].message).toMatch(/same business as #1/);
    expect((await allLeads()).map((l) => l.name)).toEqual(["Acme Plumbing & Heating", "Beta Bakery"]);
  });

  it("rejects a broken file or one with nothing importable, and writes nothing", async () => {
    expect(await commitImport(t.db, admin, { fileName: "x.json", json: "{oops" })).toMatchObject({
      ok: false,
      code: "invalid",
      message: expect.stringMatching(/valid JSON/),
    });
    expect(await commitImport(t.db, admin, file([{ name: "" }, 5]))).toMatchObject({
      ok: false,
      message: expect.stringMatching(/None of the records/),
    });
    expect(await commitImport(t.db, admin, { fileName: "", json: "[]" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await allLeads()).toHaveLength(0);
    expect(await batchCount()).toBe(0);
  });

  it("keeps only the base name of the uploaded file", async () => {
    const res = await commitImport(t.db, admin, file([crawledPoor], "C:\\Users\\someone\\exports\\march.json"));
    if (!res.ok) throw new Error(res.message);
    expect(res.preview.fileName).toBe("march.json");
  });

  it("leaves archived leads archived when a file mentions them again", async () => {
    await commitImport(t.db, admin, file([crawledPoor]));
    const archivedAt = new Date("2026-01-01T00:00:00Z");
    await t.db.update(leads).set({ archivedAt, archivedBy: admin.id });

    const res = await commitImport(t.db, admin, file([{ ...crawledPoor, seoScore: 10 }]));
    expect(res).toMatchObject({ ok: true, preview: { updated: 1, archived: 1 } });
    const [after] = await allLeads();
    expect(after.archivedAt).toEqual(archivedAt);
  });

  it("serialises overlapping imports of the same file, so each business is inserted once", async () => {
    const records = [crawledPoor, crawledGood, noWebsite, enrichedTrustpilot];
    const results = await Promise.all([1, 2, 3].map(() => commitImport(t.db, admin, file(records))));
    expect(results.every((r) => r.ok)).toBe(true);
    const inserted = results.map((r) => (r.ok ? r.preview.inserted : -1)).sort();
    expect(inserted).toEqual([0, 0, 4]);
    expect(await allLeads()).toHaveLength(4);
  });

  it("is admin only", async () => {
    for (const role of ["supervisor", "caller"] as const) {
      const user = await insertUser(t.db, role);
      const viewer = { id: user.id, role };
      expect(await previewImport(t.db, viewer, file([crawledPoor]))).toMatchObject({ ok: false, code: "forbidden" });
      expect(await commitImport(t.db, viewer, file([crawledPoor]))).toMatchObject({ ok: false, code: "forbidden" });
      expect(await listImportBatches(t.db, viewer)).toBeNull();
    }
    expect(await allLeads()).toHaveLength(0);
  });

  describe("history", () => {
    it("lists recent imports newest first, with who ran them", async () => {
      await commitImport(t.db, admin, file([crawledPoor], "first.json"));
      await commitImport(t.db, admin, file([crawledGood], "second.json"));
      const batches = await listImportBatches(t.db, admin);
      expect(batches?.map((b) => b.fileName)).toEqual(["second.json", "first.json"]);
      expect(batches?.[0].importedBy).toMatch(/^Test admin/);
    });
  });
});
