import "server-only";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { can, type Capability, type Viewer } from "@/lib/permissions";
import { checkFollowUpDate } from "@/lib/time";
import {
  checkTransition,
  isTerminal,
  needsReview,
  PIPELINE_LABEL,
  requiresFollowUp,
  type CallOutcome,
  type PipelineStatus,
} from "@/lib/workflow";
import type { Db, Tx } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { callLogs, followUps, leadAssignments, leadNotes, leads, leadStatusChanges, users } from "../db/schema";
import { fail, NOT_FOUND, type Failure, type Result } from "../result";
import {
  addNoteInput,
  cancelFollowUpInput,
  changeStatusInput,
  firstIssue,
  logCallInput,
  setFollowUpInput,
  voidEntryInput,
} from "../validation";
import { writeAudit } from "./audit";

/*
 * Everything that happens on one lead: calls, status changes, notes and
 * supervisor feedback, follow-ups, and admin voids. Each mutation locks the
 * lead row and re-checks permission against the lead *as it is now*, so a
 * caller who lost the lead mid-call can't write to it. Calls and status
 * changes also compare the lead's version with the one the form was
 * rendered from, which stops a double submit or a stale tab from logging the
 * same call twice. Notes and follow-ups don't bump the version, so a
 * supervisor's comment never invalidates a caller's open call form.
 */

interface Ctx {
  now?: Date;
  ip?: string | null;
}

const STALE = fail(
  "conflict",
  "This lead changed since you opened it, perhaps in another tab. Your entry wasn't saved; check the latest details and save again.",
);

type LockedLead = typeof leads.$inferSelect;

/** Locks the lead and checks the actor may do `capability` on it. Viewers who can't see it get NOT_FOUND. */
async function lockLead(tx: Tx, actor: Viewer, leadId: string, capability: Capability): Promise<LockedLead | Failure> {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId)).for("update");
  if (!lead || !can(actor, "lead.view", lead)) return NOT_FOUND;
  if (lead.archivedAt) return fail("invalid", "This lead has been archived.");
  if (!can(actor, capability, lead)) return fail("forbidden", "You can't do that on this lead.");
  return lead;
}

const isFailure = (v: object): v is Failure => "ok" in v && v.ok === false;

async function closeOpenFollowUp(
  tx: Tx,
  leadId: string,
  how: { completedBy: string; callId: string } | { cancelledBy: string },
  now: Date,
): Promise<void> {
  await tx
    .update(followUps)
    .set(
      "callId" in how
        ? { completedAt: now, completedBy: how.completedBy, completedByCallId: how.callId }
        : { cancelledAt: now, cancelledBy: how.cancelledBy },
    )
    .where(and(eq(followUps.leadId, leadId), isNull(followUps.completedAt), isNull(followUps.cancelledAt)));
}

function followUpProblem(status: PipelineStatus, dueAt: Date | undefined, now: Date): Failure | null {
  if (dueAt === undefined) return null;
  if (isTerminal(status)) return fail("invalid", `A ${PIPELINE_LABEL[status].toLowerCase()} lead can't have a follow-up.`);
  const message = checkFollowUpDate(dueAt, now);
  return message ? fail("invalid", message) : null;
}

export type LogCallResult = Result<{ callId: string; status: PipelineStatus; version: number }>;

/**
 * Records one call. The outcome is what happened; `newStatus` is where the
 * caller decided the lead now stands (the form pre-selects a suggestion,
 * but nothing is closed unless they chose it). Any open follow-up is
 * completed by this call, and a new one is opened if a date is given.
 */
