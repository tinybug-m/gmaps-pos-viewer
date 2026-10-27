import "server-only";
import { APIError } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { and, count, eq, gt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditLog, users } from "../db/schema";
import { writeAudit } from "../dal/audit";
import { fail, type Result } from "../result";
import { loginInput } from "../validation";
import type { Auth } from "./auth";

export const LOCK_THRESHOLD = 10;
export const LOCK_MINUTES = 15;
/** Failed sign-ins from one IP address, across all accounts, before that address is paused. */
export const IP_FAILURE_LIMIT = 50;

/**
 * One message for every failure, so the form never reveals whether an
 * account exists, is deactivated or is locked.
 */
export const LOGIN_FAILED = `Couldn't sign in with those details. After ${LOCK_THRESHOLD} failed attempts in a row, sign-in pauses for ${LOCK_MINUTES} minutes.`;
export const IP_LIMITED = `Too many failed sign-ins from your network. Try again in ${LOCK_MINUTES} minutes.`;

export interface LoginContext {
  ip: string | null;
  headers: Headers;
}

/** The client address as Vercel reports it. Only used for throttling and the audit log. */
export function clientIp(h: Headers): string | null {
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || null;
}

export async function attemptLogin(
  deps: { db: Db; auth: Auth },
  input: unknown,
  ctx: LoginContext,
): Promise<Result<{ userId: string; responseHeaders: Headers }>> {
  const { db, auth } = deps;
  const parsed = loginInput.safeParse(input);
  if (!parsed.success || !parsed.data.email || !parsed.data.password) return fail("invalid", LOGIN_FAILED);
  const { email, password } = parsed.data;

  if (ctx.ip) {
    const [{ failures }] = await db
      .select({ failures: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "auth.login_failed"),
          eq(auditLog.ip, ctx.ip),
          gt(auditLog.createdAt, sql`now() - make_interval(mins => ${LOCK_MINUTES})`),
        ),
      );
    if (failures >= IP_FAILURE_LIMIT) return fail("rate_limited", IP_LIMITED);
  }

  const [user] = await db
    .select({ id: users.id, isActive: users.isActive, lockedUntil: users.lockedUntil })
    .from(users)
    .where(eq(users.email, email));

  const failed = async (reason: string) => {
    await writeAudit(db, {
      actorId: null,
      action: "auth.login_failed",
      entityType: "user",
      entityId: user?.id ?? null,
      after: { email, reason },
      ip: ctx.ip,
    });
    return fail("invalid", LOGIN_FAILED);
  };

  if (user && (!user.isActive || (user.lockedUntil && user.lockedUntil > new Date()))) {
    // Same work as a real check, so timing doesn't give the state away.
    await hashPassword(password);
    return failed(user.isActive ? "locked" : "inactive");
  }

  let responseHeaders: Headers;
  let userId: string;
  try {
    const res = await auth.api.signInEmail({
      body: { email, password, rememberMe: true },
      headers: ctx.headers,
      returnHeaders: true,
    });
    responseHeaders = res.headers;
    userId = res.response.user.id;
  } catch (err) {
    if (!(err instanceof APIError)) throw err;
    if (!user) return failed("unknown_email");
    const [after] = await db
      .update(users)
      .set({
        failedLogins: sql`case when ${users.failedLogins} + 1 >= ${LOCK_THRESHOLD} then 0 else ${users.failedLogins} + 1 end`,
        lockedUntil: sql`case when ${users.failedLogins} + 1 >= ${LOCK_THRESHOLD} then now() + make_interval(mins => ${LOCK_MINUTES}) else ${users.lockedUntil} end`,
      })
      .where(eq(users.id, user.id))
      .returning({ failedLogins: users.failedLogins, lockedUntil: users.lockedUntil });
    if (after.failedLogins === 0 && after.lockedUntil) {
      await writeAudit(db, {
        actorId: null,
        action: "auth.locked",
        entityType: "user",
        entityId: user.id,
        after: { lockedUntil: after.lockedUntil },
        ip: ctx.ip,
      });
    }
    return failed("bad_password");
  }

  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, userId));
  await writeAudit(db, { actorId: userId, action: "auth.login", entityType: "user", entityId: userId, ip: ctx.ip });
  return { ok: true, userId, responseHeaders };
}

export async function logout(deps: { db: Db; auth: Auth }, ctx: LoginContext): Promise<void> {
  const session = await deps.auth.api.getSession({ headers: ctx.headers, query: { disableRefresh: true } });
  await deps.auth.api.signOut({ headers: ctx.headers });
  if (session) {
    await writeAudit(deps.db, {
      actorId: session.user.id,
      action: "auth.logout",
      entityType: "session",
      entityId: session.session.id,
      ip: ctx.ip,
    });
  }
}
