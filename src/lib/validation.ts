import type { LeadContactPerson, LeadOutreach, LeadSource, RawLead, RawSeoStatus } from "@/types/lead";

const VALID_STATUSES: RawSeoStatus[] = ["GOOD", "NEEDS_IMPROVEMENT", "POOR"];

/** Bytes per import file; keeps the upload under the 4 MB server action body limit. */
export const MAX_IMPORT_BYTES = 3_500_000;

export class LeadDataError extends Error {}

/** Parses and validates an uploaded JSON file into the same shape the sample dataset uses. */
export function parseRawLeads(json: string): RawLead[] {
  return parseArray(json).map((item, index) => validateLead(item, index));
}

export interface LeadFileRecords {
  valid: { index: number; raw: RawLead }[];
  invalid: { index: number; message: string }[];
}

/**
 * Like `parseRawLeads`, but checks every record and reports each invalid one
 * instead of stopping at the first, so an import can skip bad rows and say
 * which they were. Still throws when the file itself isn't a JSON array.
 */
export function parseLeadFile(json: string): LeadFileRecords {
  const result: LeadFileRecords = { valid: [], invalid: [] };
  parseArray(json).forEach((item, index) => {
    try {
      result.valid.push({ index, raw: validateLead(item, index) });
    } catch (err) {
      if (!(err instanceof LeadDataError)) throw err;
      result.invalid.push({ index, message: err.message });
    }
  });
  return result;
}

function parseArray(json: string): unknown[] {
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
  return parsed;
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
  // The enriched export also carries `town`; accept it when `city` is absent.
  if (typeof rec.city !== "string" && typeof rec.town === "string") {
    rec.city = rec.town;
  }
  if (typeof rec.city !== "string") {
    throw new LeadDataError(`${named} is missing a "city" string.`);
  }

  // websiteUrl is the branch point: null/missing/empty means "no website",
  // a business with no crawlable site rather than an invalid record.
  const websiteRaw = rec.websiteUrl ?? rec.website;
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

  const extras = parseEnrichedFields(rec);

  if (!hasWebsite) {
    return {
      name: rec.name,
      mapsUrl: rec.mapsUrl,
      city: rec.city,
      websiteUrl: null,
      reviewCount,
      source,
      trustpilotUrl,
      ...extras,
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
  if (rec.issues === undefined && rec.defectList !== undefined) {
    rec.issues = rec.defectList;
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
    ...extras,
  };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
}

function parsePerson(value: unknown): LeadContactPerson | null {
  if (typeof value === "string") {
    return value.trim() ? { name: value.trim(), role: null, email: null, phone: null } : null;
  }
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  const name = str(rec.name) ?? str(rec.fullName);
  if (!name) return null;
  return {
    name,
    role: str(rec.role) ?? str(rec.title) ?? str(rec.position) ?? null,
    email: str(rec.email) ?? null,
    phone: str(rec.phone) ?? null,
  };
}

/**
 * Business-profile and outreach fields from the enriched "call sheet"
 * export. These are free-form scraper output, so they're read leniently: a
 * field with an unexpected type is dropped rather than rejecting the file.
 */
function parseEnrichedFields(rec: Record<string, unknown>): Partial<RawLead> {
  const emails = Array.isArray(rec.emails)
    ? rec.emails.map(str).filter((e): e is string => e !== undefined)
    : [];
  const otherPeople = Array.isArray(rec.otherPeople)
    ? rec.otherPeople.map(parsePerson).filter((p): p is LeadContactPerson => p !== null)
    : [];

  const outreach: LeadOutreach = {
    phone: str(rec.phone) ?? null,
    phoneOwner: str(rec.phoneOwner) ?? null,
    emails,
    shouldCall: str(rec.shouldCall)?.toUpperCase() ?? null,
    callPriority: str(rec.priority)?.toUpperCase() ?? null,
    tier: str(rec.tier) ?? null,
    confidence: str(rec.confidence)?.toUpperCase() ?? null,
    pitchAngle: str(rec.pitchAngle) ?? null,
    callNote: str(rec.callNote) ?? null,
    askFor: str(rec.askFor) ?? null,
    decisionMaker: parsePerson(rec.decisionMaker),
    otherPeople,
    legalForm: str(rec.legalForm) ?? null,
  };
  const hasOutreach = Object.values(outreach).some((v) =>
    Array.isArray(v) ? v.length > 0 : v !== null
  );

  return {
    category: str(rec.category),
    niche: str(rec.niche),
    rating: num(rec.rating),
    branchCount: num(rec.branchCount),
    websiteScore: num(rec.websiteScore),
    websiteIssue: str(rec.websiteIssue),
    outreach: hasOutreach ? outreach : undefined,
  };
}
