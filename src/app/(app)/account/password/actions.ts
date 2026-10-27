"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/server/auth/login";
import { requireViewer } from "@/server/auth/session";
import { changeOwnPassword } from "@/server/dal/users";
import { getDb } from "@/server/db/client";

export interface PasswordState {
  error: string | null;
  success: string | null;
}

export async function changePasswordAction(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const viewer = await requireViewer({ allowPasswordChange: true });
  const newPassword = formData.get("newPassword");
  if (newPassword !== formData.get("confirmPassword")) {
    return { error: "The new passwords don't match.", success: null };
  }
  const result = await changeOwnPassword(
    getDb(),
    viewer,
    { currentPassword: formData.get("currentPassword"), newPassword },
    { ip: clientIp(await headers()) },
  );
  if (!result.ok) return { error: result.message, success: null };
  if (viewer.mustChangePassword) redirect("/");
  return { error: null, success: "Password changed. Your other devices have been signed out." };
}
