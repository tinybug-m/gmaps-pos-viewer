import { getRawLeads } from "@/data/source";
import { extractResponseMs, issueTemplateLabel, parseIssue } from "@/lib/issues";
import type {
  Lead,
  LeadPriority,
  LeadSource,
  LeadStatus,
  ParsedIssue,
  RawLead,
} from "@/types/lead";

function slugify(name: string, index: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "lead"}-${index}`;
}

function computeStatus(raw: RawLead, crawlFailed: boolean): LeadStatus {
  if (crawlFailed) return "CRAWL_FAILED";
  // Validation guarantees seoStatus is set whenever a website is present.
  return raw.seoStatus as LeadStatus;
}

function computePriority(issues: ParsedIssue[], crawlFailed: boolean): LeadPriority {
  if (crawlFailed) return "Manual Review";

  const critical = issues.filter((i) => i.severity === "critical").length;
  const important = issues.filter((i) => i.severity === "important").length;

  // Optimization-only issues (e.g. a pile of missing alt attributes) never
  // read as a strong sales signal on their own.
  if (critical === 0 && important === 0) return "Low";

  if (critical >= 2 || (critical >= 1 && important >= 1) || important >= 3) return "High";

  // At least one meaningful (critical or important) signal, but not enough
  // of them stacked up to justify High.
  return "Medium";
}

function computeSource(raw: RawLead): LeadSource {
  if (raw.source) return raw.source;
  return raw.trustpilotUrl ? "trustpilot" : "google-maps";
}

function buildLead(raw: RawLead, index: number): Lead {
  const hasWebsite = typeof raw.websiteUrl === "string" && raw.websiteUrl.trim() !== "";

  // A business with no website at all isn't a crawl result to grade — it's
  // its own lead category, and the strongest one: a "build" pitch rather
  // than a "fix" pitch.
  if (!hasWebsite) {
    const searchText = [raw.name, raw.city, "no website"].join(" ").toLowerCase();
    return {
      id: slugify(raw.name, index),
      name: raw.name,
      mapsUrl: raw.mapsUrl,
      websiteUrl: null,
      seoScore: null,
      status: "NO_WEBSITE",
      city: raw.city,
      issues: [{ text: "No website listed for this business", severity: "critical" }],
      issueCount: 1,
      priority: "High",
      crawlFailed: false,
      responseMs: null,
      reviewCount: raw.reviewCount ?? null,
      source: computeSource(raw),
      trustpilotUrl: raw.trustpilotUrl ?? null,
      searchText,
    };
  }

  const rawIssues = raw.issues ?? [];
  const parsed = rawIssues.map(parseIssue).filter((i): i is ParsedIssue => i !== null);
  const crawlFailed = parsed.some((i) => i.severity === "crawl");

  const nonCrawlIssues = parsed.filter((i) => i.severity !== "crawl");
  const responseMs = rawIssues.reduce<number | null>((best, text) => {
    const ms = extractResponseMs(text);
    if (ms === null) return best;
    return best === null ? ms : Math.max(best, ms);
  }, null);

  const status = computeStatus(raw, crawlFailed);
  const priority = computePriority(nonCrawlIssues, crawlFailed);

  const searchText = [raw.name, raw.city, raw.websiteUrl, ...rawIssues]
    .join(" ")
    .toLowerCase();

  return {
    id: slugify(raw.name, index),
    name: raw.name,
    mapsUrl: raw.mapsUrl,
    websiteUrl: raw.websiteUrl as string,
    seoScore: raw.seoScore ?? 0,
    status,
    city: raw.city,
    issues: parsed,
    issueCount: nonCrawlIssues.length,
    priority,
    crawlFailed,
    responseMs,
    reviewCount: raw.reviewCount ?? null,
    source: computeSource(raw),
    trustpilotUrl: raw.trustpilotUrl ?? null,
    searchText,
  };
}

export function buildLeads(rawLeads: RawLead[]): Lead[] {
  return rawLeads.map(buildLead);
}

let cachedSampleLeads: Lead[] | null = null;

export function getSampleLeads(): Lead[] {
  if (!cachedSampleLeads) {
    cachedSampleLeads = buildLeads(getRawLeads());
  }
  return cachedSampleLeads;
}

export interface SummaryCounts {
  total: number;
  prospects: number;
  poor: number;
  needsImprovement: number;
  noWebsite: number;
  good: number;
  crawlFailed: number;
}

export function getSummaryCounts(leads: Lead[]): SummaryCounts {
  const poor = leads.filter((l) => l.status === "POOR").length;
  const needsImprovement = leads.filter((l) => l.status === "NEEDS_IMPROVEMENT").length;
  const noWebsite = leads.filter((l) => l.status === "NO_WEBSITE").length;
  const good = leads.filter((l) => l.status === "GOOD").length;
  const crawlFailed = leads.filter((l) => l.status === "CRAWL_FAILED").length;

  return {
    total: leads.length,
    prospects: poor + needsImprovement + noWebsite,
    poor,
    needsImprovement,
    noWebsite,
    good,
    crawlFailed,
  };
}

export function getCities(leads: Lead[]): string[] {
  return Array.from(new Set(leads.map((l) => l.city))).sort();
}

export function getIssueOptions(leads: Lead[]): string[] {
  const templates = new Set<string>();
  for (const lead of leads) {
    if (lead.status === "NO_WEBSITE") continue;
    for (const issue of lead.issues) {
      if (issue.severity === "crawl") continue;
      templates.add(issueTemplateLabel(issue.text));
    }
  }
  return Array.from(templates).sort();
}
