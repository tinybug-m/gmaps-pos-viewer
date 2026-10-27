import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { can, type Viewer } from "@/lib/permissions";
import { rangeBounds, type RangeKey } from "@/lib/time";
import type { PipelineStatus, Role } from "@/lib/workflow";
import type { DbOrTx } from "../db/client";

/*
 * Dashboard numbers. Definitions (kept in step with the dashboard's
 * footnotes):
 *
 * - Calls: call logs made in the range that haven't been voided, credited
 *   to whoever made the call. Reassigning a lead never moves this credit.
 * - Leads contacted: distinct leads with at least one such call. Calling the
 *   same lead five times is five calls but one lead contacted. The team
 *   figure is distinct across the whole team, so it can be less than the
 *   sum of the per-person figures when two people called the same lead.
 * - Connects: calls whose outcome reached someone (anything but no answer,
 *   busy or voicemail).
 * - Interested / Won: distinct leads moved to that status in the range,
 *   credited to whoever moved them. A move recorded by a call that was later
 *   voided doesn't count.
 * - Open leads / Not called yet: live (not archived, not closed) leads
 *   currently assigned, and those of them with no call ever logged. These
 *   are "now", not range figures.
 * - Overdue: open follow-ups past their due time on live leads, owned by
 *   whoever the lead is assigned to now.
 */

export interface PersonMetrics {
  id: string;
  name: string;
  role: Role;
  isActive: boolean;
  calls: number;
  leadsContacted: number;
  connects: number;
  interested: number;
  won: number;
  openLeads: number;
  untouched: number;
  overdue: number;
  /** Their most recent call or note, at any time. */
  lastActivityAt: Date | null;
}

export interface TeamTotals {
  calls: number;
  leadsContacted: number;
  connects: number;
  interested: number;
  won: number;
  openLeads: number;
  untouched: number;
  overdue: number;
  /** Live, open leads nobody owns. */
  unassigned: number;
  awaitingReview: number;
}

export interface Dashboard {
  range: { key: RangeKey; from: Date; to: Date };
  /** The whole team for admins and supervisors; just the viewer for a caller. */
  scope: "team" | "self";
  totals: TeamTotals;
  people: PersonMetrics[];
}

const TERMINAL = sql`('closed_won', 'closed_lost', 'invalid', 'do_not_call')`;
const NON_CONNECT = sql`('no_answer', 'busy', 'voicemail')`;
const OPEN_FOLLOW_UP = sql`f.completed_at is null and f.cancelled_at is null`;

const n = (v: unknown) => Number(v ?? 0);

async function rows<T>(db: DbOrTx, query: SQL): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

