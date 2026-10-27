"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import FormMessage from "@/components/ui/FormMessage";
import { buttonDanger, buttonPrimary, buttonSecondary, card, input, label } from "@/components/ui/styles";
import { formatDateTime } from "@/lib/time";
import {
  checkTransition,
  isTerminal,
  PIPELINE_LABEL,
  PIPELINE_STATUSES,
  requiresFollowUp,
  type PipelineStatus,
  type Role,
} from "@/lib/workflow";

import { addNoteAction, cancelFollowUpAction, changeStatusAction, setFollowUpAction, voidEntryAction } from "./actions";
import FollowUpPicker from "./FollowUpPicker";

type ActionResult = { ok: true } | { ok: false; code: string; message: string };

/** Pending state, error and refresh-on-conflict, shared by the small forms below. */
function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  function run(action: () => Promise<ActionResult>, onDone: () => void, message: string) {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        if (result.code === "conflict") router.refresh();
        return;
      }
      onDone();
      setSuccess(message);
    });
  }
  return { pending, error, success, run };
}

/** Change the status without logging a call, e.g. to close a lead after an email. */
export function StatusChanger({ leadId, version, status, role }: { leadId: string; version: number; status: PipelineStatus; role: Role }) {
  const selectId = useId();
  const reasonId = useId();
  const [toStatus, setToStatus] = useState<PipelineStatus>(status);
  const [reason, setReason] = useState("");
  const [followUpAt, setFollowUpAt] = useState<Date | null>(null);
  const { pending, error, success, run } = useAction();

  const options = PIPELINE_STATUSES.filter((s) => checkTransition(status, s, role).ok);
  const changed = toStatus !== status;
  const needsReason = changed && (isTerminal(toStatus) || isTerminal(status));
  const needsDate = changed && requiresFollowUp(null, toStatus);
  const canSave = changed && (!needsReason || reason.trim().length > 0) && (!needsDate || followUpAt !== null) && !pending;

  if (options.length <= 1) return null;

  return (
    <section className={`${card} flex flex-col gap-3 p-4`} aria-labelledby="status-heading">
      <h2 id="status-heading" className="text-sm font-semibold text-slate-800">
        Change status
      </h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSave) return;
          run(
            () => changeStatusAction({ leadId, toStatus, version, reason: reason.trim() || undefined, followUpAt: followUpAt ?? undefined }),
            () => {
              setReason("");
              setFollowUpAt(null);
            },
            `Status changed to ${PIPELINE_LABEL[toStatus]}.`,
          );
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={selectId} className={label}>
            New status
          </label>
          <select id={selectId} className={input} value={toStatus} onChange={(e) => setToStatus(e.target.value as PipelineStatus)}>
            {options.map((s) => (
              <option key={s} value={s}>
                {PIPELINE_LABEL[s]}
                {s === status ? " (current)" : ""}
              </option>
            ))}
          </select>
        </div>
        {needsReason && (
          <div className="flex flex-col gap-1">
            <label htmlFor={reasonId} className={label}>
              Reason <span className="text-red-700">(required)</span>
            </label>
            <input id={reasonId} className={input} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        {needsDate && <FollowUpPicker value={followUpAt} onChange={setFollowUpAt} required />}
        <FormMessage error={error} success={success} />
        <div>
          <button type="submit" className={buttonSecondary} disabled={!canSave}>
            {pending ? "Saving…" : "Change status"}
          </button>
        </div>
      </form>
    </section>
  );
}

/** The lead's one open follow-up: see it, move it or cancel it. */
export function FollowUpPanel({
  leadId,
  status,
  openFollowUp,
}: {
  leadId: string;
  status: PipelineStatus;
  openFollowUp: { id: string; dueAt: Date; note: string | null } | null;
}) {
  const noteId = useId();
  const [editing, setEditing] = useState(false);
  const [dueAt, setDueAt] = useState<Date | null>(null);
  const [note, setNote] = useState("");
  const { pending, error, success, run } = useAction();
  const parked = status === "callback";

  return (
    <section className={`${card} flex flex-col gap-3 p-4`} aria-labelledby="follow-up-heading">
      <h2 id="follow-up-heading" className="text-sm font-semibold text-slate-800">
        Follow-up
      </h2>
      {openFollowUp ? (
        <p className="text-sm text-slate-700">
          Due <strong>{formatDateTime(openFollowUp.dueAt)}</strong>
          {openFollowUp.note && <span className="block text-slate-500">{openFollowUp.note}</span>}
        </p>
      ) : (
        <p className="text-sm text-slate-500">None booked.</p>
      )}

      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!dueAt) return;
            run(
              () => setFollowUpAction({ leadId, dueAt, note: note.trim() || undefined }),
              () => {
                setEditing(false);
                setDueAt(null);
                setNote("");
              },
              "Follow-up booked.",
            );
          }}
        >
          <FollowUpPicker value={dueAt} onChange={setDueAt} required />
          <div className="flex flex-col gap-1">
            <label htmlFor={noteId} className={label}>
              Note <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <input id={noteId} className={input} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <FormMessage error={error} />
          <div className="flex gap-2">
            <button type="submit" className={buttonPrimary} disabled={!dueAt || pending}>
              {pending ? "Saving…" : "Book follow-up"}
            </button>
            <button type="button" className={buttonSecondary} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <FormMessage error={error} success={success} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonSecondary} onClick={() => setEditing(true)}>
              {openFollowUp ? "Reschedule" : "Book a follow-up"}
            </button>
            {openFollowUp && (
              <button
                type="button"
                className={buttonDanger}
                disabled={pending || parked}
                title={parked ? "A callback lead needs a date. Reschedule it, or change the status first." : undefined}
                onClick={() => run(() => cancelFollowUpAction({ followUpId: openFollowUp.id }), () => {}, "Follow-up cancelled.")}
              >
                Cancel follow-up
              </button>
            )}
          </div>
          {openFollowUp && parked && (
            <p className="text-xs text-slate-500">This lead is parked as a callback, so it keeps a date. Reschedule it or change its status.</p>
          )}
        </>
      )}
    </section>
  );
}

