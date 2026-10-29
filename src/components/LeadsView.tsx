"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";

import EmptyState from "@/components/EmptyState";
import FilterBar from "@/components/FilterBar";
import LeadDetailDrawer from "@/components/LeadDetailDrawer";
import LeadTable, { sortOptions, type TableSelection } from "@/components/LeadTable";
import SearchBar from "@/components/SearchBar";
import SummaryCards from "@/components/SummaryCards";
import { buttonSecondary, input } from "@/components/ui/styles";
import {
  defaultLeadQuery,
  isDefaultLeadQuery,
  nextLeadSort,
  PAGE_SIZE,
  parseLeadQuery,
  serializeLeadQuery,
  type LeadList,
  type LeadSort,
  type LeadSortKey,
  type LeadQuery,
} from "@/lib/lead-query";

const SEARCH_DELAY_MS = 300;

export interface LeadsViewPermissions {
  viewAll: boolean;
  archive: boolean;
  import: boolean;
}

/**
 * The leads list. The server has already filtered, sorted and paged
 * `list` for `query`; this component only turns clicks into a new URL. The
 * new state shows straight away (optimistically) while the server builds
 * the matching page.
 */
export default function LeadsView({
  list,
  query,
  permissions,
  selection,
  toolbar,
}: {
  list: LeadList;
  query: LeadQuery;
  permissions: LeadsViewPermissions;
  /** Row checkboxes, for bulk actions. Passed by a client wrapper that owns the selection. */
  selection?: TableSelection;
  /** Shown above the table, e.g. the bulk-assign bar. */
  toolbar?: ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(query);
  const [draft, setDraft] = useState(query.filters.search);
  const [seenSearch, setSeenSearch] = useState(query.filters.search);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableTop = useRef<HTMLDivElement>(null);

  // The URL's search changed without the box (a nav link, reset, back): show it.
  if (current.filters.search !== seenSearch) {
    setSeenSearch(current.filters.search);
    if (draft.trim() !== current.filters.search) setDraft(current.filters.search);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function cancelSearch() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function navigate(next: LeadQuery) {
    const params = serializeLeadQuery(next).toString();
    // Round-trip through the URL so the optimistic state is exactly what the server will parse.
    const normalized = parseLeadQuery(new URLSearchParams(params));
    startTransition(() => {
      setCurrent(normalized);
      router.replace(params ? `/leads?${params}` : "/leads", { scroll: false });
    });
  }

  /** Any change other than paging goes back to page 1, and takes the search box as typed. */
  function change(next: LeadQuery) {
    cancelSearch();
    navigate({ ...next, filters: { ...next.filters, search: draft }, page: 1 });
  }

  function reset() {
    cancelSearch();
    setDraft("");
    navigate({ ...defaultLeadQuery(), sort: current.sort });
  }

  function search(value: string) {
    setDraft(value);
    cancelSearch();
    const run = () => navigate({ ...current, filters: { ...current.filters, search: value }, page: 1 });
    if (value === "") run();
    else
      timer.current = setTimeout(() => {
        timer.current = null;
        run();
      }, SEARCH_DELAY_MS);
  }

  function goToPage(page: number) {
    cancelSearch();
    navigate({ ...current, filters: { ...current.filters, search: draft }, page });
    tableTop.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  const selectedLead = list.rows.find((l) => l.id === selectedId) ?? null;
  const from = (list.page - 1) * PAGE_SIZE + 1;
  const to = from + list.rows.length - 1;
  const filtered = !isDefaultLeadQuery(current);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">
            {current.archived ? "Archived leads" : permissions.viewAll ? "Leads" : "My leads"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {current.archived
              ? "Leads an admin archived. They're hidden from everyone else's lists."
              : permissions.viewAll
                ? "Businesses whose websites show technical SEO opportunities, worst prospects first."
                : "Businesses assigned to you. Open one to see its details and history."}
          </p>
        </div>
        {permissions.import && (
          <Link href="/admin/import" className={buttonSecondary}>
            Import leads
          </Link>
        )}
      </header>

      {list.total > 0 && <SummaryCards counts={list.counts} />}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            <SearchBar value={draft} onChange={search} />
            <SortMenu
              sort={current.sort}
              options={sortOptions(list.options.showOutreach, permissions.viewAll)}
              onChange={(sort) => change({ ...current, sort })}
            />
          </div>
          <p className="text-sm text-slate-500" aria-live="polite">
            {list.matching === 0 ? (
              <>No matching leads</>
            ) : (
              <>
                Showing{" "}
                <span className="font-medium text-slate-800">
                  {from}–{to}
                </span>{" "}
                of {list.matching.toLocaleString("en-GB")}
                {list.matching === list.total ? " leads" : ` matching (${list.total.toLocaleString("en-GB")} in total)`}
              </>
            )}
          </p>
        </div>
        <FilterBar
          query={current}
          onChange={change}
          onReset={reset}
          options={list.options}
          viewAll={permissions.viewAll}
          canArchive={permissions.archive}
        />
      </div>

      {toolbar}

      <div
        ref={tableTop}
        aria-busy={isPending}
        className={`scroll-mt-4 transition-opacity ${isPending ? "opacity-60" : ""}`}
      >
        {list.total === 0 ? (
          <NoLeads archived={current.archived} permissions={permissions} />
        ) : list.matching === 0 ? (
          <EmptyState
            title={filtered ? "No leads match your current filters" : "No SEO prospects found"}
            description={
              filtered
                ? "Try widening your filters or clearing them to see more leads."
                : "There are no poor, needs-improvement, or no-website businesses here."
            }
            onClear={filtered ? reset : undefined}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <LeadTable
              leads={list.rows}
              sort={current.sort}
              onSortChange={(sort) => change({ ...current, sort })}
              onSelectLead={(lead) => setSelectedId(lead.id)}
              showOutreach={list.options.showOutreach}
              showAssignee={permissions.viewAll}
              selection={selection}
            />
            {list.pageCount > 1 && (
              <nav aria-label="Pages" className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={list.page <= 1 || isPending}
                  onClick={() => goToPage(list.page - 1)}
                >
                  Previous
                </button>
                <span className="text-sm text-slate-500">
                  Page {list.page} of {list.pageCount}
                </span>
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={list.page >= list.pageCount || isPending}
                  onClick={() => goToPage(list.page + 1)}
                >
                  Next
                </button>
              </nav>
            )}
          </div>
        )}
      </div>

      {selectedLead && (
        <LeadDetailDrawer
          lead={selectedLead}
          onClose={() => setSelectedId(null)}
          actions={
            <Link href={`/leads/${selectedLead.id}`} className={buttonSecondary}>
              Open lead
            </Link>
          }
        />
      )}
    </div>
  );
}

function SortMenu({
  sort,
  options,
  onChange,
}: {
  sort: LeadSort;
  options: { key: LeadSortKey; label: string }[];
  onChange: (sort: LeadSort) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-sm text-slate-600">
      <label htmlFor="lead-sort">Sort by</label>
      <div className="w-40">
      <select
        id="lead-sort"
        value={sort.key}
        onChange={(e) => onChange(nextLeadSort(sort, e.target.value as LeadSortKey))}
        className={input}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      </div>
      <button
        type="button"
        onClick={() => onChange({ ...sort, direction: sort.direction === "asc" ? "desc" : "asc" })}
        aria-label={`Sort direction: ${sort.direction === "asc" ? "ascending" : "descending"}. Click to reverse.`}
        className={buttonSecondary}
      >
        {sort.direction === "asc" ? "↑ Asc" : "↓ Desc"}
      </button>
    </div>
  );
}

function NoLeads({ archived, permissions }: { archived: boolean; permissions: LeadsViewPermissions }) {
  if (archived) {
    return <EmptyState title="No archived leads" description="Leads you archive will show here." />;
  }
  if (permissions.import) {
    return (
      <EmptyState title="No leads yet" description="Import an export file to add businesses for the team to call.">
        <Link href="/admin/import" className={`${buttonSecondary} mt-2`}>
          Import leads
        </Link>
      </EmptyState>
    );
  }
  if (permissions.viewAll) {
    return <EmptyState title="No leads yet" description="Leads appear here once an admin imports them." />;
  }
  return (
    <EmptyState
      title="No leads assigned to you yet"
      description="When an admin assigns businesses to you, they'll appear here."
    />
  );
}
