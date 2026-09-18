import type { SummaryCounts } from "@/lib/leads";

export default function SummaryCards({ counts }: { counts: SummaryCounts }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
      <Card label="SEO Prospects" value={counts.prospects} emphasis="prospects" className="col-span-2" />
      <Card label="Poor" value={counts.poor} emphasis="poor" />
      <Card label="Needs Improvement" value={counts.needsImprovement} emphasis="needsImprovement" />
      <Card label="No Website" value={counts.noWebsite} emphasis="noWebsite" />
      <Card label="Total Businesses" value={counts.total} emphasis="neutral" />
      <Card label="Good" value={counts.good} emphasis="neutral" />
      <Card label="Crawl Failed" value={counts.crawlFailed} emphasis="neutral" />
    </div>
  );
}

type Emphasis = "prospects" | "poor" | "needsImprovement" | "noWebsite" | "neutral";

// All cards share the same light surface — dominance comes from size and a
// left accent bar, not from inverting to a dark fill, which reads as a harsh
// flash next to the pale cards beside it during long reading sessions.
const EMPHASIS_STYLES: Record<Emphasis, { card: string; value: string; label: string }> = {
  prospects: {
    card: "bg-white ring-1 ring-slate-200 border-l-4 border-l-slate-700",
    value: "text-slate-800",
    label: "text-slate-500",
  },
  poor: {
    card: "bg-red-50/60 ring-1 ring-red-100",
    value: "text-red-800",
    label: "text-red-700/80",
  },
  needsImprovement: {
    card: "bg-amber-50/60 ring-1 ring-amber-100",
    value: "text-amber-800",
    label: "text-amber-700/80",
  },
  noWebsite: {
    card: "bg-teal-50/60 ring-1 ring-teal-100",
    value: "text-teal-800",
    label: "text-teal-700/80",
  },
  neutral: {
    card: "bg-white ring-1 ring-slate-200",
    value: "text-slate-500",
    label: "text-slate-400",
  },
};

function Card({
  label,
  value,
  emphasis,
  className = "",
}: {
  label: string;
  value: number;
  emphasis: Emphasis;
  className?: string;
}) {
  const styles = EMPHASIS_STYLES[emphasis];
  const isDominant = emphasis !== "neutral";
  return (
    <div className={`rounded-xl px-4 py-3.5 ${styles.card} ${className}`}>
      <p className={`text-xs font-medium uppercase tracking-wide ${styles.label}`}>{label}</p>
      <p className={`mt-1 font-semibold tabular-nums ${styles.value} ${isDominant ? "text-3xl" : "text-2xl"}`}>
        {value}
      </p>
    </div>
  );
}
