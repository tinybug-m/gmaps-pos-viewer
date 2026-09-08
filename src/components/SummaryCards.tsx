import type { SummaryCounts } from "@/lib/leads";

export default function SummaryCards({ counts }: { counts: SummaryCounts }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Card label="SEO Prospects" value={counts.prospects} emphasis="prospects" className="col-span-2 sm:col-span-1 lg:col-span-2" />
      <Card label="Poor" value={counts.poor} emphasis="poor" />
      <Card label="Needs Improvement" value={counts.needsImprovement} emphasis="needsImprovement" />
      <Card label="Total Businesses" value={counts.total} emphasis="neutral" />
      <Card label="Good" value={counts.good} emphasis="neutral" />
      <Card label="Crawl Failed" value={counts.crawlFailed} emphasis="neutral" />
    </div>
  );
}

type Emphasis = "prospects" | "poor" | "needsImprovement" | "neutral";

const EMPHASIS_STYLES: Record<Emphasis, { card: string; value: string; label: string }> = {
  prospects: {
    card: "bg-slate-900 ring-1 ring-slate-900",
    value: "text-white",
    label: "text-slate-300",
  },
  poor: {
    card: "bg-red-50 ring-1 ring-red-200",
    value: "text-red-700",
    label: "text-red-600",
  },
  needsImprovement: {
    card: "bg-amber-50 ring-1 ring-amber-200",
    value: "text-amber-700",
    label: "text-amber-600",
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
