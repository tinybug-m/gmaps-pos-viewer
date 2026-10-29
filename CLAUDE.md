@AGENTS.md

## Override for the Next.js docs rule above
Do NOT read node_modules/next/dist/docs/ wholesale. Only when using a Next API
you're unsure about, grep the docs for that API and read just that section.
Check the dal-cheatsheet memory first.

## Working rules
- Commit on the feature branch, never push. Conventional Commits.
- Read files by line range; for src/server/dal/*, use the dal-cheatsheet first.
- Small targeted Edits only. No rewrite scripts, no reprinting whole files.
- While working: `pnpm vitest related <changed files> --reporter=dot`.
  Full gate (lint, typecheck, test, build, e2e) only before a commit, when I ask.
- Browser checks: `pnpm test:e2e` (optionally -g "<name>"), not the Playwright MCP.
- When a task is done, say "done, ready to /clear".
