# Deployment (Vercel + Neon)

None of this has been run yet. Every step marked **(you)** needs the project owner.

## Database

Add **Neon** from the Vercel project's **Storage** tab (Marketplace integration). It sets:
- `DATABASE_URL`: the **pooled** endpoint (host contains `-pooler`). The app uses it at runtime.
- `DATABASE_URL_UNPOOLED`: the direct endpoint. `pnpm db:migrate` prefers it for schema changes.

## Environment variables (per environment)

| Variable | Production | Preview | Local |
|---|---|---|---|
| `DATABASE_URL` | Neon main branch | Synthetic-data branch (see below) | `.env.local` |
| `BETTER_AUTH_SECRET` | Unique, at least 32 random chars | Different from production | Anything local |
| `BETTER_AUTH_URL` | The production origin, e.g. `https://leads.example.com` | The preview origin | `http://localhost:3000` |

Secrets differ per environment, so a session cookie from one environment never works in another.

## Preview branches: no production data

The Neon integration can create a database branch for every preview deployment. A branch **copies its parent's data**, which includes lead contact details and call notes. Do one of these:
- Point preview branching at a **dev branch that holds only synthetic data**, or
- Turn preview branching off and give previews a fixed synthetic database.

Also enable **Vercel Deployment Protection** for previews, so only signed-in team members can open them. Never copy production leads into a preview or dev branch.

## Migration runbook

Migrations are **never** run by `next build` or a deploy. Someone runs them on purpose against a named database.

1. **Rehearse (you).** In Neon, create a branch from production, for example `rehearsal-YYYYMMDD`. Then, with `DATABASE_URL_UNPOOLED` pointing at it:
   ```sh
   pnpm db:migrate --confirm=<dbname>
   ```
   Check that the app works against the branch. Delete the branch afterwards.
2. **Apply (you).** Point at the production main branch and run the same command with `--confirm=<production dbname>`.
3. **Rollback:** use Neon's branch restore (point-in-time) on main. Migrations are additive. Destructive changes are split across deploys (expand → backfill → contract).

## First admin (you)

Once migrations are applied, run this once in an interactive terminal:

```sh
pnpm db:create-admin --email=you@company.com --name="Your Name" --confirm=<dbname>
```

The password is entered at a hidden prompt. After that, admins create every other account from **Users**. Each new user gets a one-time password and must change it at first sign-in.

## Deploying

- Deploy **outside calling hours**. Server-action ids change with every build. A caller with an open tab whose form posts to the old build sees "The app was updated… reload" from the error boundary ([src/app/(app)/error.tsx](../src/app/(app)/error.tsx)), and that entry is not saved.
- Optional: turn on Vercel **Skew Protection** in project settings to keep old builds reachable briefly. It's not configured in `next.config.ts`.
- Security headers, including CSP, are set in [next.config.ts](../next.config.ts). The CSP blocks the Vercel toolbar on previews, which is expected.

## Security notes and known limits

How sign-in is throttled:
- **Per account:** after 10 failed attempts in a row, sign-in pauses for 15 minutes. Wrong current passwords on **Change password** count towards the same limit. The counter is reserved before the password is checked, so parallel requests can't get around it.
- **Per IP address:** 50 attempts in a fixed 15-minute window, held in the `login_throttle` table (migration 0002). Successful sign-ins don't count. Crossing the limit is written to the audit log once, as `auth.ip_limited`.

Known limits, accepted for now:
- **Client IP comes from headers.** The app reads `x-real-ip`, then `x-forwarded-for` ([src/server/auth/login.ts](../src/server/auth/login.ts)). Vercel sets these itself, so they can be trusted there. Behind any other host or proxy, a client could forge them, which would defeat the per-IP limit and put false addresses in the audit log. The per-account lock still applies.
- **4 MB request bodies.** `serverActions.bodySizeLimit` in [next.config.ts](../next.config.ts) is raised for lead imports, but Next applies it to every server action. Every action still requires a session, and inputs are validated with fixed limits (notes ≤ 5,000 characters, bulk actions ≤ 500 ids).
- **Not every change is in the audit log.** Status changes are kept in `lead_status_changes`, calls in `call_logs` and notes in `lead_notes`, and the lead's history shows all of them. The audit log covers sign-in and security events, user management, imports, assignments, voids and archiving.
- **No email-based password reset.** There's no email provider, so an admin resets passwords from **Users**.
- **Failed sign-ins for unknown addresses** keep only the email domain in the audit log. For a real account, the account's email is recorded.
- **Lead filtering runs in the browser** for admins and supervisors. That works up to roughly 5,000 leads; beyond that, move filters to SQL.

## Checklist of steps only you can do

- [ ] Create the Neon database in Vercel. Set `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` for Production and Preview.
- [ ] Set the preview-branch policy and enable Deployment Protection.
- [ ] Rehearse the migrations on a Neon branch, then apply them to production.
- [ ] Create the first admin.
- [ ] Decide on the lead import (see [DATA-AND-PRIVACY.md](DATA-AND-PRIVACY.md)), and if yes, run it with a dry run first.
- [ ] Push the `feat/team-lead-management` branch and deploy. Neither has been done.
- [ ] Make the GitHub repository private (see [DATA-AND-PRIVACY.md](DATA-AND-PRIVACY.md)).
