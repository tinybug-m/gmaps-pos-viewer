export type RawSeoStatus = "GOOD" | "NEEDS_IMPROVEMENT" | "POOR";

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
  searchText: string;
}
