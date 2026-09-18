"use client";

import MultiSelectDropdown from "@/components/MultiSelectDropdown";
import { SCORE_BANDS, defaultFilters, isDefaultFilters, type LeadFilters, type ScoreBand } from "@/lib/filters";
import type { LeadStatus } from "@/types/lead";

const CORE_STATUS_PILLS: { status: LeadStatus; label: string; activeClass: string }[] = [
  { status: "POOR", label: "Poor", activeClass: "bg-red-50 text-red-800" },
  { status: "NEEDS_IMPROVEMENT", label: "Needs Improvement", activeClass: "bg-amber-50 text-amber-800" },
  { status: "NO_WEBSITE", label: "No Website", activeClass: "bg-teal-50 text-teal-800" },
];

export default function FilterBar({
  filters,
  onChange,
  cities,
  issueOptions,
}: {
  filters: LeadFilters;
  onChange: (filters: LeadFilters) => void;
  cities: string[];
  issueOptions: string[];
}) {
  function toggleStatus(status: LeadStatus) {
    const next = new Set(filters.statuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    onChange({ ...filters, statuses: next });
  }

  function toggleScoreBand(band: ScoreBand) {
    const next = new Set(filters.scoreBands);
    if (next.has(band)) next.delete(band);
    else next.add(band);
    onChange({ ...filters, scoreBands: next });
  }

  const showGood = filters.statuses.has("GOOD");
  const showCrawlFailed = filters.statuses.has("CRAWL_FAILED");

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</span>
        {CORE_STATUS_PILLS.map(({ status, label, activeClass }) => (
          <button
            key={status}
            type="button"
            onClick={() => toggleStatus(status)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              filters.statuses.has(status)
                ? activeClass
                : "bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}

        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />

        <ToggleChip
          label="Show good websites"
          active={showGood}
          onClick={() => toggleStatus("GOOD")}
        />
        <ToggleChip
          label="Include crawl failures"
          active={showCrawlFailed}
          onClick={() => toggleStatus("CRAWL_FAILED")}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">SEO Score</span>
        {SCORE_BANDS.map((band) => (
          <button
            key={band.key}
            type="button"
            onClick={() => toggleScoreBand(band.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              filters.scoreBands.has(band.key)
                ? "bg-slate-100 text-slate-800"
                : "bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {band.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Refine</span>
        <MultiSelectDropdown
          label="City"
          options={cities}
          selected={filters.cities}
          onChange={(next) => onChange({ ...filters, cities: next })}
        />
        <MultiSelectDropdown
          label="Issues"
          options={issueOptions}
          selected={filters.issueTemplates}
          onChange={(next) => onChange({ ...filters, issueTemplates: next })}
        />

        {!isDefaultFilters(filters) && (
          <button
            type="button"
            onClick={() => onChange(defaultFilters())}
            className="ml-auto text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            Reset to default view
          </button>
        )}
      </div>
    </div>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-sky-50 text-sky-700"
          : "bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${active ? "bg-sky-500" : "bg-slate-300"}`}
        aria-hidden
      />
      {label}
    </button>
  );
}
