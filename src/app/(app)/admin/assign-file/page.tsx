import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/server/auth/session";
import { ASSIGNABLE_ROLES } from "@/server/dal/assignments";
import { listAssignees } from "@/server/dal/users";
import { getDb } from "@/server/db/client";

import AssignFileForm from "./AssignFileForm";

export const metadata: Metadata = { title: "Assign a file" };

export default async function AssignFilePage() {
  const viewer = await requireRole("admin");
  const assignees = ((await listAssignees(getDb(), viewer)) ?? [])
    .filter((u) => ASSIGNABLE_ROLES.includes(u.role))
    .map(({ id, name }) => ({ id, name }));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <Link href="/leads" className="text-sm font-medium text-slate-500 hover:text-slate-800">
          ← Leads
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-800">Assign a file</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Give every unassigned lead in an export file to one team member. Businesses are matched to leads already
          in the system, so import the file first. Leads that belong to someone else are never taken from them.
        </p>
      </header>

      <div className="rounded-lg bg-white p-6 ring-1 ring-slate-200">
        <AssignFileForm assignees={assignees} />
      </div>
    </div>
  );
}
