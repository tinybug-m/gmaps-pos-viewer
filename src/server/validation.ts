import { z } from "zod";

import { MAX_IMPORT_BYTES } from "@/lib/validation";
import { CALL_OUTCOMES, PIPELINE_STATUSES, ROLES, requiresFollowUp } from "@/lib/workflow";

/**
 * Input schemas for every server action. Actions are public POST endpoints,
 * so nothing from the client is trusted: ids, enums, lengths and sizes are
 * all checked here before any database work. Ownership and role are never
 * accepted from the client; they come from the session.
 */

export const MAX_NOTE_LENGTH = 5000;
export const MAX_BULK = 500;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_IMPORT_RECORDS = 10_000;
/** UTF-8 never uses fewer bytes than characters, so any file under the byte limit passes this. */
export const MAX_IMPORT_CHARS = MAX_IMPORT_BYTES;

const id = z.uuid();
const text = (max: number) => z.string().trim().max(max);
const dateInput = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), "Invalid date");

export const loginInput = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(200),
});

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(200, "That password is too long.");

export const changePasswordInput = z.object({
  currentPassword: z.string().max(200),
  newPassword: passwordSchema,
});

export const createUserInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(254)),
  name: text(100).min(1, "Enter a name."),
  role: z.enum(ROLES),
});

export const updateUserInput = z.object({
  userId: id,
  name: text(100).min(1).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
});

export const assignInput = z
  .object({
    leadIds: z.array(id).min(1, "Select at least one lead.").max(MAX_BULK, `Assign at most ${MAX_BULK} leads at once.`),
    toUserId: id.nullable(),
    /** The assignee the admin saw for each lead; a mismatch means someone else changed it. */
    expected: z.record(id, id.nullable()),
    reason: text(500).optional(),
  })
  .refine((v) => new Set(v.leadIds).size === v.leadIds.length, "Duplicate lead ids.")
  .refine((v) => v.leadIds.every((leadId) => leadId in v.expected), "Missing expected assignee for a lead.");

export const logCallInput = z
  .object({
    leadId: id,
    outcome: z.enum(CALL_OUTCOMES),
    newStatus: z.enum(PIPELINE_STATUSES),
    notes: text(MAX_NOTE_LENGTH).optional(),
    durationSec: z.number().int().min(0).max(4 * 60 * 60).optional(),
    followUpAt: dateInput.optional(),
    /** Lead version the form was rendered from, for optimistic concurrency. */
    version: z.number().int().min(0),
  })
  .refine((v) => !requiresFollowUp(v.outcome, v.newStatus) || v.followUpAt !== undefined, {
    message: "Pick a follow-up date for the callback.",
    path: ["followUpAt"],
  });

export const changeStatusInput = z
  .object({
    leadId: id,
    toStatus: z.enum(PIPELINE_STATUSES),
    reason: text(500).optional(),
    followUpAt: dateInput.optional(),
    version: z.number().int().min(0),
  })
  .refine((v) => !requiresFollowUp(null, v.toStatus) || v.followUpAt !== undefined, {
    message: "Pick a follow-up date for the callback.",
    path: ["followUpAt"],
  });

export const addNoteInput = z.object({
  leadId: id,
  body: text(MAX_NOTE_LENGTH).min(1, "Write a note first."),
  kind: z.enum(["note", "feedback"]),
  /** For feedback: the caller it's addressed to. */
  aboutUserId: id.optional(),
});

export const setFollowUpInput = z.object({
  leadId: id,
  dueAt: dateInput,
  note: text(500).optional(),
});

export const cancelFollowUpInput = z.object({ followUpId: id });

export const voidEntryInput = z.object({
  type: z.enum(["call", "note"]),
  entryId: id,
  reason: text(500).min(3, "Give a reason."),
});

export const archiveLeadInput = z.object({ leadId: id });

export const importInput = z.object({
  // Only the base name is kept: it's shown in the import history and the audit log.
  fileName: z
    .string()
    .transform((name) => name.split(/[\\/]/).pop()!.trim())
    .pipe(z.string().min(1, "The file needs a name.").max(200, "That file name is too long.")),
  json: z
    .string()
    .min(1, "The file is empty.")
    .max(MAX_IMPORT_CHARS, "That file is too large to import in one go (3.5 MB). Split it into smaller files."),
});

export const assignFileInput = importInput.extend({
  toUserId: id,
  /** The lead count the admin confirmed in the preview; a different count on commit means the data moved. */
  expectedAssign: z.number().int().min(0).optional(),
  /** Also add the businesses in the file that aren't in the system yet, then assign them too. */
  importMissing: z.boolean().optional(),
});

/** First human-readable message from a failed parse. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}
