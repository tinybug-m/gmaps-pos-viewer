import type { LeadSource, RawLead, RawSeoStatus } from "@/types/lead";

const VALID_STATUSES: RawSeoStatus[] = ["GOOD", "NEEDS_IMPROVEMENT", "POOR"];

export class LeadDataError extends Error {}

/** Parses and validates an uploaded JSON file into the same shape the sample dataset uses. */
export function parseRawLeads(json: string): RawLead[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new LeadDataError("That file isn't valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw new LeadDataError('Expected a JSON array of businesses, e.g. [{ "name": ..., "seoScore": ... }].');
  }
  if (parsed.length === 0) {
    throw new LeadDataError("The file doesn't contain any businesses.");
  }

  return parsed.map((item, index) => validateLead(item, index));
}

function validateLead(item: unknown, index: number): RawLead {
  const label = `Business #${index + 1}`;
  if (typeof item !== "object" || item === null) {
    throw new LeadDataError(`${label} is not a valid object.`);
  }
  const rec = item as Record<string, unknown>;

  if (typeof rec.name !== "string" || !rec.name.trim()) {
    throw new LeadDataError(`${label} is missing a "name".`);
  }
  const named = `${label} ("${rec.name}")`;

  if (typeof rec.mapsUrl !== "string") {
    throw new LeadDataError(`${named} is missing a "mapsUrl" string.`);
  }
  if (typeof rec.city !== "string") {
    throw new LeadDataError(`${named} is missing a "city" string.`);
  }

  // websiteUrl is the branch point: null/missing/empty means "no website",
  // a business with no crawlable site rather than an invalid record.
  const websiteRaw = rec.websiteUrl;
  const hasWebsite =
    typeof websiteRaw === "string" && websiteRaw.trim() !== "";
  if (websiteRaw !== null && websiteRaw !== undefined && typeof websiteRaw !== "string") {
    throw new LeadDataError(`${named} has an invalid "websiteUrl" (expected a string or null).`);
  }

  let reviewCount: number | undefined;
  if (rec.reviewCount !== undefined) {
    if (typeof rec.reviewCount !== "number" || Number.isNaN(rec.reviewCount)) {
      throw new LeadDataError(`${named} has an invalid "reviewCount" (expected a number).`);
    }
    reviewCount = rec.reviewCount;
  }

  let source: LeadSource | undefined;
  if (rec.source !== undefined) {
    if (rec.source !== "google-maps" && rec.source !== "trustpilot") {
      throw new LeadDataError(`${named} has an invalid "source" (expected "google-maps" or "trustpilot").`);
    }
    source = rec.source;
  }
  let trustpilotUrl: string | undefined;
  if (rec.trustpilotUrl !== undefined && rec.trustpilotUrl !== null && rec.trustpilotUrl !== "") {
    if (typeof rec.trustpilotUrl !== "string") {
      throw new LeadDataError(`${named} has an invalid "trustpilotUrl" (expected a string).`);
    }
    trustpilotUrl = rec.trustpilotUrl;
  }

  if (!hasWebsite) {
    return {
      name: rec.name,
      mapsUrl: rec.mapsUrl,
      city: rec.city,
      websiteUrl: null,
      reviewCount,
      source,
      trustpilotUrl,
    };
  }

  if (typeof rec.seoScore !== "number" || Number.isNaN(rec.seoScore)) {
    throw new LeadDataError(`${named} has an invalid "seoScore" (expected a number).`);
  }
  if (typeof rec.seoStatus !== "string" || !VALID_STATUSES.includes(rec.seoStatus as RawSeoStatus)) {
    throw new LeadDataError(
      `${named} has an invalid "seoStatus" (expected GOOD, NEEDS_IMPROVEMENT, or POOR).`
    );
  }
  if (!Array.isArray(rec.issues) || !rec.issues.every((i) => typeof i === "string")) {
    throw new LeadDataError(`${named} has an invalid "issues" list (expected an array of strings).`);
  }

  return {
    name: rec.name,
    mapsUrl: rec.mapsUrl,
    city: rec.city,
    websiteUrl: websiteRaw as string,
    seoScore: rec.seoScore,
    seoStatus: rec.seoStatus as RawSeoStatus,
    issues: rec.issues as string[],
    reviewCount,
    source,
    trustpilotUrl,
  };
}
