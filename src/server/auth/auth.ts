import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { ROLES } from "@/lib/workflow";
import { getDb, type Db } from "../db/client";
import { schema, users } from "../db/schema";
import { MIN_PASSWORD_LENGTH } from "../validation";

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * better-auth owns password verification, session rows and the signed session
 * cookie. Everything else (who may sign in, lockout, user management) is ours:
 * - there is no public sign-up and no /api/auth route; the app calls
 *   `auth.api.*` from server actions only, which Next protects with its
 *   Origin check;
 * - role/isActive/mustChangePassword can't be set through better-auth input;
 * - sessions can't be created for a deactivated user.
 */
export function createAuth(db: Db, opts: { secret?: string; baseURL?: string } = {}) {
  return betterAuth({
    secret: opts.secret ?? process.env.BETTER_AUTH_SECRET,
    baseURL: opts.baseURL ?? process.env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 200,
    },
    user: {
      additionalFields: {
        role: { type: [...ROLES], required: true, input: false, defaultValue: "caller" },
        isActive: { type: "boolean", required: true, input: false, defaultValue: true },
        mustChangePassword: { type: "boolean", required: true, input: false, defaultValue: true },
      },
    },
    session: { expiresIn: SESSION_TTL_SECONDS, updateAge: 24 * 60 * 60 },
    advanced: { database: { generateId: "uuid" } },
    logger: { disabled: process.env.VITEST === "true" },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const [user] = await db
              .select({ isActive: users.isActive })
              .from(users)
              .where(eq(users.id, session.userId));
            return user?.isActive === true;
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const cache = globalThis as unknown as { __leadsAuth?: Auth };

export function getAuth(): Auth {
  cache.__leadsAuth ??= createAuth(getDb());
  return cache.__leadsAuth;
}