export async function logCall(db: Db, actor: Viewer, input: unknown, ctx: Ctx = {}): Promise<LogCallResult> {
  const parsed = logCallInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { leadId, outcome, newStatus, notes, durationSec, followUpAt, version } = parsed.data;
  const now = ctx.now ?? new Date();

  return db.transaction(async (tx): Promise<LogCallResult> => {
    const lead = await lockLead(tx, actor, leadId, "lead.logCall");
    if (isFailure(lead)) return lead;
    if (lead.version !== version) return STALE;
    if (isTerminal(lead.pipelineStatus) && actor.role !== "admin") {
      return fail("invalid", `This lead is ${PIPELINE_LABEL[lead.pipelineStatus].toLowerCase()}; only an admin can log more calls on it.`);
    }
    const transition = checkTransition(lead.pipelineStatus, newStatus, actor.role);
    if (!transition.ok) return fail("forbidden", transition.reason);
    const problem = followUpProblem(newStatus, followUpAt, now);
    if (problem) return problem;

    const [call] = await tx
      .insert(callLogs)
      .values({
        leadId,
        userId: actor.id,
        outcome,
        statusBefore: lead.pipelineStatus,
        statusAfter: newStatus,
        notes: notes || null,
        durationSec: durationSec ?? null,
        calledAt: now,
      })
      .returning({ id: callLogs.id });

    await closeOpenFollowUp(tx, leadId, { completedBy: actor.id, callId: call.id }, now);
    if (followUpAt) {
      await tx.insert(followUps).values({ leadId, dueAt: followUpAt, createdBy: actor.id, createdAt: now });
    }
    if (transition.changed) {
      await tx.insert(leadStatusChanges).values({
        leadId,
        fromStatus: lead.pipelineStatus,
        toStatus: newStatus,
        changedBy: actor.id,
        callLogId: call.id,
        createdAt: now,
      });
    }
    const [updated] = await tx
      .update(leads)
      .set({
        pipelineStatus: newStatus,
        attemptCount: sql`${leads.attemptCount} + 1`,
        lastCallAt: now,
        lastOutcome: outcome,
        ...(transition.changed && needsReview(newStatus) && { reviewRequestedAt: now }),
        version: sql`${leads.version} + 1`,
        updatedAt: now,
      })
      .where(eq(leads.id, leadId))
      .returning({ version: leads.version });
    return { ok: true, callId: call.id, status: newStatus, version: updated.version };
  });
}

export type StatusResult = Result<{ changed: boolean; version: number }>;

/**
 * Moves a lead to another pipeline status without a call: closing it,
 * parking it as a callback, or (admin only) reopening it. Closing or
 * reopening needs a reason, which is kept with the change.
 */
export async function changeStatus(db: Db, actor: Viewer, input: unknown, ctx: Ctx = {}): Promise<StatusResult> {
  const parsed = changeStatusInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { leadId, toStatus, reason, followUpAt, version } = parsed.data;
  const now = ctx.now ?? new Date();

  return db.transaction(async (tx): Promise<StatusResult> => {
    const lead = await lockLead(tx, actor, leadId, "lead.changeStatus");
    if (isFailure(lead)) return lead;
    if (lead.version !== version) return STALE;
    const transition = checkTransition(lead.pipelineStatus, toStatus, actor.role);
    if (!transition.ok) return fail("forbidden", transition.reason);
    if (!transition.changed) return { ok: true, changed: false, version: lead.version };

    const reopening = isTerminal(lead.pipelineStatus);
    if ((reopening || isTerminal(toStatus)) && !reason) {
      return fail("invalid", reopening ? "Say why the lead is being reopened." : "Say why the lead is being closed.");
    }
    const problem = followUpProblem(toStatus, followUpAt, now);
    if (problem) return problem;

    if (isTerminal(toStatus) || followUpAt) await closeOpenFollowUp(tx, leadId, { cancelledBy: actor.id }, now);
    if (followUpAt) await tx.insert(followUps).values({ leadId, dueAt: followUpAt, createdBy: actor.id, createdAt: now });
    await tx.insert(leadStatusChanges).values({
      leadId,
      fromStatus: lead.pipelineStatus,
      toStatus,
      changedBy: actor.id,
      reason: reason || null,
      createdAt: now,
    });
    const [updated] = await tx
      .update(leads)
      .set({
        pipelineStatus: toStatus,
        ...(needsReview(toStatus) && { reviewRequestedAt: now }),
        version: sql`${leads.version} + 1`,
        updatedAt: now,
      })
      .where(eq(leads.id, leadId))
      .returning({ version: leads.version });
    if (reopening) {
      await writeAudit(tx, {
        actorId: actor.id,
        action: "lead.reopened",
        entityType: "lead",
        entityId: leadId,
        before: { status: lead.pipelineStatus },
        after: { status: toStatus, reason },
        ip: ctx.ip,
      });
    }
    return { ok: true, changed: true, version: updated.version };
  });
}

/**
 * A note on the lead, or (admins and supervisors) feedback for a caller.
 * Feedback is addressed to the lead's current owner unless another user is
 * named, and it clears the lead's "waiting for review" flag.
 */
