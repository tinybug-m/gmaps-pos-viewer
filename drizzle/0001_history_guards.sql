-- Database-level backstop for the rule that history is never edited or deleted.
-- The DAL has no UPDATE/DELETE path for these tables; these triggers make sure
-- nothing else (a script, a console session, a future bug) can rewrite them either.
--
-- Allowed changes:
--   audit_log, lead_status_changes  insert only
--   call_logs, lead_notes           insert; void once (voided_at/by/reason, nothing else)
--   lead_assignments                insert; close an open row once (ended_at/by, nothing else)
--   follow_ups                      insert; complete or cancel an open row once
--
-- Rollback: DROP TRIGGER ... ON <table>; DROP FUNCTION history_*; (no data is touched).

CREATE FUNCTION history_reject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'history_append_only: % on % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;
--> statement-breakpoint
-- UPDATE is allowed only when TG_ARGV[0] (the "closed" marker column) goes from
-- NULL to set, and no column outside TG_ARGV changes.
CREATE FUNCTION history_close_once() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  marker text := TG_ARGV[0];
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  col text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'history_append_only: DELETE on % is not allowed', TG_TABLE_NAME;
  END IF;
  IF old_row ->> marker IS NOT NULL OR new_row ->> marker IS NULL THEN
    RAISE EXCEPTION 'history_append_only: % on % may only close an open row once', TG_OP, TG_TABLE_NAME;
  END IF;
  FOREACH col IN ARRAY TG_ARGV LOOP
    old_row := old_row - col;
    new_row := new_row - col;
  END LOOP;
  IF old_row IS DISTINCT FROM new_row THEN
    RAISE EXCEPTION 'history_append_only: % on % changed a recorded column', TG_OP, TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- follow_ups closes through either of two marker columns.
CREATE FUNCTION history_follow_up_close() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD) - 'completed_at' - 'completed_by' - 'completed_by_call_id' - 'cancelled_at' - 'cancelled_by';
  new_row jsonb := to_jsonb(NEW) - 'completed_at' - 'completed_by' - 'completed_by_call_id' - 'cancelled_at' - 'cancelled_by';
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'history_append_only: DELETE on % is not allowed', TG_TABLE_NAME;
  END IF;
  IF OLD.completed_at IS NOT NULL OR OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'history_append_only: % on % may only close an open row once', TG_OP, TG_TABLE_NAME;
  END IF;
  IF old_row IS DISTINCT FROM new_row THEN
    RAISE EXCEPTION 'history_append_only: % on % changed a recorded column', TG_OP, TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION history_reject();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION history_reject();
--> statement-breakpoint
CREATE TRIGGER lead_status_changes_append_only BEFORE UPDATE OR DELETE ON lead_status_changes
  FOR EACH ROW EXECUTE FUNCTION history_reject();
--> statement-breakpoint
CREATE TRIGGER lead_status_changes_no_truncate BEFORE TRUNCATE ON lead_status_changes
  FOR EACH STATEMENT EXECUTE FUNCTION history_reject();
--> statement-breakpoint
CREATE TRIGGER call_logs_void_only BEFORE UPDATE OR DELETE ON call_logs
  FOR EACH ROW EXECUTE FUNCTION history_close_once('voided_at', 'voided_by', 'void_reason');
--> statement-breakpoint
CREATE TRIGGER call_logs_no_truncate BEFORE TRUNCATE ON call_logs
  FOR EACH STATEMENT EXECUTE FUNCTION history_reject();
--> statement-breakpoint
CREATE TRIGGER lead_notes_void_only BEFORE UPDATE OR DELETE ON lead_notes
  FOR EACH ROW EXECUTE FUNCTION history_close_once('voided_at', 'voided_by', 'void_reason');
--> statement-breakpoint
CREATE TRIGGER lead_notes_no_truncate BEFORE TRUNCATE ON lead_notes
  FOR EACH STATEMENT EXECUTE FUNCTION history_reject();
--> statement-breakpoint
CREATE TRIGGER lead_assignments_close_only BEFORE UPDATE OR DELETE ON lead_assignments
  FOR EACH ROW EXECUTE FUNCTION history_close_once('ended_at', 'ended_by');
--> statement-breakpoint
CREATE TRIGGER lead_assignments_no_truncate BEFORE TRUNCATE ON lead_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION history_reject();
--> statement-breakpoint
CREATE TRIGGER follow_ups_close_only BEFORE UPDATE OR DELETE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION history_follow_up_close();
--> statement-breakpoint
CREATE TRIGGER follow_ups_no_truncate BEFORE TRUNCATE ON follow_ups
  FOR EACH STATEMENT EXECUTE FUNCTION history_reject();
