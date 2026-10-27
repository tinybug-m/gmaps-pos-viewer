"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { can } from "@/lib/permissions";
import { clientIp } from "@/server/auth/login";
import { requireViewer } from "@/server/auth/session";
import { assignLeads, type AssignResult } from "@/server/dal/assignments";
import { getDb } from "@/server/db/client";
import { fail } from "@/server/result";

/** Bulk assign, reassign or unassign. The DAL validates the input and re-checks every lead. */
export async function assignLeadsAction(input: {
  leadIds: string[];
  toUserId: string | null;
  expected: Record<string, string | null>;
  reason?: string;
}): Promise<AssignResult> {
  const viewer = await requireViewer();
  if (!can(viewer, "leads.assign")) return fail("forbidden", "Only an admin can assign leads.");
  const result = await assignLeads(getDb(), viewer, input, { ip: clientIp(await headers()) });
  if (result.ok) refresh();
  return result;
}
