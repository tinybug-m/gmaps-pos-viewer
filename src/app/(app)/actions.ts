"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/auth";
import { clientIp, logout } from "@/server/auth/login";
import { getDb } from "@/server/db/client";

export async function logoutAction(): Promise<void> {
  const h = new Headers(await headers());
  await logout({ db: getDb(), auth: getAuth() }, { ip: clientIp(h), headers: h });
  redirect("/login");
}
