@AGENTS.md

## Git

Work on `dev`; push `dev` freely; merge to `main` only on explicit command. One logical
change per commit, conventional-commit style (`feat(scope): …`, `fix(scope): …`), imperative
mood, ≤72 chars. Never edit an applied migration — new timestamped file under
`supabase/migrations/`. `.env.local` points at the hosted Supabase project — never write
scripts that read it; test against local Supabase only (`supabase start`, `npm run dev:local`).
