import { describe, expect, it } from "vitest";

import { applyFilters, defaultFilters, isDefaultFilters } from "@/lib/filters";
import { buildLeads } from "@/lib/leads";
import { DEFAULT_SORT, nextSortState, sortLeads } from "@/lib/sort";
import { parseRawLeads } from "@/lib/validation";
import { crawledGood, crawledPoor, crawlFailed, enrichedTrustpilot, noWebsite } from "../fixtures/leads";

const leads = buildLeads(
  parseRawLeads(JSON.stringify([crawledPoor, crawledGood, crawlFailed, noWebsite, enrichedTrustpilot]))
);
const names = (list: { name: string }[]) => list.map((l) => l.name);

describe("applyFilters", () => {
  it("defaults to prospects only", () => {
    expect(isDefaultFilters(defaultFilters())).toBe(true);
    expect(names(applyFilters(leads, defaultFilters()))).toEqual([
      "Acme Plumbing & Heating",
      "Delta Dental",
      "Epsilon Electrical Ltd",
    ]);
  });

  it("combines status, city, source, niche, call-ready and search filters", () => {
    const all = { ...defaultFilters(), statuses: new Set<never>() };
    expect(applyFilters(leads, all)).toHaveLength(5);
    expect(names(applyFilters(leads, { ...all, cities: new Set(["Testford"]) }))).toEqual([
      "Acme Plumbing & Heating",
      "Gamma Garage",
    ]);
    expect(names(applyFilters(leads, { ...all, sources: new Set(["trustpilot"] as const) }))).toEqual([
      "Epsilon Electrical Ltd",
    ]);
    expect(names(applyFilters(leads, { ...all, niches: new Set(["Trades"]) }))).toEqual(["Epsilon Electrical Ltd"]);
    expect(names(applyFilters(leads, { ...all, callReadyOnly: true }))).toEqual(["Epsilon Electrical Ltd"]);
    expect(names(applyFilters(leads, { ...all, search: "  BAKERY " }))).toEqual(["Beta Bakery"]);
    expect(isDefaultFilters({ ...all, search: "x" })).toBe(false);
  });

  it("excludes no-website leads from score-band filters", () => {
    const all = { ...defaultFilters(), statuses: new Set<never>() };
    expect(names(applyFilters(leads, { ...all, scoreBands: new Set(["0-30"] as const) }))).toEqual([
      "Acme Plumbing & Heating",
      "Gamma Garage",
    ]);
  });

  it("matches issue templates by category label", () => {
    const all = { ...defaultFilters(), statuses: new Set<never>() };
    expect(names(applyFilters(leads, { ...all, issueTemplates: new Set(["Slow response time"]) }))).toEqual([
      "Acme Plumbing & Heating",
    ]);
  });
});

describe("sortLeads", () => {
  it("sorts worst score first by default, with no-website leads ahead of score 0", () => {
    expect(names(sortLeads(leads, DEFAULT_SORT))).toEqual([
      "Delta Dental",
      "Gamma Garage",
      "Acme Plumbing & Heating",
      "Epsilon Electrical Ltd",
      "Beta Bakery",
    ]);
  });

  it("ranks call-ready outreach first and leads without outreach last", () => {
    expect(names(sortLeads(leads, { key: "call", direction: "asc" }))[0]).toBe("Epsilon Electrical Ltd");
  });

  it("sorts by priority rank and reverses for desc", () => {
    const asc = sortLeads(leads, { key: "priority", direction: "asc" }).map((l) => l.priority);
    expect(asc).toEqual(["High", "High", "Medium", "Low", "Manual Review"]);
    const desc = sortLeads(leads, { key: "priority", direction: "desc" }).map((l) => l.priority);
    expect(desc[0]).toBe("Manual Review");
  });

  it("starts columns in their worst-first direction and toggles on repeat clicks", () => {
    expect(nextSortState(DEFAULT_SORT, "issueCount")).toEqual({ key: "issueCount", direction: "desc" });
    expect(nextSortState(DEFAULT_SORT, "score")).toEqual({ key: "score", direction: "desc" });
    expect(nextSortState({ key: "name", direction: "desc" }, "name")).toEqual({ key: "name", direction: "asc" });
  });
});
