"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { can } from "@/lib/permissions";
import { clientIp } from "@/server/auth/login";
import { requireViewer } from "@/server/auth/session";
import { commitImport, previewImport, type ImportPreview } from "@/server/dal/imports";
import { getDb } from "@/server/db/client";
import { fail, type Failure, type Result } from "@/server/result";
import { MAX_IMPORT_BYTES } from "@/lib/validation";

const FORBIDDEN = fail("forbidden", "Only an admin can import leads.");

/** The uploaded file, read as text. The DAL validates the contents. */
async function readUpload(formData: FormData): Promise<{ fileName: string; json: string } | Failure> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("invalid", "Choose a JSON export file to import.");
  if (file.size > MAX_IMPORT_BYTES) {
    return fail("invalid", "That file is too large to import in one go (3.5 MB). Split it into smaller files.");
  }
  return { fileName: file.name, json: await file.text() };
}

export async function previewImportAction(formData: FormData): Promise<Result<{ preview: ImportPreview }>> {
  const viewer = await requireViewer();
  if (!can(viewer, "leads.import")) return FORBIDDEN;
  const input = await readUpload(formData);
  if ("ok" in input) return input;
  return previewImport(getDb(), viewer, input);
}

export async function commitImportAction(
  formData: FormData,
): Promise<Result<{ batchId: string; preview: ImportPreview }>> {
  const viewer = await requireViewer();
  if (!can(viewer, "leads.import")) return FORBIDDEN;
  const input = await readUpload(formData);
  if ("ok" in input) return input;
  const result = await commitImport(getDb(), viewer, input, { ip: clientIp(await headers()) });
  if (result.ok) refresh();
  return result;
}
