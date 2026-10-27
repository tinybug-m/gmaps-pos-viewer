import { describe, expect, it } from "vitest";

import {
  addNoteInput,
  assignInput,
  changePasswordInput,
  changeStatusInput,
  createUserInput,
  firstIssue,
  logCallInput,
  MAX_BULK,
  MAX_NOTE_LENGTH,
  voidEntryInput,
} from "@/server/validation";

const L1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const L2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const U1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("action input schemas", () => {
  it("validates bulk assignment shape, size and duplicates", () => {
    expect(assignInput.safeParse({ leadIds: [L1, L2], toUserId: U1, expected: { [L1]: null, [L2]: U1 } }).success).toBe(true);
    expect(assignInput.safeParse({ leadIds: [L1], toUserId: null, expected: { [L1]: U1 } }).success).toBe(true);
    expect(assignInput.safeParse({ leadIds: [], toUserId: U1, expected: {} }).success).toBe(false);
    expect(assignInput.safeParse({ leadIds: [L1, L1], toUserId: U1, expected: { [L1]: null } }).success).toBe(false);
    expect(assignInput.safeParse({ leadIds: [L1, L2], toUserId: U1, expected: { [L1]: null } }).success).toBe(false);
    expect(assignInput.safeParse({ leadIds: ["not-a-uuid"], toUserId: U1, expected: {} }).success).toBe(false);

    const many = Array.from({ length: MAX_BULK + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const res = assignInput.safeParse({ leadIds: many, toUserId: U1, expected: Object.fromEntries(many.map((l) => [l, null])) });
    expect(res.success).toBe(false);
  });

  it("requires a follow-up date for callbacks", () => {
    const base = { leadId: L1, outcome: "callback_requested", newStatus: "callback", version: 3 };
    const missing = logCallInput.safeParse(base);
    expect(missing.success).toBe(false);
    if (!missing.success) expect(firstIssue(missing.error)).toMatch(/follow-up/);
    expect(logCallInput.safeParse({ ...base, followUpAt: "2026-10-27T09:00:00Z" }).success).toBe(true);
    expect(changeStatusInput.safeParse({ leadId: L1, toStatus: "callback", version: 0 }).success).toBe(false);
  });

  it("rejects unknown enums, oversized notes and silly durations", () => {
    const base = { leadId: L1, outcome: "no_answer", newStatus: "in_progress", version: 0 };
    expect(logCallInput.safeParse(base).success).toBe(true);
    expect(logCallInput.safeParse({ ...base, outcome: "sold" }).success).toBe(false);
    expect(logCallInput.safeParse({ ...base, newStatus: "deleted" }).success).toBe(false);
    expect(logCallInput.safeParse({ ...base, notes: "x".repeat(MAX_NOTE_LENGTH + 1) }).success).toBe(false);
    expect(logCallInput.safeParse({ ...base, durationSec: -1 }).success).toBe(false);
    expect(logCallInput.safeParse({ ...base, version: 1.5 }).success).toBe(false);
  });

  it("trims notes and rejects empty ones", () => {
    expect(addNoteInput.safeParse({ leadId: L1, body: "   ", kind: "note" }).success).toBe(false);
    const ok = addNoteInput.parse({ leadId: L1, body: "  called back  ", kind: "feedback" });
    expect(ok.body).toBe("called back");
    expect(addNoteInput.safeParse({ leadId: L1, body: "x", kind: "audit" }).success).toBe(false);
  });

  it("normalises emails, enforces password length and known roles", () => {
    expect(createUserInput.parse({ email: " Pat@Example.COM ", name: "Pat", role: "caller" }).email).toBe("pat@example.com");
    expect(createUserInput.safeParse({ email: "pat@example.com", name: "Pat", role: "owner" }).success).toBe(false);
    expect(changePasswordInput.safeParse({ currentPassword: "x", newPassword: "short" }).success).toBe(false);
    expect(changePasswordInput.safeParse({ currentPassword: "x", newPassword: "a-long-enough-pass" }).success).toBe(true);
  });

  it("requires a reason to void an entry", () => {
    expect(voidEntryInput.safeParse({ type: "call", entryId: L1, reason: "" }).success).toBe(false);
    expect(voidEntryInput.safeParse({ type: "call", entryId: L1, reason: "Logged on wrong lead" }).success).toBe(true);
  });
});
