import { describe, expect, it } from "vitest";

import { LeadDataError, parseLeadFile, parseRawLeads } from "@/lib/validation";
import { crawledPoor, enrichedTrustpilot, noWebsite } from "../fixtures/leads";

const parse = (records: unknown) => parseRawLeads(JSON.stringify(records));

describe("parseRawLeads", () => {
  it("rejects invalid JSON, non-arrays and empty arrays", () => {
    expect(() => parseRawLeads("{not json")).toThrow(LeadDataError);
    expect(() => parse({ name: "x" })).toThrow(/JSON array/);
    expect(() => parse([])).toThrow(/doesn't contain any businesses/);
  });

  it("names the offending record in validation errors", () => {
    expect(() => parse([crawledPoor, { ...crawledPoor, name: "" }])).toThrow(/Business #2 is missing a "name"/);
    expect(() => parse([{ ...crawledPoor, mapsUrl: 5 }])).toThrow(/"Acme Plumbing & Heating".*mapsUrl/);
    expect(() => parse([{ ...crawledPoor, city: undefined }])).toThrow(/city/);
    expect(() => parse([{ ...crawledPoor, seoScore: "22" }])).toThrow(/seoScore/);
    expect(() => parse([{ ...crawledPoor, seoStatus: "BAD" }])).toThrow(/seoStatus/);
    expect(() => parse([{ ...crawledPoor, issues: [1] }])).toThrow(/issues/);
    expect(() => parse([{ ...crawledPoor, websiteUrl: 3 }])).toThrow(/websiteUrl/);
    expect(() => parse([{ ...crawledPoor, reviewCount: "9" }])).toThrow(/reviewCount/);
    expect(() => parse([{ ...crawledPoor, source: "yelp" }])).toThrow(/source/);
    expect(() => parse([{ ...crawledPoor, trustpilotUrl: 1 }])).toThrow(/trustpilotUrl/);
  });

  it("treats a missing or empty website as a valid no-website record without SEO fields", () => {
    const [a, b] = parse([noWebsite, { ...noWebsite, websiteUrl: "  " }]);
    expect(a).toMatchObject({ name: "Delta Dental", websiteUrl: null, city: "Exampleby" });
    expect(a.seoScore).toBeUndefined();
    expect(b.websiteUrl).toBeNull();
  });

  it("accepts the enriched export aliases and normalises outreach fields", () => {
    const [lead] = parse([enrichedTrustpilot]);
    expect(lead.city).toBe("Sampleton");
    expect(lead.websiteUrl).toBe("https://epsilon.example.org");
    expect(lead.issues).toEqual(["No canonical URL", "Very slow response time (5100ms)"]);
    expect(lead.source).toBe("trustpilot");
    expect(lead.reviewCount).toBe(41);
    expect(lead.outreach).toEqual({
      phone: "+44 20 7946 0123",
      phoneOwner: "Main line",
      emails: ["info@epsilon.example.org"],
      shouldCall: "YES",
      callPriority: "A",
      tier: "Tier 1",
      confidence: "HIGH",
      pitchAngle: "Slow site losing quote requests",
      callNote: null,
      askFor: null,
      decisionMaker: { name: "Pat Example", role: "Director", email: "pat@epsilon.example.org", phone: null },
      otherPeople: [
        { name: "Sam Sample", role: null, email: null, phone: null },
        { name: "Alex Test", role: "Office manager", email: null, phone: null },
      ],
      legalForm: "Ltd",
    });
  });

  it("omits outreach entirely when no enriched fields are present", () => {
    const [lead] = parse([crawledPoor]);
    expect(lead.outreach).toBeUndefined();
  });
});

describe("parseLeadFile", () => {
  const file = (records: unknown) => parseLeadFile(JSON.stringify(records));

  it("keeps every valid record and reports each invalid one by position instead of stopping", () => {
    const result = file([crawledPoor, { ...crawledPoor, name: "" }, noWebsite, { ...crawledPoor, seoStatus: "BAD" }, 7]);
    expect(result.valid.map((r) => [r.index, r.raw.name])).toEqual([
      [0, "Acme Plumbing & Heating"],
      [2, "Delta Dental"],
    ]);
    expect(result.invalid.map((r) => r.index)).toEqual([1, 3, 4]);
    expect(result.invalid[0].message).toMatch(/Business #2 is missing a "name"/);
    expect(result.invalid[1].message).toMatch(/seoStatus/);
    expect(result.invalid[2].message).toMatch(/Business #5 is not a valid object/);
  });

  it("still rejects a file that isn't a non-empty JSON array", () => {
    expect(() => parseLeadFile("nope")).toThrow(LeadDataError);
    expect(() => file({})).toThrow(/JSON array/);
    expect(() => file([])).toThrow(/doesn't contain any businesses/);
  });
});
