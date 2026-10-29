"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import FormMessage from "@/components/ui/FormMessage";
import { buttonPrimary, buttonSecondary, card, input, label } from "@/components/ui/styles";
import {
  CALL_OUTCOMES,
  checkTransition,
  isTerminal,
  OUTCOME_LABEL,
  PIPELINE_LABEL,
  PIPELINE_STATUSES,
  requiresFollowUp,
  suggestedStatus,
  type CallOutcome,
  type PipelineStatus,
  type Role,
} from "@/lib/workflow";

import { logCallAction } from "./actions";
import FollowUpPicker from "./FollowUpPicker";

/**
 * Record one call. Picking an outcome pre-selects the usual status, which
 * the caller can change; nothing closes the lead unless they choose it.
 * Keys 1–9 pick an outcome and Ctrl/⌘+Enter saves.
 */
export default function CallLogger({
  leadId,
  version,
  status,
  role,
  nextLeadId,
}: {
  leadId: string;
  version: number;
  status: PipelineStatus;
  role: Role;
  nextLeadId: string | null;
}) {
  const router = useRouter();
  const notesId = useId();
  const statusId = useId();
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [chosenStatus, setNewStatus] = useState<PipelineStatus>(status);
  // After a refresh the lead may have moved on; fall back to its current status instead of submitting one that is no longer offered.
  const allowedStatuses = PIPELINE_STATUSES.filter((s) => checkTransition(status, s, role).ok);
  const newStatus = allowedStatuses.includes(chosenStatus) ? chosenStatus : status;
  const [followUpAt, setFollowUpAt] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needsDate = outcome !== null && requiresFollowUp(outcome, newStatus);
  const canSave = outcome !== null && (!needsDate || followUpAt !== null) && !pending;

  function pick(o: CallOutcome) {
    setOutcome(o);
    setNewStatus(suggestedStatus(o, status));
    setError(null);
    setSuccess(null);
  }

  function save(andNext: boolean) {
    if (!outcome || !canSave) return;
    setError(null);
    startTransition(async () => {
      const result = await logCallAction({
        leadId,
        outcome,
        newStatus,
        notes: notes.trim() || undefined,
        followUpAt: followUpAt ?? undefined,
        version,
      });
      if (!result.ok) {
        // Keep the draft; a conflict means the lead moved on, so show its new state.
        setError(result.message);
        if (result.code === "conflict") router.refresh();
        return;
      }
      if (andNext && nextLeadId) {
        router.push(`/leads/${nextLeadId}`);
        return;
      }
      setOutcome(null);
      setNotes("");
      setFollowUpAt(null);
      setNewStatus(result.status);
      setSuccess(`Call saved. Status: ${PIPELINE_LABEL[result.status]}.`);
    });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        // Inside another form (a note, a void reason) the shortcut belongs to that form.
        if ((e.target as HTMLElement).closest("form")) return;
        e.preventDefault();
        save(nextLeadId !== null);
        return;
      }
      const target = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || target.closest("input, textarea, select, [contenteditable]")) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= CALL_OUTCOMES.length) pick(CALL_OUTCOMES[n - 1]);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  return (
    <section className={`${card} flex flex-col gap-4 p-4`} aria-labelledby="log-call-heading">
      <h2 id="log-call-heading" className="text-sm font-semibold text-slate-800">
        Log a call
      </h2>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-slate-700">What happened?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CALL_OUTCOMES.map((o, i) => (
            <button
              key={o}
              type="button"
              aria-pressed={outcome === o}
              onClick={() => pick(o)}
              className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium ${
                outcome === o
                  ? "border-slate-800 bg-slate-800 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {OUTCOME_LABEL[o]}
              <kbd className={`text-xs ${outcome === o ? "text-slate-300" : "text-slate-500"}`} aria-hidden>
                {i + 1}
              </kbd>
            </button>
          ))}
        </div>
      </fieldset>

      {outcome && (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={statusId} className={label}>
              Lead status after this call
            </label>
            <select
              id={statusId}
              className={input}
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as PipelineStatus)}
            >
              {allowedStatuses.map((s) => (
                <option key={s} value={s}>
                  {PIPELINE_LABEL[s]}
                  {s === status ? " (unchanged)" : ""}
                </option>
              ))}
            </select>
            {isTerminal(newStatus) && newStatus !== status && (
              <p className="text-xs text-amber-800">This closes the lead. It leaves your queue.</p>
            )}
          </div>

          {!isTerminal(newStatus) && <FollowUpPicker value={followUpAt} onChange={setFollowUpAt} required={needsDate} />}

          <div className="flex flex-col gap-1">
            <label htmlFor={notesId} className={label}>
              Notes <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <textarea
              id={notesId}
              rows={3}
              maxLength={5000}
              className={input}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Who you spoke to, what they said…"
            />
          </div>
        </>
      )}

      <FormMessage error={error} success={success} />

      <div className="flex flex-wrap gap-2">
        {nextLeadId && (
          <button type="button" className={buttonPrimary} disabled={!canSave} onClick={() => save(true)}>
            {pending ? "Saving…" : "Save & next"}
          </button>
        )}
        <button
          type="button"
          className={nextLeadId ? buttonSecondary : buttonPrimary}
          disabled={!canSave}
          onClick={() => save(false)}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {!outcome && <span className="self-center text-xs text-slate-500">Pick what happened to save. Ctrl+Enter saves.</span>}
        {needsDate && !followUpAt && <span className="self-center text-xs text-slate-500">Pick a follow-up time to save.</span>}
      </div>
    </section>
  );
}
