import { describe, expect, it } from "vitest";

import {
  buildLeads,
  getCities,
  getIssueOptions,
  getNiches,
  getSummaryCounts,
  hasOutreachData,
} from "@/lib/leads";
import { parseRawLeads } from "@/lib/validation";
import { crawledGood, crawledPoor, crawlFailed, enrichedTrustpilot, noWebsite } from "../fixtures/leads";

const build = (records: unknown[]) => buildLeads(parseRawLeads(JSON.stringify(records)));

describe("buildLeads", () => {
  it("grades a crawled site from its issues", () => {
    const [lead] = build([crawledPoor]);
    expect(lead).toMatchObject({
      name: "Acme Plumbing & Heating",
      status: "POOR",
      seoScore: 22,
      priority: "High",
      issueCount: 4,
      responseMs: 2400,
      crawlFailed: false,
      source: "google-maps",
    });
    // "No major issues detected" carries no signal and is dropped.
    expect(lead.issues.map((i) => i.severity)).toEqual(["critical", "critical", "important", "optimization"]);
    expect(lead.searchText).toContain("acme-plumbing.example.com");
  });

  it("marks optimisation-only sites Low priority", () => {
    expect(build([crawledGood])[0]).toMatchObject({ status: "GOOD", priority: "Low", issueCount: 2 });
  });

  it("pulls crawl failures into their own status for manual review", () => {
    expect(build([crawlFailed])[0]).toMatchObject({
      status: "CRAWL_FAILED",
      priority: "Manual Review",
      crawlFailed: true,
      issueCount: 0,
    });
  });

  it("treats a business with no website as a High-priority build pitch", () => {
    const [lead] = build([noWebsite]);
    expect(lead).toMatchObject({ status: "NO_WEBSITE", priority: "High", seoScore: null, websiteUrl: null, issueCount: 1 });
    expect(lead.searchText).toContain("no website");
  });

  it.each([
    [["Missing page title"], "Medium"],
    [["Missing page title", "Missing H1 heading"], "High"],
    [["Missing H1 heading", "No canonical URL"], "Medium"],
    [["Missing H1 heading", "No canonical URL", "Very little text content"], "High"],
    [["Missing page title", "No HTTPS"], "High"],
  ])("priority thresholds: %j → %s", (issues, priority) => {
    expect(build([{ ...crawledPoor, issues }])[0].priority).toBe(priority);
  });

  it("infers Trustpilot from a trustpilotUrl and indexes outreach for search", () => {
    const [lead] = build([{ ...enrichedTrustpilot, source: undefined }]);
    expect(lead.source).toBe("trustpilot");
    expect(lead.priority).toBe("Medium");
    expect(lead.responseMs).toBe(5100);
    expect(lead.searchText).toContain("+44 20 7946 0123");
    expect(lead.searchText).toContain("pat example");
    expect(lead.searchText).toContain("alex test");
  });

  it("assigns positional slug ids (current, non-durable behaviour)", () => {
    const leads = build([crawledPoor, { ...crawledGood, name: "!!!" }]);
    expect(leads.map((l) => l.id)).toEqual(["acme-plumbing-heating-0", "lead-1"]);
  });
});

describe("dataset helpers", () => {
  const leads = build([crawledPoor, crawledGood, crawlFailed, noWebsite, enrichedTrustpilot]);

  it("counts statuses, with prospects = poor + needs improvement + no website", () => {
    expect(getSummaryCounts(leads)).toEqual({
      total: 5,
      prospects: 3,
      poor: 1,
      needsImprovement: 1,
      noWebsite: 1,
      good: 1,
      crawlFailed: 1,
    });
  });

  it("lists sorted distinct cities and niches", () => {
    expect(getCities(leads)).toEqual(["Exampleby", "Sampleton", "Testford"]);
    expect(getNiches(leads)).toEqual(["Trades"]);
  });

  it("detects outreach data", () => {
    expect(hasOutreachData(leads)).toBe(true);
    expect(hasOutreachData(build([crawledPoor]))).toBe(false);
  });

  it("offers issue templates, excluding crawl and no-website issues", () => {
    const options = getIssueOptions(leads);
    expect(options).toContain("Missing page title");
    expect(options).toContain("Images missing alt text");
    expect(options).not.toContain("Website could not be crawled");
    expect(options).not.toContain("No website listed for this business");
  });
});
