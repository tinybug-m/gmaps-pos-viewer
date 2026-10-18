import type { LeadSource } from "@/types/lead";

export const SOURCE_LABELS: Record<LeadSource, string> = {
  "google-maps": "Google Maps",
  trustpilot: "Trustpilot",
};

const SOURCE_STYLES: Record<LeadSource, string> = {
  "google-maps": "bg-blue-50 text-blue-800",
  trustpilot: "bg-emerald-50 text-emerald-800",
};

const SOURCE_DOT: Record<LeadSource, string> = {
  "google-maps": "bg-blue-500",
  trustpilot: "bg-emerald-500",
};

export default function SourceBadge({ source }: { source: LeadSource }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${SOURCE_STYLES[source]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${SOURCE_DOT[source]}`} aria-hidden />
      {SOURCE_LABELS[source]}
    </span>
  );
}
