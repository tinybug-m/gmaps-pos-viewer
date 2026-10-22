export type RawSeoStatus = "GOOD" | "NEEDS_IMPROVEMENT" | "POOR";

export type LeadSource = "google-maps" | "trustpilot";

export interface RawLead {
  name: string;
  mapsUrl: string;
  city: string;
  /** `null` (or omitted) means the business has no website to crawl. */
  websiteUrl: string | null;
  /** Only meaningful when `websiteUrl` is set — a crawled site always has these. */
  seoScore?: number;
  seoStatus?: RawSeoStatus;
  issues?: string[];
  /** Google Business Profile review count, when the source data includes it. */
  reviewCount?: number;
  /** Explicit origin of the lead. When omitted it is inferred: a `trustpilotUrl` means Trustpilot, otherwise Google Maps. */
  source?: LeadSource;
  trustpilotUrl?: string;
  /** Business profile and outreach fields from the enriched "call sheet" export. All optional. */
  category?: string;
  niche?: string;
  rating?: number;
  branchCount?: number;
  websiteScore?: number;
  websiteIssue?: string;
  outreach?: LeadOutreach;
}

export interface LeadContactPerson {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

/** Who to call and what to say, from the enriched export. Free-text values are passed through as-is. */
export interface LeadOutreach {
  phone: string | null;
  phoneOwner: string | null;
  emails: string[];
  /** e.g. "YES" / "NO". */
  shouldCall: string | null;
  /** Call-list grade, e.g. "A" / "B" / "C". */
  callPriority: string | null;
  tier: string | null;
  confidence: string | null;
  pitchAngle: string | null;
  callNote: string | null;
  askFor: string | null;
  decisionMaker: LeadContactPerson | null;
  otherPeople: LeadContactPerson[];
  legalForm: string | null;
}

export type IssueSeverity = "critical" | "important" | "optimization" | "crawl";

export interface ParsedIssue {
  text: string;
  severity: IssueSeverity;
}

/**
 * Display status. Crawl-failed leads are pulled out of POOR into their own
 * bucket, and businesses with no website at all get their own bucket too —
 * that's a "build" pitch, not a "fix" pitch, and arguably the strongest lead.
 */
export type LeadStatus = "POOR" | "NEEDS_IMPROVEMENT" | "GOOD" | "CRAWL_FAILED" | "NO_WEBSITE";

export type LeadPriority = "High" | "Medium" | "Low" | "Manual Review";

export interface Lead {
  id: string;
  name: string;
  mapsUrl: string;
  websiteUrl: string | null;
  seoScore: number | null;
  status: LeadStatus;
  city: string;
  issues: ParsedIssue[];
  issueCount: number;
  priority: LeadPriority;
  crawlFailed: boolean;
  responseMs: number | null;
  reviewCount: number | null;
  source: LeadSource;
  trustpilotUrl: string | null;
  category: string | null;
  niche: string | null;
  rating: number | null;
  branchCount: number | null;
  websiteScore: number | null;
  websiteIssue: string | null;
  outreach: LeadOutreach | null;
  searchText: string;
}
