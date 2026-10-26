/**
 * Lead workflow vocabulary. A call *outcome* records what happened on one
 * call; the *pipeline status* records where the lead stands. They are kept
 * separate: logging a call only suggests a status, it never closes a lead
 * on its own.
 */

export const PIPELINE_STATUSES = [
  "new",
  "in_progress",
  "callback",
  "interested",
  "closed_won",
  "closed_lost",
  "invalid",
  "do_not_call",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const CALL_OUTCOMES = [
  "no_answer",
  "busy",
  "voicemail",
  "gatekeeper",
  "callback_requested",
  "interested",
  "not_interested",
  "wrong_number",
  "do_not_call",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const ROLES = ["admin", "supervisor", "caller"] as const;
export type Role = (typeof ROLES)[number];

const TERMINAL: ReadonlySet<PipelineStatus> = new Set(["closed_won", "closed_lost", "invalid", "do_not_call"]);

export function isTerminal(status: PipelineStatus): boolean {
  return TERMINAL.has(status);
}

export const PIPELINE_LABEL: Record<PipelineStatus, string> = {
  new: "New",
  in_progress: "In progress",
  callback: "Callback",
  interested: "Interested",
  closed_won: "Won",
  closed_lost: "Lost",
  invalid: "Invalid",
  do_not_call: "Do not call",
};

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  no_answer: "No answer",
  busy: "Busy",
  voicemail: "Voicemail",
  gatekeeper: "Gatekeeper",
  callback_requested: "Callback requested",
  interested: "Interested",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
  do_not_call: "Do not call",
};

/** Outcomes where nobody relevant was reached. Everything else counts as a connect. */
const NON_CONNECT: ReadonlySet<CallOutcome> = new Set(["no_answer", "busy", "voicemail"]);

export function isConnect(outcome: CallOutcome): boolean {
  return !NON_CONNECT.has(outcome);
}

/** The status the call form pre-selects for an outcome; the caller can change it before saving. */
export function suggestedStatus(outcome: CallOutcome, current: PipelineStatus): PipelineStatus {
  switch (outcome) {
    case "no_answer":
    case "busy":
    case "voicemail":
    case "gatekeeper":
      return current === "new" ? "in_progress" : current;
    case "callback_requested":
      return "callback";
    case "interested":
      return "interested";
    case "not_interested":
      return current === "new" ? "in_progress" : current;
    case "wrong_number":
      return "invalid";
    case "do_not_call":
      return "do_not_call";
  }
}

/** A requested callback, or a lead parked in `callback`, must have a date to call back on. */
export function requiresFollowUp(outcome: CallOutcome | null, status: PipelineStatus): boolean {
  return outcome === "callback_requested" || status === "callback";
}

export type TransitionCheck = { ok: true; changed: boolean } | { ok: false; reason: string };

/**
 * Whether `role` may move a lead from `from` to `to`. Supervisors never
 * change status; reopening a closed lead is admin-only.
 */
export function checkTransition(from: PipelineStatus, to: PipelineStatus, role: Role): TransitionCheck {
  if (role === "supervisor") return { ok: false, reason: "Supervisors can't change a lead's status." };
  if (from === to) return { ok: true, changed: false };
  if (isTerminal(from) && role !== "admin") {
    return { ok: false, reason: `This lead is ${PIPELINE_LABEL[from].toLowerCase()}; only an admin can reopen it.` };
  }
  if (to === "new" && role !== "admin") {
    return { ok: false, reason: "Only an admin can reset a lead to new." };
  }
  return { ok: true, changed: true };
}
