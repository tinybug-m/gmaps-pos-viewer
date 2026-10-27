"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { getAuth } from "@/server/auth/auth";
import { attemptLogin, clientIp } from "@/server/auth/login";
import { getDb } from "@/server/db/client";

export interface LoginState {
  error: string | null;
  email: string;
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
