import "server-only";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, asc, count, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { can, type Viewer } from "@/lib/permissions";
import type { Role } from "@/lib/workflow";
import { generateTempPassword } from "../auth/password";
import type { Db, DbOrTx } from "../db/client";
import { isUniqueViolation } from "../db/errors";
import { accounts, leads, sessions, users } from "../db/schema";
import { fail, type Result } from "../result";
import { changePasswordInput, createUserInput, firstIssue, passwordSchema, updateUserInput } from "../validation";
import { writeAudit } from "./audit";

const CREDENTIAL = "credential";
const FORBIDDEN = fail("forbidden", "Only an admin can manage users.");
const LAST_ADMIN = fail("conflict", "There must always be at least one active admin.");

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
  createdAt: Date;
  deactivatedAt: Date | null;
  /** Non-archived leads currently assigned to this user. */
  assignedLeads: number;
}

const userColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  isActive: users.isActive,
  mustChangePassword: users.mustChangePassword,
  lockedUntil: users.lockedUntil,
  createdAt: users.createdAt,
  deactivatedAt: users.deactivatedAt,
};

async function assignedCount(db: DbOrTx, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(leads)
    .where(and(eq(leads.assignedTo, userId), isNull(leads.archivedAt)));
  return row.n;
}

export async function listUsers(db: Db, actor: Viewer): Promise<UserDTO[] | null> {
  if (!can(actor, "users.manage")) return null;
  const assigned = db
    .select({ userId: leads.assignedTo, n: count().as("n") })
    .from(leads)
    .where(isNull(leads.archivedAt))
    .groupBy(leads.assignedTo)
    .as("assigned");
  const rows = await db
    .select({ ...userColumns, assignedLeads: sql<number>`coalesce(${assigned.n}, 0)::int` })
    .from(users)
    .leftJoin(assigned, eq(assigned.userId, users.id))
    .orderBy(desc(users.isActive), asc(users.name));
  return rows;
}

/** Active users who can be given leads. */
export async function listAssignees(db: Db, actor: Viewer): Promise<{ id: string; name: string; role: Role }[] | null> {
  if (!can(actor, "leads.viewAll")) return null;
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.name));
}

async function insertCredentialUser(
  tx: DbOrTx,
  values: { email: string; name: string; role: Role; mustChangePassword: boolean },
  passwordHash: string,
) {
  const [user] = await tx.insert(users).values(values).returning(userColumns);
  await tx.insert(accounts).values({
    userId: user.id,
    accountId: user.id,
    providerId: CREDENTIAL,
    password: passwordHash,
  });
  return user;
}

/** Creates an account with a one-time password. The password is returned once and never stored in clear. */
export async function createUser(
  db: Db,
  actor: Viewer,
  input: unknown,
  ctx: { ip?: string | null } = {},
): Promise<Result<{ user: UserDTO; tempPassword: string }>> {
  if (!can(actor, "users.manage")) return FORBIDDEN;
  const parsed = createUserInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  try {
    const user = await db.transaction(async (tx) => {
      const created = await insertCredentialUser(tx, { ...parsed.data, mustChangePassword: true }, hash);
      await writeAudit(tx, {
        actorId: actor.id,
        action: "user.created",
        entityType: "user",
        entityId: created.id,
        after: { email: created.email, name: created.name, role: created.role },
        ip: ctx.ip,
      });
      return created;
    });
    return { ok: true, user: { ...user, assignedLeads: 0 }, tempPassword };
  } catch (err) {
    if (isUniqueViolation(err, "users_email_unique")) return fail("conflict", "A user with that email already exists.");
    throw err;
  }
}

/**
 * Rename, change role, deactivate or reactivate. Role changes and
 * deactivation sign the user out everywhere. Nobody can change their own
 * role or deactivate themselves, and the last active admin can't be removed.
 */
export async function updateUser(
  db: Db,
  actor: Viewer,
  input: unknown,
  ctx: { ip?: string | null } = {},
): Promise<Result<{ user: UserDTO }>> {
  if (!can(actor, "users.manage")) return FORBIDDEN;
  const parsed = updateUserInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { userId, name, role, isActive } = parsed.data;
  if (userId === actor.id && ((role !== undefined && role !== actor.role) || isActive === false)) {
    return fail("forbidden", "You can't change your own role or deactivate yourself. Ask another admin.");
  }

  return db.transaction(async (tx) => {
    // Lock the active admins first, in a fixed order, so two admins demoting
    // each other at once can't both succeed (or deadlock).
    const admins = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.isActive, true)))
      .orderBy(asc(users.id))
      .for("update");
    const [before] = await tx.select(userColumns).from(users).where(eq(users.id, userId)).for("update");
    if (!before) return fail("not_found", "That user doesn't exist.");

    const roleChanged = role !== undefined && role !== before.role;
    const deactivating = isActive === false && before.isActive;
    const reactivating = isActive === true && !before.isActive;
    const renamed = name !== undefined && name !== before.name;
    const losesAdmin = before.role === "admin" && before.isActive && ((roleChanged && role !== "admin") || deactivating);
    if (losesAdmin && admins.length <= 1) return LAST_ADMIN;

    if (!roleChanged && !deactivating && !reactivating && !renamed) {
      return { ok: true as const, user: { ...before, assignedLeads: await assignedCount(tx, userId) } };
    }

    const now = new Date();
    const [after] = await tx
      .update(users)
      .set({
        ...(renamed && { name }),
        ...(roleChanged && { role }),
        ...(deactivating && { isActive: false, deactivatedAt: now }),
        ...(reactivating && { isActive: true, deactivatedAt: null, failedLogins: 0, lockedUntil: null }),
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .returning(userColumns);

    if (roleChanged || deactivating) await tx.delete(sessions).where(eq(sessions.userId, userId));

    const audit = (action: string, b: unknown, a: unknown) => ({
      actorId: actor.id,
      action,
      entityType: "user" as const,
      entityId: userId,
      before: b,
      after: a,
      ip: ctx.ip,
    });
    await writeAudit(tx, [
      ...(renamed ? [audit("user.renamed", { name: before.name }, { name })] : []),
      ...(roleChanged ? [audit("user.role_changed", { role: before.role }, { role })] : []),
      ...(deactivating ? [audit("user.deactivated", null, null)] : []),
      ...(reactivating ? [audit("user.reactivated", null, null)] : []),
    ]);
    return { ok: true as const, user: { ...after, assignedLeads: await assignedCount(tx, userId) } };
  });
}

