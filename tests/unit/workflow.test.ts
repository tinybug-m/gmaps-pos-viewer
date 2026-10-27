import { describe, expect, it } from "vitest";

import {
  CALL_OUTCOMES,
  checkTransition,
  isConnect,
  isTerminal,
  needsReview,
  PIPELINE_STATUSES,
  requiresFollowUp,
  suggestedStatus,
} from "@/lib/workflow";

describe("suggestedStatus", () => {
  it.each([
    ["no_answer", "new", "in_progress"],
    ["no_answer", "interested", "interested"],
    ["busy", "callback", "callback"],
    ["voicemail", "new", "in_progress"],
    ["gatekeeper", "in_progress", "in_progress"],
    ["callback_requested", "new", "callback"],
    ["interested", "in_progress", "interested"],
    ["not_interested", "new", "in_progress"],
    ["not_interested", "interested", "interested"],
    ["wrong_number", "new", "invalid"],
    ["do_not_call", "interested", "do_not_call"],
  ] as const)("%s from %s → %s", (outcome, current, expected) => {
    expect(suggestedStatus(outcome, current)).toBe(expected);
  });

  it("never suggests closing a lead as won or lost", () => {
    for (const outcome of CALL_OUTCOMES) {
      for (const status of PIPELINE_STATUSES) {
        const s = suggestedStatus(outcome, status);
        if (s === "closed_won" || s === "closed_lost") expect(s).toBe(status);
      }
    }
  });
});

describe("rules", () => {
  it("knows terminal statuses", () => {
    expect(PIPELINE_STATUSES.filter(isTerminal)).toEqual(["closed_won", "closed_lost", "invalid", "do_not_call"]);
  });

  it("counts only reached contacts as connects", () => {
    expect(CALL_OUTCOMES.filter((o) => !isConnect(o))).toEqual(["no_answer", "busy", "voicemail"]);
  });

  it("requires a follow-up for callbacks", () => {
    expect(requiresFollowUp("callback_requested", "in_progress")).toBe(true);
    expect(requiresFollowUp("no_answer", "callback")).toBe(true);
    expect(requiresFollowUp(null, "callback")).toBe(true);
    expect(requiresFollowUp("no_answer", "in_progress")).toBe(false);
  });

  it("flags outcomes a supervisor should review", () => {
    expect(PIPELINE_STATUSES.filter(needsReview)).toEqual(["interested", "closed_won", "closed_lost", "do_not_call"]);
  });
});

describe("checkTransition", () => {
  it("lets callers move open leads forward, including closing them", () => {
    expect(checkTransition("in_progress", "closed_lost", "caller")).toEqual({ ok: true, changed: true });
    expect(checkTransition("interested", "closed_won", "caller")).toEqual({ ok: true, changed: true });
  });

  it("treats an unchanged status as a no-op", () => {
    expect(checkTransition("interested", "interested", "caller")).toEqual({ ok: true, changed: false });
    expect(checkTransition("closed_won", "closed_won", "caller")).toEqual({ ok: true, changed: false });
  });

  it("restricts reopening closed leads and resetting to new to admins", () => {
    for (const from of PIPELINE_STATUSES.filter(isTerminal)) {
      expect(checkTransition(from, "in_progress", "caller").ok).toBe(false);
      expect(checkTransition(from, "in_progress", "admin").ok).toBe(true);
    }
    expect(checkTransition("in_progress", "new", "caller").ok).toBe(false);
    expect(checkTransition("in_progress", "new", "admin").ok).toBe(true);
  });

  it("never lets supervisors change status", () => {
    expect(checkTransition("new", "in_progress", "supervisor").ok).toBe(false);
    expect(checkTransition("new", "new", "supervisor").ok).toBe(false);
  });
});
