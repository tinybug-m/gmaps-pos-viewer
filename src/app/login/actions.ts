"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/auth";
import { attemptLogin, clientIp } from "@/server/auth/login";
import { getDb } from "@/server/db/client";

export interface LoginState {
  error: string | null;
  email: string;
}

/** Only same-site paths, so ?next= can't send someone to another site after signing in. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const h = new Headers(await headers());
  const email = String(formData.get("email") ?? "");
  const result = await attemptLogin(
    { db: getDb(), auth: getAuth() },
    { email, password: formData.get("password") },
    { ip: clientIp(h), headers: h },
  );
  if (!result.ok) return { error: result.message, email };
  redirect(safeNext(formData.get("next")));
}
