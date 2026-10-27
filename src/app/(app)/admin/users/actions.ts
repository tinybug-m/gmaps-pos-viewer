"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { can } from "@/lib/permissions";
import { clientIp } from "@/server/auth/login";
import { requireViewer } from "@/server/auth/session";
import { createUser, resetUserPassword, updateUser, type UserDTO } from "@/server/dal/users";
import { getDb } from "@/server/db/client";
import { fail, type Result } from "@/server/result";

const FORBIDDEN = fail("forbidden", "Only an admin can manage users.");

export interface CreateUserState {
  error: string | null;
  /** Shown once, straight after the account is created. */
  created: { name: string; email: string; tempPassword: string } | null;
}

export async function createUserAction(_prev: CreateUserState, formData: FormData): Promise<CreateUserState> {
  const viewer = await requireViewer();
  if (!can(viewer, "users.manage")) return { error: FORBIDDEN.message, created: null };
  const result = await createUser(
    getDb(),
    viewer,
    { name: formData.get("name"), email: formData.get("email"), role: formData.get("role") },
    { ip: clientIp(await headers()) },
  );
  if (!result.ok) return { error: result.message, created: null };
  refresh();
  return { error: null, created: { name: result.user.name, email: result.user.email, tempPassword: result.tempPassword } };
}

export async function updateUserAction(input: {
  userId: string;
  name?: string;
  role?: string;
  isActive?: boolean;
}): Promise<Result<{ user: UserDTO }>> {
  const viewer = await requireViewer();
  if (!can(viewer, "users.manage")) return FORBIDDEN;
  const result = await updateUser(getDb(), viewer, input, { ip: clientIp(await headers()) });
  if (result.ok) refresh();
  return result;
}

export async function resetPasswordAction(userId: string): Promise<Result<{ tempPassword: string }>> {
  const viewer = await requireViewer();
  if (!can(viewer, "users.manage")) return FORBIDDEN;
  const result = await resetUserPassword(getDb(), viewer, { userId }, { ip: clientIp(await headers()) });
  if (result.ok) refresh();
  return result;
}
