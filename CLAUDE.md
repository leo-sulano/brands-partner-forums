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

## Deployment
- `npm run build` → `dist/` → Vercel (config in `vercel.json`).
- SPA fallback rewrite handles client-side routing.
- Vercel password protection enabled on the deployment settings.

---

## Dynamic State

### Current Tasks
- [x] Brainstorm + design spec (`docs/superpowers/specs/2026-05-15-forums-dashboard-design.md`)
- [x] Scaffold project structure (config, src, supabase, docs)
- [ ] Implement `lib/queries.ts` against real Supabase schema
- [ ] Wire Overview KPIs, time-series, and top lists
- [ ] Add Vercel password protection on first deploy

### Recent Changes
- *2026-08-03 (newest):* Added a read-only `bif_review_accounts` Postgres view over `entries`
  (TP Brand Injection tab only) so the externally-hosted BIF Dashboard can query/subscribe
  directly, under stable column names, without depending on this repo's internal `data` jsonb
  key names — no app code changed, this repo's only touch point is the one migration file.
  `with (security_invoker = true)` means it inherits `entries`' existing "anyone can read"
  policy rather than needing a new grant. A final whole-branch review changed the migration
  from `create view` to `create or replace view` (the plan's stated apply path is the Supabase
  SQL Editor by hand, since no DB credential exists in this session — a later `supabase db push`
  re-applying the same file would otherwise fail on "relation already exists" and block every
  later migration, the same shape of incident this repo already hit once before) and added SQL
  comments documenting three undocumented gotchas for BIF: `trustpilot_added_date` mixes
  `YYYY-MM-DD` and day-first `DD/MM/YYYY` text, `brand_url` can be NULL even when the app shows
  a working link (the app additionally falls back to the code-side `BRAND_TP_URLS` map in
  `tab-configs.ts`), and `review_status`'s fixed text vocabulary. The review also added an
  `anon`-key `curl` verification step to Task 2 of the plan (the existing SQL Editor spot-check
  runs as a superuser/service role and proves nothing about the actual BIF access path) and a
  `brand_url IS NULL` count step to size that gap before BIF builds against the column. Spec:
  `docs/superpowers/specs/2026-08-03-bif-dashboard-review-accounts-view-design.md`. Plan:
  `docs/superpowers/plans/2026-08-03-bif-dashboard-review-accounts-view.md`.
- *2026-08-03 (prior):* Fixed a gap in the legacy-week chip fix directly below: it only fired
  for weeks with an existing platform-null `brand_schedule` row, so a tab with *zero* rows for
  a past week (e.g. GRG - Gulf Recovery Group, a TP-only tab never covered by the old
  spreadsheet import) still showed nothing for a real Removed post — reported live by the user
  via GRG's Jun 29 – Jul 3 week. Broadened (confirmed with user) to a universal rule: a removed
  chip renders anywhere no real schedule row exists, same as confirmed already does. A first
  attempt (merging removed into confirmed at the `SchedulePlanner.tsx` call site) was reverted
  after live Playwright verification against real Supabase data showed it broke
  `buildDateStatusIndex`'s mutually-exclusive removed/confirmed invariant, making a removed-only
  day show both the ✓ and ✕ badges at once. Real fix is in `ScheduleCell`
  (`src/lib/scheduler/calendarRenderer.tsx`): the render guard and `isActiveLook` now check
  `isRemoved` directly instead of only `isConfirmed`, keeping the two flags independent. No
  schema change, no writes, still read-only. Task 170.
- *2026-08-03 (previous):* Legacy (pre-platform-tagged, `platform = null`) Schedule Planner weeks
  now render through the same `ScheduleCell` component current weeks use instead of a separate
  plain-checkmark block, so a legacy week shows real TP/AG/CG/WO confirmed (green ✓) chips
  wherever a brand's entry has a Live/Published add-date matching that day — read-only, via
  `isApproved` forced off for the week. A final-review fix then closed a gap left by the initial
  version: `buildDateStatusIndex`'s `removed`/`confirmed` sets are mutually exclusive, and
  `ScheduleCell`'s render guard only fires on `isConfirmed` (or a real schedule row/pause), so a
  legacy week's removed/refused posts never rendered a chip at all. Fixed entirely inside
  `SchedulePlanner.tsx` (no changes to `scheduleUtils.ts`/`calendarRenderer.tsx`): for a legacy
  week only, `confirmedByPlatform` now folds in any truthy `removedByPlatform` entries so the
  guard fires, while `removedByPlatform` still passes through unchanged so `ScheduleCell`'s
  existing `isRemoved` styling (rose ring, ✕ badge, "— Removed" tooltip) takes over. Non-legacy
  weeks are untouched. No schema change, no `brand_schedule` writes. Task 169, spec
  `docs/superpowers/specs/2026-08-03-schedule-planner-legacy-week-platform-chips-design.md`,
  plan `docs/superpowers/plans/2026-08-03-schedule-planner-legacy-week-platform-chips.md`.
