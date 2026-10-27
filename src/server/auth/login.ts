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
import {
  clearAccountFailures,
  IP_FAILURE_LIMIT,
  LOCK_MINUTES,
  LOCK_THRESHOLD,
  releaseIpAttempt,
  reserveAccountAttempt,
  reserveIpAttempt,
} from "./throttle";

export { IP_FAILURE_LIMIT, LOCK_MINUTES, LOCK_THRESHOLD };

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
    const attempts = await reserveIpAttempt(db, ctx.ip);
    // The audit trail is a second, slower source for the same limit.
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
    if (attempts > IP_FAILURE_LIMIT || failures >= IP_FAILURE_LIMIT) {
      if (attempts === IP_FAILURE_LIMIT + 1) {
        await writeAudit(db, { actorId: null, action: "auth.ip_limited", entityType: "ip", entityId: ctx.ip, ip: ctx.ip });
      }
      return fail("rate_limited", IP_LIMITED);
    }
  }

  // Takes a slot before the password is checked; see ./throttle.
  const attempt = await reserveAccountAttempt(db, eq(users.email, email));

  const failed = async (userId: string | null, reason: string) => {
    await writeAudit(db, {
      actorId: null,
      action: "auth.login_failed",
      entityType: "user",
      entityId: userId,
      // An address that matches no account may be someone's mistyped
      // address or a guess list; keep only its domain.
      after: userId ? { email, reason } : { emailDomain: email.split("@").pop() ?? "", reason },
      ip: ctx.ip,
    });
    return fail("invalid", LOGIN_FAILED);
  };

  if (!attempt) {
    const [user] = await db.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.email, email));
    // Same work as a real check, so timing doesn't give the state away.
    await hashPassword(password);
    if (!user) return failed(null, "unknown_email");
    return failed(user.id, user.isActive ? "locked" : "inactive");
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
    if (attempt.lockedUntil) {
      await writeAudit(db, {
        actorId: null,
        action: "auth.locked",
        entityType: "user",
        entityId: attempt.userId,
        after: { lockedUntil: attempt.lockedUntil },
        ip: ctx.ip,
      });
    }
    return failed(attempt.userId, "bad_password");
  }

  await clearAccountFailures(db, userId);
  if (ctx.ip) await releaseIpAttempt(db, ctx.ip);
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
