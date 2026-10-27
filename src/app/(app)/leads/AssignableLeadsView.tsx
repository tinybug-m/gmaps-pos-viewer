"use client";

import { useState } from "react";

import LeadsView, { type LeadsViewPermissions } from "@/components/LeadsView";
import type { TableSelection } from "@/components/LeadTable";
import type { LeadList, LeadQuery } from "@/lib/lead-query";

import BulkAssignBar, { type AssignOption } from "./BulkAssignBar";

/**
 * The admin's leads list, with row checkboxes and the bulk-assign bar. The
 * selection survives paging and filtering, and remembers who each lead was
 * assigned to when it was ticked, so the server can refuse the change if
 * someone else reassigned it in the meantime.
 */
export default function AssignableLeadsView({
  list,
  query,
  permissions,
  assignees,
}: {
  list: LeadList;
  query: LeadQuery;
  permissions: LeadsViewPermissions;
  assignees: AssignOption[];
}) {
  const [selected, setSelected] = useState<ReadonlyMap<string, string | null>>(new Map());

  function update(fn: (next: Map<string, string | null>) => void) {
    setSelected((prev) => {
      const next = new Map(prev);
      fn(next);
      return next;
    });
  }

  const selection: TableSelection = {
    selected: new Set(selected.keys()),
    onToggle: (id) =>
      update((next) => {
        if (next.has(id)) next.delete(id);
        else {
          const row = list.rows.find((r) => r.id === id);
          if (row) next.set(id, row.workflow.assignee?.id ?? null);
        }
      }),
    onTogglePage: (checked) =>
      update((next) => {
        for (const row of list.rows) {
          if (checked) next.set(row.id, row.workflow.assignee?.id ?? null);
          else next.delete(row.id);
        }
      }),
  };

  // Archived leads can't be assigned, so the archived view has no checkboxes.
  if (query.archived) return <LeadsView list={list} query={query} permissions={permissions} />;

  return (
    <LeadsView
      list={list}
      query={query}
      permissions={permissions}
      selection={selection}
      toolbar={
        <BulkAssignBar
          selected={selected}
          assignees={assignees}
          onDone={() => setSelected(new Map())}
          onDeselect={(ids) => update((next) => ids.forEach((id) => next.delete(id)))}
        />
      }
    />
  );
}
