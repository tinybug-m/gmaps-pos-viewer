import { describe, expect, it } from "vitest";
import { buildLead } from "@/lib/leads";
import { buildQueue, nextInQueue, queueOrder } from "@/lib/queue";
import type { LeadOutreach, LeadWorkflow, RawLead, TeamLead } from "@/types/lead";

const now = new Date("2026-10-27T10:00:00Z");

// Synthetic record: invented name, example.com domain.
const rawLead = (id: string): RawLead => ({
  name: `Example Joinery ${id}`,
  city: "Testville",
  mapsUrl: `https://maps.example.com/place/${id}`,
  websiteUrl: `https://joinery-${id}.example.com`,
  seoScore: 40,
  seoStatus: "POOR",
  issues: ["Missing meta description"],
});

function lead(id: string, workflow: Partial<LeadWorkflow> = {}, raw: Partial<RawLead> = {}): TeamLead {
  const { searchText: _drop, ...base } = buildLead({ ...rawLead(id), ...raw } as RawLead, id);
  void _drop;
  return {
    ...base,
    workflow: {
      pipelineStatus: "new",
      assignee: null,
      attemptCount: 0,
      lastOutcome: null,
      lastCallAt: null,
      followUp: null,
      reviewRequested: false,
      archived: false,
      version: 1,
      ...workflow,
    },
  };
}

const graded = (callPriority: string): LeadOutreach => ({
  phone: null,
  phoneOwner: null,
  emails: [],
  shouldCall: "YES",
  callPriority,
  tier: null,
  confidence: null,
  pitchAngle: null,
  callNote: null,
  askFor: null,
  decisionMaker: null,
  otherPeople: [],
  legalForm: null,
});

const due = (hours: number, bucket: "overdue" | "today" | "upcoming") => ({
  followUp: { dueAt: new Date(now.getTime() + hours * 3600_000), bucket },
});

describe("buildQueue", () => {
  it("puts promised callbacks first, earliest due first", () => {
    const q = buildQueue([
      lead("b", { ...due(-1, "overdue"), pipelineStatus: "callback" }),
      lead("a", { ...due(-5, "overdue"), pipelineStatus: "callback" }),
      lead("c", { ...due(2, "today") }),
      lead("d", { ...due(48, "upcoming") }),
    ]);
    expect(q.overdue.map((l) => l.id)).toEqual(["a", "b"]);
    expect(q.today.map((l) => l.id)).toEqual(["c"]);
    expect(q.later.map((l) => l.id)).toEqual(["d"]);
  });

  it("orders in-progress leads by the longest wait since the last call", () => {
    const q = buildQueue([
      lead("recent", { attemptCount: 1, pipelineStatus: "in_progress", lastCallAt: new Date(now.getTime() - 3600_000) }),
      lead("stale", { attemptCount: 2, pipelineStatus: "in_progress", lastCallAt: new Date(now.getTime() - 86400_000) }),
    ]);
    expect(q.inProgress.map((l) => l.id)).toEqual(["stale", "recent"]);
  });

  it("drops closed and archived leads", () => {
    const q = buildQueue([lead("won", { pipelineStatus: "closed_won" }), lead("dnc", { pipelineStatus: "do_not_call" }), lead("arch", { archived: true })]);
    expect(queueOrder(q)).toEqual([]);
  });

  it("ranks fresh leads by the call list grade, then SEO priority", () => {
    const q = buildQueue([
      lead("noWebsite", {}, { websiteUrl: undefined, seoScore: undefined }),
      lead("gradeB", {}, { outreach: graded("B") }),
      lead("gradeA", {}, { outreach: graded("A") }),
    ]);
    expect(q.fresh.map((l) => l.id)).toEqual(["gradeA", "gradeB", "noWebsite"]);
  });
});

describe("nextInQueue", () => {
  const order = ["a", "b", "c"];
  it("returns the following lead, wrapping round", () => {
    expect(nextInQueue(order, "a")).toBe("b");
    expect(nextInQueue(order, "c")).toBe("a");
  });
  it("starts at the top when the current lead isn't queued", () => {
    expect(nextInQueue(order, "x")).toBe("a");
  });
  it("is null when nothing else is left", () => {
    expect(nextInQueue(["a"], "a")).toBeNull();
    expect(nextInQueue([], "a")).toBeNull();
  });
});
