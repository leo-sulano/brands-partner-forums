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
- **Cross-dashboard consistency is a standing requirement, not a per-task nice-to-have.** Any change or new feature must stay aligned and correctly mapped with every other surface that shares the same data/logic (Overview, Score Summary, Brand Tabs, Schedule Planner, Ask AI, etc.) — same filters, same date/status/platform semantics, same computed numbers wherever they're shown. Before calling work done, check whether other pages/components read the same underlying data or duplicate the same logic, and verify they still agree. This project has shipped multiple data-accuracy bugs from independently-written logic silently diverging (see Task 180, Task 174 platform-removed-brand gap, Task 173 plan-vs-evidence mismatch) — a final whole-branch review, not just a per-task review, is what has caught most of these historically. Ask AI's separate deployment step (`supabase functions deploy ai-assistant`) is not an exemption from this rule, even though it's already named in the surface list above — a task that changes logic that `supabase/functions/ai-assistant/tools.ts` duplicates must update `tools.ts` (with tests) in the same task; only the deploy command itself may be deferred and flagged as a pending manual step, the same way other edge function deploys already are in this project's task history (Task 207 and Task 218 both instead deferred the code change itself and documented it as a Known Issue — don't repeat that pattern).
- **Tier the process by blast radius — don't run the full pipeline on every task.** The full spec → plan → subagent-driven dev → per-task review → whole-branch review → live-verification pipeline exists to catch cross-dashboard drift, but applying it uniformly makes even small tasks take an hour. Classify every task before starting:
  - **Tier 1 (fast path):** cosmetic/copy/layout changes, or any change confined to a component/file used in exactly one place. Guardrail before treating anything as Tier 1: grep for other importers of the file/component first — if it's used anywhere else, it is not Tier 1. Skip spec/plan/subagents/whole-branch review, but never skip build + a quick visual check.
  - **Tier 2 (light path):** a scoped bug fix or small feature with one clear, contained root cause that touches shared logic but not `queries.ts`/`scoreSummary.ts`/date-status-platform filtering. Skip the formal spec+plan doc and subagent fan-out; implement directly, then do one self-review pass of the diff.
  - **Tier 3 (full pipeline, current default for anything ambiguous):** anything touching `queries.ts`, `scoreSummary.ts`, date/status/platform filtering, KPI computation, or any logic duplicated across pages — i.e. anything the cross-dashboard consistency rule above covers. When in doubt between Tier 2 and Tier 3, pick Tier 3; misjudging this exact boundary is what caused Tasks 173/174/180.

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
- *2026-08-18 (newest):* Added Schedule Planner → PMS task sync — activating a platform chip on
  the Schedule Planner grid (a manual click, or the lazy per-tab auto-generation both
  `TabScheduleSection.tsx` and `generate-weekly-schedule` already trigger) now also creates a
  matching task in the external PMS tool's "Forum Team" project To Do column, and a due-date edit
  made directly in PMS is pulled back onto the calendar the next time that tab is opened. New
  `schedule_pms_links` table (migration `20260817120000_add_schedule_pms_links.sql`) is the single
  source of truth for both directions: idempotency on push (a `(tab, brand_key, platform, date)`
  unique constraint stops a re-run of `ensureWeekGenerated` or a repeated manual click from
  creating a duplicate PMS task) and ownership on pull (which linked task a given scheduled day
  belongs to, so a due-date move or task deletion in PMS can be detected and reflected back).
  Real push/pull logic lives in one shared `src/lib/scheduler/pmsSync.ts`
  (`pushScheduleToPms`/`pullScheduleFromPms`), imported unmodified by both the new
  `sync-schedule-pms` Edge Function (thin HTTP wrapper, holds `PMS_API_TOKEN`) and
  `generate-weekly-schedule`'s own `generateForTab` — the same "real shared logic, not a ported
  copy" pattern this project already used for `ai-assistant`'s schedule tools and the original
  `generate-weekly-schedule` cron. A new `pushScheduleActivations`/`pullScheduleDrift` frontend
  wrapper (`src/lib/schedulePmsSync.ts`) calls the Edge Function from the browser; `pullScheduleDrift`
  runs once per tab visit (independent of which week is displayed, since a drifted due date can
  land in a different week entirely) and reconciles by calling the existing `setBrandScheduleDay`
  path per drifted/deleted item — no new write path, so RLS/audit-log behavior on `brand_schedule`
  itself is unchanged. Push calls are deliberately best-effort/fire-and-forget from the caller's
  perspective (a real `brand_schedule` write always happens first; a PMS sync failure surfaces as
  its own toast and never rolls back or is mistaken for the schedule write itself failing).
  `generate-weekly-schedule`'s push call reads `PMS_API_TOKEN` live via `Deno.env.get(...)` inside
  `generateForTab` rather than as a module-level const — caught in a same-day follow-up fix, since
  a module-level read is captured once at import time, before any `Deno.test()` body runs, making
  the token gate untestable from within a test that sets the env var itself. Built via
  10 subagent-driven-development tasks with per-task review (Tasks 1-10 of this plan); this
  entry (Task 11) is the plan's final documentation-only task. Full suite (458 tests) and build
  both pass. **Not yet deployed** — see the "Pending manual deploy" bullet below; until
  `sync-schedule-pms` is deployed and `VITE_SYNC_SCHEDULE_PMS_URL` is set, `pushScheduleActivations`/
  `pullScheduleDrift` both silently no-op (the frontend wrapper returns early when the URL is
  unset), so activating a chip today behaves exactly as it did before this feature shipped — no
  broken/erroring UI in the interim. Spec:
  `docs/superpowers/specs/2026-08-17-schedule-planner-pms-sync-design.md`. Plan:
  `docs/superpowers/plans/2026-08-17-schedule-planner-pms-sync.md`. Task 228.

  One accepted v1 design limitation, found during Task 9's review: the pull-reconciliation effect
  in `TabScheduleSection.tsx` applies its `schedule_pms_links` correction (via the Edge Function,
  server-side, unconditionally) *before* the frontend's own `setBrandScheduleDay` call applies the
  matching `brand_schedule` change for that same drifted/deleted item. If that `setBrandScheduleDay`
  call fails partway through a multi-item batch (e.g. a transient network blip), the calendar can be
  left silently out of sync with PMS — and it won't self-heal on a later tab revisit, because the
  next pull will see the link already matches the live PMS state and report no further drift. This
  is inherited from the plan's own design, not an implementer bug, and was ruled acceptable for v1
  given how rare the triggering conditions are (requires a human editing a PMS due date AND a
  concurrent client-side write failure); any affected cell is self-correctable by a normal manual
  click, which re-links normally. See the corresponding Known Issues bullet below.
- *2026-08-14 (prior):* Deployed `ai-assistant` (`supabase functions deploy ai-assistant`,
  version 34, confirmed `ACTIVE` via `supabase functions list`) — Task 223's `get_review_texts`
  tool is now live, closing the "not yet deployed" caveat the entry directly below carried. Same
  cross-directory `src/lib` import bundling confirmed again in the deploy log, consistent with the
  precedent Task 222 established.
- *2026-08-14 (prior):* Added a new `get_review_texts` tool to Ask AI (`supabase/functions/
  ai-assistant/`) so it can read real Published-vs-Removed review text on request for
  content-improvement questions — the model does the comparison itself by reading raw text, no
  server-side NLP. Excludes flagged-removed brands, documents known per-platform scraper text
  caveats in its own description, and (per a final whole-branch review) queries with an explicit
  order+cap for a deterministic sample and steers the model to prefer it over `query_entries` for
  content questions. Proactive trend-spotting/suggestions to the team was explicitly scoped out as
  a separate, later piece of work, per the user's own framing. Full Deno suite passes, `deno check`
  clean. Deployed the same day — see the entry above. Spec:
  `docs/superpowers/specs/2026-08-14-ask-ai-review-text-comparison-design.md`. Plan:
  `docs/superpowers/plans/2026-08-14-ask-ai-review-text-comparison.md`. Task 223.
- *2026-08-14 (prior):* Deployed `ai-assistant` (`supabase functions deploy ai-assistant`,
  version 33, confirmed `ACTIVE` via `supabase functions list`) — all 5 Ask AI drift/parity fixes
  from the 2 entries directly below (Task 220 + its same-day follow-up) are now live, closing the
  "not yet deployed" caveat both of those entries carried. The deploy log shows `tools.ts`'s
  cross-directory imports (`src/lib/scheduleBrandConfig.ts`, `removedPlatformBrands.ts`,
  `proxyAliases.ts`) were bundled successfully, resolving the "unproven at real deploy time" risk
  the Known Issues entry below used to flag — also now noted as a resolved precedent on the
  still-pending `generate-weekly-schedule` deploy item.
- *2026-08-14 (prior):* Follow-up to the entry directly below, same session: closed the 3
  remaining known Ask AI gaps that Task 220's own plan had deliberately left out of scope or that
  its final review had parked as residual. `pick()` (`supabase/functions/ai-assistant/tools.ts`)
  no longer trims before its blank check, matching `src/lib/scoreSummary.ts`'s real `pick()`
  exactly (previously documented since the 2026-08-04 Phase 2 review); `get_score_summary`'s
  `successRate` is now floored to a whole percent like the dashboard's `successRatePct` instead of
  returned raw/unrounded. `groupByField` (the `query_entries group_by` path) now buckets
  `"Proxy Used"` case-insensitively via `canonicalProxyKey`/`canonicalProxyName`
  (`src/lib/proxyAliases.ts`), matching every other proxy-grouping path — every other field is
  unaffected. `get_schedule`/`get_paused_combos`'s tool descriptions now disclose their silent
  hidden/restricted/removed-brand filtering, so the model says "may be hidden/restricted/removed"
  instead of wrongly claiming a brand "doesn't exist" per the system prompt's anti-hallucination
  rule — wording-only, no schema change. Each fixed as an independently-approved bounded task (no
  spec/plan docs) directly in this session, not via Subagent-Driven Development. `deno check`
  clean, full Deno suite passes (82 tests). Deployed the same day — see the entry above.
- *2026-08-14 (prior):* Closed 2 known Ask AI (`supabase/functions/ai-assistant/`) drift gaps: `get_success_rate_by_field`'s proxy grouping now buckets blank/redacted/case-variant values under one "No Proxy"/canonical bucket via the real `resolveProxyLabel`/`canonicalProxyKey` (`src/lib/proxyAliases.ts`), and `get_schedule`/`get_paused_combos` now exclude hidden, platform-restricted, and flagged-removed brands via the real `src/lib/scheduleBrandConfig.ts` helpers plus the file's existing `removed_platform_brands` helpers — both by importing the same real, already-Deno-proven `src/lib` functions the dashboard and `generate-weekly-schedule` use, instead of new hand-ported copies. Also added one CLAUDE.md sentence (in the cross-dashboard-consistency bullet, under Development Guidelines) explicitly closing the informal "Ask AI is separately deployed, so it's out of scope" exemption that let 2 prior tasks (207, 218) each defer a similar gap instead of fixing it. Built via Subagent-Driven Development (3 tasks + a final whole-branch review that found and fixed 2 more instances of the same drift class the branch was meant to close). Full suite passes, `deno check` clean. Deployed the same day — see the newest entry above. Spec: `docs/superpowers/specs/2026-08-14-ask-ai-drift-prevention-design.md`. Plan: `docs/superpowers/plans/2026-08-14-ask-ai-drift-prevention.md`. Task 220.
- *2026-08-14 (prior):* Follow-up to the entry directly below, same session: collapsed Brand Tab
  registration from 3 independently-maintained lists across 3 files down to 2 single-sourced ones.
  `OPERATIONAL_TABS` (`src/lib/tabs.ts`) now derives from `Object.keys(TAB_COLUMN_CONFIGS)`
  (`src/lib/tab-configs.ts`) instead of being a separately-maintained array — a tab now only needs
  one entry (its column list in `TAB_COLUMN_CONFIGS`) to be fully registered everywhere. Also found
  and fixed a live instance of the exact drift class this was meant to prevent: `TAB_ICONS` was
  independently duplicated in `Sidebar.tsx` and `Overview.tsx`, and Overview's copy was already
  missing `'GRG - Gulf Recovery Group'`, silently showing the wrong icon on that page only — moved
  to one new shared `src/lib/tabIcons.ts` (kept separate from `tab-configs.ts` since that file is
  also imported by the `generate-weekly-schedule` Deno edge function and can't safely depend on
  `lucide-react`). Registering a new Brand Tab is still a code change + deploy, not a self-service
  UI (a DB-driven admin form was considered and declined — new tabs are rare structural events, not
  a frequent operational task). Full suite (1090 tests) and build pass. Task 219.
- *2026-08-14 (prior):* Removed the hardcoded 4-provider whitelist that gated `resolveProxyLabel`
  (`src/lib/proxyAliases.ts`) — any non-blank, non-redacted `Proxy Used` value now passes through
  as its own real identity (typo-corrected via the existing `PROXY_ALIASES` map only) instead of
  silently folding into "No Proxy" when it didn't match one of the 4 listed names. Since Brand
  Tabs' proxy filter, `queries.ts`'s tab-KPI proxy filtering, and Overview's Proxy Breakdown all
  already read through this one shared function, a newly-onboarded proxy provider now
  automatically becomes its own filter option and breakdown bucket everywhere with zero other code
  changes. Prompted by a user question about whether new Proxy/Country/Agent/Platform/Brand-Tab
  values auto-propagate across the dashboard; investigation found Country, Agent, Platforms, and
  new-brand-within-a-tab already worked this way — Proxy was the one real gap. Bounded task, full
  suite (1090 tests) and build pass. Task 218.
- *2026-08-13 (prior):* The brand-removed notification email now includes a direct link back to
  the flagged brand's own tab in the dashboard (e.g. `/brands/hanan?brand=WinMega.com`), reported
  as a request after the user received a real notification email for WinMega.com (Hanan tab) with
  no way to jump straight to it. `NotifyBrandRemovedPayload` (both `src/lib/
  brandRemovedNotification.ts` and the edge function's own duplicate interface — deliberately kept
  in sync by hand, not a shared import, per that file's existing "thin proxy" design) gained a
  required `brandTabUrl` field; `BrandGroup.tsx`'s save handler builds it via the same
  `tabToSlug`/`?brand=` deep-link pattern every other in-app link already uses
  (`ScoreSummaryPanel.tsx`, `Overview.tsx`, etc.), now against a new `SITE_URL` export in
  `src/lib/supabase.ts` (reuses the existing `VITE_SITE_URL` env var Login.tsx/Signup.tsx already
  set for OAuth redirects, with the same `window.location.origin` fallback). The edge function's
  email body gained one new line ("View it here: <url>") between the removal notice and the
  call-to-action; stayed plain text (not HTML) per explicit user preference. Both
  `brandRemovedNotification.test.ts` and the edge function's own `index_test.ts` updated to cover
  the new field. Full suite (1089 tests) and `tsc --noEmit` pass; the edge function's own Deno
  tests (`deno test --allow-env --allow-net`) pass (5/5). Tier 2 (light path) — confined to one
  call site plus its two payload-interface definitions, no shared date/status/platform filtering
  logic touched — implemented directly with one self-review pass. Not yet deployed: the
  `notify-brand-removed` function needs `supabase functions deploy notify-brand-removed` before
  a real removal triggers an email containing the new link. Task 216.
- *2026-08-13 (prior):* Follow-up to Task 214 (below), reported live via a SilverPlay screenshot:
  its TrustPilot card still read 0/0/— with no way to reach that fix, since SilverPlay currently
  has exactly one distinct brand and its Brand filter dropdown never renders for a single-brand tab
  (`uniqueBrands.length > 1` gate) — SilverPlay is also in the separate `NO_BRAND_FILTER_TABS` set,
  which suppresses it regardless of brand count either way — so `brandFilter` could never become
  non-empty there and `brandScoped` could never fire. `brandScoped` (`BrandGroup.tsx:~1419`) now
  also fires when `uniqueBrands.length === 1`, since a single-brand tab's whole-tab view already IS
  that one brand's page. The moment a second brand appears on a tab this auto-trigger turns off,
  reverting to Task 214's original explicit-Brand-filter requirement. Tier 2 (light path) — a
  one-line condition extension to code just shipped/reviewed in Task 214, implemented directly with
  one self-review pass rather than the full pipeline. Full suite (396 tests) and build pass; no live
  Supabase credentials available in this session, so live verification against SilverPlay's real
  data was deferred, same as Task 214. Task 215.
- *2026-08-13 (prior):* Brand Tabs' `displayKpis`/`displayTotals` now show real counts for
  flagged-removed brand/platform combinations when the Brand filter is explicitly narrowed to one
  or more brands (`brandFilter.length > 0`), such as when a user views a brand's own tab via
  clicking its name or the `?brand=` deep link. A `brandScoped` flag in each computation skips
  the `removed_platform_brands` exclusion whenever the filter is active; the empty-filter (default
  whole-tab view) keeps today's exclusion behavior unchanged, so global KPI cards continue
  correctly excluding flagged-removed platform/brand pages. On a multi-platform tab,
  `displayTotals`'s OR-across-platforms bucketing means re-admitting a flagged platform's status can
  also shift which bucket (Live vs. Removed) a row lands in, not merely raise a zero count to a
  positive one. Score Summary/Overview/`scoreSummary.ts` are untouched. Full suite (396 tests) and
  build pass. No live Supabase
  credentials available in this session, so browser verification was deferred. Spec:
  `docs/superpowers/specs/2026-08-13-brand-tabs-removed-platform-count-design.md`. Plan:
  `docs/superpowers/plans/2026-08-13-brand-tabs-removed-platform-count.md`. Task 214.
- *2026-08-13 (prior):* Follow-up to the entry directly below, same session: after confirming
  the "2,982 of 4,307 accounts have a proxy recorded" caption's exclusion of the "No Proxy"
  bucket was intentional (a same-day final-review fix), the user asked to include "No Proxy" in
  the coverage count instead. `Overview.tsx`'s `proxyCoverage` no longer filters out the
  `NO_PROXY_LABEL` key, so it now sums every bucket and always equals `totalAccounts` (4,307 of
  4,307) — the caption reads 100%, the same behavior Country Breakdown's "Unknown" caption
  already has and that the original No Proxy group design flagged as an accepted, deliberate
  consequence of every entry always resolving to some bucket. `countryCoverage`'s equivalent
  filter is untouched. Full suite (1077 tests) and build pass; no test asserted the old
  filtered-out value (page-level presentational logic, verified via build per this project's
  established pattern for `Overview.tsx`/`BrandGroup.tsx`).
- *2026-08-13 (prior):* Per user feedback on a live screenshot, Proxy Breakdown's "No Proxy"
  card (added earlier the same day, see the `resolveProxyLabel`/No Proxy group work referenced in
  Known Issues) now always renders last, regardless of its volume — overriding that work's plan
  doc, which had deliberately decided against special pinning. `overviewBreakdown.ts`'s
  `topNWithOther` gained an optional `pinnedLastKey` param: the pinned key is excluded from
  ranking/top-N/"Other" entirely and appended as its own trailing card, so a real provider now
  fills the top-8 slot "No Proxy" would otherwise have occupied by outranking it on volume.
  Country Breakdown's call is unchanged (no key passed) and still ranks "Unknown" by volume like
  any other card. 2 new tests in `overviewBreakdown.test.ts`; full suite (1077 tests) and build
  pass.
- *2026-08-07 (prior):* Fixed a data-accuracy bug the user caught via a live screenshot:
  Overview's per-tab card and Score Summary reported different Live/Removed/Total counts for the
  same tab/platform/date-range (FTP/TrustPilot, 01/05–31/07/2026: 281 total on Overview vs. 190 on
  Score Summary). Root cause: three independently-written date-range-inclusion checks disagreed on
  which date column(s) to consult per platform and whether an undated row should count —
  `dateUtils.ts`'s `inDateRange` (Overview's `fetchTabKpis`) picked one date per row from an
  8-column cross-platform fallback chain and excluded undated rows, gating all 4 platforms' tallies
  off that one shared date; `scoreSummary.ts`'s `passesDateFilter` (Score Summary) checked only the
  platform's own date column and always included undated rows; `BrandGroup.tsx`'s
  `inDateRangeInclusive` (Brand Tabs' own cards) used the same fallback chain as Overview but
  included undated rows like Score Summary. Added one shared `passesPlatformDateFilter`
  (`scoreSummary.ts`) and pointed `fetchTabKpis` (via a new pure, testable `computeTabKpisFromEntries`
  export) and `BrandGroup.tsx`'s per-platform and single-platform KPI cards at it. A final
  whole-branch review then caught 2 more Important gaps a per-task review couldn't see: the
  aggregate had silently started excluding platform-flagged brands (violating this task's own
  constraint), and `BrandGroup.tsx`'s single-platform totals (the exact FTP/BITP tabs from the
  report) were still on the old unfixed logic — both fixed, with 2 new regression tests. One real
  gap deliberately parked, not fixed: on a multi-platform tab's `platformFilter === 'all'` view,
  the visible table rows still use the old date logic while the KPI cards above them are now fixed,
  so they can disagree — a separate, documented follow-up (see Known Issues). Built in a worktree
  that forked before Task 179 (below) landed; both touched `queries.ts`/`BrandGroup.tsx`, merged
  cleanly (one textual import-list conflict, zero semantic conflicts, confirmed by reading the
  merged functions, not just trusting git). Full suite (225 tests) and build pass; `deno check`
  clean. Plan: `docs/superpowers/plans/2026-08-07-overview-score-summary-date-filter-parity.md`.
  Task 180.
- *2026-08-06 (prior):* Added automatic weekly Schedule Planner generation via a new
  `generate-weekly-schedule` Supabase Edge Function + `pg_cron` job (Mondays 01:00 UTC = 09:00
  Asia/Manila), so a tab's schedule generates even if nobody opens that tab's Schedule Planner
  page that week. Imports the real, unmodified `schedulerService.ts` scheduling logic rather
  than a ported copy — `queries.ts`'s 8 scheduler-used functions and `schedulerService.ts`'s
  `recalculatePauses`/`ensureWeekGenerated` gained an optional injected Supabase client (default
  = existing browser singleton, zero call-site changes), `supabase.ts` was made import-safe
  outside Vite, and the whole dependency chain got explicit `.ts` extensions for Deno. Built via
  9-task Subagent-Driven Development; final whole-branch review caught and fixed 5 more issues
  (unbounded per-isolate entry-cache growth across all 11 tabs, an unverified `deno.json` import
  map, a missing test on the write path, an incomplete plan command, an undocumented
  Manila-timezone dependency). **Not yet live:** the migration hasn't been applied
  (`supabase db push`) and the function hasn't been deployed (`supabase functions deploy
  generate-weekly-schedule`) — both require explicit confirmation against production and were
  deliberately left pending. Spec: `docs/superpowers/specs/2026-08-05-schedule-planner-weekly-cron-design.md`.
  Plan: `docs/superpowers/plans/2026-08-05-schedule-planner-weekly-cron.md`. Task 178.
- *2026-08-05:* Confirmed, after an initial back-and-forth, that Brand Tabs' per-platform
  "page removed" flag (`removed_platform_brands`, e.g. "TrustPilot page removed") is *correctly*
  excluding a flagged brand+platform from both Schedule Planner (chip hidden in every cell via
  `SchedulePlanner.tsx`'s `brandPlatforms()`; permanently skipped by `schedulerService.ts`'s
  `recalculatePauses`/`ensureWeekGenerated`) and Score Summary/Brand Tabs — an ambiguous first
  reading of the user's request led to briefly removing the Schedule Planner side of this before
  the user's follow-up clarified they wanted it kept on both surfaces; reverted via `git restore`.
  Then added the one piece that was genuinely missing: for a multi-platform brand with only one
  platform flagged (e.g. TP removed, AG/CG still active), Schedule Planner gave no visual hint why
  that platform's chip never appears — Brand Tabs' `PlatformRemovedBadge` now also renders next to
  the brand name in Schedule Planner's sticky Brand column (new `flaggedRemovedPlatforms()` helper,
  `brandPlatforms()`'s inverse), then swapped for a page-local `RemovedPlatformIcon` using the
  platform's actual favicon instead of `PlatformRemovedBadge`'s 2-letter text code, matching the
  icon-based chips this page already uses elsewhere (Brand Tabs itself is unaffected — still shows
  the text-code badge). Then, for the single-platform case (a brand whose only active platform is
  flagged removed, e.g. a TP-only tab's sole brand), `filteredBrands` now drops it from Schedule
  Planner entirely — no row at all, not just an empty one — via a new `brandPlatforms(brand).length
  === 0` check. Fixed a real temporal-dead-zone bug this surfaced: `filteredBrands`' `useMemo` now
  calls `brandPlatforms()` synchronously during render, which closes over `activePlatforms` — a
  `const` that used to live safely below every function that only got called from JSX, but now
  needed hoisting above `brandPlatforms`'s own definition to avoid a `ReferenceError`. Day-cell
  scheduling/exclusion logic untouched throughout. Live-verified via Playwright against real
  Supabase data (SilverPlay's "Silver Play", Hanan's several TP-flagged brands, and a live
  flag/unflag round-trip on Trybet's real "Trybet.com" brand confirming it vanishes from and
  reappears in the Trybet tab's list with no residual state left behind). Finally, a readability
  pass on `RemovedPlatformIcon` itself after the user flagged a live screenshot where the red-X
  marker read as little more than a dot: first enlarged it (favicon to `size-4`, badge circle to
  `size-3` with a white ring), then — per a follow-up request — dropped the circle background
  entirely in favor of a plain `size-3` red X with a small white drop-shadow for contrast, directly
  over the favicon. `PlatformRemovedBadge` (Brand Tabs) is unaffected by any of this. Full suite
  (273 tests) and build both pass. Task 175.
- *2026-08-04 (prior):* Extended Ask AI (`supabase/functions/ai-assistant/`, GPT-4o
  tool-calling assistant) to full coverage of the dashboard's own metrics across 4 phases,
  none deployed yet (`supabase functions deploy ai-assistant` still pending): (1) fixed a live
  credential leak — `get_entry`/`query_entries` returned raw `data` jsonb including
  `Password`/`Backup Codes`/`Authenticator Backup` until `redactSensitive()` was added — plus
  a new `get_success_rate_by_field` tool (proxy/agent/country); (2) `get_score_summary` gained
  a `platform` param (tp/ag/cg/wo), fixing a latent bug where AskGamblers scores of 6-10 were
  misclassified as unrated under a hardcoded 1-5 ceiling; (3) `get_removed_platform_flags` plus
  the same platform-removed-brand exclusion wired into both `get_score_summary` and
  `get_success_rate_by_field`, and gave the latter the `platform` param the former already had
  (closing a cross-tool inconsistency Phase 2's own review flagged); (4) `get_schedule`/
  `get_paused_combos` for Schedule Planner state, plus a current-date system message that was
  previously entirely missing — building it surfaced that this team operates in Asia/Manila
  (UTC+8, same assumption `scheduleBrands.ts`'s `toISODate` already documents), so a bare UTC
  date would misread "this week" for roughly a third of every day; fixed with a deliberate,
  narrowly-scoped `+8h` offset on that one system message only. A final whole-branch review
  (Phase 4) then caught 5 more gaps: `get_schedule`'s description didn't warn its rows are an
  unconfirmed *plan* (the exact same gap Task 173, below, fixed on the Schedule Planner UI
  itself); `get_paused_combos`'s description didn't warn a pause row can be stale until someone
  reopens that tab in the app; `get_schedule` had no runtime guard against a model call omitting
  `tab`/`week_start` despite both being schema-`required` (a real gap — `required` is a hint to
  the model, not an enforced guarantee); the system prompt never defined WO/Wizard of Odds
  despite every phase-2-4 tool accepting `platform: 'wo'`; and the "Tab names" vocabulary list
  was missing 2 of the real 11 tabs (`Wizard of Odds`, `GRG - Gulf Recovery Group`), which
  matters more than it looks since `get_schedule` treats an empty result as a legitimate
  "nothing scheduled" answer. Full `tools_test.ts` suite (38 tests) passes; `deno check` clean.
  Specs/plans: `docs/superpowers/specs/2026-08-04-ask-ai-full-coverage-phase{1,2,3,4}-design.md`,
  `docs/superpowers/plans/2026-08-04-ask-ai-full-coverage-phase{1,2,3,4}.md`. Task 174.
- *2026-08-04 (prior):* Fixed a Schedule Planner mismatch the user caught by comparing the
  calendar against the Brand Tabs page directly: a TP chip showed as scheduled for Lucky7even
  on Jul 30 with no real TP post anywhere in that brand's entry data. Root cause: `ScheduleCell`
  (`src/lib/scheduler/calendarRenderer.tsx`) rendered a chip whenever the auto-generated
  `brand_schedule` plan said `status === 'active'`, with no requirement that a real entry ever
  confirm it — the confirmed/removed evidence overlay (Tasks 165/168) only added a badge on top
  of the plan, it never gated the plan's own chip. Since `ensureWeekGenerated` only runs for the
  current week, every past week's rows are exactly this kind of forward-looking plan, so a
  planned post that never actually happened kept showing as if it had. Same root cause explains
  a self-contradicting tooltip the user also flagged, "CasinoGuru: Not scheduled — Removed" — the
  plan-status label and the real-evidence label were concatenated instead of one replacing the
  other. Fix: for any day strictly before today, a plan-only chip (status set, no matching
  confirmed/removed evidence) is now ghosted (`opacity-0`, revealed on hover/focus/touch, same
  pattern as the existing "+ Add Platform" button) rather than shown at full opacity — still
  clickable so a wrongly-planned past day stays correctable, just not visually asserting
  something unverified by default. Today/future days are unaffected (the day hasn't concluded,
  so there's no evidence to check the plan against yet). Tooltip now shows just "Removed" or
  "Confirmed" when evidence exists, dropping the concatenated plan-status prefix. New `isPastDay`
  prop threaded from `SchedulePlanner.tsx`. Full test suite (271 tests) and build both pass; no
  schema change. Live browser verification against real Supabase data was not performed this
  session — the shared Playwright browser profile was locked by a concurrent session, and
  force-closing another session's browser to reclaim it was avoided; worth a follow-up look at
  the Rooster Partners Jul 27–31 week specifically, since that's the exact week the user's
  screenshot showed the bug on. Task 173.
- *2026-08-04 (prior):* Fixed a critical post-merge bug in the `bif_review_accounts` view
  (Task 172, directly below) caught by that same task's own Step 5 live-verification: its
  `review_status` column read only `data->>'Review Status'`, but a direct count against all
  793 live TP Brand Injection rows found zero use that exact key — every single row stores
  status under `TP Review Status` instead, so `review_status` was `NULL` for 100% of rows,
  not an edge case. The app already has a header-alias table for exactly this
  (`PLATFORM_STATUS_KEYS.tp` + `pick()` in `scoreSummary.ts`); the view just didn't use it.
  New migration `20260804090000_fix_bif_review_accounts_status_key.sql` redefines
  `review_status` as a `coalesce(nullif(..., ''), ...)` chain across all 5 known aliases in
  `pick()`'s exact precedence order, closing a gap a bare `coalesce()` would still have (an
  empty-string value winning over a real one in a lower-precedence key). The other 7
  jsonb-derived columns were individually re-verified against the same 793-row count and are
  unaffected. Also confirmed via direct `anon`-key REST calls (not just the SQL Editor):
  Step 3's permission check returns HTTP 200, and Step 4's `brand_url IS NULL` count is 98 of
  793 (~12%).
- *2026-08-03 (prior):* Added a read-only `bif_review_accounts` Postgres view over `entries`
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
  `docs/superpowers/plans/2026-08-03-bif-dashboard-review-accounts-view.md`. Task 172.
- *2026-08-03 (prior):* Future Schedule Planner weeks are no longer read-only — supersedes the
  "legacy and future weeks stay non-interactive, unchanged" line in Task 170's write-up
  (`docs/task-history.md`). Users can now click-to-cycle and use "+ Add Platform" on any future
  week the grid can already navigate to, exactly like the current week; only legacy
  (pre-platform-tagged) weeks remain read-only. This was safe to unlock because
  `ensureWeekGenerated`/`recalculatePauses` (`src/lib/scheduler/schedulerService.ts`) moved from
  a week-level no-op guard ("does *any* platform row exist for this week?") to a per-brand+
  platform-combo guard — a manual edit to one combo in a future week is passed to the generator
  as a "pinned" combo (`pinnedBrandPlatforms`, an existing `SchedulerInput` field the engine
  already fully honored but had never been wired up) and skipped, so it can no longer block
  generation or pause-detection for every *other* combo once that week becomes current.
  Protection is per (brand, platform, week), not per exact day — touching one day pins the
  whole combo's row for that week, a deliberate consequence of the one-row-per-combo data
  model, not a bug. `isFutureWeek` (`SchedulePlanner.tsx`) is deleted entirely; `isCurrentWeek`'s
  scheduler-invocation gate is unchanged. Full test suite (168 tests, including 2 new
  combo-level regression cases in `schedulerService.test.ts`) and build both pass. No schema
  change. Live browser verification of the click-to-cycle/"+ Add Platform" path on a future
  week was not performed this session (no browser-automation tooling available to the
  implementing agent) — the unlocked code path is otherwise identical to the already
  live-verified current-week path (Tasks 164/169/170). Spec:
  `docs/superpowers/specs/2026-08-03-schedule-planner-future-week-manual-edit-design.md`. Plan:
  `docs/superpowers/plans/2026-08-03-schedule-planner-future-week-manual-edit.md`. Task 171.
- *2026-08-03 (previous):* Fixed a gap in the legacy-week chip fix directly below: it only fired
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
  to a past or future week never triggers a write; future weeks were read-only in the UI for
  the same reason (a manual edit there would permanently block that week's own eventual
  auto-generation) until Task 171 made it safe to unlock. Day cells now show one small colored badge per platform (TP/AG/CG/WO)
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
- **Pending manual deploy (2026-08-18):** the Schedule Planner → PMS task sync feature's migration
  (`supabase/migrations/20260817120000_add_schedule_pms_links.sql`) has not been applied to the
  live database, and the `sync-schedule-pms` Edge Function has not been deployed. The Vercel env
  var it depends on (`VITE_SYNC_SCHEDULE_PMS_URL`) has also not been set (`.env`'s own copy is
  left blank for the same reason). **Setup required before it works:**
  1. `supabase db push` (applies the new `schedule_pms_links` table).
  2. `supabase secrets set PMS_API_TOKEN=...` then `supabase functions deploy sync-schedule-pms`.
  3. Add `VITE_SYNC_SCHEDULE_PMS_URL=<deployed function URL>` to Vercel env, then redeploy.
  Until all 3 are done, `pushScheduleActivations`/`pullScheduleDrift` (`src/lib/schedulePmsSync.ts`)
  both silently no-op — activating a Schedule Planner chip behaves exactly as it did before this
  feature shipped, no broken UI in the interim. Separately, `generate-weekly-schedule`'s own
  already-pending deploy (see the bullet below) now additionally needs `PMS_API_TOKEN` set before
  its push-wiring (added the same day as this feature) does anything — it silently no-ops without
  it per its own `if (activated.length > 0 && pmsApiToken)` guard, so this isn't a new blocker on
  top of that function's existing pending-deploy status, just one more secret to set at the same
  time. Live-verify once deployed: open Schedule Planner, click a blank cell active on a real tab,
  confirm a real task appears in the "Forum Team" PMS project's To Do column with the right
  title/label/due date; then edit that task's due date directly in PMS, reload the tab, and confirm
  the calendar cell moves to match. Task 228. Two more verification sub-steps a final review flagged
  as gaps in that same walkthrough, not yet covered by the spot-check above:
  4. **Date round-trip via the PMS's own UI, not just its API.** The create/patch API path's date
     handling was spot-verified once during planning (see the spec doc's live-verification note),
     but that only proves the API side. Pull reconciliation depends on a different path: a human
     manually editing a task's due date through the PMS's own UI. Create one real task via the
     deployed function, edit its due date by hand in the PMS UI (not via `curl`/the API), then
     independently confirm via `GET /api/projects/{projectId}/tasks` that the returned `dueDate`
     slices back to the exact `YYYY-MM-DD` shown in the UI. If the PMS UI stores or displays dates
     in local time while the API returns UTC, a human-edited date could silently shift by a day when
     pulled back — misfiring drift-detection on every linked task, not just occasionally.
  5. **List-endpoint completeness.** `pullScheduleFromPms` treats any linked `pms_task_id` NOT
     present in `GET /api/projects/{projectId}/tasks`'s response as "deleted in PMS" and un-schedules
     the corresponding calendar day. Before trusting this in production, confirm that endpoint
     returns every task in the project unpaginated and regardless of column, including Done/archived
     — by creating a linked task, moving it to Done in the PMS UI (a normal workflow action, not a
     delete), and confirming it still appears in the list response. If the endpoint is paginated or
     excludes Done/archived tasks, a normal "mark as done" action would incorrectly read as
     "deleted" and silently clear a real, still-valid schedule day.
- **Schedule Planner ↔ PMS pull reconciliation doesn't check hidden/restricted/removed-brand
  exclusion sets before applying drift (Task 228 final review, not yet fixed).**
  `pullScheduleFromPms` (`src/lib/scheduler/pmsSync.ts`) reconciles every `schedule_pms_links` row
  for a tab against live PMS state without checking `schedule_hidden_brands`,
  `schedule_platform_restrictions`, or `removed_platform_brands`. If a brand+platform combo becomes
  hidden, restricted, or flagged-removed *after* its PMS task was linked, and someone later edits
  that task's due date in PMS, the pull effect will still write an 'active' day into
  `brand_schedule` for that now-excluded combo. Practical impact is narrower than it sounds:
  `TabScheduleSection.tsx`'s `brandPlatforms()`/`resolveBrandPlatforms()` already filter excluded
  combos out of what actually renders regardless of what's sitting in `brand_schedule` (the same
  exclusion-filtering logic used everywhere else on this page), so the real effect is an orphaned,
  invisible `brand_schedule` row — not an incorrect number or chip shown anywhere. Still worth
  fixing properly per this project's standing cross-dashboard-consistency rule, by threading the
  same hidden/restricted/removed sets `TabScheduleSection.tsx` already computes into the pull call
  (or having `pullScheduleFromPms` resolve them itself, the way `generateForTab`'s `buildTabContext`
  already does) and skipping any drift/deletion whose combo is currently excluded.
- **Schedule Planner ↔ PMS pull-reconciliation can silently desync on a partial write failure
  (accepted v1 limitation, Task 228).** `TabScheduleSection.tsx`'s pull effect applies its
  `schedule_pms_links` correction via the Edge Function (server-side, unconditional) *before* the
  frontend's own `setBrandScheduleDay` call applies the matching `brand_schedule` change for that
  same drifted/deleted item. If `setBrandScheduleDay` fails partway through a multi-item batch
  (e.g. a transient network blip), the calendar can be left silently out of sync with PMS, and it
  won't self-heal on a later tab revisit — the next pull will see the link already matches the
  live PMS state and report no further drift. Inherited from the plan's own design, not an
  implementer bug; ruled acceptable for v1 given how rare the triggering conditions are (requires
  a human editing a PMS due date AND a concurrent client-side write failure). Any affected cell is
  self-correctable by a normal manual click, which re-links normally. Fix direction, if ever
  needed: apply the `brand_schedule` write(s) first and only advance/clear the `schedule_pms_links`
  row(s) after they succeed, so a partial failure leaves the link stale (re-detected as drift next
  pull) rather than silently consumed.
- **`countryFlags.ts`/`reviewRemovalAssessment.ts` extensionless imports break local `deno
  check`/`deno test` for any Edge Function that transitively imports either file (found during
  Task 228, pre-existing, not introduced by that plan).** `src/lib/countryFlags.ts` (imports `from
  './tab-configs'`) and `src/lib/reviewRemovalAssessment.ts` (imports `from './supabase'`, `from
  './entryFieldSections'`, `from './scoreSummary'`) all use relative imports missing the `.ts`
  extension Deno's strict module resolution requires. This breaks `deno check`/`deno test` for
  both the new `sync-schedule-pms` function and the pre-existing, already-undeployed
  `generate-weekly-schedule` function (confirmed identically broken for both — same 4 `TS2307`
  errors either way) — but does **not** affect the real Supabase deploy bundler, which already
  resolves extensionless imports fine, proven by `ai-assistant`'s successful 2026-08-14 deploy
  using the same cross-import pattern (see that entry above). Narrow, real scope: local
  `deno check`/`deno test` only, currently making it impossible to get a clean Deno test run for
  either function. Not a deploy blocker for `sync-schedule-pms` or `generate-weekly-schedule`.
  Fix direction: add explicit `.ts` extensions to the 4 imports across those 2 files.
- **AG/CG/WO automated brand-page-removal detection not built — spike research found no evidence to build on.**
  Following the TP automated-removal-detection feature (2026-08-13,
  `docs/superpowers/specs/2026-08-13-automated-brand-page-removal-detection-design.md`), a same-day
  spike investigated extending it to AskGamblers, CasinoGuru, and Wizard of Odds. Tested 4 real
  brands already confirmed dead on TrustPilot (Pribet, WinMega, RealSpin, Silver Play) against their
  AskGamblers and CasinoGuru pages via a live stealth-browser probe: all 4 still show fully live,
  populated review pages on both platforms (real ratings, review counts, Safety Index scores) — no
  removed/delisted state found. This suggests AG/CG may not delist a review page when the underlying
  business closes at all, unlike TrustPilot, which would mean "check if removed" isn't a meaningful
  thing to detect there (not just "not yet verified"). Wizard of Odds has no known-dead brand to test
  against at all; only a fabricated never-existed URL was checked, which returns a generic "404 Page
  Not Found" — a real signal, but for "never existed," not "was removed," so it's unconfirmed whether
  WO ever actually delists a published review either. Decision: do not build detection for any of the
  3 on this evidence. Revisit only if/when a real removed example turns up on one of them (naturally,
  or if someone already knows of one) — do not re-derive a signature from a fabricated 404 alone.
- **Brand Tabs' KPI cards can disagree with the table when brand-filtered + status-filtered (Task 214).**
  Task 214 made `displayKpis`/`displayTotals` (`BrandGroup.tsx`) show real non-zero Live/Removed
  counts for a flagged-removed brand/platform whenever the Brand filter is non-empty. `matchesPlatform`
  (`BrandGroup.tsx:~1397`), which gates which rows the table shows, was deliberately left unchanged
  and still excludes those same rows whenever a status filter is also active. Concretely: a KPI card
  can show a non-zero count directly above a table reading "No entries match your filters." — reachable
  via Score Summary's own brand/status deep links (`?platform=<p>&brand=<brand>&status=live` or
  `&status=removed`, `ScoreSummaryPanel.tsx:~621`/`~633`) or via this page's own KPI-click-through
  (`TotalBreakdownModal`, `BrandGroup.tsx:~2703-2704`, which sets `statusFilter` from a card click). A
  fix would mean symmetrically guarding `matchesPlatform` with the same `brandScoped` condition, which
  needs a product decision first — it changes what scoping `matchesPlatform` was deliberately never
  given, and was explicitly out of scope for Task 214.
- Schedule Planner's CSV/Excel export (`src/lib/scheduler/scheduleExport.ts`) reads each day's status
  only from the `brand_schedule` plan row (`rowsByPlatform[platform]?.[day]`), not from the same
  confirmed/removed real-evidence overlay or past-day "ghosting" the calendar grid itself displays on
  top of that plan (Tasks 165/168/173). A day can therefore show a confirmed ✓ or a removed ✕ chip on
  screen while exporting as blank, or export a confident `Active` for a past day the grid itself
  ghosts as unverified. This is spec-sanctioned (the design spec explicitly scopes the day columns to
  the plan lookup) but breaks that same spec's own "what you see is what you get" framing, and is the
  same class of plan-vs-evidence divergence Task 173 fixed on the calendar itself. Fix direction: add
  two more export columns (`Confirmed Days`, `Removed Days`) built from the `dateStatusIndex`
  `SchedulePlanner.tsx` already computes via `computeConfirmedByPlatform`/`computeRemovedByPlatform`.
- The `xlsx` dependency (Data Export feature) is pinned at `0.18.5` — the last version SheetJS
  published to npm; known npm-audit advisories against it (prototype pollution, ReDoS) have no patched
  version available on npm (fixes exist only via SheetJS's own CDN), so `npm audit`/Dependabot will
  flag this permanently with no npm-side fix to upgrade to. Actual exposure is negligible: the app only
  ever calls `XLSX.utils.aoa_to_sheet`/`XLSX.write` on data it constructs itself
  (`src/lib/exportFile.ts`) — the only `XLSX.read` call in the codebase is in that file's own test,
  reading a buffer the same test just produced, never untrusted input. Documented so a future audit
  finding isn't mistaken for an active gap or "fixed" by swapping in an unvetted fork.
- **Live cross-surface consistency check never performed on this branch (multi-select filters).**
  No live check exists yet confirming Overview's and Score Summary's combined multi-platform KPI
  figures agree on real data for the same tab/platforms/range — this branch's entire premise is
  4 independently-coded implementations of one counting rule, and only static tracing + unit
  tests have verified agreement so far (no Supabase login credentials are available in any
  session in this environment currently). Recommend this be the first live check performed once
  credentials are available, specifically comparing a 2-platform selection's numbers between
  Overview and Score Summary for the same tab/range.
- Overview's per-tab KPI count can disagree with the row list on the BrandGroup page it
  deep-links into, for a row with mixed per-platform outcomes (e.g. TP Removed + CG Published on
  the same row) — Overview's combined-total logic classifies such a row as live-only (live
  checked before removed, one classification per row), while BrandGroup's own status filter
  treats a row as matching `?status=removed` if ANY relevant platform matches. Pre-existing
  behavior (present before the multi-select filters branch), but multi-select makes it newly
  reachable via an explicit 2-platform selection rather than only the old "all platforms" view.
- Comma is an unescaped delimiter in every multi-select filter's URL/localStorage serialization
  (`src/lib/filterParams.ts`'s `readArrayParam`/`writeArrayParam`). A country label, brand name,
  or tab name containing a literal comma would round-trip incorrectly through
  `?country=`/`?brand=`/`?tab=`. No known real value currently contains one, but this hasn't been
  exhaustively verified against live country/brand data.
- Check Status silently widens to an unscoped sweep when 2+ values are selected for
  Agent/Proxy/Country/Status on Brand Tabs (`BrandGroup.tsx`'s Check Status scope-building logic)
  — the live `StatusCheckScope` API only accepts one value per field, so selecting e.g. 2 proxies
  and clicking Check Status runs an unscoped (all-proxies) sweep for that field rather than
  guessing which of the 2 to send, which can be a much longer-running check than the user expects
  from the visible filter. No UI hint currently surfaces this. A lone "No Proxy" proxy-filter
  selection triggers the same unscoped-sweep fallback for the identical reason — the live API has
  no concept of "No Proxy" either, so there's nothing real to send it as the single scoped value.
- On a multi-platform brand tab (Rooster Partners, Revolution Casino, SilverPlay, Hanan) with
  `platformFilter === 'all'` and a date range set, `BrandGroup.tsx`'s visible **table rows**
  (`applyDateFilter`, around the `platformFilter === 'all'` branch) still use the old
  cross-platform date-column fallback (`inDateRangeInclusive`) rather than checking each active
  platform's own date via `passesPlatformDateFilter` like the KPI cards above them now do (fixed
  2026-08-07, Task 180). This means the table's visible rows can disagree with what the cards
  imply. Real, but deliberately deferred — a different question (what "in range" means for a
  table row mixing multiple platforms' data) from the Overview/Score-Summary bug Task 180 fixed,
  and `BrandGroup.tsx` has no test coverage to safely verify a deeper change to `applyDateFilter`
  in one pass. Fix direction: extend that branch to check `getTabPlatforms(tab).some(p =>
  passesPlatformDateFilter(e.data, p, dateFrom, dateTo))`, matching the aggregate logic
  `computeTabKpisFromEntries` (`queries.ts`) already uses.
- `queries.ts`'s `computeTabKpisFromEntries` has a `genericInRange` fallback (kept on the old,
  unfixed `inDateRange` cross-platform-fallback date logic, since no platform-specific date key
  applies to a bare/unresolved status column) for rows whose tp/ag/cg/wo values are all blank.
  Whether any of the 11 real operational tabs currently has rows that take this path has not been
  verified against live Supabase headers/data — no DB credential was available in the 2026-08-07
  session that added this comment. If it turns out to be live on a real tab, that tab's undated
  rows in this fallback path would still be excluded rather than always-included, reintroducing a
  narrower version of the bug Task 180 fixed.
- **Pending manual deploy (2026-08-06):** the `generate-weekly-schedule` migration
  (`supabase/migrations/20260805100000_add_generate_weekly_schedule_cron.sql`) has not been
  applied to the live database, and the Edge Function has not been deployed. Until both are
  done, no Monday cron job actually exists in the live project — Schedule Planner generation
  still only happens via the pre-existing page-visit trigger. To finish: `supabase db push`,
  then `supabase functions deploy generate-weekly-schedule`, then confirm via `select * from
  cron.job where jobname = 'generate-weekly-schedule-monday';`. See Task 9 of
  `docs/superpowers/plans/2026-08-05-schedule-planner-weekly-cron.md` for the full manual
  deploy checklist, including a one-time manual invocation to confirm it writes real
  `brand_schedule` rows before waiting for the first real Monday. One prior open question is now
  answered: whether a bundler can actually resolve this function's `../../../src/lib/*` imports at
  real deploy time was unconfirmed (this function itself has never been deployed) — `ai-assistant`
  deployed successfully with the same import pattern on 2026-08-14 (see the Ask AI item above), so
  that specific worry no longer applies when this deploy is finally run. As of 2026-08-18
  (Task 228), this deploy also needs `PMS_API_TOKEN` set before `generateForTab`'s push-to-PMS
  wiring does anything — it silently no-ops without it, so this isn't a new blocker on top of the
  above, just one more secret to set at the same time; see the Schedule Planner → PMS task sync
  pending-deploy bullet above for the rest of that feature's own checklist.
- **Pending manual deploy (2026-08-14):** the AI Review Removal Assessment feature's migration
  (`supabase/migrations/20260814150000_add_ai_review_analysis.sql`) has not been applied to the live
  database, and the `review-removal-assessment` Edge Function has not been deployed. The Vercel env
  var it depends on (`VITE_REVIEW_REMOVAL_ASSESSMENT_URL`) has also not been set. **Setup required
  before it works** (same pattern as `ai-assistant`/`translate-review`):
  1. `supabase db push` (applies the new `ai_review_analysis`/`ai_review_analysis_hash`/
     `ai_review_analysis_model`/`ai_review_analysis_at` columns on `entries`).
  2. `supabase functions deploy review-removal-assessment` (`OPENAI_API_KEY` is already set —
     shared with `ai-assistant`/`translate-review`).
  3. Add `VITE_REVIEW_REMOVAL_ASSESSMENT_URL=<deployed function URL>` to Vercel env, then redeploy.
  Until all 3 are done, the "🤖 Analyze Review" button in Edit Entry always fails with the standard
  "Unable to generate an AI assessment right now. Please try again later." error message. Task 225.
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
  in `src/lib/scheduler/schedulerRules.ts`) now windows the rate to a rolling 30 days ending on
  `weekStart` (`recalculatePauses`' `last30DaysRange` in `schedulerService.ts`), not all-time —
  changed 2026-08-07 per a final whole-branch review of the Schedule Planner rules update: a
  calendar-month-to-date window (that task's first attempt) made the check mathematically
  unreachable for Wizard of Odds (dropped to 1 post/wk that same task) and Casino Guru (already
  1/wk), since neither can accumulate `minDecidedPostsForRateCheck` (5) dated posts within a
  single calendar month. Still requires at least 5 decided posts within the 30-day window, paired
  with a fixed 1-week auto-pause — the same "chronically underperforming brand oscillates in and
  out of pause indefinitely" tradeoff as before still applies, just on a rolling rather than
  calendar-month basis, and is still accepted/deliberate. That same task also added a manual
  override layer (`brand_platform_override` table, checked first in `recalculatePauses`) that can
  force a brand+platform `'active'` regardless of what this or any other auto-check computes, or
  force it `'pause'` unconditionally — ops sets/clears it via a control on the Schedule Planner
  grid, and it persists until explicitly cleared (no auto-expiry, unlike an auto-detected pause).
  Spec: `docs/superpowers/specs/2026-08-07-schedule-planner-rules-update-design.md`.
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
  `get_review_texts` (Task 223) is a third dependent, and the AI Review Removal Assessment feature's
  WO framing (Task 225, `supabase/functions/review-removal-assessment/`) is now a fourth dependent on
  this same unverified key.
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
- **All of Ask AI's known drift/parity gaps were closed in code as of Task 220 and its
  same-day follow-up fixes** (2026-08-14) — `get_schedule`/`get_paused_combos`
  (`supabase/functions/ai-assistant/tools.ts`) now filter through
  `schedule_hidden_brands`/`schedule_platform_restrictions` AND `removed_platform_brands`,
  matching `SchedulePlanner.tsx`'s real 3-part exclusion (hidden, restricted, flagged-removed),
  via the real `buildHiddenBrandSet`/`buildPlatformRestrictionMap`/`scheduleBrandKey`
  (`src/lib/scheduleBrandConfig.ts`) and `fetchRemovedPlatformBrandSet`/`platformRemovedKey`
  (already in `tools.ts`) instead of new hand-ported copies, and both tools' descriptions now
  disclose this filtering so the model says "may be hidden/restricted/removed" instead of
  "doesn't exist" per the anti-hallucination system-prompt rule. `get_success_rate_by_field`'s
  proxy grouping and `query_entries`'s `group_by="Proxy Used"` path (`groupByField`) both bucket
  case-insensitively via `resolveProxyLabel`/`canonicalProxyKey`/`canonicalProxyName`
  (`src/lib/proxyAliases.ts`), matching the dashboard's own grouping. `pick()` (`tools.ts`) no
  longer trims before its blank check (matches `src/lib/scoreSummary.ts`'s real `pick()` exactly)
  and `get_score_summary`'s `successRate` is now floored to a whole percent like the dashboard's
  `successRatePct` — closing the last 2 items from the 2026-08-04 Phase 2 review that used to sit
  just above this bullet. **Deployed 2026-08-14** (`supabase functions deploy ai-assistant`,
  version 33 — confirmed `ACTIVE` via `supabase functions list`) — all 5 fixes are live. This also
  resolved the deploy-time risk this bullet used to flag: `ai-assistant` was only the 2nd Deno
  function in this repo to import across into `src/lib/*` via a relative `../../../src/lib/` path
  (the 1st, `generate-weekly-schedule`, still hasn't been deployed — see the item below), so
  whether a bundler could actually resolve that pattern at real deploy time (as opposed to just
  `deno check`) was unconfirmed; the deploy log shows `scheduleBrandConfig.ts`,
  `removedPlatformBrands.ts`, and `proxyAliases.ts` were all uploaded as bundled assets alongside
  `tools.ts`/`index.ts`, so the pattern is now proven safe at deploy time — worth noting when
  `generate-weekly-schedule`'s own pending deploy (below) is finally run. Spec/plan for the
  original Task 220 scope:
  `docs/superpowers/specs/2026-08-14-ask-ai-drift-prevention-design.md`,
  `docs/superpowers/plans/2026-08-14-ask-ai-drift-prevention.md` — the 3 same-day follow-up fixes
  (`pick()`/`successRate` parity, `groupByField` case-insensitivity, tool-description disclosure)
  were done directly as bounded fixes in the same session, no separate spec/plan.

<!-- gitnexus:start -->
# GitNexus MCP

This project is indexed by GitNexus as **Forums Dashboard** (1240 symbols, 3401 relationships, 82 execution flows).

GitNexus provides a knowledge graph over this codebase — call chains, blast radius, execution flows, and semantic search.

## Always Start Here

For any task involving code understanding, debugging, impact analysis, or refactoring, you must:

1. **Read `gitnexus://repo/{name}/context`** — codebase overview + check index freshness
2. **Match your task to a skill below** and **read that skill file**
3. **Follow the skill's workflow and checklist**

> If step 1 warns the index is stale, run `npx gitnexus analyze` in the terminal first.

## Skills

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/refactoring/SKILL.md` |

## Tools Reference

| Tool | What it gives you |
|------|-------------------|
| `query` | Process-grouped code intelligence — execution flows related to a concept |
| `context` | 360-degree symbol view — categorized refs, processes it participates in |
| `impact` | Symbol blast radius — what breaks at depth 1/2/3 with confidence |
| `detect_changes` | Git-diff impact — what do your current changes affect |
| `rename` | Multi-file coordinated rename with confidence-tagged edits |
| `cypher` | Raw graph queries (read `gitnexus://repo/{name}/schema` first) |
| `list_repos` | Discover indexed repos |

## Resources Reference

Lightweight reads (~100-500 tokens) for navigation:

| Resource | Content |
|----------|---------|
| `gitnexus://repo/{name}/context` | Stats, staleness check |
| `gitnexus://repo/{name}/clusters` | All functional areas with cohesion scores |
| `gitnexus://repo/{name}/cluster/{clusterName}` | Area members |
| `gitnexus://repo/{name}/processes` | All execution flows |
| `gitnexus://repo/{name}/process/{processName}` | Step-by-step trace |
| `gitnexus://repo/{name}/schema` | Graph schema for Cypher |

## Graph Schema

**Nodes:** File, Function, Class, Interface, Method, Community, Process
**Edges (via CodeRelation.type):** CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, MEMBER_OF, STEP_IN_PROCESS

```cypher
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunc"})
RETURN caller.name, caller.filePath
```

<!-- gitnexus:end -->
