# Data and privacy

## Production import: not done, your decision

[refrence/data.json](../refrence/data.json) holds 114 records. They contain business names, Maps and website URLs, and SEO findings, with no phones or emails. The file arrived in commit `88a877e`, titled "feat: add sample data", so it looks like **sample data**, and nothing has been imported into any shared database.

- **If these are not real leads (recommended):** skip them and start with your first real export.
- **If they are real:** dry-run first, check the counts, then commit:
  ```sh
  pnpm db:import --file=refrence/data.json --as=<admin email>                              # dry run (reads only)
  pnpm db:import --file=refrence/data.json --as=<admin email> --commit --confirm=<dbname>  # write
  ```
  Admins can do the same through **Import** in the app. Re-running an import changes nothing, and the source file is only read.

## Real exports never go in git

Exports with phones, emails or decision-maker names must **never** be committed, attached to issues, or used as test fixtures. Import them from a local path outside the repo. Tests and E2E use synthetic data only.

## Repository visibility

`github.com/tinybug-m/gmaps-pos-viewer` is **public**. To make it private (you):
- On GitHub, go to **Settings → General → Danger Zone → Change repository visibility → Private**, or
- run `gh auth login`, then `gh repo edit tinybug-m/gmaps-pos-viewer --visibility private --accept-visibility-change-consequences`.

Making the repository private limits who can read the code and history. It does **not** protect the app. Access control is enforced by the app itself: login, roles, and ownership checks in SQL and in every action.

## History exposure assessment

These read-only checks were run on 2026-10-27 over every local branch, using `git log --all --name-only` and the blob sizes:

| Finding | Exposure |
|---|---|
| `refrence/data.json` (66 KB, commit `88a877e`, on `main`) | The 114 records described above are readable by anyone in the public history, even if the file is deleted later |
| `.env.example` | Template only: placeholders, no values |
| `.env`, `.env.local`, `*.pem`, `*.key`, credential files | **Never committed** |
| Other large files | Lockfiles and Drizzle migration snapshots only |

Removing `refrence/data.json` from history requires a history rewrite (for example `git filter-repo`) and a **force-push**. That rewrites shared history and breaks existing clones, so it needs your explicit approval and hasn't been done. Clones and forks made while the repo was public may still hold the file. If the data is sensitive, treat it as already disclosed.
