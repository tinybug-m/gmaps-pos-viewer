"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { can } from "@/lib/permissions";
import { MAX_IMPORT_BYTES } from "@/lib/validation";
import { clientIp } from "@/server/auth/login";
import { requireViewer } from "@/server/auth/session";
import {
  commitFileAssignment,
  previewFileAssignment,
  type FileAssignPreview,
  type FileAssignResult,
} from "@/server/dal/file-assignments";
import { getDb } from "@/server/db/client";
import { fail, type Failure, type Result } from "@/server/result";

const FORBIDDEN = fail("forbidden", "Only an admin can assign leads.");

/** The uploaded file and chosen user. The DAL validates the contents. */
async function readForm(formData: FormData): Promise<{ fileName: string; json: string; toUserId: string; expectedAssign?: number; importMissing?: boolean } | Failure> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("invalid", "Choose a JSON export file.");
  if (file.size > MAX_IMPORT_BYTES) {
    return fail("invalid", "That file is too large to use in one go (3.5 MB). Split it into smaller files.");
  }
  const expected = formData.get("expectedAssign");
  return {
    fileName: file.name,
    json: await file.text(),
    toUserId: String(formData.get("toUserId") ?? ""),
    ...(expected !== null && { expectedAssign: Number(expected) }),
    importMissing: formData.get("importMissing") === "1",
  };
}

export async function previewFileAssignmentAction(formData: FormData): Promise<Result<{ preview: FileAssignPreview }>> {
  const viewer = await requireViewer();
  if (!can(viewer, "leads.assign")) return FORBIDDEN;
  const input = await readForm(formData);
  if ("ok" in input) return input;
  return previewFileAssignment(getDb(), viewer, input);
}

export async function commitFileAssignmentAction(formData: FormData): Promise<FileAssignResult> {
  const viewer = await requireViewer();
  if (!can(viewer, "leads.assign")) return FORBIDDEN;
  const input = await readForm(formData);
  if ("ok" in input) return input;
  const result = await commitFileAssignment(getDb(), viewer, input, { ip: clientIp(await headers()) });
  if (result.ok) refresh();
  return result;
}
