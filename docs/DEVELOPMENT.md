# Development

Next.js 16 (App Router), Postgres via Drizzle and Better Auth with email and password. Everything sits behind a login. Read `node_modules/next/dist/docs/` before writing Next code (see [AGENTS.md](../AGENTS.md)).

## Setup

1. Install Node 24 and pnpm 11, then run `pnpm install`.
2. Run `cp .env.example .env.local` and fill it in. `.env.local` is git-ignored, and never commit it. You need:
   - `DATABASE_URL`: a local Postgres or a Neon **dev** branch, never production.
   - `BETTER_AUTH_SECRET`: generate with `openssl rand -base64 32`.
   - `BETTER_AUTH_URL`: `http://localhost:3000`.
   - `TEST_DATABASE_URL`: only for integration and E2E tests (see below).
3. Local Postgres for tests (throwaway; bound to localhost only):

   ```sh
   docker run -d --name leads-test-pg -e POSTGRES_PASSWORD=postgres \
     -p 127.0.0.1:54329:5432 postgres:17-alpine
   # later sessions: docker start leads-test-pg
   ```

   Then `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres`. The same server can host a dev database too. For example, run `create database leads_dev` and point `DATABASE_URL` at it.

## Database scripts

All three read `.env.local`. They run freely against `localhost`, but any other host must be named with `--confirm=<dbname>` (see [scripts/lib/target.ts](../scripts/lib/target.ts)).

| Command | What it does |
|---|---|
| `pnpm db:migrate` | Applies [drizzle/](../drizzle/) migrations. Prefers `DATABASE_URL_UNPOOLED` when set |
| `pnpm db:create-admin --email=… --name="…"` | Creates the first admin. The password is typed at a hidden prompt, and it refuses if an active admin exists |
| `pnpm db:import --file=export.json --as=admin@…` | Import dry run (counts only). Add `--commit` to write |
| `pnpm db:generate` | Generates a new migration after editing [schema.ts](../src/server/db/schema.ts). Review the SQL before committing |

Then run `pnpm dev`, sign in at `/login`, and create other users from **Users**.

## Tests

| Command | Needs | Notes |
|---|---|---|
| `pnpm test` | `TEST_DATABASE_URL` for integration suites (they're skipped without it) | Vitest. Each integration file creates and drops its own `leads_test_*` database. Only `TEST_*` vars are read from `.env.local` ([vitest.config.ts](../vitest.config.ts)) |
| `pnpm test:e2e` | `TEST_DATABASE_URL` on a **local** host, plus the Playwright Chromium (`pnpm exec playwright install chromium` once) | See below |

The E2E suite ([playwright.config.ts](../playwright.config.ts), [e2e/](../e2e/)) works like this:
- It drops and recreates `leads_e2e` on the `TEST_DATABASE_URL` server, migrates it, and seeds four synthetic accounts and six synthetic leads ([e2e/seed.ts](../e2e/seed.ts)).
- Passwords are random per run. They're written only to `.local/e2e/state.json`, which is git-ignored with mode 600, and never printed.
- It then runs `next build` and `next start -p 3200` with a per-run `BETTER_AUTH_SECRET`. It never uses `DATABASE_URL`.
- Specs run serially because some of them change the seeded data.

All fixtures are synthetic: `example.com` domains and Ofcom drama numbers. Never put real or exported lead data in tests.

## Regression gate

Run this before every commit:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Run `pnpm test:e2e` as well when you change pages, actions or auth.

## Roles

The matrix lives in [src/lib/permissions.ts](../src/lib/permissions.ts). The server enforces it on every page and action, and the UI uses it only to hide controls.

| | Admin | Supervisor | Caller |
|---|---|---|---|
| Users, import, archive, assign, void entries, audit log | ✓ | – | – |
| See all leads and the team dashboard | ✓ | ✓ | – (own leads only; others are 404) |
| Log calls, change status | ✓ | – | own leads |
| Notes, follow-ups | ✓ | ✓ | own leads |
| Feedback | ✓ | ✓ | reads feedback on own leads |
| Reopen a closed lead | ✓ | – | – |

Callers are scoped in SQL, and ownership is checked again inside the transaction of every write.