export async function getDashboard(db: DbOrTx, viewer: Viewer, rangeKey: RangeKey, now = new Date()): Promise<Dashboard> {
  const { from, to } = rangeBounds(rangeKey, now);
  const team = can(viewer, "dashboard.team");
  // Callers only ever get their own numbers; the filter is in the SQL.
  const only = (col: SQL) => (team ? sql`true` : sql`${col} = ${viewer.id}`);

  const inRange = (col: SQL) => sql`${col} >= ${from} and ${col} < ${to}`;
  const liveCall = sql`c.voided_at is null and ${inRange(sql`c.called_at`)} and ${only(sql`c.user_id`)}`;
  const creditedChange = sql`${inRange(sql`s.created_at`)} and (s.call_log_id is null or cl.voided_at is null) and ${only(sql`s.changed_by`)}`;
  const openLead = sql`l.archived_at is null and l.pipeline_status not in ${TERMINAL}`;

  const [people, [totals]] = await Promise.all([
    rows<Record<string, unknown>>(
      db,
      sql`
        with calls as (
          select c.user_id as uid, count(*) as calls, count(distinct c.lead_id) as leads,
                 count(*) filter (where c.outcome not in ${NON_CONNECT}) as connects
          from call_logs c where ${liveCall} group by c.user_id
        ), moves as (
          select s.changed_by as uid,
                 count(distinct s.lead_id) filter (where s.to_status = 'interested') as interested,
                 count(distinct s.lead_id) filter (where s.to_status = 'closed_won') as won
          from lead_status_changes s left join call_logs cl on cl.id = s.call_log_id
          where ${creditedChange} group by s.changed_by
        ), owned as (
          select l.assigned_to as uid, count(*) as open_leads, count(*) filter (where l.attempt_count = 0) as untouched
          from leads l where ${openLead} and l.assigned_to is not null group by l.assigned_to
        ), overdue as (
          select l.assigned_to as uid, count(*) as overdue
          from follow_ups f join leads l on l.id = f.lead_id
          where ${OPEN_FOLLOW_UP} and f.due_at < ${now} and l.archived_at is null and l.assigned_to is not null
          group by l.assigned_to
        ), last_call as (
          select c.user_id as uid, max(c.called_at) as at from call_logs c where c.voided_at is null group by c.user_id
        ), last_note as (
          select nt.author_id as uid, max(nt.created_at) as at from lead_notes nt where nt.voided_at is null group by nt.author_id
        )
        select u.id, u.name, u.role, u.is_active,
               calls.calls, calls.leads, calls.connects, moves.interested, moves.won,
               owned.open_leads, owned.untouched, overdue.overdue,
               greatest(last_call.at, last_note.at) as last_activity
        from users u
        left join calls on calls.uid = u.id
        left join moves on moves.uid = u.id
        left join owned on owned.uid = u.id
        left join overdue on overdue.uid = u.id
        left join last_call on last_call.uid = u.id
        left join last_note on last_note.uid = u.id
        where ${only(sql`u.id`)}
          and (u.role <> 'supervisor' or calls.calls is not null or moves.uid is not null)
        order by u.is_active desc, u.name asc`,
    ),
    rows<Record<string, unknown>>(
      db,
      sql`
        select
          (select count(*) from call_logs c where ${liveCall}) as calls,
          (select count(distinct c.lead_id) from call_logs c where ${liveCall}) as leads,
          (select count(*) from call_logs c where ${liveCall} and c.outcome not in ${NON_CONNECT}) as connects,
          (select count(distinct s.lead_id) from lead_status_changes s left join call_logs cl on cl.id = s.call_log_id
             where ${creditedChange} and s.to_status = 'interested') as interested,
          (select count(distinct s.lead_id) from lead_status_changes s left join call_logs cl on cl.id = s.call_log_id
             where ${creditedChange} and s.to_status = 'closed_won') as won,
          (select count(*) from leads l where ${openLead} and l.assigned_to is not null and ${only(sql`l.assigned_to`)}) as open_leads,
          (select count(*) from leads l where ${openLead} and l.assigned_to is not null and l.attempt_count = 0
             and ${only(sql`l.assigned_to`)}) as untouched,
          (select count(*) from follow_ups f join leads l on l.id = f.lead_id
             where ${OPEN_FOLLOW_UP} and f.due_at < ${now} and l.archived_at is null and ${only(sql`l.assigned_to`)}) as overdue,
          (select count(*) from leads l where ${openLead} and l.assigned_to is null and ${team ? sql`true` : sql`false`}) as unassigned,
          (select count(*) from leads l where l.archived_at is null and l.review_requested_at is not null
             and ${team ? sql`true` : sql`false`}) as review`,
    ),
  ]);

  return {
    range: { key: rangeKey, from, to },
    scope: team ? "team" : "self",
    totals: {
      calls: n(totals.calls),
      leadsContacted: n(totals.leads),
      connects: n(totals.connects),
      interested: n(totals.interested),
      won: n(totals.won),
      openLeads: n(totals.open_leads),
      untouched: n(totals.untouched),
      overdue: n(totals.overdue),
      unassigned: n(totals.unassigned),
      awaitingReview: n(totals.review),
    },
    people: people.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      role: r.role as Role,
      isActive: r.is_active as boolean,
      calls: n(r.calls),
      leadsContacted: n(r.leads),
      connects: n(r.connects),
      interested: n(r.interested),
      won: n(r.won),
      openLeads: n(r.open_leads),
      untouched: n(r.untouched),
      overdue: n(r.overdue),
      lastActivityAt: r.last_activity ? new Date(r.last_activity as string) : null,
    })),
  };
}

