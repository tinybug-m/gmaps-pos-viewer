import type { Metadata } from "next";
import LeadsView from "@/components/LeadsView";
import { parseLeadQuery, toSearchParams } from "@/lib/lead-query";
import { can } from "@/lib/permissions";
import { requireViewer } from "@/server/auth/session";
import { listLeadsForViewer, queryForViewer } from "@/server/dal/leads";
import { getDb } from "@/server/db/client";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage(props: PageProps<"/leads">) {
  const viewer = await requireViewer();
  const query = queryForViewer(viewer, parseLeadQuery(toSearchParams(await props.searchParams)));
  const list = await listLeadsForViewer(getDb(), viewer, query);
  return (
    <LeadsView
      list={list}
      query={query}
      permissions={{
        viewAll: can(viewer, "leads.viewAll"),
        archive: can(viewer, "leads.archive"),
        import: can(viewer, "leads.import"),
      }}
    />
  );
}
