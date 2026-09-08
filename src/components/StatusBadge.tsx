import type { LeadStatus } from "@/types/lead";

const STATUS_STYLES: Record<LeadStatus, string> = {
  POOR: "bg-red-50 text-red-700 ring-red-600/20",
  NEEDS_IMPROVEMENT: "bg-amber-50 text-amber-700 ring-amber-600/20",
  GOOD: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CRAWL_FAILED: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const STATUS_LABEL: Record<LeadStatus, string> = {
  POOR: "Poor",
  NEEDS_IMPROVEMENT: "Needs Improvement",
  GOOD: "Good",
  CRAWL_FAILED: "Crawl Failed",
};

export default function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
