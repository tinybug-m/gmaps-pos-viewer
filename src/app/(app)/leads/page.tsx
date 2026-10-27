import type { Metadata } from "next";
import LeadsView from "@/components/LeadsView";
import { parseLeadQuery, toSearchParams } from "@/lib/lead-query";
import { can } from "@/lib/permissions";
import { requireViewer } from "@/server/auth/session";
import { ASSIGNABLE_ROLES } from "@/server/dal/assignments";
import { listLeadsForViewer, queryForViewer } from "@/server/dal/leads";
import { listAssignees } from "@/server/dal/users";
import { getDb } from "@/server/db/client";

import AssignableLeadsView from "./AssignableLeadsView";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage(props: PageProps<"/leads">) {
  const viewer = await requireViewer();
  const db = getDb();
  const query = queryForViewer(viewer, parseLeadQuery(toSearchParams(await props.searchParams)));
  const list = await listLeadsForViewer(db, viewer, query);
  const permissions = {
    viewAll: can(viewer, "leads.viewAll"),
    archive: can(viewer, "leads.archive"),
    import: can(viewer, "leads.import"),
  };

  if (!can(viewer, "leads.assign")) return <LeadsView list={list} query={query} permissions={permissions} />;

  const assignees = ((await listAssignees(db, viewer)) ?? [])
    .filter((u) => ASSIGNABLE_ROLES.includes(u.role))
    .map(({ id, name }) => ({ id, name }));
  return <AssignableLeadsView list={list} query={query} permissions={permissions} assignees={assignees} />;
}