- *2026-08-03 (prior):* Schedule Planner now shows a "confirmed" indicator (small emerald ✓
  corner badge, bottom-right) on a day whose real entry add-date matches, distinct from the
  "removed" indicator's (Task 165) top-right ✕. Unlike the removed indicator, a confirmed day
  renders its own chip even if `brand_schedule` has no row for it at all — the calendar now
  genuinely reflects real review-add history, not just the plan. `buildRemovedOnDateIndex` is
  generalized into `buildDateStatusIndex` (`src/lib/scheduler/scheduleUtils.ts`), returning
  both `removed`/`confirmed` sets from one entries scan; `isLiveStatus` newly exported from
  `scoreSummary.ts`. Purely additive — no schema change, click-to-cycle behavior unchanged.
  Task 168, spec `docs/superpowers/specs/2026-08-03-schedule-planner-confirmed-indicator-design.md`.
- *2026-08-03 (latest):* A brand's name in the Schedule Planner grid now links straight to its
  row on the Brand Tabs page (`/brands/<tab>?brand=<name>`) instead of just filtering the
  Schedule Planner's own search box — reuses `BrandGroup.tsx`'s existing `?brand=` deep-link
  exact-match filter, no Brand Tabs-side changes needed. Task 167.
- *2026-08-03 (later):* Fixed why most brand tabs never showed the new platform-chip Schedule
  Planner grid at all — only Rooster Partners had actually gotten it. Root cause:
  `SchedulePlanner.tsx` resolved a tab's active platforms via its own `resolveActivePlatforms`
  (`src/lib/queries.ts`), which queried live Supabase headers with a narrower name-variant
  list than every other feature in the app uses (BrandGroup/Score Summary/Sidebar/Topbar all
  use the static `getTabPlatforms` in `src/lib/tab-configs.ts`, driven by the already-known
  `TAB_COLUMN_CONFIGS` whitelist — no live-header dependency, Wizard of Odds hardcoded to
  `['wo']`). `resolveActivePlatforms`'s TP variant list was missing plain `'Review Status'`,
  the configured status column for TP Brand Injection/TP Affiliate/SuprPlay Limited, silently
  zeroing out `activePlatforms` for those tabs; Wizard of Odds depended on a live
  `'WoO Review Status'` header that was never confirmed to exist (see Known Issues below —
  now resolved by no longer depending on it at all). Fix: `SchedulePlanner.tsx` now calls
  `getTabPlatforms(tab)` directly; `resolveActivePlatforms` is deleted (had no other callers).
  Added a `getTabPlatforms` regression-lock test suite covering all 11 operational tabs.
  Doesn't rewrite history — each of the other 10 tabs gets its current week's platform-tagged
  rows generated the next time it's opened, same lazy-generation model Rooster Partners went
  through originally. Task 166.
