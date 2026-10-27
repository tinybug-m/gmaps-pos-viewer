import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { CALL_OUTCOMES, PIPELINE_STATUSES, ROLES } from "../../lib/workflow";
import type { RawLead } from "../../types/lead";

/*
 * Conventions
 * - Primary keys are UUIDs, every timestamp is timestamptz.
 * - History tables (lead_assignments, call_logs, lead_notes, follow_ups,
 *   lead_status_changes, audit_log) are append-only. Corrections void a row
 *   with a reason. drizzle/0001_history_guards.sql adds triggers that reject
 *   any UPDATE other than voiding/closing a row once, and every DELETE.
 * - The four auth tables (users, sessions, accounts, verifications) follow
 *   better-auth's model; property names are the ones better-auth expects.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const roleEnum = pgEnum("user_role", ROLES);
export const pipelineStatusEnum = pgEnum("pipeline_status", PIPELINE_STATUSES);
export const callOutcomeEnum = pgEnum("call_outcome", CALL_OUTCOMES);
export const noteKindEnum = pgEnum("note_kind", ["note", "feedback"]);

// ---------------------------------------------------------------- auth

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    // Least privilege by default; only an admin can raise it.
    role: roleEnum("role").notNull().default("caller"),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    deactivatedAt: ts("deactivated_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("users_email_lowercase", sql`${t.email} = lower(${t.email})`),
    check("users_failed_logins_nonneg", sql`${t.failedLogins} >= 0`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("accounts_provider_account_uq").on(t.providerId, t.accountId),
    index("accounts_user_idx").on(t.userId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------- leads

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  importedBy: uuid("imported_by")
    .notNull()
    .references(() => users.id),
  fileName: text("file_name").notNull(),
  total: integer("total").notNull(),
  inserted: integer("inserted").notNull(),
  updated: integer("updated").notNull(),
  unchanged: integer("unchanged").notNull(),
  invalid: integer("invalid").notNull(),
  duplicates: integer("duplicates").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    // The id the lead had in the old JSON-only viewer (slug + array index). Traceability only.
    legacySlug: text("legacy_slug"),
    raw: jsonb("raw").$type<RawLead>().notNull(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    source: text("source").notNull(),
    pipelineStatus: pipelineStatusEnum("pipeline_status").notNull().default("new"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    assignedAt: ts("assigned_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastCallAt: ts("last_call_at"),
    lastOutcome: callOutcomeEnum("last_outcome"),
    // Set when a lead reaches a state a supervisor should look at; cleared by their feedback.
    reviewRequestedAt: ts("review_requested_at"),
    version: integer("version").notNull().default(1),
    firstImportId: uuid("first_import_id").references(() => importBatches.id),
    lastImportId: uuid("last_import_id").references(() => importBatches.id),
    archivedAt: ts("archived_at"),
    archivedBy: uuid("archived_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("leads_assignee_status_idx").on(t.assignedTo, t.pipelineStatus),
    index("leads_status_idx").on(t.pipelineStatus),
    index("leads_review_idx").on(t.reviewRequestedAt).where(sql`${t.reviewRequestedAt} is not null`),
    check("leads_assignment_pair", sql`(${t.assignedTo} is null) = (${t.assignedAt} is null)`),
    check("leads_archive_pair", sql`(${t.archivedAt} is null) = (${t.archivedBy} is null)`),
    check("leads_attempts_nonneg", sql`${t.attemptCount} >= 0`),
    check("leads_version_positive", sql`${t.version} >= 1`),
    check("leads_source_known", sql`${t.source} in ('google-maps', 'trustpilot')`),
  ],
);

/** One row per period a caller owned a lead. Unassigning closes the open row without opening another. */
export const leadAssignments = pgTable(
  "lead_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    assignedTo: uuid("assigned_to")
      .notNull()
      .references(() => users.id),
    assignedBy: uuid("assigned_by")
      .notNull()
      .references(() => users.id),
    reason: text("reason"),
    startedAt: ts("started_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
    endedBy: uuid("ended_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("lead_assignments_one_active_uq").on(t.leadId).where(sql`${t.endedAt} is null`),
    index("lead_assignments_lead_idx").on(t.leadId, t.startedAt),
    index("lead_assignments_user_idx").on(t.assignedTo, t.startedAt),
    check("lead_assignments_end_pair", sql`(${t.endedAt} is null) = (${t.endedBy} is null)`),
    check("lead_assignments_end_after_start", sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  ],
);

const voidColumns = {
  voidedAt: ts("voided_at"),
  voidedBy: uuid("voided_by").references(() => users.id),
  voidReason: text("void_reason"),
};

export const callLogs = pgTable(
  "call_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    // Who made the call. Never re-attributed, so reassignment doesn't move credit.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    outcome: callOutcomeEnum("outcome").notNull(),
    statusBefore: pipelineStatusEnum("status_before").notNull(),
    statusAfter: pipelineStatusEnum("status_after").notNull(),
    notes: text("notes"),
    durationSec: integer("duration_sec"),
    calledAt: ts("called_at").notNull().defaultNow(),
    ...voidColumns,
  },
  (t) => [
    index("call_logs_lead_idx").on(t.leadId, t.calledAt),
    index("call_logs_user_idx").on(t.userId, t.calledAt),
    check("call_logs_duration_range", sql`${t.durationSec} is null or ${t.durationSec} between 0 and 14400`),
    check("call_logs_notes_length", sql`${t.notes} is null or char_length(${t.notes}) <= 5000`),
    check(
      "call_logs_void_complete",
      sql`(${t.voidedAt} is null and ${t.voidedBy} is null and ${t.voidReason} is null) or (${t.voidedAt} is not null and ${t.voidedBy} is not null and ${t.voidReason} is not null)`,
    ),
  ],
);

export const leadNotes = pgTable(
  "lead_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    kind: noteKindEnum("kind").notNull().default("note"),
    // For supervisor feedback: which caller it is about.
    aboutUserId: uuid("about_user_id").references(() => users.id),
    callLogId: uuid("call_log_id").references(() => callLogs.id),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    ...voidColumns,
  },
  (t) => [
    index("lead_notes_lead_idx").on(t.leadId, t.createdAt),
    index("lead_notes_author_idx").on(t.authorId, t.createdAt),
    check("lead_notes_body_length", sql`char_length(${t.body}) between 1 and 5000`),
    check("lead_notes_about_only_feedback", sql`${t.aboutUserId} is null or ${t.kind} = 'feedback'`),
    check(
      "lead_notes_void_complete",
      sql`(${t.voidedAt} is null and ${t.voidedBy} is null and ${t.voidReason} is null) or (${t.voidedAt} is not null and ${t.voidedBy} is not null and ${t.voidReason} is not null)`,
    ),
  ],
);

