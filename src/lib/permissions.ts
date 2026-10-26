import type { Role } from "@/lib/workflow";

/**
 * Role-permission matrix. This is the single source of truth: the server
 * enforces it on every action, and the UI reads it only to hide controls.
 * Callers' lead scoping is also applied in SQL so they can never list
 * leads that aren't theirs.
 */

export interface Viewer {
  id: string;
  role: Role;
}

/** The part of a lead that permission checks look at, as read at request time. */
export interface LeadRef {
  assignedTo: string | null;
}

export type Capability =
  | "users.manage"
  | "leads.import"
  | "leads.archive"
  | "leads.viewAll"
  | "leads.assign"
  | "audit.view"
  | "entries.void"
  | "dashboard.team"
  | "lead.view"
  | "lead.logCall"
  | "lead.changeStatus"
  | "lead.reopen"
  | "lead.addNote"
  | "lead.addFeedback"
  | "lead.manageFollowUp";

const GLOBAL: Record<Capability, readonly Role[]> = {
  "users.manage": ["admin"],
  "leads.import": ["admin"],
  "leads.archive": ["admin"],
  "leads.viewAll": ["admin", "supervisor"],
  "leads.assign": ["admin"],
  "audit.view": ["admin"],
  "entries.void": ["admin"],
  "dashboard.team": ["admin", "supervisor"],
  "lead.view": ["admin", "supervisor"],
  "lead.logCall": ["admin"],
  "lead.changeStatus": ["admin"],
  "lead.reopen": ["admin"],
  "lead.addNote": ["admin", "supervisor"],
  "lead.addFeedback": ["admin", "supervisor"],
  "lead.manageFollowUp": ["admin", "supervisor"],
};

/** What a caller may do on a lead currently assigned to them. */
const CALLER_OWN: ReadonlySet<Capability> = new Set([
  "lead.view",
  "lead.logCall",
  "lead.changeStatus",
  "lead.addNote",
  "lead.manageFollowUp",
]);

export function can(viewer: Viewer, capability: Capability, lead?: LeadRef): boolean {
  if (GLOBAL[capability].includes(viewer.role)) return true;
  if (viewer.role === "caller" && CALLER_OWN.has(capability)) {
    return lead !== undefined && lead.assignedTo === viewer.id;
  }
  return false;
}
