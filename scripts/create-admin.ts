/**
 * Creates the first admin account. Run once per environment:
 *
 *   pnpm db:create-admin --email=you@company.com --name="Your Name"
 *   pnpm db:create-admin --email=… --name=… --confirm=<dbname>   (non-local database)
 *
 * The password is typed at a hidden prompt, twice. It is never accepted as an
 * argument or environment variable, so it can't end up in shell history, CI
 * logs or process listings. Refuses if an active admin already exists; after
 * that, admins create everyone else from the Users page.
 */
import { createInterface } from "node:readline/promises";
import { createDb } from "../src/server/db/client";
import { bootstrapAdmin } from "../src/server/dal/users";
import { requireConfirmedTarget, requireDatabaseUrl } from "./lib/target";

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let value = "";
    // Raw mode first, so nothing typed early is echoed.
    stdin.setRawMode(true);
    process.stdout.write(question);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  if (!process.stdin.isTTY) {
    console.error("Run this in an interactive terminal: the password is read from a hidden prompt.");
    process.exit(2);
  }
  const url = requireDatabaseUrl();
  requireConfirmedTarget(url, "create an admin in");

  const email = arg("email") ?? (await ask("Email: "));
  const name = arg("name") ?? (await ask("Full name: "));
  const password = await askHidden("Password (12+ characters): ");
  if ((await askHidden("Repeat password: ")) !== password) {
    console.error("The passwords don't match.");
    process.exit(1);
  }

  const { db, pool } = createDb(url, 1);
  try {
    const result = await bootstrapAdmin(db, { email, name, password });
    if (!result.ok) {
      console.error(result.message);
      process.exit(1);
    }
    console.log(`Admin created for ${email.trim().toLowerCase()}. Sign in at /login.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
