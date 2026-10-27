"use client";

import { useId } from "react";

import { input } from "@/components/ui/styles";
import { followUpPresets, formatDateTime } from "@/lib/time";

const PRESET_LABELS = followUpPresets(new Date()).map((p) => p.label);

/** `yyyy-MM-ddTHH:mm` in the browser's time zone, for a datetime-local input. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Quick picks plus a custom date and time. Presets are worked out at click
 * time, so a page left open for an hour still books "in 2 hours" correctly.
 */
export default function FollowUpPicker({
  value,
  onChange,
  required = false,
  disabled = false,
}: {
  value: Date | null;
  onChange: (date: Date | null) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const customId = useId();
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-sm font-medium text-slate-700">
        Follow-up {required ? <span className="text-red-700">(required)</span> : <span className="font-normal text-slate-500">(optional)</span>}
      </legend>
      <div className="flex flex-wrap gap-2">
        {PRESET_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => onChange(followUpPresets(new Date())[i].at)}
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {label}
          </button>
        ))}
        {value && !required && (
          <button type="button" onClick={() => onChange(null)} className="px-2 text-xs font-medium text-slate-500 hover:text-slate-800">
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={customId} className="text-xs text-slate-500">
          Or pick a time (your local time)
        </label>
        <input
          id={customId}
          type="datetime-local"
          className={`${input} w-auto py-1`}
          value={value ? toLocalInput(value) : ""}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value) : null)}
        />
      </div>
      {value && (
        <p className="text-xs text-slate-600" aria-live="polite">
          Booked for <strong>{formatDateTime(value)}</strong> (UK time)
        </p>
      )}
    </fieldset>
  );
}