- *2026-08-03:* Schedule Planner day cells now flag a platform chip as removed (rose ring +
  small ✕ corner badge + "— Removed" tooltip suffix) when the post scheduled for that exact
  calendar day was later found Removed/Refused. New `buildRemovedOnDateIndex`
  (`src/lib/scheduler/scheduleUtils.ts`, TDD'd) scans a tab's raw entries once per tab load
  and builds a `brandKey::platform::date` index, reusing the same
  `PLATFORM_STATUS_KEYS`/`PLATFORM_DATE_KEYS`/`isRemovedStatus`/`parsePostDate` helpers the
  scheduler's auto-pause logic already reads from `scoreSummary.ts` — no new schema. Matching
  is deliberately exact-date-only (not nearest-date or most-recent-status), so under-flagging
  is possible if a recorded add-date doesn't line up exactly with the scheduled day, but the
  day a chip is flagged for can never be wrong. Purely a read-only visual overlay — no change
  to click/cycle behavior, and legacy (pre-platform) weeks are untouched. Task 165, spec
  `docs/superpowers/specs/2026-08-03-schedule-planner-removed-indicator-design.md`.
- *2026-08-01:* Schedule Planner day cells no longer render a chip for every active platform
  unconditionally — `ScheduleCell` (`src/lib/scheduler/calendarRenderer.tsx`) now shows a chip
  only for platforms actually scheduled that day or scheduler-paused for the week, and existing
  chips show icon+label together instead of icon-only. A new hover-revealed "+" button (also
  reachable via keyboard focus and visible on touch/no-hover devices, a final-review fix) opens
  a new `AddPlatformModal` (`src/components/AddPlatformModal.tsx`) listing only the platforms
  not yet scheduled for that day, addable as Active or Paused via the existing
  `setBrandScheduleDay` path. A shared `unscheduledPlatforms` predicate
  (`src/lib/scheduler/scheduleUtils.ts`) is used by both the cell and the modal so they can't
  disagree about what's addable. Supersedes the "every active platform renders a placeholder
  chip in every cell" design from the Intelligent Schedule Planner entry below. Final review also
  added the `isFutureWeek` write guard to the new `handleSetDayStatus` handler (matching
  `handleCellClick`'s existing guard) and fixed the modal's backdrop z-index so an error `Toast`
  isn't painted over while it's open. Task 164, spec
  `docs/superpowers/specs/2026-07-31-schedule-planner-cell-display-design.md`.
- *2026-07-31:* Turned Schedule Planner into an Intelligent Schedule Planner: platform-aware
  (TP/AG/CG/WO) auto-generation, auto-pause/resume, and Success Rate/pause UI on top of the
  per-week grid shipped earlier the same day. New `src/lib/scheduler/` module —
  `schedulerRules.ts` (configurable per-platform posting frequency: TP 2/wk preferring
  Mon+Thu or Tue+Fri, AG 2/wk, CG 1/wk, WO 3/wk preferring Mon/Wed/Fri; pause/carryover
  thresholds), pure `schedulerEngine.ts` (`generateWeekSchedule`, priority-ordered
  carryover→resuming→normal assignment with day-load balancing), I/O `schedulerService.ts`
  (`recalculatePauses`/`ensureWeekGenerated`, mocking Supabase in tests), shared
  `scheduleUtils.ts`, presentational `calendarRenderer.tsx`. `brand_schedule` gained a
  nullable `platform` column (migration `20260801090000`, applied live via the Supabase SQL
  Editor — no DB credential was available in this session, so the user ran the SQL directly
  and the migration file was written after, to match); the 1,133 pre-existing rows keep
  `platform = null` and render read-only in the old checkmark style, never migrated or
  edited. New `brand_platform_pause` table (same 4-policy RLS shape as `brand_schedule`)
  tracks one row per active pause, inserted when a brand+platform's two most recent posts
  are both Removed/Refused-classified (reusing `scoreSummary.ts`'s existing status/date
  helpers, now exported for reuse) and deleted a week later on resume. Generation/pause-recalc
  run lazily from the page's existing effect, gated to the actual current week only — browsing
  to a past or future week never triggers a write; future weeks are read-only in the UI for
  the same reason (a manual edit there would permanently block that week's own eventual
  auto-generation). Day cells now show one small colored badge per platform (TP/AG/CG/WO)
  instead of a bare checkmark, with a hover/long-press tooltip for status detail (the
  design's originally-specified click-to-open popover was dropped in favor of keeping every
  cell — including never-scheduled ones — independently clickable, a deliberate,
  user-approved deviation); a paused platform's badge is dimmed and non-interactive for the
  week it governs, with a separate "⛔ Paused" indicator. New Success Rate column reuses
  `computeSuccessRates` from `scoreSummary.ts`, color-coded green/yellow/red.
  Completion-based carryover (the "<40% last week → carry unfinished work forward" rule) is
  implemented but **deliberately disabled** (`CARRYOVER_RULES.completionThreshold = 0` in
  `schedulerRules.ts`) — the formula as specified (last week's *total* slot count, uncapped,
  against an all-time exact-match "done" status) compounds unbounded and would saturate any
  underperforming brand to all 5 weekdays within about 5 weeks; needs a real redesign
  (time-scoped completion, capped/remainder-based count) validated against real
  platform-generated week data before re-enabling. Built via 12 subagent-driven-development
  tasks with per-task review; the review loop caught and fixed 3 genuine plan-level design
  bugs before they shipped — a duplicate-day collision in the engine that silently nullified
  carryover, a pause-reinsertion bug that permanently defeated re-pausing after one resume
  cycle, and a tab-switch race where the scheduler could write a newly-selected tab's week
  using the *previous* tab's brand list, permanently blocking that tab's real schedule from
  ever generating (caught only by the final whole-branch review, since it only appears when
  both page effects are considered together). One known follow-up, never resolvable in this
  session (no Supabase DB credential available): confirm the live `WoO Review Status`/
  `Wizard of Odds` header names on a WO-tracking tab against `scoreSummary.ts`'s
  `PLATFORM_STATUS_KEYS`/`PLATFORM_DATE_KEYS` (exact-match, not case-insensitive) before
  trusting WO pause detection's post-recency ordering. Full test suite (395 tests) and build
  both pass. Spec: `docs/superpowers/specs/2026-07-31-intelligent-schedule-planner-design.md`.
  Plan: `docs/superpowers/plans/2026-07-31-intelligent-schedule-planner.md`.
- *2026-07-31 (earlier):* Schedule Planner moved from one recurring Mon-Fri template per (tab, brand)
  to real per-calendar-week tracking, and its 9 months of real history (Oct 2025 – present)
  from `csv/Scheduled_Planner.xlsx` was imported — superseding the "week nav is purely
  cosmetic" design from the day before. `brand_schedule` gained a `week_start date not null`
  column (the Monday of that week), widening uniqueness to `(tab, brand_key, week_start)`;
  the 43 rows already in the table (all written during the week of 2026-07-27) were
  backfilled to that week before the column went `NOT NULL`. `scheduleFor`/`withDayStatus`
  (`src/lib/scheduleBrands.ts`) and `fetchBrandSchedule`/`setBrandScheduleDay`
  (`src/lib/queries.ts`) all now take a `weekStart` parameter, matching on it alongside
  `tab`/`brand_key`; `SchedulePlanner.tsx`'s prev/next/Today buttons now trigger a real
  refetch instead of only changing the displayed date labels, and every week (past or
  future) is independently editable with no read-only-history rule. Historical import:
  parsed all 42 dated sheets in the source spreadsheet (excluding one undated legacy
  template whose brand set — "Medier Brands", Midasluck, Bit Coin — matches none of today's
  11 tabs), deriving each sheet's `week_start` from its name (verified: 41 of 42 land
  exactly 7 days apart on a Monday matching the name; one, `"9-12 Dec"`, is a one-day typo
  in the source file, corrected to the computed `2025-12-08`). Matching brand names to tabs
  required resolving each brand independently (not by whole spreadsheet group) after
  discovering two older sheets (`19Jan-23Jan`, `26Jan-30Jan`) genuinely combined the
  Revolution Casino and Trybet groups under one shared header row — a real historical
  layout, not a data error — which a whole-group approach mismatched; per-brand resolution
  with anchor-tab disambiguation (for the 4 names — Fortuneplay, Lucky7even, Rocketspin,
  Rollero — shared verbatim between Rooster Partners and Wizard of Odds) fixed it. Wrote
  1119 rows across all 42 weeks via bulk upsert; skip list (brands with no match to any of
  today's 11 tabs, same rule as the original single-week migration) stayed stable at
  "Trusted Casino UK", "Trusted Casino CA", "Betway", "Bit Coin", "BlissBursts", and the
  8-brand "Medier Brands" set. Post-import verification: table holds 1133 rows across 43
  distinct weeks; every row's brand-key resolves against a real, currently-tracked brand in
  its tab (checked across all 11 tabs) except one now-deleted test-residue row. During
  implementation, a real timezone bug was caught and fixed before it could ship: the
  straightforward `date.toISOString().slice(0, 10)` conversion rolls the calendar date back
  one day in any timezone ahead of UTC (converts to UTC before slicing) — which would have
  made every already-migrated row permanently invisible for any user/session in a UTC+
  timezone (this dev environment is UTC+8) — fixed to build the ISO string from local
  `getFullYear`/`getMonth`/`getDate()` instead, matching the page's existing
  `mondayOf`/`formatWeekdayDate` helpers (already local-time); `toISODate` was moved to
  `src/lib/scheduleBrands.ts` and given a `TZ=Asia/Manila` regression test that fails
  against the naive UTC-based version, so it can't silently regress. The final whole-branch
  review also caught that the week-navigation refetch was re-downloading a tab's entire
  (sometimes 2000+ row) entries table on every Prev/Next/Today click when only the schedule
  data depends on the week — fixed by splitting into two effects (`[tab]` for
  entries/brands, `[tab, weekStartISO]` for schedule data only) and holding the week as a
  memoized ISO string instead of a `Date`, which also fixed a "Today" no-op still
  triggering a reload. Full test suite (110 tests) and build both pass. One known,
  deliberately-deferred issue: the schedule-only effect doesn't clear the error banner on a
  successful fetch after a prior failure, so a transient network error during week
  navigation leaves the banner visible until a tab switch — low-impact (no data loss), a
  one-line fix (`setError(null)` at the top of that effect), left for a follow-up rather
  than reopening the review loop. Spec:
  `docs/superpowers/specs/2026-07-31-schedule-planner-per-week-design.md`. Plan:
  `docs/superpowers/plans/2026-07-31-schedule-planner-per-week.md`.
- *2026-07-30:* Added a "Success Rate" figure directly to brand tab summary cards
  (`BrandGroup.tsx`), reusing the same `live / (live + removed) × 100` formula and
  floor-to-whole-percent rounding Score Summary already uses (Task 148/156) — computed
  from counts the page already has, so it automatically respects the active date range and
  platform-removed exclusions with no new filtering logic. Single-platform tabs (e.g.
  BITP) gained a 4th card in the existing Total/Live/Removed row, violet-accented via a new
  `KpiCard` color variant, non-clickable. Three-platform tabs (Rooster Partners, Revolution
  Casino, SilverPlay, Hanan) gained a small percentage badge (with an explanatory `title`
  tooltip) on each platform's existing Live/Removed card, computed from that platform's own
  counts. New `rateFromCounts`/`successRatePct`/`formatRatePct` helpers added to
  `src/lib/scoreSummary.ts` (the last one deliberately shared by both new UI call sites so
  they can't drift from each other — added in a post-implementation review fix, along with
  the badge's tooltip). Built via 4 independently-reviewed subagent tasks plus one final
  whole-branch review; 406-test full suite and build both pass. Manual browser verification
  (exact card-row wrapping at narrow widths, hover affordance on the new non-clickable card)
  was not performed — no implementer/reviewer subagent had Supabase login credentials in its
  environment; worth a quick live look, especially the 4-up row around 640-820px wide.
  Spec: `docs/superpowers/specs/2026-07-30-brand-tab-success-rate-card-design.md`. Plan:
  `docs/superpowers/plans/2026-07-30-brand-tab-success-rate-card.md`.
- *2026-07-30:* Added a Schedule Planner — a per-tab weekly grid for tracking which weekdays
  a brand's outreach/posting is active vs. paused, independent of any specific calendar
  week. New `brand_schedule` table (migration
  `supabase/migrations/20260730120000_add_brand_schedule.sql`) holds one recurring Mon-Fri
  row per (tab, brand): five nullable day columns constrained to `'active' | 'paused'`
  (NULL = unset/blank), a generated `brand_key` (lower+trim, same normalization pattern as
  `removed_platform_brands`) for case/whitespace-insensitive matching, and all four RLS
  policies (anyone can read, approved users can insert/update/delete). New page
  `src/pages/SchedulePlanner.tsx`, routed at `/schedule-planner` and linked from the
  sidebar's "Admin" section next to Score Summary and Log — like those two, it is **not**
  admin-only, just gated by the same `ProtectedRoute` every approved user passes through.
  It shows a brand-tab dropdown, a search box that filters rows by brand name, cosmetic
  previous/next-week/Today navigation (changes only the displayed date labels, never any
  cell's saved status, since the schedule isn't tied to a real week), and a table with a
  frozen Brand column and frozen weekday header (`sticky left-0`/`sticky top-<toolbar
  height>`) so both stay visible while scrolling the grid in either direction. Clicking a
  day cell cycles it blank → ✓ (active) → Pause → blank and persists immediately via new
  `fetchBrandSchedule`/`setBrandScheduleDay` functions in `src/lib/queries.ts`, with the
  cycle/lookup logic (`nextStatus`, `scheduleFor`, `withDayStatus`) factored into
  `src/lib/scheduleBrands.ts` and unit-tested (`scheduleBrands.test.ts`, 8 tests). Full test
  suite (99 tests) and build both pass. Live-verified in this session as the already-signed-in
  admin user (leo@optinetsolutions.com): the sidebar link, page load, and tab dropdown all
  work; selecting Rooster Partners rendered its 11 distinct brands as rows; typing "rocket"
  in search narrowed the table to just Rocketspin and clearing it restored all 11; clicking a
  cell cycled blank→✓→Pause→blank as designed, and setting a cell to ✓ then reloading the
  page confirmed it persisted; Next week/Today changed only the date labels (Jul 27–31 →
  Aug 3–7 → back) while the ✓ cell stayed put; switching to Revolution Casino, setting a
  cell there, and switching back to Rooster Partners confirmed each tab's grid loads and
  saves independently; narrowing the viewport confirmed the Brand column and weekday header
  stay pinned during both horizontal and vertical scroll. Did **not** independently verify
  the non-admin-approved-user case live (no second test account was available this
  session) — confirmed instead by reading `Sidebar.tsx` (the Schedule Planner link renders
  outside the `isAdmin &&` block that gates only "Users") and `SchedulePlanner.tsx` (no
  `isAdmin` check anywhere in the file; editing is gated on `isApproved` only). Spec:
  `docs/superpowers/specs/2026-07-30-schedule-planner-design.md`. Plan:
  `docs/superpowers/plans/2026-07-30-schedule-planner.md`.
- *2026-07-29:* Generalized the TP-only "page removed" flag (below) to independently cover
  all 4 review platforms — TrustPilot, AskGamblers, CasinoGuru, and Wizard of Odds —
  superseding that entry. `removed_tp_brands` was renamed to `removed_platform_brands` and
  given a `platform` column (`'tp' | 'ag' | 'cg' | 'wo'`, check-constrained), with the
  original 14 rows backfilled to `platform='tp'` and uniqueness widened to
  `(tab, brand_key, platform)` so the same brand can carry independent flags per platform.
  The old bare-circle `TpRemovedBadge` became a labeled `PlatformRemovedBadge` (a red pill
  reading TP/AG/CG/WO) — `BrandGroup.tsx` now renders one badge per platform actually
  flagged for that brand, side by side. The Edit Entry modal's single "TP page removed"
  checkbox became one checkbox per platform active on the current tab, labeled e.g.
  "AskGamblers page removed" (1 checkbox on TP-only/WO-only tabs, 3 on Hanan/Rooster
  Partners/Revolution Casino/SilverPlay), each diffed and written independently on save via
  `setBrandPlatformRemoved` so toggling one platform never touches another's row.
  `scoreSummary.ts`'s three compute functions exclude brands per-platform (no more TP-only
  special case), and along the way this fixed a latent bug where the Wizard of Odds tab's
  KPI card was checked against a TP-specific flag instead of WO's own. The shared
  `tpRemovedKey`/`buildRemovedTpBrandSet` helpers became `platformRemovedKey`/
  `buildRemovedPlatformBrandSet` in `src/lib/removedPlatformBrands.ts` (also now the
  canonical home of the `Platform` type, re-exported by `scoreSummary.ts` for existing
  importers). Full test suite (81 tests, including `removedPlatformBrands.test.ts` and
  updated `scoreSummary.test.ts`) and build both pass. Live-verified end to end via a
  throwaway headless Playwright run (the shared browser was in use by a concurrent
  session): all 14 originally-seeded brands still show their TP badge and stay excluded
  from Score Summary's TrustPilot view; flagging a fresh Hanan brand (ZodiacBet.com)
  AG-only showed exactly one AG badge and excluded it from the AskGamblers view while
  TrustPilot/CasinoGuru stayed untouched; additionally flagging it TP-removed showed both
  badges with both exclusions applying independently and CG still untouched; flagging a
  Wizard of Odds brand (Lucky7even) showed a WO badge (not TP), excluded it from that tab's
  own KPI view, and its Edit Entry checkbox read "Wizard of Odds page removed"; unchecking
  AG while TP stayed checked cleared only the AG badge/exclusion. All flags added during
  the walkthrough were undone afterward — confirmed via a direct table query that
  `removed_platform_brands` ends at exactly the original 14 rows, all `platform='tp'`.
  Spec: `docs/superpowers/specs/2026-07-29-multi-platform-removed-brands-design.md`. Plan:
  `docs/superpowers/plans/2026-07-29-multi-platform-removed-brands.md`.
- *2026-07-29 (superseded by the entry above):* Added a TP-removed brand flag — Trustpilot can delist a brand's review
  page entirely, independent of any single review's status, and the dashboard now tracks
  that fact per (tab, brand) in a new `removed_tp_brands` table (seeded with 14 known
  cases: 6 in "TP Brand Injection", 5 in "TP Affiliate", 3 in "Hanan"). A red circle-X
  `TpRemovedBadge` renders next to the brand name in every `BrandGroup.tsx` brand cell for
  a flagged brand, and Score Summary's three compute functions (`scoreSummary.ts`) exclude
  flagged brands from brand lists, star counts, and Success Rate — but only in the
  TrustPilot platform view; AG/CG/WO still show the brand's data normally, since a TP page
  being taken down says nothing about the brand's standing on other platforms. Toggled from
  a "TP page removed" checkbox in the Edit Entry modal, wired through `setBrandTpRemoved` in
  `src/lib/queries.ts` (upsert to flag, delete to clear). Matching between the table's
  brand values and imported entries' brand values is case-insensitive/trimmed via the
  shared `tpRemovedKey`/`buildRemovedTpBrandSet` helpers in `src/lib/removedTpBrands.ts` —
  every reader goes through that one helper, which matters because several real imported
  brand values carry a trailing space (e.g. `"Online Casino Deutschland "`) that the seed
  data does not. Full test suite (76 tests, including new `removedTpBrands.test.ts` and
  `scoreSummary.test.ts` additions) and build both pass. Live-verified end to end,
  including the checkbox→badge round trip: toggling "TP page removed" off for a seeded
  brand (Prive Casino) made its badge disappear from all 25 of its rows and made it
  reappear in the TrustPilot Score Summary; toggling back on reversed both. Spec:
  `docs/superpowers/specs/2026-07-29-tp-removed-brands-design.md`.
- *2026-07-27:* Added cross-dashboard SSO — a new public route
  (`/auth/portal-callback`) and Edge Function (`sso-callback`) let a user who
  logs into the central SSO portal land here already authenticated. The
  function verifies the portal's signed JWT (JWKS + issuer + audience +
  expiry), finds-or-creates the user by email, force-approves their
  `profiles` row (the portal is treated as the access authority — a valid
  token only exists because a portal admin assigned this dashboard to that
  user), and mints a session the frontend adopts via
  `supabase.auth.setSession(...)`. Requires three new Edge Function secrets
  (`PORTAL_JWKS_URL`, `PORTAL_ISSUER`, `SSO_AUDIENCE`, documented in
  `.env.example`) — code is complete and reviewed, but the function has NOT
  been deployed yet and the secrets have NOT been set (needs Supabase CLI
  access this session doesn't have); deploy, set secrets, and the portal
  owner enabling SSO for this dashboard's card are still pending. Final
  review added replay protection (each token's `jti` can only be claimed
  once, via `sso_consumed_tokens`) and a 7-day bounded revocation window for
  SSO-provisioned users (`profiles.sso_provisioned`/`sso_last_verified_at`,
  enforced by a daily `pg_cron` job) — migration
  `supabase/migrations/20260727150000_add_sso_replay_and_revocation.sql` must
  be applied via `supabase db push` **before** the function is deployed,
  since the function's code assumes that table/those columns already exist.
  An admin's manual re-approval in Admin Users now also clears
  `sso_provisioned` back to `false`, so an explicit approval isn't silently
  undone by the next day's cron run. Spec:
  `docs/superpowers/specs/2026-07-27-portal-sso-callback-design.md`. Plan:
  `docs/superpowers/plans/2026-07-27-portal-sso-callback.md`.
- *2026-07-10:* Brand Name in Add Review Account (and Edit Entry, since it shares the same
  `BrandSelectDropdown` component) is now creatable — typing a name with no case-insensitive
  match in the existing list shows a `+ Add "<text>"` row that sets it as a free-typed brand,
  on every brand tab. Previously the field only let you pick from brands already seen in that
  tab's data, with no way to add a genuinely new one. Spec:
  `docs/superpowers/specs/2026-07-10-manual-brand-entry-design.md`. Plan:
  `docs/superpowers/plans/2026-07-10-manual-brand-entry.md`.
- *2026-07-08:* Added a "Getting Started" walkthrough to the How It Works page — a numbered
  step list (login → add an entry → edit an entry → run Check Status → see the result) next
  to an animated GIF (`public/getting-started.gif`) captured from the real running app. No
  video/screenshot tool exists in this environment, so the GIF is produced by a one-time,
  human-supervised Playwright script (`scripts/capture-getting-started.mjs`, run via
  `npm run capture:demo`) that logs in, drives the flow against the `GRG - Gulf Recovery
  Group` tab using a disposable demo entry, and deletes it afterward — re-run manually
  whenever the UI changes enough to make the GIF stale (needs `npm run dev` running first,
  plus `CAPTURE_EMAIL`/`CAPTURE_PASSWORD` env vars). Spec:
  `docs/superpowers/specs/2026-07-08-getting-started-walkthrough-design.md`. Plan:
  `docs/superpowers/plans/2026-07-08-getting-started-walkthrough.md`.
- *2026-07-07:* Fully disconnected the Google Sheet from the dashboard — deleted the
  `sync-sheet`, `push-to-sheet`, `import-tabs`, and `backfill-brand-hrefs` Edge Functions
  (repo source + live Supabase deployment) along with the frontend code that only served
  them (`fetchSyncRuns`, `subscribeSyncRuns`, `src/types/sync.ts`). The Sheet→DB direction
  was already disabled 2026-06-26; this removes the now-unused DB→Sheet path and its dead
  readers. `apps-script/Code.gs` and the Sheet itself are untouched. Spec:
  `docs/superpowers/specs/2026-07-07-google-sheet-disconnect-design.md`.
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
- `entries` is fully public-readable via the `anon` key across **all** tabs, not just TP Brand
  Injection, and its `data` jsonb contains credential fields (`Password`, `Backup Codes`,
  `Authenticator Backup` — see `AddReviewAccountModal.tsx`). This is a pre-existing condition,
  not something the 2026-08-03 `bif_review_accounts` view created — but that view's design
  relies on it (it inherits `entries`' policy via `security_invoker` rather than defining a
  narrower one), and BIF Dashboard's live-update design (a raw `postgres_changes` subscription
  on `entries` itself, per its spec) receives this same full raw payload, including credential
  fields, for every row it's subscribed to. Now operationally relevant to a second, external
  consumer — worth a deliberate future decision (tightening `entries`' RLS policy, or a
  column-filtered publication) rather than staying an implicit side effect. Not fixed as part
  of that task; documentation only.
- The success-rate pause trigger (`PAUSE_RULES.successRateThreshold`/`minDecidedPostsForRateCheck`
  in `src/lib/scheduler/schedulerRules.ts`) uses an all-time, unwindowed rate paired with a fixed
  1-week pause. A chronically underperforming brand+platform will pause, auto-resume after 1
  week, post once or twice, but its all-time rate barely moves — so it pauses again next cycle,
  indefinitely, at roughly half normal cadence rather than eventually stabilizing. This is an
  accepted, deliberate tradeoff (not a bug), matching how completion-based carryover (below) was
  disabled for a related unbounded-compounding shape. If this becomes a real problem in practice,
  the fix would be windowing the rate (e.g. last N posts, or a trailing date range —
  `computeSuccessRates` already supports a `DateRange` param) or adding a re-pause cooldown after
  resume.
- Intelligent Schedule Planner's completion-based carryover is implemented but disabled
  (`CARRYOVER_RULES.completionThreshold = 0` in `src/lib/scheduler/schedulerRules.ts`) — the
  formula as originally specified compounds unbounded (see 2026-07-31 entry above). Needs a
  redesign (time-scoped completion, capped/remainder-based carryover count) validated
  against at least one real platform-generated week before re-enabling.
- Confirm the live `WoO Review Status`/`Wizard of Odds` header names on a Wizard of Odds
  brand tab against `scoreSummary.ts`'s `PLATFORM_STATUS_KEYS`/`PLATFORM_DATE_KEYS`
  (`pick()` does an exact string match, not case-insensitive) — never verified live, no
  Supabase DB credential was available in the session that shipped WO pause detection.
  Narrower than it used to be: the Schedule Planner grid itself no longer depends on this
  (2026-08-03, Task 166, now uses the static `getTabPlatforms` instead of a live header
  check), but WO pause detection and the removed-post indicator's date-matching (Task 165)
  both still read actual status/date *values* through these same two keys, so a real
  mismatch there would still silently make both features inert for WO specifically.
- Recharts pinned to v2; revisit if a major upgrade is available at install time.
- No dedicated `/mentions` list view — Overview's recent-mentions table is the only path to detail. Revisit if filtering needs grow.
- Sentiment column is passthrough; classification deferred.
- The Google Sheet disconnect (2026-07-07) deliberately left `check-review-status` untouched: it still pushes changed rows to the Sheet via the Apps Script web app (`APPS_SCRIPT_URL`/`APPS_SCRIPT_SECRET` Supabase secrets) whenever a Check Status run detects a change. Revisit if a truly Sheet-free dashboard is required — either remove that push call or unset those two secrets on the function.
- Trybet's table view shows "—" in its "Brands" column even when an entry's brand value is
  correctly saved (confirmed 2026-07-10 via the raw Supabase insert payload — the value is
  genuinely persisted, this is a read/display-only issue). Likely a key mismatch between the
  column `getBrandNameCol()` resolves for writes (`'Brands'`, from the `TAB_COLUMN_CONFIGS`
  whitelist) and whatever `BrandGroup.tsx` resolves for the rendered header/cell from
  `tab_schemas` (`BrandGroup.tsx:948-952,2216`) — not yet root-caused further. Pre-existing;
  unrelated to the 2026-07-10 manual-brand-entry change (reproduces via the old plain-input
  fallback too). Worth a follow-up look since it makes a correctly-saved new brand look like
  the save silently failed.
- Supabase Auth still uses the default built-in email sender, which caps auth emails (signup confirmation, password reset, magic link) project-wide at a few per hour. Hit in practice 2026-07-08 trying to recover the `sandbox@optinetsolutions.com` account — both signup and password-reset threw "email rate limit exceeded" back to back. Fix: wire up a free custom SMTP provider (e.g. Resend, free tier, no card required) under Authentication → Emails / SMTP Settings to remove the cap. Immediate unblock without waiting: Authentication → Users → select user → Reset Password sets a new password directly, no email sent.
