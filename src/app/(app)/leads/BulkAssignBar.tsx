"use client";

import { useId, useState, useTransition } from "react";

import FormMessage from "@/components/ui/FormMessage";
import { buttonPrimary, buttonSecondary, input, label } from "@/components/ui/styles";
import type { AssignProblem } from "@/server/dal/assignments";

import { assignLeadsAction } from "./actions";

export interface AssignOption {
  id: string;
  name: string;
}

const UNASSIGN = "__unassign__";
const MAX_REASON = 500;

/**
 * Assign the ticked leads to one person, or unassign them. Two steps (pick,
 * then confirm) so a stray click can't move a caller's whole list. The
 * server applies all or nothing; if any lead can't be changed, each one is
 * listed and can be dropped from the selection.
 */
export default function BulkAssignBar({
  selected,
  assignees,
  onDone,
  onDeselect,
}: {
  /** Selected lead id → the assignee shown when it was ticked. */
  selected: ReadonlyMap<string, string | null>;
  assignees: AssignOption[];
  onDone: () => void;
  onDeselect: (ids: string[]) => void;
}) {
  const ids = useId();
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<AssignProblem[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  const count = selected.size;
  if (count === 0 && !success) return null;

  const targetName = target === UNASSIGN ? null : (assignees.find((a) => a.id === target)?.name ?? null);
  const plural = (n: number) => `${n.toLocaleString("en-GB")} lead${n === 1 ? "" : "s"}`;

  function submit() {
    setError(null);
    setProblems([]);
    setSuccess(null);
    startTransition(async () => {
      const leadIds = [...selected.keys()];
      const result = await assignLeadsAction({
        leadIds,
        toUserId: target === UNASSIGN ? null : target,
        expected: Object.fromEntries(selected),
        reason: reason.trim() || undefined,
      });
      setConfirming(false);
      if (result.ok) {
        const verb = targetName ? `Assigned to ${targetName}` : "Unassigned";
        const skipped = result.unchanged > 0 ? ` (${plural(result.unchanged)} already there)` : "";
        setSuccess(`${verb}: ${plural(result.changed)}${skipped}.`);
        setReason("");
        onDone();
      } else {
        setError(result.message);
        setProblems("problems" in result ? result.problems : []);
      }
    });
  }

  if (count === 0) {
    return (
      <div className="flex items-center justify-between gap-3">
        <FormMessage success={success} />
        <button type="button" className="text-sm text-slate-500 hover:text-slate-800" onClick={() => setSuccess(null)}>
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <section
      aria-label="Assign selected leads"
      className="sticky top-2 z-10 flex flex-col gap-3 rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-300"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <p className="text-sm font-medium text-slate-800 lg:pb-2" aria-live="polite">
          {plural(count)} selected
        </p>
        <div className="flex flex-col gap-1 lg:w-56">
          <label htmlFor={`${ids}-to`} className={label}>
            Assign to
          </label>
          <select
            id={`${ids}-to`}
            className={input}
            value={target}
            disabled={pending}
            onChange={(e) => {
              setTarget(e.target.value);
              setConfirming(false);
            }}
          >
            <option value="">Choose…</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            <option value={UNASSIGN}>Nobody (unassign)</option>
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={`${ids}-reason`} className={label}>
            Reason <span className="font-normal text-slate-400">(optional, kept in the history)</span>
          </label>
          <input
            id={`${ids}-reason`}
            className={input}
            value={reason}
            maxLength={MAX_REASON}
            disabled={pending}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Covering while Sam is away"
          />
        </div>
        <div className="flex gap-2">
          {confirming ? (
            <>
              <button type="button" className={buttonPrimary} disabled={pending} onClick={submit}>
                {pending ? "Saving…" : targetName ? `Assign ${plural(count)} to ${targetName}` : `Unassign ${plural(count)}`}
              </button>
              <button type="button" className={buttonSecondary} disabled={pending} onClick={() => setConfirming(false)}>
                Back
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={buttonPrimary}
                disabled={!target}
                onClick={() => {
                  setError(null);
                  setProblems([]);
                  setConfirming(true);
                }}
              >
                Continue
              </button>
              <button type="button" className={buttonSecondary} onClick={onDone}>
                Clear selection
              </button>
            </>
          )}
        </div>
      </div>

      {confirming && (
        <p className="text-sm text-slate-600">
          {targetName
            ? `${targetName} will see these leads in their list straight away. Whoever had them loses access, but every call and note stays on the lead.`
            : "These leads will go back to the unassigned pool. Their calls and notes stay on the lead."}
        </p>
      )}

      <FormMessage error={error} />
      {problems.length > 0 && (
        <div className="flex flex-col gap-2">
          <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm text-slate-700">
            {problems.map((p) => (
              <li key={p.leadId}>
                <span className="font-medium">{p.name ?? "Unknown lead"}</span>: {p.message}
              </li>
            ))}
          </ul>
          <div>
            <button
              type="button"
              className={buttonSecondary}
              onClick={() => {
                onDeselect(problems.map((p) => p.leadId));
                setProblems([]);
                setError(null);
              }}
            >
              Remove {plural(problems.length)} from the selection
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
