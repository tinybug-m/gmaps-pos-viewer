import type { LeadPriority } from "@/types/lead";

const PRIORITY_STYLES: Record<LeadPriority, string> = {
  High: "bg-red-50 text-red-800",
  Medium: "bg-amber-50 text-amber-800",
  Low: "bg-slate-100 text-slate-600",
  "Manual Review": "bg-sky-50 text-sky-700",
};

const PRIORITY_DOT: Record<LeadPriority, string> = {
  High: "bg-red-500",
  Medium: "bg-amber-500",
  Low: "bg-slate-400",
  "Manual Review": "bg-sky-500",
};

export default function PriorityBadge({ priority }: { priority: LeadPriority }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${PRIORITY_STYLES[priority]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[priority]}`} aria-hidden />
      {priority}
    </span>
  );
}