export async function addNote(db: Db, actor: Viewer, input: unknown, ctx: Ctx = {}): Promise<Result<{ noteId: string }>> {
  const parsed = addNoteInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { leadId, body, kind, aboutUserId } = parsed.data;
  const now = ctx.now ?? new Date();

  return db.transaction(async (tx): Promise<Result<{ noteId: string }>> => {
    const lead = await lockLead(tx, actor, leadId, kind === "feedback" ? "lead.addFeedback" : "lead.addNote");
    if (isFailure(lead)) return lead;
    let about: string | null = null;
    if (kind === "feedback") {
      about = aboutUserId ?? lead.assignedTo;
      if (aboutUserId) {
        const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, aboutUserId));
        if (!user) return fail("invalid", "That team member doesn't exist.");
      }
    } else if (aboutUserId) {
      return fail("invalid", "Only feedback is addressed to someone.");
    }

    const [note] = await tx
      .insert(leadNotes)
      .values({ leadId, authorId: actor.id, kind, aboutUserId: about, body, createdAt: now })
      .returning({ id: leadNotes.id });
    if (kind === "feedback" && lead.reviewRequestedAt) {
      await tx.update(leads).set({ reviewRequestedAt: null, updatedAt: now }).where(eq(leads.id, leadId));
    }
    return { ok: true, noteId: note.id };
  });
}

/** Schedules (or reschedules) the lead's callback. The previous open one, if any, is cancelled. */
export async function setFollowUp(db: Db, actor: Viewer, input: unknown, ctx: Ctx = {}): Promise<Result<{ followUpId: string }>> {
  const parsed = setFollowUpInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { leadId, dueAt, note } = parsed.data;
  const now = ctx.now ?? new Date();

  try {
    return await db.transaction(async (tx): Promise<Result<{ followUpId: string }>> => {
      const lead = await lockLead(tx, actor, leadId, "lead.manageFollowUp");
      if (isFailure(lead)) return lead;
      const problem = followUpProblem(lead.pipelineStatus, dueAt, now);
      if (problem) return problem;
      await closeOpenFollowUp(tx, leadId, { cancelledBy: actor.id }, now);
      const [row] = await tx
        .insert(followUps)
        .values({ leadId, dueAt, note: note || null, createdBy: actor.id, createdAt: now })
        .returning({ id: followUps.id });
      return { ok: true, followUpId: row.id };
    });
  } catch (err) {
    // Only reachable if the lead lock is bypassed; the unique index is the backstop.
    if (isUniqueViolation(err, "follow_ups_one_open_uq")) return fail("conflict", "This lead already has a follow-up.");
    throw err;
  }
}

/** Cancels an open follow-up. A lead parked as a callback must keep a date, so its status has to change first. */
export async function cancelFollowUp(db: Db, actor: Viewer, input: unknown, ctx: Ctx = {}): Promise<Result> {
  const parsed = cancelFollowUpInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const now = ctx.now ?? new Date();

  const [row] = await db
    .select({ leadId: followUps.leadId })
    .from(followUps)
    .where(eq(followUps.id, parsed.data.followUpId));
  if (!row) return NOT_FOUND;

  return db.transaction(async (tx): Promise<Result> => {
    const lead = await lockLead(tx, actor, row.leadId, "lead.manageFollowUp");
    if (isFailure(lead)) return lead;
    if (requiresFollowUp(null, lead.pipelineStatus)) {
      return fail("invalid", "This lead is waiting for a callback, so it needs a date. Pick a new date or change its status.");
    }
    const closed = await tx
      .update(followUps)
      .set({ cancelledAt: now, cancelledBy: actor.id })
      .where(and(eq(followUps.id, parsed.data.followUpId), isNull(followUps.completedAt), isNull(followUps.cancelledAt)))
      .returning({ id: followUps.id });
    if (closed.length === 0) return fail("conflict", "That follow-up was already completed or cancelled.");
    return { ok: true };
  });
}

/**
 * Admin correction: marks a call or note as void with a reason. The row
 * stays in the history (struck through), and is excluded from attempt
 * counts and metrics. The lead's status is not rolled back; change it
 * explicitly if the voided call moved it.
 */
