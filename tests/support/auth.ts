import { createAuth, type Auth } from "@/server/auth/auth";
import { attemptLogin } from "@/server/auth/login";
import type { Db } from "@/server/db/client";
import { createUser } from "@/server/dal/users";
import type { Role } from "@/lib/workflow";

export const TEST_SECRET = "test-secret-not-used-anywhere-else-0123456789";

export function testAuth(db: Db): Auth {
  return createAuth(db, { secret: TEST_SECRET, baseURL: "http://localhost:3000" });
}

let seq = 0;

/** Creates a user through the admin flow and returns the one-time password. */
export async function createAccount(db: Db, admin: { id: string; role: Role }, role: Role = "caller") {
  const n = ++seq;
  const res = await createUser(db, admin, { email: `account${n}-${role}@example.com`, name: `Account ${n}`, role });
  if (!res.ok) throw new Error(res.message);
  return { ...res.user, password: res.tempPassword };
}

/** Signs in and returns request headers carrying the session cookie. */
export async function signIn(db: Db, auth: Auth, email: string, password: string, ip = "198.51.100.1") {
  const res = await attemptLogin({ db, auth }, { email, password }, { ip, headers: new Headers() });
  if (!res.ok) return { ok: false as const, res };
  const setCookie = res.responseHeaders.get("set-cookie") ?? "";
  const cookie = setCookie
    .split(/,(?=\s*[\w.-]+=)/)
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.includes("session_token"))
    .join("; ");
  return { ok: true as const, res, headers: new Headers({ cookie }) };
}
