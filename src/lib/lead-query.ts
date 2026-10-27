import { applyFilters, defaultFilters, isDefaultFilters, SCORE_BANDS, type LeadFilters, type ScoreBand } from "@/lib/filters";
import type { SummaryCounts } from "@/lib/leads";
import { DEFAULT_SORT, INITIAL_DIRECTION, sortLeads, type SortDirection, type SortKey } from "@/lib/sort";
import type { FollowUpBucket } from "@/lib/time";
import { PIPELINE_STATUSES, type PipelineStatus } from "@/lib/workflow";
import type { Lead, LeadAssignee, LeadSource, LeadStatus, LeadWorkflow, TeamLead } from "@/types/lead";

/**
 * The leads list's filters, sort and page, and how they map to the URL. The
 * URL is the source of truth, so a view survives a refresh and can be
 * bookmarked; the server reads the same params to build the page. Every
 * value is checked against what it may be, so a hand-edited URL can only
 * select a valid view, never an error or something outside the viewer's scope.
 */

export const PAGE_SIZE = 50;

export type WorkflowSortKey = "pipeline" | "assignee" | "followUp" | "lastCall";
export type LeadSortKey = SortKey | WorkflowSortKey;

export interface LeadSort {
  key: LeadSortKey;
  direction: SortDirection;
}

export interface LeadQuery {
  filters: LeadFilters;
  pipeline: Set<PipelineStatus>;
  /** "unassigned", "me" or a user id; null for everyone's. Ignored for callers, who only see their own. */
  assignee: string | null;
  due: FollowUpBucket | null;
  /** Archived leads instead of live ones. Admin only; ignored for everyone else. */
  archived: boolean;
  sort: LeadSort;
  page: number;
}

export function defaultLeadQuery(): LeadQuery {
  return {
    filters: defaultFilters(),
    pipeline: new Set(),
    assignee: null,
    due: null,
    archived: false,
    sort: DEFAULT_SORT,
    page: 1,
  };
}

/** Whether any filter is narrowing the view. Sort and page don't count. */
export function isDefaultLeadQuery(query: LeadQuery): boolean {
  return (
    isDefaultFilters(query.filters) &&
    query.pipeline.size === 0 &&
    query.assignee === null &&
    query.due === null &&
    !query.archived
  );
}

const LEAD_STATUSES: readonly LeadStatus[] = ["POOR", "NEEDS_IMPROVEMENT", "NO_WEBSITE", "GOOD", "CRAWL_FAILED"];
const SOURCES: readonly LeadSource[] = ["google-maps", "trustpilot"];
const BANDS: readonly ScoreBand[] = SCORE_BANDS.map((b) => b.key);
export const DUE_BUCKETS: readonly FollowUpBucket[] = ["overdue", "today", "upcoming"];
const WORKFLOW_SORT_KEYS: readonly WorkflowSortKey[] = ["pipeline", "assignee", "followUp", "lastCall"];
const SORT_KEYS: readonly LeadSortKey[] = [...(Object.keys(INITIAL_DIRECTION) as SortKey[]), ...WORKFLOW_SORT_KEYS];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Caps on what a URL can ask for, so a crafted link can't make the server do unbounded work. */
const MAX_VALUES = 50;
const MAX_TEXT = 200;

const WORKFLOW_INITIAL_DIRECTION: Record<WorkflowSortKey, SortDirection> = {
  pipeline: "asc",
  assignee: "asc",
  followUp: "asc",
  lastCall: "desc",
};

function isWorkflowKey(key: LeadSortKey): key is WorkflowSortKey {
  return (WORKFLOW_SORT_KEYS as readonly string[]).includes(key);
}

function initialDirection(key: LeadSortKey): SortDirection {
  return isWorkflowKey(key) ? WORKFLOW_INITIAL_DIRECTION[key] : INITIAL_DIRECTION[key];
}

/** Clicking a column: a new column starts in its natural direction, the same column flips. */
export function nextLeadSort(current: LeadSort, key: LeadSortKey): LeadSort {
  if (current.key !== key) return { key, direction: initialDirection(key) };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

/** What `URLSearchParams` and Next's `ReadonlyURLSearchParams` both offer. */
export interface ParamReader {
  get(name: string): string | null;
  getAll(name: string): string[];
}

/** A page's `searchParams` prop as URLSearchParams. */
export function toSearchParams(record: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  }
  return params;
}

function oneOf<T extends string>(allowed: readonly T[], value: string | null): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function values(params: ParamReader, name: string): string[] {
  return params
    .getAll(name)
    .slice(0, MAX_VALUES)
    .map((v) => v.trim())
    .filter((v) => v !== "" && v.length <= MAX_TEXT);
}

function setOf<T extends string>(params: ParamReader, name: string, allowed?: readonly T[]): Set<T> {
  const list = values(params, name);
  return new Set((allowed ? list.filter((v) => (allowed as readonly string[]).includes(v)) : list) as T[]);
}