export async function voidEntry(db: Db, actor: Viewer, input: unknown, ctx: Ctx = {}): Promise<Result> {
  if (!can(actor, "entries.void")) return fail("forbidden", "Only an admin can void entries.");
  const parsed = voidEntryInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { type, entryId, reason } = parsed.data;
  const now = ctx.now ?? new Date();
  const table = type === "call" ? callLogs : leadNotes;

  const [entry] = await db.select({ leadId: table.leadId }).from(table).where(eq(table.id, entryId));
  if (!entry) return fail("not_found", "That entry doesn't exist.");

  return db.transaction(async (tx): Promise<Result> => {
    // Lock the lead so the recount below can't interleave with a new call.
    await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, entry.leadId)).for("update");
    const voided = await tx
      .update(table)
      .set({ voidedAt: now, voidedBy: actor.id, voidReason: reason })
      .where(and(eq(table.id, entryId), isNull(table.voidedAt)))
      .returning({ id: table.id });
    if (voided.length === 0) return fail("conflict", "That entry was already voided.");

    if (type === "call") {
      const live = and(eq(callLogs.leadId, entry.leadId), isNull(callLogs.voidedAt));
      const [{ n }] = await tx.select({ n: count() }).from(callLogs).where(live);
      const [last] = await tx
        .select({ calledAt: callLogs.calledAt, outcome: callLogs.outcome })
        .from(callLogs)
        .where(live)
        .orderBy(desc(callLogs.calledAt), desc(callLogs.id))
        .limit(1);
      await tx
        .update(leads)
        .set({ attemptCount: n, lastCallAt: last?.calledAt ?? null, lastOutcome: last?.outcome ?? null, updatedAt: now })
        .where(eq(leads.id, entry.leadId));
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: `${type}.voided`,
      entityType: type,
      entityId: entryId,
      after: { leadId: entry.leadId, reason },
      ip: ctx.ip,
    });
    return { ok: true };
  });
}

// ---------------------------------------------------------------- timeline

interface Person {
  id: string;
  name: string;
}

interface Voidable {
  voided: { at: Date; by: Person; reason: string } | null;
}

export type TimelineEntry =
  | ({
      kind: "call";
      id: string;
      at: Date;
      by: Person;
      outcome: CallOutcome;
      statusBefore: PipelineStatus;
      statusAfter: PipelineStatus;
      notes: string | null;
      durationSec: number | null;
    } & Voidable)
  | ({ kind: "note" | "feedback"; id: string; at: Date; by: Person; about: Person | null; body: string } & Voidable)
  | { kind: "status"; id: string; at: Date; by: Person; from: PipelineStatus; to: PipelineStatus; reason: string | null; viaCall: boolean }
  | {
      kind: "followUp";
      id: string;
      at: Date;
      by: Person;
      dueAt: Date;
      note: string | null;
      state: "open" | "completed" | "cancelled";
      closedAt: Date | null;
    }
  /** `to` is null when an admin unassigned the lead. */
  | { kind: "assignment"; id: string; at: Date; by: Person; to: Person | null; reason: string | null };

export interface LeadActivity {
  entries: TimelineEntry[];
  openFollowUp: { id: string; dueAt: Date; note: string | null } | null;
  /** Calls that haven't been voided. */
  liveCalls: number;
}

const person = (id: string | null, name: string | null): Person | null => (id && name !== null ? { id, name } : null);

/**
 * Everything recorded on a lead, newest first, if the viewer may see the
 * lead. Callers see the lead's full call and note history, including
 * entries made by whoever had it before, but not the assignment history.
 */
