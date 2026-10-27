import type { Metadata } from "next";
import { requireViewer } from "@/server/auth/session";

import PasswordForm from "./PasswordForm";

export const metadata: Metadata = { title: "Change password" };

export default async function PasswordPage() {
  const viewer = await requireViewer({ allowPasswordChange: true });
  return (
    <div className="mx-auto max-w-md px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold text-slate-800">
        {viewer.mustChangePassword ? "Set your password" : "Change password"}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {viewer.mustChangePassword
          ? "You're signed in with a one-time password. Choose your own before you continue."
          : "Changing your password signs you out on your other devices."}
      </p>
      <div className="mt-6 rounded-lg bg-white p-6 ring-1 ring-slate-200">
        <PasswordForm email={viewer.email} />
      </div>
    </div>
  );
}