export function parseLeadQuery(params: ParamReader): LeadQuery {
  const defaults = defaultLeadQuery();

  // No `status` is the default prospects view; `status=all` turns the filter off.
  const statusParam = values(params, "status");
  let statuses = statusParam.includes("all") ? new Set<LeadStatus>() : setOf(params, "status", LEAD_STATUSES);
  if (!statusParam.includes("all") && statuses.size === 0) statuses = defaults.filters.statuses;

  const assigneeParam = params.get("assignee")?.trim().toLowerCase() ?? "";
  const assignee =
    assigneeParam === "unassigned" || assigneeParam === "me" || UUID.test(assigneeParam) ? assigneeParam : null;

  const sortKey = oneOf(SORT_KEYS, params.get("sort"));
  const direction = oneOf(["asc", "desc"] as const, params.get("dir"));
  const page = Number(params.get("page") ?? "1");

  return {
    filters: {
      statuses,
      scoreBands: setOf(params, "band", BANDS),
      cities: setOf(params, "city"),
      sources: setOf(params, "source", SOURCES),
      issueTemplates: setOf(params, "issue"),
      niches: setOf(params, "niche"),
      callReadyOnly: params.get("ready") === "1",
      search: (params.get("q") ?? "").slice(0, MAX_TEXT),
    },
    pipeline: setOf(params, "pipeline", PIPELINE_STATUSES),
    assignee,
    due: oneOf(DUE_BUCKETS, params.get("due")),
    archived: params.get("archived") === "1",
    sort: sortKey ? { key: sortKey, direction: direction ?? initialDirection(sortKey) } : defaults.sort,
    page: Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1,
  };
}

function inOrder<T extends string>(set: Set<T>, order?: readonly T[]): T[] {
  return order ? order.filter((v) => set.has(v)) : [...set].sort();
}

/** The URL params for a query, leaving out anything at its default so links stay short. */
export function serializeLeadQuery(query: LeadQuery): URLSearchParams {
  const params = new URLSearchParams();
  const f = query.filters;
  const append = (name: string, list: string[]) => list.forEach((v) => params.append(name, v));

  if (f.search.trim()) params.set("q", f.search.trim());
  const defaultStatuses = defaultFilters().statuses;
  if (f.statuses.size === 0) params.set("status", "all");
  else if (f.statuses.size !== defaultStatuses.size || [...f.statuses].some((s) => !defaultStatuses.has(s))) {
    append("status", inOrder(f.statuses, LEAD_STATUSES));
  }
  append("band", inOrder(f.scoreBands, BANDS));
  append("source", inOrder(f.sources, SOURCES));
  append("city", inOrder(f.cities));
  append("niche", inOrder(f.niches));
  append("issue", inOrder(f.issueTemplates));
  if (f.callReadyOnly) params.set("ready", "1");
  append("pipeline", inOrder(query.pipeline, PIPELINE_STATUSES));
  if (query.assignee) params.set("assignee", query.assignee);
  if (query.due) params.set("due", query.due);
  if (query.archived) params.set("archived", "1");
  if (query.sort.key !== DEFAULT_SORT.key || query.sort.direction !== DEFAULT_SORT.direction) {
    params.set("sort", query.sort.key);
    params.set("dir", query.sort.direction);
  }
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}

/** The workflow half of a query; `applyFilters` is the SEO half. */
export function matchesWorkflow(workflow: LeadWorkflow, query: LeadQuery, viewerId: string): boolean {
  if (query.pipeline.size > 0 && !query.pipeline.has(workflow.pipelineStatus)) return false;
  const assigneeId = workflow.assignee?.id ?? null;
  if (query.assignee === "unassigned" && assigneeId !== null) return false;
  if (query.assignee === "me" && assigneeId !== viewerId) return false;
  if (query.assignee && query.assignee !== "unassigned" && query.assignee !== "me" && assigneeId !== query.assignee) {
    return false;
  }
  if (query.due && workflow.followUp?.bucket !== query.due) return false;
  return true;
}

const PIPELINE_RANK = Object.fromEntries(PIPELINE_STATUSES.map((s, i) => [s, i])) as Record<PipelineStatus, number>;

function workflowValue(lead: TeamLead, key: WorkflowSortKey): number | string | null {
  const w = lead.workflow;
  switch (key) {
    case "pipeline":
      return PIPELINE_RANK[w.pipelineStatus];
    case "assignee":
      return w.assignee?.name ?? null;
    case "followUp":
      return w.followUp?.dueAt.getTime() ?? null;
    case "lastCall":
      return w.lastCallAt?.getTime() ?? null;
  }
}

/** SEO columns sort as before. Workflow columns put empty values last in both directions, then go by name. */
export function sortTeamLeads<T extends TeamLead>(leads: T[], sort: LeadSort): T[] {
  const { key, direction } = sort;
  if (!isWorkflowKey(key)) return sortLeads(leads, { key, direction });
  const dir = direction === "asc" ? 1 : -1;
  return [...leads].sort((a, b) => {
    const x = workflowValue(a, key);
    const y = workflowValue(b, key);
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
    } else if (x !== y) {
      return (typeof x === "string" ? x.localeCompare(y as string) : x - (y as number)) * dir;
    }
    return a.name.localeCompare(b.name);
  });
}

export interface LeadPage<T> {
  rows: T[];
  /** Leads matching the query, across all pages. */
  matching: number;
  page: number;
  pageCount: number;
}

/** Filters, sorts and pages leads that carry their search text. */
export function selectLeads<T extends Lead & { workflow: LeadWorkflow }>(
  leads: T[],
  query: LeadQuery,
  viewerId: string,
): LeadPage<T> {
  const matching = applyFilters(leads, query.filters).filter((l) => matchesWorkflow(l.workflow, query, viewerId));
  const sorted = sortTeamLeads(matching, query.sort);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  return { rows: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), matching: sorted.length, page, pageCount };
}

export interface LeadListOptions {
  cities: string[];
  issueOptions: string[];
  niches: string[];
  showOutreach: boolean;
  /** Everyone who currently has a lead in scope, for the assignee filter. Empty for callers. */
  assignees: LeadAssignee[];
}

export interface LeadList {
  rows: TeamLead[];
  /** Leads in the viewer's scope (live or archived, as asked), before filters. */
  total: number;
  /** Of those, the ones matching the query. */
  matching: number;
  page: number;
  pageCount: number;
  counts: SummaryCounts;
  options: LeadListOptions;
}
