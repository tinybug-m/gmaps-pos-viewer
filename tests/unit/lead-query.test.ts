import { describe, expect, it } from "vitest";

import {
  defaultLeadQuery,
  isDefaultLeadQuery,
  matchesWorkflow,
  nextLeadSort,
  PAGE_SIZE,
  parseLeadQuery,
  selectLeads,
  serializeLeadQuery,
  sortTeamLeads,
  toSearchParams,
  type LeadQuery,
} from "@/lib/lead-query";
import { buildLead } from "@/lib/leads";
import { parseRawLeads } from "@/lib/validation";
import type { LeadWorkflow } from "@/types/lead";
import { crawledGood, crawledPoor, noWebsite } from "../fixtures/leads";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-03-10T12:00:00Z");

function workflow(overrides: Partial<LeadWorkflow> = {}): LeadWorkflow {
  return {
    pipelineStatus: "new",
    assignee: null,
    attemptCount: 0,
    lastOutcome: null,
    lastCallAt: null,
    followUp: null,
    reviewRequested: false,
    archived: false,
    version: 1,
    ...overrides,
  };
}

const [poorRaw, goodRaw, noSiteRaw] = parseRawLeads(JSON.stringify([crawledPoor, crawledGood, noWebsite]));
const lead = (name: string, w: Partial<LeadWorkflow> = {}, raw = poorRaw) => ({
  ...buildLead({ ...raw, name }, `id-${name}`),
  workflow: workflow(w),
});

const parse = (qs: string) => parseLeadQuery(new URLSearchParams(qs));

describe("parseLeadQuery / serializeLeadQuery", () => {
  it("reads an empty URL as the default prospects view, and writes the default as an empty URL", () => {
    expect(parse("")).toEqual(defaultLeadQuery());
    expect(serializeLeadQuery(defaultLeadQuery()).toString()).toBe("");
    expect(isDefaultLeadQuery(parse(""))).toBe(true);
  });

  it("round-trips every filter, the sort and the page", () => {
    const query: LeadQuery = {
      filters: {
        statuses: new Set(["POOR", "GOOD"]),
        scoreBands: new Set(["0-30"]),
        cities: new Set(["Testford", "Sampleton"]),
        sources: new Set(["trustpilot"]),
        issueTemplates: new Set(["Missing page title"]),
        niches: new Set(["Trades"]),
        callReadyOnly: true,
        search: "plumbing",
      },
      pipeline: new Set(["callback", "interested"]),
      assignee: OTHER,
      due: "overdue",
      archived: true,
      sort: { key: "followUp", direction: "desc" },
      page: 3,
    };
    const again = parse(serializeLeadQuery(query).toString());
    expect(again).toEqual(query);
    expect(isDefaultLeadQuery(again)).toBe(false);
  });

  it("treats status=all as no SEO status filter", () => {
    const q = parse("status=all");
    expect(q.filters.statuses.size).toBe(0);
    expect(serializeLeadQuery(q).get("status")).toBe("all");
  });

  it("ignores values a hand-edited URL can't legitimately hold", () => {
    const q = parse(
      "status=BAD&band=99&source=yelp&pipeline=hacked&assignee=' or 1=1--&due=someday&sort=password&dir=up&page=-4&archived=yes&ready=true",
    );
    expect(q).toEqual(defaultLeadQuery());
  });

  it("accepts assignee as unassigned, me or a uuid only", () => {
    expect(parse("assignee=unassigned").assignee).toBe("unassigned");
    expect(parse("assignee=ME").assignee).toBe("me");
    expect(parse(`assignee=${OTHER.toUpperCase()}`).assignee).toBe(OTHER);
    expect(parse("assignee=12345").assignee).toBeNull();
  });

  it("caps how many values and how much text a URL can carry", () => {
    const many = Array.from({ length: 80 }, (_, i) => `city=c${i}`).join("&");
    expect(parse(many).filters.cities.size).toBe(50);
    expect(parse(`city=${"x".repeat(201)}`).filters.cities.size).toBe(0);
    expect(parse(`q=${"y".repeat(500)}`).filters.search).toHaveLength(200);
    expect(parse("page=100001").page).toBe(1);
    expect(parse("page=2.5").page).toBe(1);
  });

  it("gives a sort without a direction its natural direction", () => {
    expect(parse("sort=lastCall").sort).toEqual({ key: "lastCall", direction: "desc" });
    expect(parse("sort=name").sort).toEqual({ key: "name", direction: "asc" });
  });

  it("converts a page's searchParams record, including repeated keys", () => {
    const params = toSearchParams({ city: ["A", "B"], q: "x", empty: undefined });
    expect(params.getAll("city")).toEqual(["A", "B"]);
    expect(params.get("q")).toBe("x");
    expect(params.has("empty")).toBe(false);
  });
});

describe("nextLeadSort", () => {
  it("starts a new column in its natural direction and flips the same column", () => {
    const first = nextLeadSort({ key: "score", direction: "asc" }, "lastCall");
    expect(first).toEqual({ key: "lastCall", direction: "desc" });
    expect(nextLeadSort(first, "lastCall")).toEqual({ key: "lastCall", direction: "asc" });
  });
});

