import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { Viewer } from "@/lib/permissions";
import type { Role } from "@/lib/workflow";
import { getAuth } from "./auth";

export interface SessionViewer extends Viewer {
  name: string;
  email: string;
  mustChangePassword: boolean;
  sessionId: string;
}

/**
 * The signed-in user for this request, or null. Reads the session row and the
 * user on every request (no cookie cache), so deactivation, role changes and
 * revoked sessions take effect immediately.
 */
export const getViewer = cache(async (): Promise<SessionViewer | null> => {
  const h = await headers();
  // Cookies can only be written from a server action, so only slide the
  // session's expiry there; otherwise the DB and the cookie would disagree.
  const inAction = h.has("next-action");
  const result = await getAuth().api.getSession({ headers: h, query: { disableRefresh: !inAction } });
  if (!result) return null;
  const { user, session } = result;
  if (!user.isActive) return null;
  return {
    id: user.id,
    role: user.role as Role,
    name: user.name,
    email: user.email,
    mustChangePassword: user.mustChangePassword,
    sessionId: session.id,
  };
});

/** For pages and actions: the viewer, or a redirect to sign in (or to set a password first). */
export async function requireViewer(opts: { allowPasswordChange?: boolean } = {}): Promise<SessionViewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.mustChangePassword && !opts.allowPasswordChange) redirect("/account/password");
  return viewer;
}

/** Pages that a role can't use don't exist for it. */
export async function requireRole(...roles: Role[]): Promise<SessionViewer> {
  const viewer = await requireViewer();
  if (!roles.includes(viewer.role)) notFound();
  return viewer;
}
