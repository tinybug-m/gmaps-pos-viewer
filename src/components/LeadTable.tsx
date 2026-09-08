"use client";

import LeadTableRow from "@/components/LeadTableRow";
import { nextSortState, type SortKey, type SortState } from "@/lib/sort";
import type { Lead } from "@/types/lead";

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: "priority", label: "Priority" },
  { key: "name", label: "Business" },
  { key: "score", label: "SEO Score" },
  { key: "status", label: "Status" },
  { key: null, label: "Main Issues" },
  { key: "responseMs", label: "Performance" },
  { key: null, label: "Website" },
  { key: null, label: "Maps" },
];

export default function LeadTable({
  leads,
  sort,
  onSortChange,
  onSelectLead,
}: {
  leads: Lead[];
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  onSelectLead: (lead: Lead) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[900px] border-collapse text-left">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {COLUMNS.map((col) => (
              <th key={col.label} className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {col.key ? (
                  <button
                    type="button"
                    onClick={() => onSortChange(nextSortState(sort, col.key as SortKey))}
                    className="flex items-center gap-1 hover:text-slate-800"
                  >
                    {col.label}
                    <SortIndicator active={sort.key === col.key} direction={sort.direction} />
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <LeadTableRow key={lead.id} lead={lead} onSelect={() => onSelectLead(lead)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortIndicator({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      className={`h-3 w-3 transition-transform ${active ? "text-slate-700" : "text-slate-300"} ${
        active && direction === "desc" ? "rotate-180" : ""
      }`}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
    </svg>
  );
}
