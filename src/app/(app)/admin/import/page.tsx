import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/server/auth/session";
import { listImportBatches } from "@/server/dal/imports";
import { getDb } from "@/server/db/client";
import { formatDateTime } from "@/lib/time";

import ImportForm from "./ImportForm";

export const metadata: Metadata = { title: "Import leads" };

export default async function ImportPage() {
  const viewer = await requireRole("admin");
  const batches = (await listImportBatches(getDb(), viewer)) ?? [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <Link href="/leads" className="text-sm font-medium text-slate-500 hover:text-slate-800">
          ← Leads
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-800">Import leads</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Check a file first to see what it will change. Businesses already in the system are matched by their
          Trustpilot or Google Maps link, so importing the same file twice adds nothing. New leads arrive
          unassigned.
        </p>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          To give a file to a team member, use{" "}
          <Link href="/admin/assign-file" className="font-medium text-slate-700 underline">
            Assign file
          </Link>
          . It can import the businesses that are missing and assign them in one step.
        </p>
      </header>

      <div className="rounded-lg bg-white p-6 ring-1 ring-slate-200">
        <ImportForm />
      </div>

      <section aria-labelledby="recent-imports" className="flex flex-col gap-3">
        <h2 id="recent-imports" className="text-base font-semibold text-slate-800">
          Recent imports
        </h2>
        {batches.length === 0 ? (
          <p className="text-sm text-slate-500">No imports yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-slate-200">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2.5">When</th>
                  <th scope="col" className="px-4 py-2.5">File</th>
                  <th scope="col" className="px-4 py-2.5">By</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Records</th>
                  <th scope="col" className="px-4 py-2.5 text-right">New</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Changed</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Unchanged</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Skipped</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap px-4 py-2.5">{formatDateTime(b.createdAt)}</td>
                    <td className="max-w-[16rem] truncate px-4 py-2.5" title={b.fileName}>
                      {b.fileName}
                    </td>
                    <td className="px-4 py-2.5">{b.importedBy}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{b.total.toLocaleString("en-GB")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{b.inserted.toLocaleString("en-GB")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{b.updated.toLocaleString("en-GB")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{b.unchanged.toLocaleString("en-GB")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {(b.invalid + b.duplicates).toLocaleString("en-GB")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
