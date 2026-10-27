# Chinvat Bridge leads

Team lead management: admins import and assign leads, callers work their own queue and log every call, and supervisors review the work and leave feedback. Everything sits behind a login, and permissions are enforced on the server.

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): local setup, database scripts, tests and the regression gate
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Vercel + Neon, environment variables, the migration runbook
- [docs/DATA-AND-PRIVACY.md](docs/DATA-AND-PRIVACY.md): the import decision, repository visibility and history exposure

```sh
pnpm install
cp .env.example .env.local   # then fill it in, see docs/DEVELOPMENT.md
pnpm db:migrate
pnpm dev
```
