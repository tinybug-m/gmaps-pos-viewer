import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { can, type Viewer } from "@/lib/permissions";
import type { Role } from "@/lib/workflow";
import type { Db } from "../db/client";
import { leadAssignments, leads, users } from "../db/schema";
import { fail, type Failure, type Result } from "../result";
import { assignInput, firstIssue } from "../validation";
import { writeAudit } from "./audit";

/** Roles that can work leads. Supervisors review but never call, so leads aren't given to them. */
export const ASSIGNABLE_ROLES: readonly Role[] = ["caller", "admin"];

export interface AssignProblem {
  leadId: string;
  name: string | null;
  reason: "not_found" | "archived" | "changed";
  message: string;
}

/** Nothing is written when any lead has a problem; each one is listed so the admin can fix their selection. */
export type AssignResult = Result<{ changed: number; unchanged: number }> | (Failure & { problems: AssignProblem[] });

/**
 * Assigns, reassigns or unassigns (toUserId null) up to MAX_BULK leads in
 * one transaction. `expected` is the assignee the admin saw for each lead:
 * if any lead has changed hands since, nothing is applied, so two admins
 * working the same list can't silently overwrite each other.
 *
 * Leads are locked in id order (so overlapping bulk assigns can't
 * deadlock), the open assignment period is closed and a new one opened,
 * and the partial unique index on lead_assignments backs up the rule that a
 * lead has at most one active owner. Calls, notes and follow-ups stay on the
 * lead, so the new owner sees the full history and credit stays with
 * whoever did the work.
 */
export async function assignLeads(
  db: Db,
  actor: Viewer,
  input: unknown,
  ctx: { ip?: string | null } = {},
): Promise<AssignResult> {
  if (!can(actor, "leads.assign")) return fail("forbidden", "Only an admin can assign leads.");
  const parsed = assignInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { leadIds, toUserId, expected, reason } = parsed.data;

  return db.transaction(async (tx): Promise<AssignResult> => {
    let target: { id: string; name: string } | null = null;
    if (toUserId) {
      // FOR SHARE blocks a concurrent deactivation or role change until this commits.
      const [user] = await tx
        .select({ id: users.id, name: users.name, role: users.role, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, toUserId))
        .for("share");
      if (!user || !user.isActive) return fail("invalid", "Pick an active team member to assign to.");
      if (!ASSIGNABLE_ROLES.includes(user.role)) {
        return fail("invalid", "Supervisors review leads but don't call them, so leads can't be assigned to them.");
      }
      target = user;
    }

    const current = await tx
      .select({ id: leads.id, name: leads.name, assignedTo: leads.assignedTo, archivedAt: leads.archivedAt })
      .from(leads)
      .where(inArray(leads.id, leadIds))
      .orderBy(asc(leads.id))
      .for("update");
    const byId = new Map(current.map((l) => [l.id, l]));

    const problems: AssignProblem[] = [];
    for (const leadId of leadIds) {
      const lead = byId.get(leadId);
      if (!lead) problems.push({ leadId, name: null, reason: "not_found", message: "This lead no longer exists." });
      else if (lead.archivedAt) {
        problems.push({ leadId, name: lead.name, reason: "archived", message: "This lead has been archived." });
      } else if (lead.assignedTo !== expected[leadId]) {
        problems.push({
          leadId,
          name: lead.name,
          reason: "changed",
          message: "Someone else changed who this lead is assigned to since you loaded the list.",
        });
      }
    }
    if (problems.length > 0) {
      const changed = problems.filter((p) => p.reason === "changed").length;
      return {
        ...fail(
          changed === problems.length ? "conflict" : "invalid",
          `${problems.length} of the selected leads can't be assigned. Nothing was changed. Refresh the list and try again.`,
        ),
        problems,
      };
    }

    const toChange = leadIds.filter((leadId) => byId.get(leadId)!.assignedTo !== toUserId);
    if (toChange.length > 0) {
      const now = new Date();
      await tx
        .update(leadAssignments)
        .set({ endedAt: now, endedBy: actor.id })
        .where(and(inArray(leadAssignments.leadId, toChange), isNull(leadAssignments.endedAt)));
      if (target) {
        await tx
          .insert(leadAssignments)
          .values(toChange.map((leadId) => ({ leadId, assignedTo: target.id, assignedBy: actor.id, reason, startedAt: now })));
      }
      await tx
        .update(leads)
        .set({
          assignedTo: toUserId,
          assignedAt: toUserId ? now : null,
          version: sql`${leads.version} + 1`,
          updatedAt: now,
        })
        .where(inArray(leads.id, toChange));
      await writeAudit(
        tx,
        toChange.map((leadId) => ({
          actorId: actor.id,
          action: toUserId ? "lead.assigned" : "lead.unassigned",
          entityType: "lead" as const,
          entityId: leadId,
          before: { assignedTo: byId.get(leadId)!.assignedTo },
          after: { assignedTo: toUserId, ...(reason && { reason }) },
          ip: ctx.ip,
        })),
      );
    }
    return { ok: true, changed: toChange.length, unchanged: leadIds.length - toChange.length };
  });
}

export interface AssignmentPeriod {
  id: string;
  assignee: { id: string; name: string };
  assignedBy: { id: string; name: string };
  reason: string | null;
  startedAt: Date;
  endedAt: Date | null;
  endedBy: { id: string; name: string } | null;
}

/** Ownership history of one lead, newest first. Admins and supervisors only. */
export async function listAssignmentHistory(db: Db, actor: Viewer, leadId: unknown): Promise<AssignmentPeriod[] | null> {
  if (!can(actor, "leads.viewAll")) return null;
  const id = z.uuid().safeParse(leadId);
  if (!id.success) return [];
  const assignee = alias(users, "assignee");
  const by = alias(users, "assigned_by_user");
  const ender = alias(users, "ended_by_user");
  const rows = await db
    .select({
      id: leadAssignments.id,
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      byId: by.id,
      byName: by.name,
      reason: leadAssignments.reason,
      startedAt: leadAssignments.startedAt,
      endedAt: leadAssignments.endedAt,
      enderId: ender.id,
      enderName: ender.name,
    })
    .from(leadAssignments)
    .innerJoin(assignee, eq(assignee.id, leadAssignments.assignedTo))
    .innerJoin(by, eq(by.id, leadAssignments.assignedBy))
    .leftJoin(ender, eq(ender.id, leadAssignments.endedBy))
    .where(eq(leadAssignments.leadId, id.data))
    .orderBy(desc(leadAssignments.startedAt), desc(leadAssignments.id));
  return rows.map((r) => ({
    id: r.id,
    assignee: { id: r.assigneeId, name: r.assigneeName },
    assignedBy: { id: r.byId, name: r.byName },
    reason: r.reason,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    endedBy: r.enderId && r.enderName ? { id: r.enderId, name: r.enderName } : null,
  }));
}
