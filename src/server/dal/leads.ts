import "server-only";
import { and, eq, isNotNull, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { selectLeads, type LeadList, type LeadQuery } from "@/lib/lead-query";
import {
  buildLead,
  getCities,
  getIssueOptions,
  getNiches,
  getSummaryCounts,
  hasOutreachData,
} from "@/lib/leads";
import { can, type Viewer } from "@/lib/permissions";
import { followUpBucket } from "@/lib/time";
import type { Lead, LeadAssignee, LeadWorkflow, TeamLead } from "@/types/lead";
import type { DbOrTx } from "../db/client";
import { followUps, leads, users } from "../db/schema";

type ScopedLead = Lead & { workflow: LeadWorkflow };

/**
 * Which leads a viewer can see, as a SQL condition. Callers only ever get
 * live leads assigned to them; the filter is in the query itself, so a
 * caller's request can't return anyone else's leads whatever it asks for.
 * Archived leads are an admin-only view.
 */
function scope(viewer: Viewer, archived: boolean): SQL | undefined {
  if (!can(viewer, "leads.viewAll")) return and(eq(leads.assignedTo, viewer.id), isNull(leads.archivedAt));
  return archived && can(viewer, "leads.archive") ? isNotNull(leads.archivedAt) : isNull(leads.archivedAt);
}

const openFollowUp = and(eq(followUps.leadId, leads.id), isNull(followUps.completedAt), isNull(followUps.cancelledAt));

async function loadLeads(db: DbOrTx, where: SQL | undefined, now: Date): Promise<ScopedLead[]> {
  const rows = await db
    .select({
      id: leads.id,
      raw: leads.raw,
      pipelineStatus: leads.pipelineStatus,
      assigneeId: users.id,
      assigneeName: users.name,
      assigneeActive: users.isActive,
      attemptCount: leads.attemptCount,
      lastOutcome: leads.lastOutcome,
      lastCallAt: leads.lastCallAt,
      followUpDueAt: followUps.dueAt,
      reviewRequestedAt: leads.reviewRequestedAt,
      archivedAt: leads.archivedAt,
      version: leads.version,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.assignedTo))
    .leftJoin(followUps, openFollowUp)
    .where(where);

  return rows.map((r) => ({
    ...buildLead(r.raw, r.id),
    workflow: {
      pipelineStatus: r.pipelineStatus,
      assignee: r.assigneeId ? { id: r.assigneeId, name: r.assigneeName ?? "", isActive: r.assigneeActive ?? false } : null,
      attemptCount: r.attemptCount,
      lastOutcome: r.lastOutcome,
      lastCallAt: r.lastCallAt,
      followUp: r.followUpDueAt ? { dueAt: r.followUpDueAt, bucket: followUpBucket(r.followUpDueAt, now) } : null,
      reviewRequested: r.reviewRequestedAt !== null,
      archived: r.archivedAt !== null,
      version: r.version,
    },
  }));
}

/** Drops the search index, which only the server's filtering needs, so it isn't sent to the browser. */
function toTeamLead(lead: ScopedLead): TeamLead {
  const out: Omit<ScopedLead, "searchText"> & { searchText?: string } = { ...lead };
  delete out.searchText;
  return out;
}

/**
 * The query with the parts this viewer can't use dropped: callers' lists are
 * already only their own live leads, and only admins see archived leads.
 * Pages pass this back to the view so it never shows a filter that isn't applied.
 */
export function queryForViewer(viewer: Viewer, query: LeadQuery): LeadQuery {
  return {
    ...query,
    assignee: can(viewer, "leads.viewAll") ? query.assignee : null,
    archived: query.archived && can(viewer, "leads.archive"),
  };
}

/**
 * One page of the leads list for this viewer. Filter options and summary
 * counts cover the viewer's whole scope, so the filter bar doesn't change as
 * filters narrow the list.
 *
 * Leads are filtered in memory with the same code the viewer always used,
 * which keeps search behaviour identical. That's comfortable to several
 * thousand leads; past that the filters belong in SQL.
 */
export async function listLeadsForViewer(db: DbOrTx, viewer: Viewer, query: LeadQuery, now = new Date()): Promise<LeadList> {
  const viewAll = can(viewer, "leads.viewAll");
  const effective = queryForViewer(viewer, query);
  const all = await loadLeads(db, scope(viewer, effective.archived), now);
  const page = selectLeads(all, effective, viewer.id);

  const assignees = new Map<string, LeadAssignee>();
  if (viewAll) for (const l of all) if (l.workflow.assignee) assignees.set(l.workflow.assignee.id, l.workflow.assignee);

  return {
    rows: page.rows.map(toTeamLead),
    total: all.length,
    matching: page.matching,
    page: page.page,
    pageCount: page.pageCount,
    counts: getSummaryCounts(all),
    options: {
      cities: getCities(all),
      issueOptions: getIssueOptions(all),
      niches: getNiches(all),
      showOutreach: hasOutreachData(all),
      assignees: [...assignees.values()].sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

/**
 * A single lead, if this viewer may see it; otherwise null, whether it
 * doesn't exist or belongs to someone else, so ids can't be probed.
 */
export async function getLeadForViewer(db: DbOrTx, viewer: Viewer, id: unknown, now = new Date()): Promise<TeamLead | null> {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return null;
  const viewAll = can(viewer, "leads.viewAll");
  const where = viewAll
    ? can(viewer, "leads.archive")
      ? eq(leads.id, parsed.data)
      : and(eq(leads.id, parsed.data), isNull(leads.archivedAt))
    : and(eq(leads.id, parsed.data), scope(viewer, false));
  const [lead] = await loadLeads(db, where, now);
  return lead ? toTeamLead(lead) : null;
}