/** A note anyone working the lead can read; staff can mark it as feedback for the caller. */
export function NoteForm({ leadId, canFeedback, assigneeName }: { leadId: string; canFeedback: boolean; assigneeName: string | null }) {
  const bodyId = useId();
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"note" | "feedback">("note");
  const { pending, error, success, run } = useAction();

  return (
    <section className={`${card} flex flex-col gap-3 p-4`} aria-labelledby="note-heading">
      <h2 id="note-heading" className="text-sm font-semibold text-slate-800">
        Add a note
      </h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          run(
            () => addNoteAction({ leadId, body: body.trim(), kind }),
            () => setBody(""),
            kind === "feedback" ? "Feedback saved." : "Note saved.",
          );
        }}
      >
        {canFeedback && (
          <fieldset className="flex flex-wrap gap-4 text-sm text-slate-700">
            <legend className="sr-only">Kind of note</legend>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="kind" checked={kind === "note"} onChange={() => setKind("note")} />
              Note
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="kind"
                checked={kind === "feedback"}
                disabled={!assigneeName}
                onChange={() => setKind("feedback")}
              />
              Feedback{assigneeName ? ` for ${assigneeName}` : " (assign the lead first)"}
            </label>
          </fieldset>
        )}
        <label htmlFor={bodyId} className="sr-only">
          Note
        </label>
        <textarea id={bodyId} rows={3} maxLength={5000} className={input} value={body} onChange={(e) => setBody(e.target.value)} />
        <FormMessage error={error} success={success} />
        <div>
          <button type="submit" className={buttonSecondary} disabled={!body.trim() || pending}>
            {pending ? "Saving…" : kind === "feedback" ? "Save feedback" : "Save note"}
          </button>
        </div>
      </form>
    </section>
  );
}

/** Admin-only: strike a call or note out of the counts. The row stays, with who voided it and why. */
export function VoidButton({ type, entryId }: { type: "call" | "note"; entryId: string }) {
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, error, run } = useAction();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-slate-500 hover:text-red-700">
        Void
      </button>
    );
  }
  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => voidEntryAction({ type, entryId, reason: reason.trim() }), () => setOpen(false), "");
      }}
    >
      <label htmlFor={reasonId} className="text-xs font-medium text-slate-700">
        Why is this {type} being voided?
      </label>
      <input id={reasonId} className={`${input} py-1`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      <FormMessage error={error} />
      <div className="flex gap-2">
        <button type="submit" className={`${buttonDanger} py-1`} disabled={reason.trim().length < 3 || pending}>
          {pending ? "Voiding…" : `Void ${type}`}
        </button>
        <button type="button" className={`${buttonSecondary} py-1`} onClick={() => setOpen(false)}>
          Keep
        </button>
      </div>
    </form>
  );
}
