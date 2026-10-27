import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/server/auth/session";

import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getViewer()) redirect("/");
  const { next } = await searchParams;
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-slate-800">Chinvat Bridge Leads</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in with the account your admin gave you.</p>
        <div className="mt-6 rounded-lg bg-white p-6 ring-1 ring-slate-200">
          <LoginForm next={typeof next === "string" ? next : "/"} />
        </div>
        <p className="mt-4 text-xs text-slate-500">Forgotten your password? Ask an admin to reset it.</p>
      </div>
    </main>
  );
}