export async function getLeadActivity(db: Db, viewer: Viewer, leadId: unknown): Promise<LeadActivity | null> {
  const parsed = z.uuid().safeParse(leadId);
  if (!parsed.success) return null;
  const id = parsed.data;
  const [lead] = await db
    .select({ assignedTo: leads.assignedTo, archivedAt: leads.archivedAt })
    .from(leads)
    .where(eq(leads.id, id));
  if (!lead || !can(viewer, "lead.view", lead)) return null;
  if (lead.archivedAt && !can(viewer, "leads.archive")) return null;

  const by = alias(users, "by_user");
  const voider = alias(users, "voider");
  const about = alias(users, "about_user");

  const [calls, notes, statuses, follows, assignments] = await Promise.all([
    db
      .select({ c: callLogs, byName: by.name, voiderName: voider.name })
      .from(callLogs)
      .innerJoin(by, eq(by.id, callLogs.userId))
      .leftJoin(voider, eq(voider.id, callLogs.voidedBy))
      .where(eq(callLogs.leadId, id)),
    db
      .select({ n: leadNotes, byName: by.name, aboutName: about.name, voiderName: voider.name })
      .from(leadNotes)
      .innerJoin(by, eq(by.id, leadNotes.authorId))
      .leftJoin(about, eq(about.id, leadNotes.aboutUserId))
      .leftJoin(voider, eq(voider.id, leadNotes.voidedBy))
      .where(eq(leadNotes.leadId, id)),
    db
      .select({ s: leadStatusChanges, byName: by.name })
      .from(leadStatusChanges)
      .innerJoin(by, eq(by.id, leadStatusChanges.changedBy))
      .where(eq(leadStatusChanges.leadId, id)),
    db
      .select({ f: followUps, byName: by.name })
      .from(followUps)
      .innerJoin(by, eq(by.id, followUps.createdBy))
      .where(eq(followUps.leadId, id)),
    can(viewer, "leads.viewAll")
      ? db
          .select({ a: leadAssignments, byName: by.name, toName: about.name, enderName: voider.name })
          .from(leadAssignments)
          .innerJoin(by, eq(by.id, leadAssignments.assignedBy))
          .innerJoin(about, eq(about.id, leadAssignments.assignedTo))
          .leftJoin(voider, eq(voider.id, leadAssignments.endedBy))
          .where(eq(leadAssignments.leadId, id))
      : Promise.resolve([]),
  ]);

  const voided = (at: Date | null, byId: string | null, name: string | null, reason: string | null) =>
    at && byId && reason ? { at, by: { id: byId, name: name ?? "" }, reason } : null;

  const entries: TimelineEntry[] = [
    ...calls.map(({ c, byName, voiderName }): TimelineEntry => ({
      kind: "call",
      id: c.id,
      at: c.calledAt,
      by: { id: c.userId, name: byName },
      outcome: c.outcome,
      statusBefore: c.statusBefore,
      statusAfter: c.statusAfter,
      notes: c.notes,
      durationSec: c.durationSec,
      voided: voided(c.voidedAt, c.voidedBy, voiderName, c.voidReason),
    })),
    ...notes.map(({ n, byName, aboutName, voiderName }): TimelineEntry => ({
      kind: n.kind,
      id: n.id,
      at: n.createdAt,
      by: { id: n.authorId, name: byName },
      about: person(n.aboutUserId, aboutName),
      body: n.body,
      voided: voided(n.voidedAt, n.voidedBy, voiderName, n.voidReason),
    })),
    ...statuses.map(({ s, byName }): TimelineEntry => ({
      kind: "status",
      id: s.id,
      at: s.createdAt,
      by: { id: s.changedBy, name: byName },
      from: s.fromStatus,
      to: s.toStatus,
      reason: s.reason,
      viaCall: s.callLogId !== null,
    })),
    ...follows.map(({ f, byName }): TimelineEntry => ({
      kind: "followUp",
      id: f.id,
      at: f.createdAt,
      by: { id: f.createdBy, name: byName },
      dueAt: f.dueAt,
      note: f.note,
      state: f.completedAt ? "completed" : f.cancelledAt ? "cancelled" : "open",
      closedAt: f.completedAt ?? f.cancelledAt,
    })),
    ...assignments.map(({ a, byName, toName }): TimelineEntry => ({
      kind: "assignment",
      id: a.id,
      at: a.startedAt,
      by: { id: a.assignedBy, name: byName },
      to: { id: a.assignedTo, name: toName },
      reason: a.reason,
    })),
    // A stint that ended without another one starting at that moment was an unassignment.
    ...assignments
      .filter(({ a }) => a.endedAt && a.endedBy && !assignments.some(({ a: b }) => b.startedAt.getTime() === a.endedAt!.getTime()))
      .map(({ a, enderName }): TimelineEntry => ({
        kind: "assignment",
        id: `${a.id}-end`,
        at: a.endedAt!,
        by: { id: a.endedBy!, name: enderName ?? "" },
        to: null,
        reason: null,
      })),
  ];
  // Newest first; within one instant, a call sorts above the status change and follow-up it caused.
  const order: Record<TimelineEntry["kind"], number> = { call: 0, status: 1, followUp: 2, note: 3, feedback: 3, assignment: 4 };
  entries.sort((a, b) => b.at.getTime() - a.at.getTime() || order[a.kind] - order[b.kind]);

  const open = follows.find(({ f }) => !f.completedAt && !f.cancelledAt)?.f;
  return {
    entries,
    openFollowUp: open ? { id: open.id, dueAt: open.dueAt, note: open.note } : null,
    liveCalls: calls.filter(({ c }) => !c.voidedAt).length,
  };
}
