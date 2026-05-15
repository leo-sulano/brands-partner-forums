# Brands Partner Forum

Internal brand-monitoring dashboard. Surfaces forum mentions from a Google Sheet (synced into Supabase by an Edge Function) and presents trends, individual mention detail, and sync health.

## Stack
Vite · React 19 · TypeScript · Tailwind v4 · React Router v7 · Recharts · Supabase · Vercel

## Quick start

```bash
npm install
cp .env.example .env       # fill in VITE_SUPABASE_URL + anon key
npm run dev
```

App boots at http://localhost:5173.

## Scripts
- `npm run dev` — local dev server
- `npm run build` — typecheck + production build to `dist/`
- `npm run preview` — preview the production build

## Routes
- `/` — Overview (KPIs, time-series chart, top forums/keywords, recent mentions)
- `/mentions/:id` — Mention detail + status toggle
- `/sync` — Sync status / manual sync trigger

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Deploy the Edge Function: `supabase functions deploy sync-sheet`.
4. Set secrets: `supabase secrets set GOOGLE_SHEET_ID=... GOOGLE_SERVICE_ACCOUNT_JSON=... SUPABASE_SERVICE_ROLE_KEY=...`
5. Schedule the function (e.g. via `pg_cron` or Supabase scheduled functions).

## Deploy

Push to the configured Vercel project. Enable **Password Protection** in Vercel project settings — there is no app-level auth.

## Spec

See [docs/superpowers/specs/2026-05-15-forums-dashboard-design.md](docs/superpowers/specs/2026-05-15-forums-dashboard-design.md).
