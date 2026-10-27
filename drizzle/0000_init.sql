CREATE TYPE "public"."call_outcome" AS ENUM('no_answer', 'busy', 'voicemail', 'gatekeeper', 'callback_requested', 'interested', 'not_interested', 'wrong_number', 'do_not_call');--> statement-breakpoint
CREATE TYPE "public"."note_kind" AS ENUM('note', 'feedback');--> statement-breakpoint
CREATE TYPE "public"."pipeline_status" AS ENUM('new', 'in_progress', 'callback', 'interested', 'closed_won', 'closed_lost', 'invalid', 'do_not_call');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'supervisor', 'caller');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"outcome" "call_outcome" NOT NULL,
	"status_before" "pipeline_status" NOT NULL,
	"status_after" "pipeline_status" NOT NULL,
	"notes" text,
	"duration_sec" integer,
	"called_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	CONSTRAINT "call_logs_duration_range" CHECK ("call_logs"."duration_sec" is null or "call_logs"."duration_sec" between 0 and 14400),
	CONSTRAINT "call_logs_notes_length" CHECK ("call_logs"."notes" is null or char_length("call_logs"."notes") <= 5000),
	CONSTRAINT "call_logs_void_complete" CHECK (("call_logs"."voided_at" is null and "call_logs"."voided_by" is null and "call_logs"."void_reason" is null) or ("call_logs"."voided_at" is not null and "call_logs"."voided_by" is not null and "call_logs"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"completed_by_call_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	CONSTRAINT "follow_ups_not_both_closed" CHECK ("follow_ups"."completed_at" is null or "follow_ups"."cancelled_at" is null),
	CONSTRAINT "follow_ups_complete_pair" CHECK (("follow_ups"."completed_at" is null) = ("follow_ups"."completed_by" is null)),
	CONSTRAINT "follow_ups_cancel_pair" CHECK (("follow_ups"."cancelled_at" is null) = ("follow_ups"."cancelled_by" is null)),
	CONSTRAINT "follow_ups_note_length" CHECK ("follow_ups"."note" is null or char_length("follow_ups"."note") <= 5000)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"imported_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"total" integer NOT NULL,
	"inserted" integer NOT NULL,
	"updated" integer NOT NULL,
	"unchanged" integer NOT NULL,
	"invalid" integer NOT NULL,
	"duplicates" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"assigned_to" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	CONSTRAINT "lead_assignments_end_pair" CHECK (("lead_assignments"."ended_at" is null) = ("lead_assignments"."ended_by" is null)),
	CONSTRAINT "lead_assignments_end_after_start" CHECK ("lead_assignments"."ended_at" is null or "lead_assignments"."ended_at" >= "lead_assignments"."started_at")
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" "note_kind" DEFAULT 'note' NOT NULL,
	"about_user_id" uuid,
	"call_log_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	CONSTRAINT "lead_notes_body_length" CHECK (char_length("lead_notes"."body") between 1 and 5000),
	CONSTRAINT "lead_notes_about_only_feedback" CHECK ("lead_notes"."about_user_id" is null or "lead_notes"."kind" = 'feedback'),
	CONSTRAINT "lead_notes_void_complete" CHECK (("lead_notes"."voided_at" is null and "lead_notes"."voided_by" is null and "lead_notes"."void_reason" is null) or ("lead_notes"."voided_at" is not null and "lead_notes"."voided_by" is not null and "lead_notes"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "lead_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_status" "pipeline_status" NOT NULL,
	"to_status" "pipeline_status" NOT NULL,
	"changed_by" uuid NOT NULL,
	"call_log_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_status_changes_differs" CHECK ("lead_status_changes"."from_status" <> "lead_status_changes"."to_status")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"legacy_slug" text,
	"raw" jsonb NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"source" text NOT NULL,
	"pipeline_status" "pipeline_status" DEFAULT 'new' NOT NULL,
	"assigned_to" uuid,
	"assigned_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_call_at" timestamp with time zone,
	"last_outcome" "call_outcome",
	"review_requested_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"first_import_id" uuid,
	"last_import_id" uuid,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "leads_assignment_pair" CHECK (("leads"."assigned_to" is null) = ("leads"."assigned_at" is null)),
	CONSTRAINT "leads_archive_pair" CHECK (("leads"."archived_at" is null) = ("leads"."archived_by" is null)),
	CONSTRAINT "leads_attempts_nonneg" CHECK ("leads"."attempt_count" >= 0),
	CONSTRAINT "leads_version_positive" CHECK ("leads"."version" >= 1),
	CONSTRAINT "leads_source_known" CHECK ("leads"."source" in ('google-maps', 'trustpilot'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'caller' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_failed_logins_nonneg" CHECK ("users"."failed_logins" >= 0)
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_completed_by_call_id_call_logs_id_fk" FOREIGN KEY ("completed_by_call_id") REFERENCES "public"."call_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_about_user_id_users_id_fk" FOREIGN KEY ("about_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_call_log_id_call_logs_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_status_changes" ADD CONSTRAINT "lead_status_changes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_status_changes" ADD CONSTRAINT "lead_status_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_status_changes" ADD CONSTRAINT "lead_status_changes_call_log_id_call_logs_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_first_import_id_import_batches_id_fk" FOREIGN KEY ("first_import_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_last_import_id_import_batches_id_fk" FOREIGN KEY ("last_import_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_uq" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "call_logs_lead_idx" ON "call_logs" USING btree ("lead_id","called_at");--> statement-breakpoint
CREATE INDEX "call_logs_user_idx" ON "call_logs" USING btree ("user_id","called_at");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_ups_one_open_uq" ON "follow_ups" USING btree ("lead_id") WHERE "follow_ups"."completed_at" is null and "follow_ups"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "follow_ups_open_due_idx" ON "follow_ups" USING btree ("due_at") WHERE "follow_ups"."completed_at" is null and "follow_ups"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "follow_ups_lead_idx" ON "follow_ups" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_assignments_one_active_uq" ON "lead_assignments" USING btree ("lead_id") WHERE "lead_assignments"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "lead_assignments_lead_idx" ON "lead_assignments" USING btree ("lead_id","started_at");--> statement-breakpoint
CREATE INDEX "lead_assignments_user_idx" ON "lead_assignments" USING btree ("assigned_to","started_at");--> statement-breakpoint
CREATE INDEX "lead_notes_lead_idx" ON "lead_notes" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_notes_author_idx" ON "lead_notes" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_status_changes_lead_idx" ON "lead_status_changes" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_status_changes_user_idx" ON "lead_status_changes" USING btree ("changed_by","created_at");--> statement-breakpoint
CREATE INDEX "leads_assignee_status_idx" ON "leads" USING btree ("assigned_to","pipeline_status");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("pipeline_status");--> statement-breakpoint
CREATE INDEX "leads_review_idx" ON "leads" USING btree ("review_requested_at") WHERE "leads"."review_requested_at" is not null;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");