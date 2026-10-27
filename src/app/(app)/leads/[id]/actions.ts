"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { clientIp } from "@/server/auth/login";
import { requireViewer } from "@/server/auth/session";
import {
  addNote,
  cancelFollowUp,
  changeStatus,
  logCall,
  setFollowUp,
  voidEntry,
  type LogCallResult,
  type StatusResult,
} from "@/server/dal/activity";
import { getDb } from "@/server/db/client";
import type { Result } from "@/server/result";

// Each action is a public endpoint: the DAL validates the input, locks the
// lead and re-checks the viewer's rights on every call.

async function context() {
  return { viewer: await requireViewer(), ctx: { ip: clientIp(await headers()) } };
}

function done<R extends { ok: boolean }>(result: R): R {
  if (result.ok) refresh();
  return result;
}

export async function logCallAction(input: unknown): Promise<LogCallResult> {
  const { viewer, ctx } = await context();
  return done(await logCall(getDb(), viewer, input, ctx));
}

export async function changeStatusAction(input: unknown): Promise<StatusResult> {
  const { viewer, ctx } = await context();
  return done(await changeStatus(getDb(), viewer, input, ctx));
}

export async function addNoteAction(input: unknown): Promise<Result<{ noteId: string }>> {
  const { viewer, ctx } = await context();
  return done(await addNote(getDb(), viewer, input, ctx));
}

export async function setFollowUpAction(input: unknown): Promise<Result<{ followUpId: string }>> {
  const { viewer, ctx } = await context();
  return done(await setFollowUp(getDb(), viewer, input, ctx));
}

export async function cancelFollowUpAction(input: unknown): Promise<Result> {
  const { viewer, ctx } = await context();
  return done(await cancelFollowUp(getDb(), viewer, input, ctx));
}

export async function voidEntryAction(input: unknown): Promise<Result> {
  const { viewer, ctx } = await context();
  return done(await voidEntry(getDb(), viewer, input, ctx));
}
