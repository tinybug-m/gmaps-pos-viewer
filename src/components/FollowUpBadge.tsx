import { formatDateTime, type FollowUpBucket } from "@/lib/time";

const BUCKET: Record<FollowUpBucket, { label: string; className: string }> = {
  overdue: { label: "Overdue", className: "bg-red-50 text-red-800" },
  today: { label: "Today", className: "bg-amber-50 text-amber-800" },
  upcoming: { label: "Upcoming", className: "bg-slate-100 text-slate-600" },
};

/** A lead's open follow-up: how urgent it is, then when it's due. */
export default function FollowUpBadge({ dueAt, bucket }: { dueAt: Date; bucket: FollowUpBucket }) {
  const { label, className } = BUCKET[bucket];
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
        {label}
      </span>
      <time dateTime={dueAt.toISOString()} className="whitespace-nowrap text-xs tabular-nums text-slate-500">
        {formatDateTime(dueAt)}
      </time>
    </span>
  );
}
