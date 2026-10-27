"use client";

import LeadTableRow from "@/components/LeadTableRow";
import { nextLeadSort, type LeadSort, type LeadSortKey } from "@/lib/lead-query";
import type { TeamLead } from "@/types/lead";

const COLUMNS: { key: LeadSortKey | null; label: string; only?: "outreach" | "assignee" }[] = [
  { key: "priority", label: "Priority" },
  { key: "name", label: "Business" },
  { key: "call", label: "Call", only: "outreach" },
  { key: "score", label: "SEO Score" },
  { key: "status", label: "SEO Status" },
  { key: "pipeline", label: "Pipeline" },
  { key: "assignee", label: "Assignee", only: "assignee" },
  { key: "followUp", label: "Follow-up" },
  { key: null, label: "Main Issues" },
  { key: null, label: "Links" },
];

export interface TableSelection {
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Select or clear every lead on this page. */
  onTogglePage: (checked: boolean) => void;
}

export default function LeadTable({
  leads,
  sort,
  onSortChange,
  onSelectLead,
  showOutreach,
  showAssignee,
  selection,
}: {
  leads: TeamLead[];
  sort: LeadSort;
  onSortChange: (sort: LeadSort) => void;
  onSelectLead: (lead: TeamLead) => void;
  showOutreach: boolean;
  showAssignee: boolean;
  selection?: TableSelection;
}) {
  const columns = COLUMNS.filter(
    (col) => (col.only !== "outreach" || showOutreach) && (col.only !== "assignee" || showAssignee),
  );
  const pageSelected = selection ? leads.filter((l) => selection.selected.has(l.id)).length : 0;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className={`w-full border-collapse text-left ${showOutreach ? "min-w-[1240px]" : "min-w-[1080px]"}`}>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {selection && (
              <th className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all leads on this page"
                  checked={leads.length > 0 && pageSelected === leads.length}
                  ref={(el) => {
                    if (el) el.indeterminate = pageSelected > 0 && pageSelected < leads.length;
                  }}
                  onChange={(e) => selection.onTogglePage(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-slate-800"
                />
              </th>
            )}
            {columns.map((col) => {
              const active = col.key !== null && sort.key === col.key;
              return (
                <th
                  key={col.label}
                  aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                  className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500"
                >
                  {col.key ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(nextLeadSort(sort, col.key as LeadSortKey))}
                      className="flex items-center gap-1 uppercase hover:text-slate-800"
                    >
                      {col.label}
                      <SortIndicator active={active} direction={sort.direction} />
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <LeadTableRow
              key={lead.id}
              lead={lead}
              showOutreach={showOutreach}
              showAssignee={showAssignee}
              onSelect={() => onSelectLead(lead)}
              selected={selection ? selection.selected.has(lead.id) : undefined}
              onToggleSelected={selection ? () => selection.onToggle(lead.id) : undefined}
            />
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
