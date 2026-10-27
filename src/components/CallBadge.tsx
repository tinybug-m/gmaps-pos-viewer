import type { LeadOutreach } from "@/types/lead";

// Same muted hues as the priority badges: grade A reads like "High".
const GRADE_STYLES: Record<string, string> = {
  A: "bg-red-50 text-red-800",
  B: "bg-amber-50 text-amber-800",
  C: "bg-slate-100 text-slate-600",
};

function shouldCallStyle(shouldCall: string | null): { chip: string; dot: string; label: string } {
  if (shouldCall === "YES") return { chip: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-500", label: "Call" };
  if (shouldCall === "NO") return { chip: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "Don't call" };
  if (shouldCall) return { chip: "bg-amber-50 text-amber-800", dot: "bg-amber-500", label: humanize(shouldCall) };
  return { chip: "bg-slate-100 text-slate-600", dot: "bg-slate-300", label: "Undecided" };
}

export default function CallBadge({ outreach }: { outreach: LeadOutreach }) {
  const call = shouldCallStyle(outreach.shouldCall);
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${call.chip}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${call.dot}`} aria-hidden />
        {call.label}
      </span>
      {outreach.callPriority && (
        <span
          title="Call-list priority"
          className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold tabular-nums ${
            GRADE_STYLES[outreach.callPriority] ?? "bg-slate-100 text-slate-600"
          }`}
        >
          {outreach.callPriority}
        </span>
      )}
    </span>
  );
}

/** "WEAK_WEBSITE" → "Weak website", "call" → "Call". */
export function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