/** A scheduled callback. At most one open per lead; it belongs to whoever currently owns the lead. */
export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    dueAt: ts("due_at").notNull(),
    note: text("note"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
    completedBy: uuid("completed_by").references(() => users.id),
    completedByCallId: uuid("completed_by_call_id").references(() => callLogs.id),
    cancelledAt: ts("cancelled_at"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("follow_ups_one_open_uq")
      .on(t.leadId)
      .where(sql`${t.completedAt} is null and ${t.cancelledAt} is null`),
    index("follow_ups_open_due_idx")
      .on(t.dueAt)
      .where(sql`${t.completedAt} is null and ${t.cancelledAt} is null`),
    index("follow_ups_lead_idx").on(t.leadId, t.createdAt),
    check("follow_ups_not_both_closed", sql`${t.completedAt} is null or ${t.cancelledAt} is null`),
    check("follow_ups_complete_pair", sql`(${t.completedAt} is null) = (${t.completedBy} is null)`),
    check("follow_ups_cancel_pair", sql`(${t.cancelledAt} is null) = (${t.cancelledBy} is null)`),
    check("follow_ups_note_length", sql`${t.note} is null or char_length(${t.note}) <= 5000`),
  ],
);

export const leadStatusChanges = pgTable(
  "lead_status_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id),
    fromStatus: pipelineStatusEnum("from_status").notNull(),
    toStatus: pipelineStatusEnum("to_status").notNull(),
    changedBy: uuid("changed_by")
      .notNull()
      .references(() => users.id),
    callLogId: uuid("call_log_id").references(() => callLogs.id),
    reason: text("reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("lead_status_changes_lead_idx").on(t.leadId, t.createdAt),
    index("lead_status_changes_user_idx").on(t.changedBy, t.createdAt),
    check("lead_status_changes_differs", sql`${t.fromStatus} <> ${t.toStatus}`),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_action_idx").on(t.action, t.createdAt),
    index("audit_log_actor_idx").on(t.actorId, t.createdAt),
  ],
);

export const schema = {
  users,
  sessions,
  accounts,
  verifications,
  importBatches,
  leads,
  leadAssignments,
  callLogs,
  leadNotes,
  followUps,
  leadStatusChanges,
  auditLog,
};
