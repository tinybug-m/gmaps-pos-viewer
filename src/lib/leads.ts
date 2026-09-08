import { getRawLeads } from "@/data/source";
import { extractResponseMs, issueTemplateLabel, parseIssue } from "@/lib/issues";
import type {
  Lead,
  LeadPriority,
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
  return raw.seoStatus;
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

function buildLead(raw: RawLead, index: number): Lead {
  const parsed = raw.issues.map(parseIssue).filter((i): i is ParsedIssue => i !== null);
  const crawlFailed = parsed.some((i) => i.severity === "crawl");

  const nonCrawlIssues = parsed.filter((i) => i.severity !== "crawl");
  const responseMs = raw.issues.reduce<number | null>((best, text) => {
    const ms = extractResponseMs(text);
    if (ms === null) return best;
    return best === null ? ms : Math.max(best, ms);
  }, null);

  const status = computeStatus(raw, crawlFailed);
  const priority = computePriority(nonCrawlIssues, crawlFailed);

  const searchText = [raw.name, raw.city, raw.websiteUrl, ...raw.issues]
    .join(" ")
    .toLowerCase();

  return {
    id: slugify(raw.name, index),
    name: raw.name,
    mapsUrl: raw.mapsUrl,
    websiteUrl: raw.websiteUrl,
    seoScore: raw.seoScore,
    status,
    city: raw.city,
    issues: parsed,
    issueCount: nonCrawlIssues.length,
    priority,
    crawlFailed,
    responseMs,
    searchText,
  };
}

let cachedLeads: Lead[] | null = null;

export function getLeads(): Lead[] {
  if (!cachedLeads) {
    cachedLeads = getRawLeads().map(buildLead);
  }
  return cachedLeads;
}

export interface SummaryCounts {
  total: number;
  prospects: number;
  poor: number;
  needsImprovement: number;
  good: number;
  crawlFailed: number;
}

export function getSummaryCounts(leads: Lead[]): SummaryCounts {
  const poor = leads.filter((l) => l.status === "POOR").length;
  const needsImprovement = leads.filter((l) => l.status === "NEEDS_IMPROVEMENT").length;
  const good = leads.filter((l) => l.status === "GOOD").length;
  const crawlFailed = leads.filter((l) => l.status === "CRAWL_FAILED").length;

  return {
    total: leads.length,
    prospects: poor + needsImprovement,
    poor,
    needsImprovement,
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
    for (const issue of lead.issues) {
      if (issue.severity === "crawl") continue;
      templates.add(issueTemplateLabel(issue.text));
    }
  }
  return Array.from(templates).sort();
}