export interface ReviewItem {
  leadId: string;
  name: string;
  city: string;
  status: PipelineStatus;
  assignee: { id: string; name: string } | null;
  requestedAt: Date;
}

/** Leads waiting for a supervisor's feedback, oldest first. Null for viewers who don't review. */
export async function listReviewQueue(db: DbOrTx, viewer: Viewer, limit = 50): Promise<ReviewItem[] | null> {
  if (!can(viewer, "lead.addFeedback")) return null;
  const result = await rows<Record<string, unknown>>(
    db,
    sql`select l.id, l.name, l.city, l.pipeline_status, l.review_requested_at, u.id as uid, u.name as uname
        from leads l left join users u on u.id = l.assigned_to
        where l.archived_at is null and l.review_requested_at is not null
        order by l.review_requested_at asc limit ${limit}`,
  );
  return result.map((r) => ({
    leadId: r.id as string,
    name: r.name as string,
    city: r.city as string,
    status: r.pipeline_status as PipelineStatus,
    assignee: r.uid ? { id: r.uid as string, name: r.uname as string } : null,
    requestedAt: new Date(r.review_requested_at as string),
  }));
}

export interface OverdueItem {
  followUpId: string;
  leadId: string;
  name: string;
  dueAt: Date;
  assignee: { id: string; name: string } | null;
}

/** Overdue follow-ups, most overdue first: the whole team's for staff, a caller's own otherwise. */
export async function listOverdueFollowUps(db: DbOrTx, viewer: Viewer, now = new Date(), limit = 50): Promise<OverdueItem[]> {
  const mine = can(viewer, "dashboard.team") ? sql`true` : sql`l.assigned_to = ${viewer.id}`;
  const result = await rows<Record<string, unknown>>(
    db,
    sql`select f.id, f.due_at, l.id as lead_id, l.name, u.id as uid, u.name as uname
        from follow_ups f join leads l on l.id = f.lead_id left join users u on u.id = l.assigned_to
        where ${OPEN_FOLLOW_UP} and f.due_at < ${now} and l.archived_at is null and ${mine}
        order by f.due_at asc limit ${limit}`,
  );
  return result.map((r) => ({
    followUpId: r.id as string,
    leadId: r.lead_id as string,
    name: r.name as string,
    dueAt: new Date(r.due_at as string),
    assignee: r.uid ? { id: r.uid as string, name: r.uname as string } : null,
  }));
}

export interface FeedbackItem {
  noteId: string;
  leadId: string;
  leadName: string;
  body: string;
  author: string;
  at: Date;
  /** False when the lead has since moved to someone else, so the link would 404 for a caller. */
  stillYours: boolean;
}

/** Recent supervisor feedback about the viewer. Only the feedback itself; not other notes on those leads. */
export async function listFeedbackFor(db: DbOrTx, viewer: Viewer, limit = 20): Promise<FeedbackItem[]> {
  const result = await rows<Record<string, unknown>>(
    db,
    sql`select nt.id, nt.body, nt.created_at, l.id as lead_id, l.name as lead_name, l.assigned_to, a.name as author
        from lead_notes nt join leads l on l.id = nt.lead_id join users a on a.id = nt.author_id
        where nt.kind = 'feedback' and nt.voided_at is null and nt.about_user_id = ${viewer.id}
        order by nt.created_at desc limit ${limit}`,
  );
  return result.map((r) => ({
    noteId: r.id as string,
    leadId: r.lead_id as string,
    leadName: r.lead_name as string,
    body: r.body as string,
    author: r.author as string,
    at: new Date(r.created_at as string),
    stillYours: r.assigned_to === viewer.id,
  }));
}
