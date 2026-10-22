import { issueTemplateLabel } from "@/lib/issues";
import type { Lead, LeadSource, LeadStatus } from "@/types/lead";

export type ScoreBand = "0-30" | "31-50" | "51-70" | "71-89" | "90-100";

export const SCORE_BANDS: { key: ScoreBand; label: string; min: number; max: number }[] = [
  { key: "0-30", label: "0–30", min: 0, max: 30 },
  { key: "31-50", label: "31–50", min: 31, max: 50 },
  { key: "51-70", label: "51–70", min: 51, max: 70 },
  { key: "71-89", label: "71–89", min: 71, max: 89 },
  { key: "90-100", label: "90–100", min: 90, max: 100 },
];

export interface LeadFilters {
  statuses: Set<LeadStatus>;
  scoreBands: Set<ScoreBand>;
  cities: Set<string>;
  sources: Set<LeadSource>;
  issueTemplates: Set<string>;
  niches: Set<string>;
  /** Only leads the enriched export marked `shouldCall: "YES"`. */
  callReadyOnly: boolean;
  search: string;
}

export function defaultFilters(): LeadFilters {
  return {
    statuses: new Set<LeadStatus>(["POOR", "NEEDS_IMPROVEMENT", "NO_WEBSITE"]),
    scoreBands: new Set(),
    cities: new Set(),
    sources: new Set(),
    issueTemplates: new Set(),
    niches: new Set(),
    callReadyOnly: false,
    search: "",
  };
}

export function isDefaultFilters(filters: LeadFilters): boolean {
  const defaults = defaultFilters();
  return (
    setsEqual(filters.statuses, defaults.statuses) &&
    filters.scoreBands.size === 0 &&
    filters.cities.size === 0 &&
    filters.sources.size === 0 &&
    filters.issueTemplates.size === 0 &&
    filters.niches.size === 0 &&
    !filters.callReadyOnly &&
    filters.search.trim() === ""
  );
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function matchesScoreBand(score: number | null, bands: Set<ScoreBand>): boolean {
  if (bands.size === 0) return true;
  // A score-band filter is specifically about crawled sites, so a lead with
  // no score (no website) can't match one — it's excluded, not defaulted in.
  if (score === null) return false;
  return SCORE_BANDS.some((b) => bands.has(b.key) && score >= b.min && score <= b.max);
}

export function applyFilters(leads: Lead[], filters: LeadFilters): Lead[] {
  const search = filters.search.trim().toLowerCase();

  return leads.filter((lead) => {
    if (filters.statuses.size > 0 && !filters.statuses.has(lead.status)) return false;
    if (!matchesScoreBand(lead.seoScore, filters.scoreBands)) return false;
    if (filters.cities.size > 0 && !filters.cities.has(lead.city)) return false;
    if (filters.sources.size > 0 && !filters.sources.has(lead.source)) return false;
    if (filters.niches.size > 0 && (lead.niche === null || !filters.niches.has(lead.niche))) return false;
    if (filters.callReadyOnly && lead.outreach?.shouldCall !== "YES") return false;

    if (filters.issueTemplates.size > 0) {
      const templates = lead.issues.map((i) => issueTemplateLabel(i.text));
      const hasMatch = templates.some((t) => filters.issueTemplates.has(t));
      if (!hasMatch) return false;
    }

    if (search && !lead.searchText.includes(search)) return false;

    return true;
  });
}
