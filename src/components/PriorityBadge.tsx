import type { LeadPriority } from "@/types/lead";

const PRIORITY_STYLES: Record<LeadPriority, string> = {
  High: "bg-red-600 text-white",
  Medium: "bg-amber-400 text-amber-950",
  Low: "bg-slate-200 text-slate-700",
  "Manual Review": "bg-violet-100 text-violet-700 ring-1 ring-inset ring-violet-600/20",
};

export default function PriorityBadge({ priority }: { priority: LeadPriority }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${PRIORITY_STYLES[priority]}`}
    >
      {priority}
    </span>
  );
}
