# Brands Partner Forum — Design Spec

**Date:** 2026-05-15
**Owner:** leo@optinetsolutions.com
**Status:** Approved (scaffold underway)

## Purpose

Internal brand-monitoring dashboard. Surfaces forum mentions (collected upstream in a Google Sheet) so the team can see trends, drill into individual mentions, and verify the data pipeline is healthy.

## Architecture

```
Google Sheet (source of truth for raw mentions)
        │
        │  scheduled pull
        ▼
Supabase Edge Function: `sync-sheet`  (Deno)
        │
        │  upsert
        ▼
Supabase Postgres
   ├── mentions
   └── sync_runs
        ▲
        │  read via @supabase/supabase-js (anon key, RLS)
        │
React + Vite + TS + Tailwind dashboard
        │
        ▼
Vercel (password-protected deployment — no app-level auth)
```

## Stack

- **Frontend:** Vite 6, React 19, TypeScript ~5.8, Tailwind v4, React Router v7, lucide-react
- **Backend:** Supabase (Postgres + Edge Functions, Deno)
- **Charting:** Recharts (lightweight, React-native, fits the tooling already used in sibling projects)
- **Hosting:** Vercel
- **Auth:** none in app — Vercel password protection gates the deploy

## Pages

### `/` Overview
- KPI cards: total mentions, mentions in last 7d, top forum, trending keyword
- Time-series chart of mentions per day (last 30d default, range selector later)
- Top forums list (count by forum, last 30d)
- Trending keywords list (count by keyword, last 7d)
- Recent mentions table (latest 20 rows, each row links to `/mentions/:id`)

### `/mentions/:id` Mention Detail
- Full mention text and thread title
- Forum, author, posted-at, source URL (opens in new tab)
- Sentiment badge (if set)
- Status toggle: `new` → `reviewed` / `ignored` (writes back to Supabase)

### `/sync` Sync Status
- Last successful sync timestamp + duration
- Rows seen / upserted / skipped counts for last 10 runs
- Recent sync errors with message
- "Run sync now" button — calls Edge Function with auth header

## Data Model

### `mentions`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `source_row_id` | `text` unique | Stable identifier per Sheet row (e.g. row hash or sheet row number+sheet name); used for idempotent upsert |
| `forum` | `text` | Source forum (Reddit, Quora, etc.) |
| `thread_title` | `text` | |
| `mention_text` | `text` | Body excerpt |
| `url` | `text` | Permalink to the mention |
| `author` | `text` nullable | |
| `posted_at` | `timestamptz` nullable | When mention was originally posted |
| `keyword` | `text` nullable | Tracked keyword that matched |
| `sentiment` | `text` nullable | `positive` / `neutral` / `negative` (free-form for MVP) |
| `status` | `text` default `'new'` | `new` / `reviewed` / `ignored` |
| `synced_at` | `timestamptz` default `now()` | Last time this row was upserted from Sheet |

Index on `(posted_at desc)`, `(forum)`, `(keyword)`, `(status)`.

### `sync_runs`
| Column | Type |
|--------|------|
| `id` | `uuid` PK |
| `started_at` | `timestamptz` |
| `finished_at` | `timestamptz` nullable |
| `rows_seen` | `int` default 0 |
| `rows_upserted` | `int` default 0 |
| `rows_skipped` | `int` default 0 |
| `error_message` | `text` nullable |
| `status` | `text` — `running` / `success` / `error` |

## Edge Function: `sync-sheet`

- Trigger: scheduled (cron) + manual via `/sync` page
- Reads Google Sheet via service-account JSON or public CSV export (TBD, env-driven)
- Maps Sheet columns → `mentions` schema
- Upsert on `source_row_id`
- Writes a `sync_runs` row capturing counts and errors

## Folder Layout

```
Brands Partner Forum/
├── CLAUDE.md
├── README.md
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts
├── vercel.json
├── index.html
├── .env.example
├── .gitignore
├── public/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── vite-env.d.ts
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── Topbar.tsx
│   │   ├── KpiCard.tsx
│   │   ├── MentionsTable.tsx
│   │   ├── TopList.tsx
│   │   ├── TimeSeriesChart.tsx
│   │   ├── StatusBadge.tsx
│   │   └── Toast.tsx
│   ├── pages/
│   │   ├── Overview.tsx
│   │   ├── MentionDetail.tsx
│   │   └── SyncStatus.tsx
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── queries.ts
│   │   └── format.ts
│   └── types/
│       ├── mention.ts
│       └── sync.ts
├── supabase/
│   ├── schema.sql
│   └── functions/
│       └── sync-sheet/
│           └── index.ts
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-05-15-forums-dashboard-design.md
```

## Open Items

1. **Exact Sheet schema** — confirm column names so Edge Function mapping matches reality.
2. **Sheet access** — service-account JSON vs. public CSV export. Default to service account for robustness.
3. **Sync cadence** — proposed default: hourly via `pg_cron` or Supabase scheduled functions.
4. **No dedicated list view** — Overview's recent-mentions table is the only path to detail. Revisit if the team needs deeper filtering.
5. **Sentiment source** — currently passthrough from Sheet. If upstream doesn't supply sentiment, leave column nullable; add classification later.
