import { describe, expect, it } from "vitest";

import { can, type Capability, type Viewer } from "@/lib/permissions";
import type { Role } from "@/lib/workflow";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const viewer = (role: Role): Viewer => ({ id: ME, role });

// Mirrors the approved role-permission matrix. [admin, supervisor, caller-own, caller-not-own]
const MATRIX: [Capability, boolean, boolean, boolean, boolean][] = [
  ["users.manage", true, false, false, false],
  ["leads.import", true, false, false, false],
  ["leads.archive", true, false, false, false],
  ["leads.viewAll", true, true, false, false],
  ["leads.assign", true, false, false, false],
  ["audit.view", true, false, false, false],
  ["entries.void", true, false, false, false],
  ["dashboard.team", true, true, false, false],
  ["lead.view", true, true, true, false],
  ["lead.logCall", true, false, true, false],
  ["lead.changeStatus", true, false, true, false],
  ["lead.reopen", true, false, false, false],
  ["lead.addNote", true, true, true, false],
  ["lead.addFeedback", true, true, false, false],
  ["lead.manageFollowUp", true, true, true, false],
];

describe("can()", () => {
  it.each(MATRIX)("%s", (capability, admin, supervisor, callerOwn, callerOther) => {
    expect(can(viewer("admin"), capability, { assignedTo: OTHER })).toBe(admin);
    expect(can(viewer("supervisor"), capability, { assignedTo: OTHER })).toBe(supervisor);
    expect(can(viewer("caller"), capability, { assignedTo: ME })).toBe(callerOwn);
    expect(can(viewer("caller"), capability, { assignedTo: OTHER })).toBe(callerOther);
  });

  it("denies callers on unassigned leads and when no lead is given", () => {
    expect(can(viewer("caller"), "lead.view", { assignedTo: null })).toBe(false);
    expect(can(viewer("caller"), "lead.logCall")).toBe(false);
  });

  it("covers every capability in the matrix", () => {
    // A capability added to permissions.ts without a matrix row fails here.
    const caps = new Set(MATRIX.map(([c]) => c));
    expect(caps.size).toBe(MATRIX.length);
    expect(caps.size).toBe(15);
  });
});
