import PipelineBadge from "@/components/PipelineBadge";
import { card } from "@/components/ui/styles";
import { formatDateTime } from "@/lib/time";
import { OUTCOME_LABEL } from "@/lib/workflow";
import type { TimelineEntry } from "@/server/dal/activity";

import { VoidButton } from "./LeadControls";

const FOLLOW_UP_STATE = { open: "open", completed: "done", cancelled: "cancelled" } as const;

function duration(sec: number): string {
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m} min ${sec % 60} s` : `${sec} s`;
}

/** Everything recorded on the lead, newest first. Voided entries stay visible, struck through, with the reason. */
export default function Timeline({ entries, canVoid }: { entries: TimelineEntry[]; canVoid: boolean }) {
  return (
    <section className={`${card} p-4`} aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className="mb-3 text-sm font-semibold text-slate-800">
        History
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing recorded yet.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-slate-100">
          {entries.map((e) => (
            <li key={`${e.kind}-${e.id}`} className="py-3 first:pt-0 last:pb-0">
              <Entry entry={e} canVoid={canVoid} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Meta({ entry, label }: { entry: TimelineEntry; label: string }) {
  return (
    <p className="text-xs text-slate-500">
      <span className="font-medium text-slate-700">{label}</span> · {entry.by.name} ·{" "}
      <time dateTime={entry.at.toISOString()}>{formatDateTime(entry.at)}</time>
    </p>
  );
}

function Entry({ entry: e, canVoid }: { entry: TimelineEntry; canVoid: boolean }) {
  switch (e.kind) {
    case "call":
      return (
        <div className={e.voided ? "opacity-60" : undefined}>
          <Meta entry={e} label="Call" />
          <p className={`mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-800 ${e.voided ? "line-through" : ""}`}>
            {OUTCOME_LABEL[e.outcome]}
            {e.durationSec !== null && <span className="text-xs text-slate-500">{duration(e.durationSec)}</span>}
          </p>
          {e.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{e.notes}</p>}
          <Voided entry={e} canVoid={canVoid} type="call" />
        </div>
      );
    case "note":
    case "feedback":
      return (
        <div className={e.voided ? "opacity-60" : undefined}>
          <Meta entry={e} label={e.kind === "feedback" ? `Feedback${e.about ? ` for ${e.about.name}` : ""}` : "Note"} />
          <p
            className={`mt-1 whitespace-pre-wrap text-sm ${
              e.kind === "feedback" ? "rounded-md bg-amber-50 px-3 py-2 text-amber-900" : "text-slate-700"
            } ${e.voided ? "line-through" : ""}`}
          >
            {e.body ?? <span className="italic">Text removed when voided.</span>}
          </p>
          <Voided entry={e} canVoid={canVoid} type="note" />
        </div>
      );
    case "status":
      return (
        <div>
          <Meta entry={e} label={e.viaCall ? "Status (from call)" : "Status"} />
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
            <PipelineBadge status={e.from} /> <span aria-label="to">→</span> <PipelineBadge status={e.to} />
          </p>
          {e.reason && <p className="mt-1 text-sm text-slate-600">{e.reason}</p>}
        </div>
      );
    case "followUp":
      return (
        <div>
          <Meta entry={e} label={`Follow-up (${FOLLOW_UP_STATE[e.state]})`} />
          <p className="mt-1 text-sm text-slate-700">
            Due <time dateTime={e.dueAt.toISOString()}>{formatDateTime(e.dueAt)}</time>
            {e.note && <span className="text-slate-500"> · {e.note}</span>}
          </p>
        </div>
      );
    case "assignment":
      return (
        <div>
          <Meta entry={e} label={e.to ? "Assigned" : "Unassigned"} />
          <p className="mt-1 text-sm text-slate-700">
            {e.to ? `To ${e.to.name}` : "Back in the unassigned pool"}
            {e.reason && <span className="text-slate-500"> · {e.reason}</span>}
          </p>
        </div>
      );
  }
}

function Voided({
  entry,
  canVoid,
  type,
}: {
  entry: Extract<TimelineEntry, { voided: unknown }>;
  canVoid: boolean;
  type: "call" | "note";
}) {
  if (entry.voided) {
    return (
      <p className="mt-1 text-xs text-red-700">
        Voided by {entry.voided.by.name}, {formatDateTime(entry.voided.at)}: {entry.voided.reason}
      </p>
    );
  }
  return canVoid ? <VoidButton type={type} entryId={entry.id} /> : null;
}
