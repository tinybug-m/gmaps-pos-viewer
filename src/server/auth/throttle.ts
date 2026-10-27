import "server-only";
import { and, eq, gt, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { loginThrottle, users } from "../db/schema";

export const LOCK_THRESHOLD = 10;
export const LOCK_MINUTES = 15;
/** Failed sign-ins from one IP address, across all accounts, before that address is paused. */
export const IP_FAILURE_LIMIT = 50;

/*
 * Both counters are reserved *before* a password is checked, in one atomic
 * UPDATE, and handed back on success. Checking first and counting afterwards
 * would let a burst of parallel requests all pass the check before any of
 * them is counted.
 */

export interface AccountAttempt {
  userId: string;
  /** Set when this attempt used the last free slot and locked the account. */
  lockedUntil: Date | null;
}

/**
 * Takes one attempt slot on an active, unlocked account matching `where`.
 * Returns null when there's no such account (unknown, deactivated or locked).
 * The slot that reaches the threshold sets the lock straight away, so no
 * further attempt can start until the pause ends.
 */
export async function reserveAccountAttempt(db: Db, where: SQL): Promise<AccountAttempt | null> {
  const reaches = sql`${users.failedLogins} + 1 >= ${LOCK_THRESHOLD}`;
  const [row] = await db
    .update(users)
    .set({
      failedLogins: sql`case when ${reaches} then 0 else ${users.failedLogins} + 1 end`,
      lockedUntil: sql`case when ${reaches} then now() + make_interval(mins => ${LOCK_MINUTES}) else null end`,
    })
    .where(and(where, eq(users.isActive, true), or(isNull(users.lockedUntil), lte(users.lockedUntil, sql`now()`))))
    .returning({ id: users.id, lockedUntil: users.lockedUntil });
  return row ? { userId: row.id, lockedUntil: row.lockedUntil } : null;
}

/** The password was right: forget the failures, including the slot this attempt took. */
export async function clearAccountFailures(db: Db, userId: string): Promise<void> {
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, userId));
}

/**
 * Counts one attempt from `ip` in the current fixed window and returns the
 * count including it. Over IP_FAILURE_LIMIT means refuse without checking.
 */
export async function reserveIpAttempt(db: Db, ip: string): Promise<number> {
  const expired = sql`${loginThrottle.windowStart} <= now() - make_interval(mins => ${LOCK_MINUTES})`;
  const [row] = await db
    .insert(loginThrottle)
    .values({ ip, attempts: 1 })
    .onConflictDoUpdate({
      target: loginThrottle.ip,
      set: {
        windowStart: sql`case when ${expired} then now() else ${loginThrottle.windowStart} end`,
        attempts: sql`case when ${expired} then 1 else ${loginThrottle.attempts} + 1 end`,
      },
    })
    .returning({ attempts: loginThrottle.attempts });
  return row.attempts;
}

/** A successful sign-in doesn't count against the address. */
export async function releaseIpAttempt(db: Db, ip: string): Promise<void> {
  await db
    .update(loginThrottle)
    .set({ attempts: sql`${loginThrottle.attempts} - 1` })
    .where(and(eq(loginThrottle.ip, ip), gt(loginThrottle.attempts, 0)));
}
