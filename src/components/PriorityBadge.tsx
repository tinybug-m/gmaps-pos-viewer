import type { LeadPriority } from "@/types/lead";

const PRIORITY_STYLES: Record<LeadPriority, string> = {
  High: "bg-red-50 text-red-700 ring-red-600/20",
  Medium: "bg-amber-50 text-amber-700 ring-amber-600/20",
  Low: "bg-slate-100 text-slate-600 ring-slate-500/20",
  "Manual Review": "bg-violet-50 text-violet-700 ring-violet-600/20",
};

const PRIORITY_DOT: Record<LeadPriority, string> = {
  High: "bg-red-500",
  Medium: "bg-amber-500",
  Low: "bg-slate-400",
  "Manual Review": "bg-violet-500",
};

export default function PriorityBadge({ priority }: { priority: LeadPriority }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${PRIORITY_STYLES[priority]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[priority]}`} aria-hidden />
      {priority}
    </span>
  );
}
