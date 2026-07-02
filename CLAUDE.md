# CLAUDE Context — Brands Partner Forum

## Purpose
Internal brand-monitoring dashboard. Reads forum-mention data that an upstream Edge Function pulls from a Google Sheet into Supabase, and presents it as an overview, per-mention detail, and a sync-status admin page.

## Tech Stack
Vite 6 · React 19 · TypeScript · Tailwind v4 · React Router v7 · Recharts · Supabase (Postgres + Edge Functions) · Vercel

## Project Structure
```
Brands Partner Forum/
├── src/
│   ├── main.tsx, App.tsx, index.css, vite-env.d.ts
│   ├── components/         # Sidebar, Topbar, KpiCard, MentionsTable, TopList, TimeSeriesChart, StatusBadge, Toast
│   ├── pages/              # Overview, MentionDetail, SyncStatus
│   ├── lib/                # supabase (client), queries (data access), format (helpers)
│   └── types/              # mention, sync
├── supabase/
│   ├── schema.sql          # mentions + sync_runs tables, indexes
│   └── functions/
│       └── sync-sheet/     # Deno Edge Function: Google Sheet → mentions upsert
├── docs/superpowers/specs/ # design specs
└── public/
```

## Architecture Rules
- **Data flow:** Google Sheet → `sync-sheet` Edge Function → `mentions` table → React reads via supabase-js
- **Auth:** email+password login via Supabase Auth, gated by admin-approval (`profiles.approved`). `AuthContext` holds session/profile; `ProtectedRoute` wraps every app route except `/login`, `/signup`, `/reset-password`. Vercel password protection also guards the deploy on top of this.
- **Data access:** all Supabase queries live in `src/lib/queries.ts`. Pages and components import from there, never call `supabase.from(...)` directly.
- **Routing:** React Router v7 declarative routes — `/`, `/mentions/:id`, `/brands/:tab`, `/sync`, `/log`, `/score-summary`, `/ask-ai`, `/admin/users`, plus public `/login`, `/signup`, `/reset-password`.
- **Styling:** Tailwind v4 utility classes. No global CSS beyond `index.css` (resets, base tokens).
- **Charts:** Recharts only. Keep chart components in `src/components/` and pass plain data props.

## Data Model
- `mentions(id, source_row_id, forum, thread_title, mention_text, url, author, posted_at, keyword, sentiment, status, synced_at)`
- `sync_runs(id, started_at, finished_at, rows_seen, rows_upserted, rows_skipped, error_message, status)`
- `source_row_id` is the idempotency key for upserts from the Sheet.

## Development Guidelines
- TypeScript strict mode. No `any` unless commented why.
- Pages own data fetching via `lib/queries.ts`; components stay presentational.
- Env vars are read once in `src/lib/supabase.ts`. Never hardcode URLs or keys.
- Sync function (`supabase/functions/sync-sheet/index.ts`) must write a `sync_runs` row for every invocation, even on failure.

## Deployment
- `npm run build` → `dist/` → Vercel (config in `vercel.json`).
- SPA fallback rewrite handles client-side routing.
- Vercel password protection enabled on the deployment settings.

---

## Dynamic State

### Current Tasks
- [x] Brainstorm + design spec (`docs/superpowers/specs/2026-05-15-forums-dashboard-design.md`)
- [x] Scaffold project structure (config, src, supabase, docs)
- [ ] Confirm Google Sheet schema and access method (service account vs. public CSV)
- [ ] Implement `lib/queries.ts` against real Supabase schema
- [ ] Wire Overview KPIs, time-series, and top lists
- [ ] Implement `sync-sheet` Edge Function with real Sheet read + upsert
- [ ] Add Vercel password protection on first deploy

### Recent Changes
- *2026-06-02:* Added AI assistant (OpenAI **gpt-4o-mini**). Floating chat widget on
  every authenticated page, backed by the `ai-assistant` Edge Function (holds
  `OPENAI_API_KEY`, runs a read-only tool-calling loop over `entries`, streams via SSE).
  Spec: `docs/superpowers/specs/2026-06-02-ai-assistant-design.md`. Plan:
  `docs/superpowers/plans/2026-06-02-ai-assistant.md`.
  **Setup required before it works:**
  1. `supabase secrets set OPENAI_API_KEY=sk-...`
  2. `supabase functions deploy ai-assistant`
  3. Add `VITE_AI_ASSISTANT_URL=<deployed function URL>` to Vercel env, then redeploy.
  Until `VITE_AI_ASSISTANT_URL` is set, the widget shows "Assistant not configured".
- *2026-05-15:* Initial scaffold. Vite + React + TS + Tailwind v4 + React Router + Recharts. Supabase schema + Edge Function stubs. Pages and components stubbed.

### Known Issues / Backlog
- Recharts pinned to v2; revisit if a major upgrade is available at install time.
- No dedicated `/mentions` list view — Overview's recent-mentions table is the only path to detail. Revisit if filtering needs grow.
- Sentiment column is passthrough; classification deferred.
- Cron schedule for `sync-sheet` not yet defined (proposed hourly).
