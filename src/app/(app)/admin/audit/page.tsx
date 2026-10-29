import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { buttonSecondary, card, input } from "@/components/ui/styles";
import { formatDateTime } from "@/lib/time";
import { requireRole } from "@/server/auth/session";
import { AUDIT_CATEGORIES, listAudit, type AuditRow } from "@/server/dal/audit";
import { getDb } from "@/server/db/client";

export const metadata: Metadata = { title: "Audit log" };

const params = z.object({
  category: z.enum(AUDIT_CATEGORIES).optional().catch(undefined),
  entity: z.string().trim().max(200).optional().catch(undefined),
  before: z.coerce.number().int().positive().optional().catch(undefined),
});

const CATEGORY_LABEL: Record<(typeof AUDIT_CATEGORIES)[number], string> = {
  auth: "Sign-ins",
  user: "Users",
  lead: "Leads",
  import: "Imports",
  call: "Calls",
  note: "Notes",
};

export default async function AuditPage(props: PageProps<"/admin/audit">) {
  const viewer = await requireRole("admin");
  const { category, entity, before } = params.parse(await props.searchParams);
  const page = (await listAudit(getDb(), viewer, { category, entityId: entity || undefined, beforeId: before }))!;

  const query = (extra: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ category, entity: entity || undefined, ...extra })) if (v !== undefined) q.set(k, String(v));
    const s = q.toString();
    return s ? `/admin/audit?${s}` : "/admin/audit";
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-800">Audit log</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Sign-ins, account changes, imports, assignments, status changes and voids. Entries can&apos;t be edited or removed.
        </p>
      </header>

      <form action="/admin/audit" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Type
          <select name="category" defaultValue={category ?? ""} className={`${input} w-40`}>
            <option value="">All</option>
            {AUDIT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-full flex-col gap-1 text-xs font-medium text-slate-600 sm:w-auto">
          Lead, user or entry id
          <input name="entity" defaultValue={entity ?? ""} className={`${input} w-full sm:w-80`} placeholder="Paste an id" />
        </label>
        <button type="submit" className={buttonSecondary}>
          Filter
        </button>
        {(category || entity) && (
          <Link href="/admin/audit" className="py-2 text-sm text-slate-500 hover:text-slate-800">
            Clear
          </Link>
        )}
      </form>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2">
                When
              </th>
              <th scope="col" className="px-3 py-2">
                Who
              </th>
              <th scope="col" className="px-3 py-2">
                What
              </th>
              <th scope="col" className="px-3 py-2">
                On
              </th>
              <th scope="col" className="px-4 py-2">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {page.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                  {category || entity ? "No entries match this filter." : "No entries yet."}
                </td>
              </tr>
            )}
            {page.rows.map((r) => (
              <Row key={r.id} row={r} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-4 text-sm">
        {before && (
          <Link href={query({})} className="font-medium text-slate-600 hover:text-slate-900">
            ← Newest
          </Link>
        )}
        {page.nextBeforeId && (
          <Link href={query({ before: page.nextBeforeId })} className="font-medium text-slate-600 hover:text-slate-900">
            Older →
          </Link>
        )}
      </div>
    </div>
  );
}

/** The lead an entry concerns, when there is one, so it can be linked. */
function leadIdOf(r: AuditRow): string | null {
  if (r.entityType === "lead") return r.entityId;
  const after = r.after as { leadId?: unknown } | null;
  return typeof after?.leadId === "string" ? after.leadId : null;
}

function Row({ row: r }: { row: AuditRow }) {
  const leadId = leadIdOf(r);
  return (
    <tr>
      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-500">{formatDateTime(r.at)}</td>
      <td className="px-3 py-2 text-slate-700">{r.actor?.name ?? <span className="text-slate-500">Nobody signed in</span>}</td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-800">{r.action}</td>
      <td className="px-3 py-2 text-xs">
        {leadId ? (
          <Link href={`/leads/${leadId}`} className="font-medium text-slate-700 hover:underline">
            Lead
          </Link>
        ) : (
          <span className="text-slate-500">{r.entityType}</span>
        )}
        {r.entityId && (
          <Link href={`/admin/audit?entity=${encodeURIComponent(r.entityId)}`} className="ml-1.5 font-mono text-slate-500 hover:text-slate-700" title="All entries for this">
            {r.entityId.slice(0, 8)}
          </Link>
        )}
      </td>
      <td className="max-w-md px-4 py-2 text-xs text-slate-600">
        {r.after != null && <pre className="whitespace-pre-wrap break-words font-mono">{JSON.stringify(r.after)}</pre>}
        {r.before != null && (
          <details>
            <summary className="cursor-pointer text-slate-500">Previous values</summary>
            <pre className="whitespace-pre-wrap break-words font-mono">{JSON.stringify(r.before, null, 1)}</pre>
          </details>
        )}
        {r.ip && <p className="text-slate-500">IP {r.ip}</p>}
      </td>
    </tr>
  );
}
