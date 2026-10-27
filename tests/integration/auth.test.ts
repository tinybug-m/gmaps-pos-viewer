import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IP_FAILURE_LIMIT, IP_LIMITED, LOCK_THRESHOLD, LOGIN_FAILED, attemptLogin } from "@/server/auth/login";
import type { Auth } from "@/server/auth/auth";
import { auditLog, loginThrottle, sessions, users } from "@/server/db/schema";
import {
  bootstrapAdmin,
  changeOwnPassword,
  createUser,
  listUsers,
  resetUserPassword,
  updateUser,
} from "@/server/dal/users";
import { createAccount, signIn, testAuth } from "../support/auth";
import { createTestDb, describeDb, type TestDb } from "../support/db";

const ADMIN_PASSWORD = "correct horse battery staple";

describeDb("authentication and user management", () => {
  let t: TestDb;
  let auth: Auth;
  let admin: { id: string; role: "admin" };

  beforeAll(async () => {
    t = await createTestDb();
    auth = testAuth(t.db);
    const res = await bootstrapAdmin(t.db, { email: "Owner@Example.com", name: "Owner", password: ADMIN_PASSWORD });
    if (!res.ok) throw new Error(res.message);
    admin = { id: res.userId, role: "admin" };
  });
  afterAll(async () => {
    await t?.drop();
  });

  const session = (headers: Headers) => auth.api.getSession({ headers, query: { disableRefresh: true } });
  const sessionCount = async (userId: string) =>
    (await t.db.select().from(sessions).where(eq(sessions.userId, userId))).length;

  describe("bootstrap", () => {
    it("creates the first admin with a lowercased email and refuses a second", async () => {
      const [row] = await t.db.select().from(users).where(eq(users.id, admin.id));
      expect(row).toMatchObject({ email: "owner@example.com", role: "admin", mustChangePassword: false });

      const again = await bootstrapAdmin(t.db, { email: "second@example.com", name: "Second", password: ADMIN_PASSWORD });
      expect(again).toMatchObject({ ok: false, code: "conflict" });
    });

    it("rejects a short password", async () => {
      const res = await bootstrapAdmin(t.db, { email: "x@example.com", name: "X", password: "short" });
      expect(res).toMatchObject({ ok: false, code: "invalid" });
    });

    it("lets the admin sign in", async () => {
      const res = await signIn(t.db, auth, "owner@example.com", ADMIN_PASSWORD);
      expect(res.ok).toBe(true);
      const s = await session(res.ok ? res.headers : new Headers());
      expect(s?.user).toMatchObject({ id: admin.id, role: "admin", isActive: true });
    });
  });

  describe("sign-in", () => {
    it("returns the same message for a wrong password and an unknown email", async () => {
      const user = await createAccount(t.db, admin);
      const wrong = await attemptLogin({ db: t.db, auth }, { email: user.email, password: "wrong password!!" }, { ip: null, headers: new Headers() });
      const unknown = await attemptLogin({ db: t.db, auth }, { email: "nobody@example.com", password: "wrong password!!" }, { ip: null, headers: new Headers() });
      expect(wrong).toEqual({ ok: false, code: "invalid", message: LOGIN_FAILED });
      expect(unknown).toEqual(wrong);
      const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
      expect(row.failedLogins).toBe(1);
    });

    it("locks the account after repeated failures, then lets it in once the pause ends", async () => {
      const user = await createAccount(t.db, admin);
      for (let i = 0; i < LOCK_THRESHOLD; i++) {
        await attemptLogin({ db: t.db, auth }, { email: user.email, password: `wrong-${i}-password` }, { ip: null, headers: new Headers() });
      }
      const [locked] = await t.db.select().from(users).where(eq(users.id, user.id));
      expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      // Even the right password is refused while locked, with the same message.
      const blocked = await signIn(t.db, auth, user.email, user.password);
      expect(blocked.ok).toBe(false);
      expect(blocked.res).toEqual({ ok: false, code: "invalid", message: LOGIN_FAILED });
      expect(await sessionCount(user.id)).toBe(0);

      const lockAudit = await t.db.select().from(auditLog).where(eq(auditLog.action, "auth.locked"));
      expect(lockAudit.some((a) => a.entityId === user.id)).toBe(true);

      await t.db.update(users).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(users.id, user.id));
      const ok = await signIn(t.db, auth, user.email, user.password);
      expect(ok.ok).toBe(true);
      const [after] = await t.db.select().from(users).where(eq(users.id, user.id));
      expect(after).toMatchObject({ failedLogins: 0, lockedUntil: null });
    });

    it("pauses an IP address with too many failures across accounts", async () => {
      const user = await createAccount(t.db, admin);
      const ip = "203.0.113.77";
      await t.db.insert(auditLog).values(
        Array.from({ length: IP_FAILURE_LIMIT }, () => ({ action: "auth.login_failed", entityType: "user", ip })),
      );
      const blocked = await signIn(t.db, auth, user.email, user.password, ip);
      expect(blocked.res).toEqual({ ok: false, code: "rate_limited", message: IP_LIMITED });
      const elsewhere = await signIn(t.db, auth, user.email, user.password, "203.0.113.78");
      expect(elsewhere.ok).toBe(true);
    });

    it("audits successful and failed sign-ins without storing the password", async () => {
      const user = await createAccount(t.db, admin);
      await signIn(t.db, auth, user.email, "not-the-password!");
      await signIn(t.db, auth, user.email, user.password);
      const rows = await t.db.select().from(auditLog).where(eq(auditLog.entityId, user.id));
      expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["auth.login_failed", "auth.login"]));
      expect(JSON.stringify(rows)).not.toContain(user.password);
      expect(JSON.stringify(rows)).not.toContain("not-the-password!");
    });

    it("has no public sign-up", async () => {
      await expect(
        auth.api.signUpEmail({ body: { email: "self@example.com", password: "a-long-enough-password", name: "Self" } }),
      ).rejects.toThrow();
      expect(await t.db.select().from(users).where(eq(users.email, "self@example.com"))).toHaveLength(0);
    });

    it("won't let a user raise their own role through better-auth", async () => {
      const user = await createAccount(t.db, admin);
      const signed = await signIn(t.db, auth, user.email, user.password);
      if (!signed.ok) throw new Error("sign-in failed");
      await expect(
        auth.api.updateUser({ headers: signed.headers, body: { role: "admin" } as never }),
      ).rejects.toThrow();
      await expect(
        auth.api.updateUser({ headers: signed.headers, body: { isActive: true, mustChangePassword: false } as never }),
      ).rejects.toThrow();
      const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
      expect(row).toMatchObject({ role: "caller", mustChangePassword: true });
    });
  });

  describe("user management", () => {
    it("creates users with a one-time password they must change", async () => {
      const res = await createUser(t.db, admin, { email: " New.Person@Example.com ", name: "New Person", role: "supervisor" });
      if (!res.ok) throw new Error(res.message);
      expect(res.user).toMatchObject({ email: "new.person@example.com", role: "supervisor", mustChangePassword: true });
      expect(res.tempPassword).toMatch(/^[\w]{4}-[\w]{4}-[\w]{4}-[\w]{4}$/);
      const signed = await signIn(t.db, auth, "new.person@example.com", res.tempPassword);
      expect(signed.ok).toBe(true);

      const dup = await createUser(t.db, admin, { email: "NEW.person@example.com", name: "Dup", role: "caller" });
      expect(dup).toMatchObject({ ok: false, code: "conflict" });
    });

    it("ignores extra fields a client might add", async () => {
      const res = await createUser(t.db, admin, {
        email: "sneaky@example.com",
        name: "Sneaky",
        role: "caller",
        mustChangePassword: false,
        isActive: false,
        id: "00000000-0000-4000-8000-000000000000",
      });
      if (!res.ok) throw new Error(res.message);
      expect(res.user.id).not.toBe("00000000-0000-4000-8000-000000000000");
      expect(res.user).toMatchObject({ mustChangePassword: true, isActive: true });
    });

    it("only lets admins manage users", async () => {
      const supervisor = await createAccount(t.db, admin, "supervisor");
      const caller = await createAccount(t.db, admin, "caller");
      for (const actor of [supervisor, caller]) {
        const v = { id: actor.id, role: actor.role };
        expect(await createUser(t.db, v, { email: "x1@example.com", name: "X", role: "admin" })).toMatchObject({ code: "forbidden" });
        expect(await updateUser(t.db, v, { userId: actor.id, role: "admin" })).toMatchObject({ code: "forbidden" });
        expect(await resetUserPassword(t.db, v, { userId: admin.id })).toMatchObject({ code: "forbidden" });
        expect(await listUsers(t.db, v)).toBeNull();
      }
      const [row] = await t.db.select().from(users).where(eq(users.id, caller.id));
      expect(row.role).toBe("caller");
    });

    it("signs a user out everywhere when deactivated and blocks new sign-ins", async () => {
      const user = await createAccount(t.db, admin);
      const signed = await signIn(t.db, auth, user.email, user.password);
      if (!signed.ok) throw new Error("sign-in failed");
      expect(await session(signed.headers)).not.toBeNull();

      const res = await updateUser(t.db, admin, { userId: user.id, isActive: false });
      expect(res).toMatchObject({ ok: true, user: { isActive: false } });
      expect(await session(signed.headers)).toBeNull();
      expect(await sessionCount(user.id)).toBe(0);

      const again = await signIn(t.db, auth, user.email, user.password);
      expect(again.res).toEqual({ ok: false, code: "invalid", message: LOGIN_FAILED });
      // Even calling better-auth directly can't create a session for them.
      await expect(auth.api.signInEmail({ body: { email: user.email, password: user.password } })).rejects.toThrow();
      expect(await sessionCount(user.id)).toBe(0);

      await updateUser(t.db, admin, { userId: user.id, isActive: true });
      expect((await signIn(t.db, auth, user.email, user.password)).ok).toBe(true);

      const actions = (await t.db.select().from(auditLog).where(eq(auditLog.entityId, user.id))).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(["user.created", "user.deactivated", "user.reactivated"]));
    });

    it("signs a user out when their role changes", async () => {
      const user = await createAccount(t.db, admin);
      const signed = await signIn(t.db, auth, user.email, user.password);
      if (!signed.ok) throw new Error("sign-in failed");
      await updateUser(t.db, admin, { userId: user.id, role: "supervisor" });
      expect(await session(signed.headers)).toBeNull();
      // Renaming doesn't.
      const again = await signIn(t.db, auth, user.email, user.password);
      if (!again.ok) throw new Error("sign-in failed");
      await updateUser(t.db, admin, { userId: user.id, name: "Renamed" });
      expect(await session(again.headers)).not.toBeNull();
    });

    it("stops admins changing their own role or deactivating themselves", async () => {
      expect(await updateUser(t.db, admin, { userId: admin.id, role: "caller" })).toMatchObject({ code: "forbidden" });
      expect(await updateUser(t.db, admin, { userId: admin.id, isActive: false })).toMatchObject({ code: "forbidden" });
    });

    it("always keeps one active admin, even when two admins remove each other at once", async () => {
      const second = await createAccount(t.db, admin, "admin");
      const a = { id: admin.id, role: "admin" as const };
      const b = { id: second.id, role: "admin" as const };
      const results = await Promise.all([
        updateUser(t.db, a, { userId: b.id, isActive: false }),
        updateUser(t.db, b, { userId: a.id, role: "caller" }),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([expect.objectContaining({ code: "conflict" })]);
      const activeAdmins = await t.db.select().from(users).where(eq(users.role, "admin"));
      expect(activeAdmins.filter((u) => u.isActive)).toHaveLength(1);

      // Put things back for later tests.
      const survivor = activeAdmins.find((u) => u.isActive)!;
      if (survivor.id !== admin.id) {
        await updateUser(t.db, { id: survivor.id, role: "admin" }, { userId: admin.id, role: "admin" });
      }
    });

    it("resets a password: new one-time password, lock cleared, sessions revoked", async () => {
      const user = await createAccount(t.db, admin);
      const signed = await signIn(t.db, auth, user.email, user.password);
      if (!signed.ok) throw new Error("sign-in failed");
      await t.db.update(users).set({ lockedUntil: new Date(Date.now() + 60_000), failedLogins: 3 }).where(eq(users.id, user.id));

      const res = await resetUserPassword(t.db, admin, { userId: user.id });
      if (!res.ok) throw new Error(res.message);
      expect(await session(signed.headers)).toBeNull();
      expect((await signIn(t.db, auth, user.email, user.password)).ok).toBe(false);
      expect((await signIn(t.db, auth, user.email, res.tempPassword)).ok).toBe(true);
      const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
      expect(row).toMatchObject({ mustChangePassword: true, lockedUntil: null });
    });
  });

  describe("throttling under parallel requests", () => {
    const failuresFor = async (userId: string) =>
      (await t.db.select().from(auditLog).where(and(eq(auditLog.action, "auth.login_failed"), eq(auditLog.entityId, userId)))).map(
        (r) => (r.after as { reason: string }).reason,
      );

    it("checks at most LOCK_THRESHOLD passwords for an account however many arrive at once", async () => {
      const user = await createAccount(t.db, admin);
      const results = await Promise.all(
        Array.from({ length: LOCK_THRESHOLD * 3 }, (_, i) =>
          attemptLogin({ db: t.db, auth }, { email: user.email, password: `wrong-guess-${i}` }, { ip: `192.0.2.${i + 1}`, headers: new Headers() }),
        ),
      );
      expect(results.every((r) => !r.ok)).toBe(true);
      const reasons = await failuresFor(user.id);
      expect(reasons.filter((r) => r === "bad_password")).toHaveLength(LOCK_THRESHOLD);
      expect(reasons.filter((r) => r === "locked")).toHaveLength(LOCK_THRESHOLD * 2);
      expect(await t.db.select().from(auditLog).where(and(eq(auditLog.action, "auth.locked"), eq(auditLog.entityId, user.id)))).toHaveLength(1);
      expect((await signIn(t.db, auth, user.email, user.password)).ok).toBe(false);
    });

    it("lets exactly IP_FAILURE_LIMIT attempts from one address through a burst, and audits the limit once", async () => {
      const ip = "203.0.113.90";
      const results = await Promise.all(
        Array.from({ length: IP_FAILURE_LIMIT + 10 }, (_, i) =>
          attemptLogin({ db: t.db, auth }, { email: `burst${i}@nowhere.example`, password: "irrelevant-guess" }, { ip, headers: new Headers() }),
        ),
      );
      expect(results.filter((r) => !r.ok && r.code === "rate_limited")).toHaveLength(10);
      expect(await t.db.select().from(auditLog).where(and(eq(auditLog.action, "auth.ip_limited"), eq(auditLog.ip, ip)))).toHaveLength(1);
    });

    it("doesn't count successful sign-ins against the address", async () => {
      const user = await createAccount(t.db, admin);
      const ip = "203.0.113.91";
      for (let i = 0; i < IP_FAILURE_LIMIT + 5; i++) expect((await signIn(t.db, auth, user.email, user.password, ip)).ok).toBe(true);
      await signIn(t.db, auth, user.email, "not-the-password!", ip);
      const [row] = await t.db.select().from(loginThrottle).where(eq(loginThrottle.ip, ip));
      expect(row.attempts).toBe(1);
    });

    it("keeps only the domain of an address that matches no account", async () => {
      const ip = "203.0.113.92";
      await signIn(t.db, auth, "someone.typo@unknown.example", "irrelevant-guess", ip);
      const [row] = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "auth.login_failed"), eq(auditLog.ip, ip)));
      expect(row.after).toEqual({ emailDomain: "unknown.example", reason: "unknown_email" });
      expect(JSON.stringify(row)).not.toContain("someone.typo");
    });
  });

  describe("changing your own password", () => {
    it("checks the current password, keeps this session and ends the others", async () => {
      const user = await createAccount(t.db, admin);
      const here = await signIn(t.db, auth, user.email, user.password);
      const there = await signIn(t.db, auth, user.email, user.password);
      if (!here.ok || !there.ok) throw new Error("sign-in failed");
      const current = await session(here.headers);
      const viewer = { id: user.id, role: user.role, sessionId: current!.session.id };

      expect(await changeOwnPassword(t.db, viewer, { currentPassword: "wrong-password", newPassword: "a brand new passphrase" })).toMatchObject({ ok: false, code: "invalid" });
      expect(await changeOwnPassword(t.db, viewer, { currentPassword: user.password, newPassword: "short" })).toMatchObject({ ok: false, code: "invalid" });

      const ok = await changeOwnPassword(t.db, viewer, { currentPassword: user.password, newPassword: "a brand new passphrase" });
      expect(ok).toEqual({ ok: true });
      expect(await session(here.headers)).not.toBeNull();
      expect(await session(there.headers)).toBeNull();
      const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
      expect(row.mustChangePassword).toBe(false);
      expect((await signIn(t.db, auth, user.email, "a brand new passphrase")).ok).toBe(true);
      expect((await signIn(t.db, auth, user.email, user.password)).ok).toBe(false);
    });
    it("pauses after repeated wrong current passwords, sharing the sign-in counter", async () => {
      const user = await createAccount(t.db, admin);
      const here = await signIn(t.db, auth, user.email, user.password);
      if (!here.ok) throw new Error("sign-in failed");
      const viewer = { id: user.id, role: user.role, sessionId: (await session(here.headers))!.session.id };
      const results = await Promise.all(
        Array.from({ length: LOCK_THRESHOLD * 2 }, (_, i) =>
          changeOwnPassword(t.db, viewer, { currentPassword: `wrong-current-${i}`, newPassword: "a brand new passphrase" }),
        ),
      );
      expect(results.filter((r) => !r.ok && r.code === "invalid")).toHaveLength(LOCK_THRESHOLD);
      expect(results.filter((r) => !r.ok && r.code === "rate_limited")).toHaveLength(LOCK_THRESHOLD);
      expect(await changeOwnPassword(t.db, viewer, { currentPassword: user.password, newPassword: "a brand new passphrase" })).toMatchObject({
        ok: false,
        code: "rate_limited",
      });
      expect(await t.db.select().from(auditLog).where(and(eq(auditLog.action, "auth.locked"), eq(auditLog.entityId, user.id)))).toHaveLength(1);
      // The old password still works once the pause is over.
      await t.db.update(users).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(users.id, user.id));
      expect((await signIn(t.db, auth, user.email, user.password)).ok).toBe(true);
    });
  });
});
