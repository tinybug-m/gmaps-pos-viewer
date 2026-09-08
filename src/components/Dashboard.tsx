"use client";

import { useMemo, useState } from "react";

import EmptyState from "@/components/EmptyState";
import FilterBar from "@/components/FilterBar";
import LeadDetailDrawer from "@/components/LeadDetailDrawer";
import LeadTable from "@/components/LeadTable";
import SearchBar from "@/components/SearchBar";
import SummaryCards from "@/components/SummaryCards";
import { applyFilters, defaultFilters, isDefaultFilters, type LeadFilters } from "@/lib/filters";
import { getCities, getIssueOptions, getLeads, getSummaryCounts } from "@/lib/leads";
import { DEFAULT_SORT, sortLeads, type SortState } from "@/lib/sort";
import type { Lead } from "@/types/lead";

export default function Dashboard() {
  const leads = useMemo(() => getLeads(), []);
  const cities = useMemo(() => getCities(leads), [leads]);
  const issueOptions = useMemo(() => getIssueOptions(leads), [leads]);
  const counts = useMemo(() => getSummaryCounts(leads), [leads]);

  const [filters, setFilters] = useState<LeadFilters>(defaultFilters);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const filtered = useMemo(() => applyFilters(leads, filters), [leads, filters]);
  const sorted = useMemo(() => sortLeads(filtered, sort), [filtered, sort]);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">SEO Lead Discovery</h1>
        <p className="mt-1 text-sm text-slate-500">
          Businesses whose websites show technical SEO opportunities, worst prospects first.
        </p>
      </header>

      <SummaryCards counts={counts} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchBar value={filters.search} onChange={(search) => setFilters({ ...filters, search })} />
          <p className="text-sm text-slate-500">
            Showing <span className="font-medium text-slate-900">{sorted.length}</span> of{" "}
            {leads.length} businesses
          </p>
        </div>
        <FilterBar filters={filters} onChange={setFilters} cities={cities} issueOptions={issueOptions} />
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title={isDefaultFilters(filters) ? "No SEO prospects found" : "No businesses match your current filters"}
          description={
            isDefaultFilters(filters)
              ? "There are no poor or needs-improvement websites in the current dataset."
              : "Try widening your filters or clearing them to see more businesses."
          }
          onClear={() => setFilters(defaultFilters())}
        />
      ) : (
        <LeadTable leads={sorted} sort={sort} onSortChange={setSort} onSelectLead={setSelectedLead} />
      )}

      {selectedLead && <LeadDetailDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} />}
    </div>
  );
}
