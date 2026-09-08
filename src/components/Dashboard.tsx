"use client";

import { useMemo, useState } from "react";

import DataUpload from "@/components/DataUpload";
import EmptyState from "@/components/EmptyState";
import FilterBar from "@/components/FilterBar";
import LeadDetailDrawer from "@/components/LeadDetailDrawer";
import LeadTable from "@/components/LeadTable";
import SearchBar from "@/components/SearchBar";
import SummaryCards from "@/components/SummaryCards";
import { applyFilters, defaultFilters, isDefaultFilters, type LeadFilters } from "@/lib/filters";
import { buildLeads, getCities, getIssueOptions, getSampleLeads, getSummaryCounts } from "@/lib/leads";
import { DEFAULT_SORT, sortLeads, type SortState } from "@/lib/sort";
import type { Lead, RawLead } from "@/types/lead";

export default function Dashboard() {
  const sampleLeads = useMemo(() => getSampleLeads(), []);
  const [customLeads, setCustomLeads] = useState<Lead[] | null>(null);
  const [customFileName, setCustomFileName] = useState<string | null>(null);
  const leads = customLeads ?? sampleLeads;

  const cities = useMemo(() => getCities(leads), [leads]);
  const issueOptions = useMemo(() => getIssueOptions(leads), [leads]);
  const counts = useMemo(() => getSummaryCounts(leads), [leads]);

  const [filters, setFilters] = useState<LeadFilters>(defaultFilters);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const filtered = useMemo(() => applyFilters(leads, filters), [leads, filters]);
  const sorted = useMemo(() => sortLeads(filtered, sort), [filtered, sort]);

  function handleUpload(rawLeads: RawLead[], fileName: string) {
    setCustomLeads(buildLeads(rawLeads));
    setCustomFileName(fileName);
    setFilters(defaultFilters());
    setSelectedLead(null);
  }

  function handleResetToSample() {
    setCustomLeads(null);
    setCustomFileName(null);
    setFilters(defaultFilters());
    setSelectedLead(null);
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">SEO Lead Discovery</h1>
          <p className="mt-1 text-sm text-slate-500">
            Businesses whose websites show technical SEO opportunities, worst prospects first.
          </p>
        </div>
        <DataUpload
          onUpload={handleUpload}
          onReset={handleResetToSample}
          isCustom={customLeads !== null}
          fileName={customFileName}
        />
      </header>

      <SummaryCards counts={counts} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchBar value={filters.search} onChange={(search) => setFilters({ ...filters, search })} />
          <p className="text-sm text-slate-500">
            Showing <span className="font-medium text-slate-800">{sorted.length}</span> of{" "}
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
