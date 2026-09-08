export type RawSeoStatus = "GOOD" | "NEEDS_IMPROVEMENT" | "POOR";

export interface RawLead {
  name: string;
  mapsUrl: string;
  websiteUrl: string;
  seoScore: number;
  seoStatus: RawSeoStatus;
  issues: string[];
  city: string;
}

export type IssueSeverity = "critical" | "important" | "optimization" | "crawl";

export interface ParsedIssue {
  text: string;
  severity: IssueSeverity;
}

/** Display status. Crawl-failed leads are pulled out of POOR into their own bucket. */
export type LeadStatus = "POOR" | "NEEDS_IMPROVEMENT" | "GOOD" | "CRAWL_FAILED";

export type LeadPriority = "High" | "Medium" | "Low" | "Manual Review";

export interface Lead {
  id: string;
  name: string;
  mapsUrl: string;
  websiteUrl: string;
  seoScore: number;
  status: LeadStatus;
  city: string;
  issues: ParsedIssue[];
  issueCount: number;
  priority: LeadPriority;
  crawlFailed: boolean;
  responseMs: number | null;
  searchText: string;
}
