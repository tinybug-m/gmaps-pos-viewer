import type { Lead, LeadPriority } from "@/types/lead";

export type SortKey =
  | "score"
  | "name"
  | "city"
  | "status"
  | "responseMs"
  | "issueCount"
  | "priority";

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortState = { key: "score", direction: "asc" };

const PRIORITY_RANK: Record<LeadPriority, number> = {
  High: 0,
  Medium: 1,
  Low: 2,
  "Manual Review": 3,
};

function compareValues(a: Lead, b: Lead, key: SortKey): number {
  switch (key) {
    case "score":
      return a.seoScore - b.seoScore;
    case "name":
      return a.name.localeCompare(b.name);
    case "city":
      return a.city.localeCompare(b.city);
    case "status":
      return a.status.localeCompare(b.status);
    case "responseMs":
      return (a.responseMs ?? -1) - (b.responseMs ?? -1);
    case "issueCount":
      return a.issueCount - b.issueCount;
    case "priority":
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  }
}

export function sortLeads(leads: Lead[], sort: SortState): Lead[] {
  const sorted = [...leads].sort((a, b) => compareValues(a, b, sort.key));
  return sort.direction === "asc" ? sorted : sorted.reverse();
}

// Direction a column starts in the first time it's clicked, chosen so the
// "worst" prospects surface first rather than always defaulting to A→Z.
const INITIAL_DIRECTION: Record<SortKey, SortDirection> = {
  score: "asc",
  issueCount: "desc",
  responseMs: "desc",
  priority: "asc",
  name: "asc",
  city: "asc",
  status: "asc",
};

export function nextSortState(current: SortState, key: SortKey): SortState {
  if (current.key !== key) {
    return { key, direction: INITIAL_DIRECTION[key] };
  }
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}
