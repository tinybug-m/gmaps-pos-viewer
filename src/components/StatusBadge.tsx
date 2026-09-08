import type { LeadStatus } from "@/types/lead";

// Kept to three low-saturation hues total (red, amber, gray/blue-gray) so a
// dense table of badges doesn't fight for attention across many rows.
const STATUS_STYLES: Record<LeadStatus, string> = {
  POOR: "bg-red-50 text-red-800",
  NEEDS_IMPROVEMENT: "bg-amber-50 text-amber-800",
  GOOD: "bg-slate-100 text-slate-500",
  CRAWL_FAILED: "bg-sky-50 text-sky-700",
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
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