/** Issues a new one-time password, clears any lockout and signs the user out everywhere. */
export async function resetUserPassword(
  db: Db,
  actor: Viewer,
  input: unknown,
  ctx: { ip?: string | null } = {},
): Promise<Result<{ tempPassword: string }>> {
  if (!can(actor, "users.manage")) return FORBIDDEN;
  const parsed = z.object({ userId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("invalid", "Pick a user.");
  const { userId } = parsed.data;
  if (userId === actor.id) return fail("forbidden", "Use Change password for your own account.");
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);

  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    if (!target) return fail("not_found", "That user doesn't exist.");
    await tx
      .update(users)
      .set({ mustChangePassword: true, failedLogins: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    const updated = await tx
      .update(accounts)
      .set({ password: hash, updatedAt: new Date() })
      .where(and(eq(accounts.userId, userId), eq(accounts.providerId, CREDENTIAL)))
      .returning({ id: accounts.id });
    if (updated.length === 0) {
      await tx.insert(accounts).values({ userId, accountId: userId, providerId: CREDENTIAL, password: hash });
    }
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "user.password_reset",
      entityType: "user",
      entityId: userId,
      ip: ctx.ip,
    });
    return { ok: true as const, tempPassword };
  });
}

/** The signed-in user changes their own password; their other sessions are signed out. */
export async function changeOwnPassword(
  db: Db,
  viewer: Viewer & { sessionId: string },
  input: unknown,
  ctx: { ip?: string | null } = {},
): Promise<Result> {
  const parsed = changePasswordInput.safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { currentPassword, newPassword } = parsed.data;
  if (currentPassword === newPassword) return fail("invalid", "Choose a new password, not the current one.");

  const [account] = await db
    .select({ id: accounts.id, password: accounts.password })
    .from(accounts)
    .where(and(eq(accounts.userId, viewer.id), eq(accounts.providerId, CREDENTIAL)));
  if (!account?.password || !(await verifyPassword({ hash: account.password, password: currentPassword }))) {
    await writeAudit(db, {
      actorId: viewer.id,
      action: "user.password_change_failed",
      entityType: "user",
      entityId: viewer.id,
      ip: ctx.ip,
    });
    return fail("invalid", "Your current password is incorrect.");
  }
  const hash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    await tx.update(accounts).set({ password: hash, updatedAt: new Date() }).where(eq(accounts.id, account.id));
    await tx
      .update(users)
      .set({ mustChangePassword: false, updatedAt: new Date() })
      .where(eq(users.id, viewer.id));
    await tx.delete(sessions).where(and(eq(sessions.userId, viewer.id), ne(sessions.id, viewer.sessionId)));
    await writeAudit(tx, {
      actorId: viewer.id,
      action: "user.password_changed",
      entityType: "user",
      entityId: viewer.id,
      ip: ctx.ip,
    });
  });
  return { ok: true };
}

/**
 * Creates the first admin from the command line (scripts/create-admin.ts).
 * Refuses once any active admin exists; after that, admins create users in the app.
 */
export async function bootstrapAdmin(
  db: Db,
  input: { email: string; name: string; password: string },
): Promise<Result<{ userId: string }>> {
  const parsed = createUserInput
    .omit({ role: true })
    .extend({ password: passwordSchema })
    .safeParse(input);
  if (!parsed.success) return fail("invalid", firstIssue(parsed.error));
  const { email, name, password } = parsed.data;
  const hash = await hashPassword(password);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('leads.bootstrap_admin'))`);
      const [existing] = await tx
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.role, "admin"), eq(users.isActive, true)));
      if (existing.n > 0) return fail("conflict", "An active admin already exists. Create more users from the app.");
      const user = await insertCredentialUser(tx, { email, name, role: "admin", mustChangePassword: false }, hash);
      await writeAudit(tx, {
        actorId: null,
        action: "user.bootstrap_admin",
        entityType: "user",
        entityId: user.id,
        after: { email, name },
      });
      return { ok: true as const, userId: user.id };
    });
  } catch (err) {
    if (isUniqueViolation(err, "users_email_unique")) return fail("conflict", "A user with that email already exists.");
    throw err;
  }
}
