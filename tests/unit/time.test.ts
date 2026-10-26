import { describe, expect, it } from "vitest";

import { checkFollowUpDate, followUpBucket, followUpPresets, rangeBounds, startOfDay, zonedTime } from "@/lib/time";

const iso = (d: Date) => d.toISOString();

describe("business time (Europe/London)", () => {
  it("finds local midnight in summer (BST) and winter (GMT)", () => {
    expect(iso(startOfDay(new Date("2026-07-15T10:00:00Z")))).toBe("2026-07-14T23:00:00.000Z");
    // 23:30 UTC on 15 July is already 16 July locally.
    expect(iso(startOfDay(new Date("2026-07-15T23:30:00Z")))).toBe("2026-07-15T23:00:00.000Z");
    expect(iso(startOfDay(new Date("2026-12-01T00:30:00Z")))).toBe("2026-12-01T00:00:00.000Z");
  });

  it("converts wall-clock times either side of a DST change", () => {
    expect(iso(zonedTime(2026, 10, 24, 9))).toBe("2026-10-24T08:00:00.000Z");
    expect(iso(zonedTime(2026, 10, 26, 9))).toBe("2026-10-26T09:00:00.000Z");
    expect(iso(zonedTime(2026, 3, 30, 9))).toBe("2026-03-30T08:00:00.000Z");
  });

  it("builds whole-day ranges across the October clock change", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    expect(rangeBounds("today", now)).toEqual({
      from: new Date("2026-10-26T00:00:00Z"),
      to: new Date("2026-10-27T00:00:00Z"),
    });
    expect(iso(rangeBounds("7d", now).from)).toBe("2026-10-19T23:00:00.000Z");
    expect(iso(rangeBounds("30d", now).from)).toBe("2026-09-26T23:00:00.000Z");
  });

  it("buckets follow-ups as overdue, today or upcoming in local days", () => {
    const now = new Date("2026-07-15T23:30:00Z"); // 00:30 on 16 July locally
    expect(followUpBucket(new Date("2026-07-15T23:00:00Z"), now)).toBe("overdue");
    expect(followUpBucket(new Date("2026-07-16T22:59:00Z"), now)).toBe("today");
    expect(followUpBucket(new Date("2026-07-16T23:00:00Z"), now)).toBe("upcoming");
  });

  it("validates follow-up dates", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    expect(checkFollowUpDate(new Date("2026-10-26T11:59:00Z"), now)).toMatch(/future/);
    expect(checkFollowUpDate(new Date("2027-10-27T12:00:00Z"), now)).toMatch(/365/);
    expect(checkFollowUpDate(new Date("invalid"), now)).toMatch(/valid/);
    expect(checkFollowUpDate(new Date("2026-10-27T09:00:00Z"), now)).toBeNull();
  });

  it("offers quick-pick presets at 9:00 local time", () => {
    const presets = followUpPresets(new Date("2026-10-24T15:00:00Z"));
    expect(presets.map((p) => [p.label, iso(p.at)])).toEqual([
      ["In 2 hours", "2026-10-24T17:00:00.000Z"],
      ["Tomorrow 9:00", "2026-10-25T09:00:00.000Z"],
      ["In 3 days", "2026-10-27T09:00:00.000Z"],
    ]);
  });
});
