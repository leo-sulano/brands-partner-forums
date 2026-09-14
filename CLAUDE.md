# CLAUDE Context — Brands Partner Forum

## Purpose
Internal brand-monitoring dashboard. Entries are created and edited directly in Supabase, the dashboard's sole data store with no external sync, and presented as an overview, per-mention detail, and a sync-status admin page.

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
│   └── types/              # mention, entry, brand-entry, audit-log, etc.
├── supabase/
│   ├── schema.sql          # mentions + sync_runs tables, indexes
│   └── functions/          # Supabase Edge Functions (ai-assistant, check-review-status, etc.)
├── docs/superpowers/specs/ # design specs
└── public/
```

## Architecture Rules
- **Data flow:** Supabase is the sole data store — entries are created and edited directly in the dashboard via `supabase-js`. No external sync (the Google Sheet integration was fully disconnected 2026-07-07).
- **Auth:** email+password login via Supabase Auth, gated by admin-approval (`profiles.approved`). `AuthContext` holds session/profile; `ProtectedRoute` wraps every app route except `/login`, `/signup`, `/reset-password`. Vercel password protection also guards the deploy on top of this.
- **Data access:** all Supabase queries live in `src/lib/queries.ts`. Pages and components import from there, never call `supabase.from(...)` directly.
- **Routing:** React Router v7 declarative routes — `/`, `/mentions/:id`, `/brands/:tab`, `/sync`, `/log`, `/score-summary`, `/ask-ai`, `/schedule-planner`, `/admin/users`, plus public `/login`, `/signup`, `/reset-password`.
- **Styling:** Tailwind v4 utility classes. No global CSS beyond `index.css` (resets, base tokens).
- **Charts:** Recharts only. Keep chart components in `src/components/` and pass plain data props.

## Data Model
- `mentions(id, source_row_id, forum, thread_title, mention_text, url, author, posted_at, keyword, sentiment, status, synced_at)`
- `sync_runs(id, started_at, finished_at, rows_seen, rows_upserted, rows_skipped, error_message, status)`

## Development Guidelines
- TypeScript strict mode. No `any` unless commented why.
- Pages own data fetching via `lib/queries.ts`; components stay presentational.
- Env vars are read once in `src/lib/supabase.ts`. Never hardcode URLs or keys.
- **Cross-dashboard consistency is a standing requirement, not a per-task nice-to-have.** Any change or new feature must stay aligned and correctly mapped with every other surface that shares the same data/logic (Overview, Score Summary, Brand Tabs, Schedule Planner, Ask AI, etc.) — same filters, same date/status/platform semantics, same computed numbers wherever they're shown. Before calling work done, check whether other pages/components read the same underlying data or duplicate the same logic, and verify they still agree. This project has shipped multiple data-accuracy bugs from independently-written logic silently diverging — a final whole-branch review, not just a per-task review, is what has caught most of these historically (see `docs/task-history.md` for specific past incidents). Ask AI's separate deployment step (`supabase functions deploy ai-assistant`) is not an exemption from this rule — a task that changes logic that `supabase/functions/ai-assistant/tools.ts` duplicates must update `tools.ts` (with tests) in the same task; only the deploy command itself may be deferred and flagged as a pending manual step.
- **Tier the process by blast radius — don't run the full pipeline on every task.** The full spec → plan → subagent-driven dev → per-task review → whole-branch review → live-verification pipeline exists to catch cross-dashboard drift, but applying it uniformly makes even small tasks take an hour. Classify every task before starting:
  - **Tier 1 (fast path):** cosmetic/copy/layout changes, or any change confined to a component/file used in exactly one place. Guardrail before treating anything as Tier 1: grep for other importers of the file/component first — if it's used anywhere else, it is not Tier 1. Skip spec/plan/subagents/whole-branch review, but never skip build + a quick visual check.
  - **Tier 2 (light path):** a scoped bug fix or small feature with one clear, contained root cause that touches shared logic but not `queries.ts`/`scoreSummary.ts`/date-status-platform filtering. Skip the formal spec+plan doc and subagent fan-out; implement directly, then do one self-review pass of the diff.
  - **Tier 3 (full pipeline, current default for anything ambiguous):** anything touching `queries.ts`, `scoreSummary.ts`, date/status/platform filtering, KPI computation, or any logic duplicated across pages — i.e. anything the cross-dashboard consistency rule above covers. When in doubt between Tier 2 and Tier 3, pick Tier 3.

## Deployment
- `npm run build` → `dist/` → Vercel (config in `vercel.json`).
- SPA fallback rewrite handles client-side routing.
- Vercel password protection enabled on the deployment settings.

---

## Where to find current state and history (workflow as of 2026-09-14)

This file intentionally stays static — architecture and standing rules only. It no longer
carries a per-task changelog (a "Recent Changes"/"Known Issues" log used to live here and
grew past 2,400 lines, all auto-loaded into every session's context regardless of relevance).

- **What's true right now / what's in flight:** `.agent/handoff/` — one dated file per
  session/thread of work (`YYYY-MM-DD-short-slug.md`). **Read the newest file there first**,
  before anything else. See `.agent/handoff/README.md` for the format.
- **Full task-by-task history:** `docs/task-history.md`. Each entry is a short
  `## Task N: Title` heading + 2-3 sentence summary (the heading format is required — a
  Stop hook, `.claude/scripts/ship-to-pms.ps1`, parses it to auto-create PMS tasks). Richer
  detail for any given task lives in a handoff file and/or Claude's own memory system, not
  inline here.
- **Don't proactively read `docs/task-history.md` in full** — resume from the newest
  `.agent/handoff/` file, and only open task-history.md (or grep it) when actually
  investigating something specific that needs that older history.