describe("matchesWorkflow", () => {
  const q = (overrides: Partial<LeadQuery>) => ({ ...defaultLeadQuery(), ...overrides });
  const mine = workflow({ assignee: { id: ME, name: "Me", isActive: true }, pipelineStatus: "callback" });
  const unassigned = workflow();

  it("filters by pipeline status", () => {
    expect(matchesWorkflow(mine, q({ pipeline: new Set(["callback"]) }), ME)).toBe(true);
    expect(matchesWorkflow(unassigned, q({ pipeline: new Set(["callback"]) }), ME)).toBe(false);
  });

  it("filters by assignee: unassigned, me, or a specific person", () => {
    expect(matchesWorkflow(unassigned, q({ assignee: "unassigned" }), ME)).toBe(true);
    expect(matchesWorkflow(mine, q({ assignee: "unassigned" }), ME)).toBe(false);
    expect(matchesWorkflow(mine, q({ assignee: "me" }), ME)).toBe(true);
    expect(matchesWorkflow(mine, q({ assignee: "me" }), OTHER)).toBe(false);
    expect(matchesWorkflow(mine, q({ assignee: ME }), OTHER)).toBe(true);
    expect(matchesWorkflow(mine, q({ assignee: OTHER }), ME)).toBe(false);
  });

  it("filters by follow-up bucket, and leads with no follow-up never match one", () => {
    const due = workflow({ followUp: { dueAt: NOW, bucket: "overdue" } });
    expect(matchesWorkflow(due, q({ due: "overdue" }), ME)).toBe(true);
    expect(matchesWorkflow(due, q({ due: "today" }), ME)).toBe(false);
    expect(matchesWorkflow(unassigned, q({ due: "overdue" }), ME)).toBe(false);
  });
});

describe("sortTeamLeads", () => {
  const soon = lead("Soon", { followUp: { dueAt: new Date(NOW.getTime() + 3600_000), bucket: "today" } });
  const later = lead("Later", { followUp: { dueAt: new Date(NOW.getTime() + 86_400_000), bucket: "upcoming" } });
  const none = lead("None");

  it("puts leads without a value last in both directions", () => {
    expect(sortTeamLeads([none, later, soon], { key: "followUp", direction: "asc" }).map((l) => l.name)).toEqual([
      "Soon",
      "Later",
      "None",
    ]);
    expect(sortTeamLeads([none, soon, later], { key: "followUp", direction: "desc" }).map((l) => l.name)).toEqual([
      "Later",
      "Soon",
      "None",
    ]);
  });

  it("orders the pipeline by workflow stage, then name", () => {
    const leads = [
      lead("B", { pipelineStatus: "interested" }),
      lead("A", { pipelineStatus: "interested" }),
      lead("C", { pipelineStatus: "new" }),
    ];
    expect(sortTeamLeads(leads, { key: "pipeline", direction: "asc" }).map((l) => l.name)).toEqual(["C", "A", "B"]);
  });

  it("keeps the SEO sort for SEO columns", () => {
    const leads = [lead("Good", {}, goodRaw), lead("Poor"), lead("No site", {}, noSiteRaw)];
    const sorted = sortTeamLeads(leads, { key: "name", direction: "asc" });
    expect(sorted.map((l) => l.name)).toEqual(["Good", "No site", "Poor"]);
  });
});

describe("selectLeads", () => {
  const leads = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => lead(`Lead ${String(i).padStart(3, "0")}`));

  it("filters, then pages, reporting the total that matched", () => {
    const page2 = selectLeads(leads, { ...defaultLeadQuery(), sort: { key: "name", direction: "asc" }, page: 2 }, ME);
    expect(page2).toMatchObject({ matching: PAGE_SIZE + 5, page: 2, pageCount: 2 });
    expect(page2.rows.map((l) => l.name)).toEqual(["Lead 050", "Lead 051", "Lead 052", "Lead 053", "Lead 054"]);
  });

  it("clamps a page past the end to the last page", () => {
    expect(selectLeads(leads, { ...defaultLeadQuery(), page: 99 }, ME).page).toBe(2);
    const none = selectLeads(leads, { ...defaultLeadQuery(), assignee: "me", page: 5 }, ME);
    expect(none).toMatchObject({ matching: 0, page: 1, pageCount: 1, rows: [] });
  });

  it("applies the SEO filters and search as well as the workflow ones", () => {
    const mixed = [lead("Good", {}, goodRaw), lead("Poor one"), lead("Poor two", { pipelineStatus: "callback" })];
    const result = selectLeads(mixed, { ...defaultLeadQuery(), pipeline: new Set(["new"]) }, ME);
    expect(result.rows.map((l) => l.name)).toEqual(["Poor one"]);
    const search = selectLeads(mixed, parse("q=two&status=all"), ME);
    expect(search.rows.map((l) => l.name)).toEqual(["Poor two"]);
  });
});
