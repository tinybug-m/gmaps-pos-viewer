import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it.each(["/", "/queue", "/leads/abc?tab=1#calls", "/admin/audit?category=auth"])("keeps the same-site path %s", (p) => {
    expect(safeNext(p)).toBe(p);
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r\n//evil.example",
    "\\/evil.example",
    "https://evil.example/",
    "javascript:alert(1)",
    " /queue",
    "",
    "queue",
    "/%2F/evil.example/..//x",
  ])("falls back to / for %j", (p) => {
    const out = safeNext(p);
    expect(new URL(out, "https://app.example").origin).toBe("https://app.example");
    expect(out.startsWith("//")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(42)).toBe("/");
  });
});
