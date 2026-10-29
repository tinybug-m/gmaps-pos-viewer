"use client";

import type { ReactNode } from "react";

import MultiSelectDropdown from "@/components/MultiSelectDropdown";
import { SOURCE_LABELS } from "@/components/SourceBadge";
import { SCORE_BANDS, type ScoreBand } from "@/lib/filters";
import { isDefaultLeadQuery, type LeadListOptions, type LeadQuery } from "@/lib/lead-query";
import type { FollowUpBucket } from "@/lib/time";
import { PIPELINE_LABEL, PIPELINE_STATUSES, type PipelineStatus } from "@/lib/workflow";
import type { LeadSource, LeadStatus } from "@/types/lead";

const SOURCES: LeadSource[] = ["google-maps", "trustpilot"];

const CORE_STATUS_PILLS: { status: LeadStatus; label: string; activeClass: string }[] = [
  { status: "POOR", label: "Poor", activeClass: "bg-red-50 text-red-800" },
  { status: "NEEDS_IMPROVEMENT", label: "Needs Improvement", activeClass: "bg-amber-50 text-amber-800" },
  { status: "NO_WEBSITE", label: "No Website", activeClass: "bg-teal-50 text-teal-800" },
];

const DUE_CHIPS: { bucket: FollowUpBucket; label: string }[] = [
  { bucket: "overdue", label: "Overdue" },
  { bucket: "today", label: "Due today" },
  { bucket: "upcoming", label: "Upcoming" },
];

const PILL = "rounded-full px-3 py-1.5 text-sm font-medium transition-colors";
const PILL_ON = "bg-slate-100 text-slate-800";
const PILL_OFF = "bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:bg-slate-50";

function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export default function FilterBar({
  query,
  onChange,
  onReset,
  options,
  viewAll,
  canArchive,
}: {
  query: LeadQuery;
  onChange: (query: LeadQuery) => void;
  onReset: () => void;
  options: LeadListOptions;
  /** Admins and supervisors: show the assignee filter. */
  viewAll: boolean;
  /** Admins: show the archived view. */
  canArchive: boolean;
}) {
  const { filters } = query;
  const setFilters = (next: Partial<LeadQuery["filters"]>) => onChange({ ...query, filters: { ...filters, ...next } });
  const toggleStatus = (status: LeadStatus) => setFilters({ statuses: toggled(filters.statuses, status) });
  const togglePipeline = (status: PipelineStatus) => onChange({ ...query, pipeline: toggled(query.pipeline, status) });
  const toggleBand = (band: ScoreBand) => setFilters({ scoreBands: toggled(filters.scoreBands, band) });
  const toggleSource = (source: LeadSource) => setFilters({ sources: toggled(filters.sources, source) });

  // A uuid in the URL for someone with no leads in this view still needs an option to show as selected.
  const knownAssignee =
    query.assignee === null || query.assignee === "unassigned" || query.assignee === "me"
      ? true
      : options.assignees.some((a) => a.id === query.assignee);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
      <FilterRow label="Pipeline">
        {PIPELINE_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            aria-pressed={query.pipeline.has(status)}
            onClick={() => togglePipeline(status)}
            className={`${PILL} ${query.pipeline.has(status) ? PILL_ON : PILL_OFF}`}
          >
            {PIPELINE_LABEL[status]}
          </button>
        ))}
      </FilterRow>

      <FilterRow label="Follow-up">
        {DUE_CHIPS.map(({ bucket, label }) => (
          <ToggleChip
            key={bucket}
            label={label}
            active={query.due === bucket}
            onClick={() => onChange({ ...query, due: query.due === bucket ? null : bucket })}
          />
        ))}

        {viewAll && (
          <>
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
            <label className="flex items-center gap-2 text-sm text-slate-500">
              Assignee
              <select
                value={query.assignee ?? ""}
                onChange={(e) => onChange({ ...query, assignee: e.target.value || null })}
                className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-200"
              >
                <option value="">Anyone</option>
                <option value="unassigned">Unassigned</option>
                <option value="me">Assigned to me</option>
                {!knownAssignee && <option value={query.assignee ?? ""}>Selected person</option>}
                {options.assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.isActive ? "" : " (deactivated)"}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {canArchive && (
          <>
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
            <ToggleChip
              label="Archived leads"
              active={query.archived}
              onClick={() => onChange({ ...query, archived: !query.archived })}
            />
          </>
        )}
      </FilterRow>

      <FilterRow label="SEO Status">
        {CORE_STATUS_PILLS.map(({ status, label, activeClass }) => (
          <button
            key={status}
            type="button"
            aria-pressed={filters.statuses.has(status)}
            onClick={() => toggleStatus(status)}
            className={`${PILL} ${filters.statuses.has(status) ? activeClass : PILL_OFF}`}
          >
            {label}
          </button>
        ))}

        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />

        <ToggleChip label="Show good websites" active={filters.statuses.has("GOOD")} onClick={() => toggleStatus("GOOD")} />
        <ToggleChip
          label="Include sites we couldn't check"
          active={filters.statuses.has("CRAWL_FAILED")}
          onClick={() => toggleStatus("CRAWL_FAILED")}
        />
        {options.showOutreach && (
          <ToggleChip
            label="Call-ready only"
            active={filters.callReadyOnly}
            onClick={() => setFilters({ callReadyOnly: !filters.callReadyOnly })}
          />
        )}
      </FilterRow>

      <FilterRow label="SEO Score">
        {SCORE_BANDS.map((band) => (
          <button
            key={band.key}
            type="button"
            aria-pressed={filters.scoreBands.has(band.key)}
            onClick={() => toggleBand(band.key)}
            className={`${PILL} ${filters.scoreBands.has(band.key) ? PILL_ON : PILL_OFF}`}
          >
            {band.label}
          </button>
        ))}

        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />

        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source</span>
        {SOURCES.map((source) => (
          <button
            key={source}
            type="button"
            aria-pressed={filters.sources.has(source)}
            onClick={() => toggleSource(source)}
            className={`${PILL} ${filters.sources.has(source) ? PILL_ON : PILL_OFF}`}
          >
            {SOURCE_LABELS[source]}
          </button>
        ))}
      </FilterRow>

      <FilterRow label="Refine">
        <MultiSelectDropdown
          label="City"
          options={options.cities}
          selected={filters.cities}
          onChange={(next) => setFilters({ cities: next })}
        />
        {options.niches.length > 0 && (
          <MultiSelectDropdown
            label="Niche"
            options={options.niches}
            selected={filters.niches}
            onChange={(next) => setFilters({ niches: next })}
          />
        )}
        <MultiSelectDropdown
          label="Issues"
          options={options.issueOptions}
          selected={filters.issueTemplates}
          onChange={(next) => setFilters({ issueTemplates: next })}
        />

        {!isDefaultLeadQuery(query) && (
          <button type="button" onClick={onReset} className="ml-auto text-sm font-medium text-slate-500 hover:text-slate-800">
            Reset to default view
          </button>
        )}
      </FilterRow>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 ${PILL} ${active ? "bg-sky-50 text-sky-700" : PILL_OFF}`}
    >
      <span className={`h-2 w-2 rounded-full ${active ? "bg-sky-500" : "bg-slate-300"}`} aria-hidden />
      {label}
    </button>
  );
}
