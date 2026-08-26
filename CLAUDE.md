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
- *2026-08-26 (newest):* User-requested audit of documented Known Issues/gaps, then a fix wave over
  the 6 confirmed as real (2 turned out already stale, 1 worse than documented — see Task 277 in
  `docs/task-history.md` for the full grounding). Fixed: Trybet's Brands-column display bug (root
  cause was a stale `TAB_COLUMN_CONFIGS['Trybet']` entry, `'Brands'` vs. the real live header
  `'Brand Name'`); `Login.tsx`'s Rules-of-Hooks violation; Schedule Planner's CSV/Excel export now
  carries 5 new evidence columns (Confirmed/Removed/Pending/Done per weekday) matching the
  calendar's own overlay; the PMS pull-reconciliation effect now excludes hidden/restricted/
  flagged-removed combos, matching the push-direction effect's existing guard; Brand Tabs'
  `matchesPlatform` now shares the same `brandScoped` exception `displayKpis`/`displayTotals`
  already had, closing the Task 214 KPI-vs-table divergence. The big one: `entries`' `data` jsonb
  had real credential fields (`Password`/`Casino Password`/`Backup Code(s)`/`Authenticator*` — 8
  real header-spelling variants across the 33 tabs, confirmed via a live `tab_schemas` query, not
  the 6 names originally assumed) sitting in a table that's fully public-readable via the anon key
  (kept that way deliberately for BIF Dashboard's realtime subscription). New
  `src/lib/entryCredentials.ts` normalizes every variant; new `entry_credentials` table
  (approved-users-only RLS) holds them now, migrated live and verified (`entries` row count
  unchanged, zero credential keys left in `data`, anon key can no longer read the new table).
  Migration applied live and verified (no data loss, credentials unreadable via anon key), frontend
  committed and pushed to `origin/main` (Vercel Production redeploy confirmed). A recurring
  verification anomaly (4 pre-existing rows across 2 checks that the migration's own strip silently
  missed, root cause unidentified) was closed properly with a second migration adding a hard
  Postgres CHECK constraint rejecting all 8 keys from `entries.data` outright — applying it
  validated every existing row with zero violations, and any future write path that tries to
  reintroduce one now fails loudly instead of silently leaking. Full suite (2104 tests) and build
  pass. See Known Issues above and Task 277 in `docs/task-history.md` for the full detail.
- *2026-08-26 (prior):* The dashboard's Date From/To toolbar filter is now a real Check Status
  scope, alongside the existing Status/Brand/Agent/Proxy/Country five — closing a gap flagged
  earlier the same session (date range narrowed the visible table but was silently ignored by the
  actual Check Status request). New shared `passes_date_filter()`/`_parse_post_date()`
  (`scripts/check_review_status.py`) mirror `passesPlatformDateFilter`/`parsePostDate`
  (`src/lib/scoreSummary.ts`) for the two real date formats (`YYYY-MM-DD`, `DD/MM/YYYY`), same
  "undated/unparseable row stays included, not excluded" bias as the TS version. New
  `TP_DATE_COLS` added (AG/CG/WO already had their own); `matches_scope_filters()` gained
  `date_cols`/`date_from`/`date_to` params, ANDed in alongside Brand/Agent/Proxy/Country so a date
  range combines correctly with every other filter. Threaded through all 4 loaders, their calling
  functions, and all 4 `status_server.py` routes. Frontend: `StatusCheckScope`
  (`src/lib/queries.ts`) gained `dateFrom`/`dateTo`, forwarded by the one shared `statusCheckBody()`
  helper so all 4 trigger functions picked it up for free; `BrandGroup.tsx`'s `handleCheckStatus`
  includes them in its scope object, same pattern as the other 5 fields. 6 new Python tests; full
  scripts suite 139 passed, full frontend suite 2085 passed, build clean. **Deployed the same
  session:** `scp` + `sudo systemctl restart status-server.service` (the corrected procedure from
  the entry below), clean restart, `NRestarts=0`, `md5sum` parity reconfirmed. Bounded fix
  (Tier 2), no spec/plan doc. Task 270.
- *2026-08-26 (prior):* Schedule Planner's day-cell tooltip gained an Account line (the actual
  login/email used to post, distinct from Agent — the staff member who owns the brand), per a
  direct user request off a screenshot. New `buildAccountIndex` (`src/lib/scheduler/
  scheduleUtils.ts`) mirrors `buildAgentIndex`/`buildCountryIndex` exactly — same
  most-recently-updated-entry, brand-level resolution rule, just reading the `Account` column — so
  it can't disagree with how Agent/Country are already resolved for this same tooltip. A new
  `account` prop threads through `ScheduleCell`/`PlatformChip`/`PausedPlatformIndicator`
  (`calendarRenderer.tsx`) and `TabScheduleSection.tsx`'s new `accountIndex` memo, alongside the
  existing `agent`/`country` props. Tier 1 (fast path) — confined entirely to the Schedule
  Planner's own tooltip components (confirmed via grep: no other importers of `AgentCountryLines`/
  `buildAgentIndex`/`buildCountryIndex`). Full build and the scheduler test suite (505 tests) both
  pass. Task 269.
- *2026-08-26 (prior):* Task 266's `MAX_UNSCOPED_BATCH = 20` cap on a filter-free Check Status
  click is removed entirely (`cap_unscoped_batch()` and its 4 call sites deleted from
  `scripts/check_review_status.py`/`status_server.py`/`check_ag_status.py`/`check_cg_status.py`/
  `check_wo_status.py`), per direct user request after they asked how to re-check hundreds of
  Published entries on a brand tab — confirmed the tradeoff first via `AskUserQuestion` (remove
  entirely / raise the number / leave as-is) given the cap existed as this project's EC2-load
  control after the real Task 226 OOM incident; user chose remove entirely. The Chrome-restart
  safeguard from that same incident (unrelated to the cap) is untouched. **While deploying, found
  and fixed a real live incident, unrelated to the cap change:** the EC2 box had been silently
  running on stale code for 24 hours — Task 266's own deploy (2026-08-25) restarted the server via
  a manual `nohup`-style script instead of `systemctl` (to dodge the `pkill -f status_server`
  self-matching-the-SSH-command gotcha), which raced systemd for port 5001 instead of replacing the
  systemd-managed process; the manual process won the race and kept serving all real traffic (so
  `/health` looked fine the whole time), while the systemd unit crash-looped trying to rebind the
  same port ~9,400 times over 24h, completely invisible to any health check. Root cause:
  `docs/ec2-scraper-runbook.md` itself still documented the stale pre-systemd `pkill`/`nohup`
  restart pattern in 5 separate places — fixed all 5 to use `sudo systemctl restart/start/stop/
  status status-server.service`, plus corrected its `~/server.log` log-viewing guidance to
  `journalctl -u status-server.service` (systemd's stdout never reaches that file). Live-verified:
  killed the orphan PID directly (by PID, not `pkill -f`), confirmed the systemd unit is now
  `active (running)` with a frozen restart counter, and `md5sum` of all 5 files on the box now
  matches the repo exactly. Full scripts suite: 133 passed (3 now-obsolete cap tests removed).
  Bounded fix (Tier 2), no spec/plan doc. Task 268.
- *2026-08-26 (prior):* Schedule Planner → PMS status sync (Task 247) now maps to two different
  real PMS columns per direct user request. Pending/Done/Published/Removed now move to the real
  **Done** column instead of Review/QA — a settled slot is done, not awaiting review. A paused combo
  now moves its task to the real **Project Paused** column (confirmed live via the PMS API's own
  project-columns response — both columns already existed on the "Forum Team" project, just never
  wired into this sync) instead of being left untouched. `resolvePmsSyncStatus`
  (`src/lib/scheduler/scheduleUtils.ts`) now returns a real `'paused'` `PmsSyncStatus` (no longer
  nullable) instead of `null`; `PMS_STATUS_COLUMN_IDS` (`src/lib/scheduler/pmsSync.ts`) was
  repointed accordingly and the now-unused `PMS_REVIEW_QA_COLUMN_ID` removed. Also closed the
  Task 247 "only recognizes scheduler auto-pause, not manual per-day pause" known gap: the status-
  sync effect (`TabScheduleSection.tsx`) now also fetches `brand_schedule` rows for every distinct
  week its `schedule_pms_links` point at (not just the currently-displayed date range) and folds a
  manually-paused day cell into the same `isPaused` signal already covering scheduler auto-pause and
  the `brand_platform_override` force-pause. Full suite (2079 tests) and build both pass; `deno
  check` clean on both Deno consumers of the shared module (`sync-schedule-pms`,
  `generate-weekly-schedule`). **Deployed the same session:** `supabase functions deploy
  sync-schedule-pms` (version 14, confirmed `ACTIVE`) and `git push origin main`. No schema change,
  no new Vercel env var. Task 267.
- *2026-08-25 (prior):* Fixed a real pre-existing bug: `entries.ai_review_analysis` was a single
  shared slot per entry, not one per platform, so on a multi-platform tab analyzing one platform's
  review silently overwrote another's cached analysis on the same entry. New `entry_review_analyses`
  table keyed by `(entry_id, platform)` (same 4-policy RLS as `brand_platform_pause`), migrating the
  9 unambiguous existing analyses and dropping the 2 ambiguous ones (live-verified counts). `queries.ts`
  /`ReviewRemovalAssessment.tsx`/`EditEntryModal.tsx`/`BrandGroup.tsx` all re-wired to read/write
  per-platform — the map-building line in `BrandGroup.tsx` is keyed by `entryReviewAnalysisKey(entry_id,
  platform)`, the single safety-critical line that prevents the bug reappearing one layer up (verified
  independently by 2 reviewers). Also added a new Ask AI tool, `get_review_analyses` — replaces an
  earlier, larger "dedicated aggregation page" idea rejected during brainstorming in favor of reusing
  Ask AI's existing tool-calling infrastructure — so management can ask conversational questions
  ("which agent has the most removal-risk flags") over whatever's been analyzed so far. Coverage is
  deliberately sparse/organic (only manually-analyzed entries), explicitly disclosed in the tool's own
  description; reuses existing helpers throughout (`resolveAgentLabels`, `fetchRemovedPlatformBrandSet`,
  etc.) rather than duplicating logic. Built via 8 SDD tasks + 1 same-task fix round (an untrimmed
  brand value would have silently split one real brand into two `group_by: 'brand'` buckets — this
  project has a documented live case of exactly that trailing-space class of bug) + a final
  whole-branch review (opus) that found and fixed 1 more real issue: the new cached-analysis fetch in
  `BrandGroup.tsx`'s load `Promise.all` had no `.catch()`, so its failure would take down the entire
  Brand Tab page instead of just showing "not yet analyzed" — fixed to fail open, matching this
  project's own `fetchCustomTabs` precedent. Full suite (674 tests) and build pass; Deno suite (118
  tests) and `deno check` clean. **Not yet deployed** — deploy order matters: `supabase db push`
  (migration) before `git push origin main` (frontend), then `supabase functions deploy ai-assistant`.
  Spec: `docs/superpowers/specs/2026-08-25-review-analysis-per-platform-storage-and-ask-ai-design.md`.
  Plan: `docs/superpowers/plans/2026-08-25-review-analysis-per-platform-storage-and-ask-ai.md`.
  Task 264.
- *2026-08-25 (prior):* Same-day follow-up (Task 263) to the overhaul directly below: closed 3 of
  the 4 remaining parked Minor findings — same-row/different-platform duplicate review text is now
  detected (previously only checked other entries), the edge function rejects a non-object/array
  `evidence` payload and caps its stringified size at 5000 chars, and the stale-assessment banner
  now says "review or related dashboard data changed" since the hash covers cross-entry evidence
  too. Deliberately did NOT add `.ts` extensions to `ReviewRemovalAssessment.tsx`'s imports (the
  4th parked item) — every other component in this codebase uses extensionless imports and this
  file is never in a deployed Edge Function's import graph, so the fix would have added
  inconsistency for no real risk reduction. Deployed the same session (function v5, fresh Vercel
  Production deploy). Task 263.
- *2026-08-25 (prior):* Overhauled the AI Review Removal Assessment (Task 225) for accuracy,
  reliability, and actionability, per an explicit request that agents/management get a concrete
  reason for a removal/refusal instead of a vague hedge. New `src/lib/reviewRemovalEvidence.ts`
  computes a deterministic `RemovalEvidence` bundle from a tab's already-loaded entries (no new
  queries): cross-entry proxy/country pattern matching, this brand's historical live/removed
  outcomes on the platform, cross-platform corroboration on the 4 multi-platform tabs, and two
  hard signals (duplicate review text; proxy already tied to another removal) — rendered directly
  in the UI as raw numbers, never AI-paraphrased. `reviewRemovalAssessment.ts`'s schema dropped the
  old free-text `likely_reason` for a named `root_cause` (+ ranked alternatives),
  `evidence_for_removal`/`evidence_against_removal` (forces weighing both sides), and a
  UI-prominent `agent_recommendation` ("For Next Time" block with concrete behavioral actions) —
  the cache hash now covers the evidence bundle too, and an old cached blob simply fails the
  updated validator (no migration needed). The edge function now receives the evidence bundle as
  ground truth, must top-rank a hard signal as root cause unless explicitly argued against, and
  sets `temperature: 0` for consistency. Built via 5 SDD tasks + 1 verification task, all clean,
  plus a final whole-branch review (opus) that caught and fixed 4 Important cross-task issues:
  missing `.ts` extensions on a now-deployment-reachable file (this project's own repeatedly-hit
  deploy-bundler landmine), the new Evidence row wrongly gated behind an existing AI result
  (contradicting the spec), `why_it_may_have_been_removed` orphaned from rendering entirely, and
  cross-entry country matching bypassing the canonical `getEntryCountry` resolver. Deliberately
  deferred: agent/brand-level aggregation of root causes across many entries for management
  visibility — a separate follow-up project once this per-entry output shape is proven. Full suite
  and build both pass. Deployed the same day: `supabase functions deploy review-removal-assessment`
  (now ACTIVE v4), `git push origin main`, and a fresh Vercel Production deploy confirmed Ready —
  `VITE_REVIEW_REMOVAL_ASSESSMENT_URL` turned out to already be set in Vercel (a stale doc claim,
  corrected in Known Issues), so no env var change was actually needed, just the push+redeploy. The
  "🤖 Analyze Review" button is fully live end to end — live-verified via Playwright against a real
  Rooster Partners entry (Luckyvibe, TP, Removed): the Evidence row rendered before the AI result
  existed (confirming that spec requirement), Root Cause correctly disclosed a hard signal's
  cross-platform scope ("tied to a removal on another platform," not implying same-platform),
  Evidence For/Against both populated, the previously-orphaned Why field rendered, "For Next Time"
  showed concrete actions, and a Re-analyze produced the same verdict (temperature-0 consistency).
  Zero console errors. Spec:
  `docs/superpowers/specs/2026-08-25-review-removal-assessment-accuracy-design.md`. Plan:
  `docs/superpowers/plans/2026-08-25-review-removal-assessment-accuracy.md`. Task 262.
- *2026-08-20 (prior):* Added a third, one-way PMS sync direction on top of the two Task 231
  already shipped (push-on-activate creates a linked task; pull reconciles due-date/assignee
  drift): a Schedule Planner cell's own real status (Removed/Confirmed-"Published"/Pending/Done/
  plan-only Active) now moves its linked PMS task to a matching board column, so someone working
  the PMS board can see status without opening the dashboard. Dashboard → PMS only — a human
  moving a card in PMS never writes back to `brand_schedule` or the calendar. Column mapping
  (IDs confirmed live against the real "Forum Team" PMS project): Published/Removed → Review/QA;
  Pending/Done → In Progress; Active → To Do; Paused is excluded entirely (never moves). New pure
  `resolvePmsSyncStatus` (`src/lib/scheduler/scheduleUtils.ts`) mirrors `ScheduleCell`'s own render
  precedence exactly (`Removed > Confirmed > Pending > Done > Paused > Active`) so PMS can never
  disagree with what the calendar shows for evidenced cells. New `not null default 'active'`
  `synced_status` column on `schedule_pms_links` (migration
  `20260820130000_add_schedule_pms_links_synced_status.sql`) records what PMS was last
  successfully told, so the sync only calls the PMS move API for links whose resolved status
  actually changed. Real logic lives in `syncScheduleStatusToPms()` (`src/lib/scheduler/pmsSync.ts`,
  the same shared module `sync-schedule-pms`/`generate-weekly-schedule` already import), reached via
  a new `action: 'syncStatus'` branch; a new `pushScheduleStatusSync()` browser wrapper
  (`src/lib/schedulePmsSync.ts`) mirrors `pushScheduleActivations`'s fire-and-forget shape exactly;
  wired into `TabScheduleSection.tsx` as a new effect alongside the existing `pullScheduleDrift`
  call. Built via 5 subagent-driven-development tasks plus a final whole-branch review that caught
  3 real bugs before shipping — the effect now waits on `scheduleLoading` so pause state isn't read
  stale/empty on first render (it previously always would have been, since `pauses` starts empty and
  only populates after a slower async chain), pause matching is scoped to the link's own week via
  `paused_week_start` instead of matching across every week regardless of date (a correction to this
  feature's own design doc, which had incorrectly claimed pauses carry no date component at all —
  they do, and the calendar's own pause logic already used it), and links whose platform is
  currently hidden/restricted/flagged-removed for that brand are now skipped, consistent with every
  other Schedule Planner surface's existing exclusion rules. One known, deliberately-accepted gap:
  the resolver only recognizes a *scheduler* auto-pause, not a `brand_schedule` day manually cycled
  to `'paused'` nor a day with no schedule row and no evidence at all — both currently resolve to
  `'active'` rather than being excluded (see Known Issues). Full suite (1309 tests) and build both
  pass. **Not yet deployed** (see Known Issues for the exact checklist and a real risk this review
  surfaced: the widened `fetchSchedulePmsLinks` select will break the already-live push/pull PMS
  sync the moment this code deploys, until the migration is applied — deploy the migration first).
  Spec: `docs/superpowers/specs/2026-08-20-schedule-planner-pms-status-sync-design.md`. Plan:
  `docs/superpowers/plans/2026-08-20-schedule-planner-pms-status-sync.md`. Task 247.
- *2026-08-20 (prior):* Two same-day follow-ups to the Task 243 entry directly below, both
  reported live by the user. **Task 244:** Schedule Planner's Confirmed/Removed/Pending/Done
  overlay now updates live via a `subscribeEntries` (`src/lib/realtime.ts`) subscription in
  `TabScheduleSection.tsx` — the same Supabase realtime helper `BrandGroup.tsx` already uses —
  instead of only refreshing on a manual reload; a new `liveEntries` state is kept deliberately
  separate from `tabCtx` so a live edit never re-triggers the scheduler-invocation effect
  (`recalculatePauses`/`ensureWeekGenerated`, which writes to the DB/PMS and must still run only
  once per tab visit). **Task 245:** fixes a real bug this surfaced — Rooster Partners' Luckyvibe
  brand showed AskGamblers Pending on Brand Tabs (dated 18/08/2026) but "Done" on Schedule
  Planner's Tuesday cell, because Task 243's `buildCurrentStatusIndex` painted one brand+platform's
  most-recently-updated status onto *every* scheduled day that week, not the specific day. Its
  premise ("Pending has no date to anchor to") was wrong — the date column records when an entry
  was *added*, independent of current status, so Pending/Done anchor to an exact day just like
  Published/Removed. Deleted `buildCurrentStatusIndex` entirely and folded Pending/Done into
  `buildDateStatusIndex`'s existing exact-date matching; this also fixes the second complaint from
  the same report — Pending/Done are no longer exempt from the past-day "ghosting" effect
  (Task 173) the way the Task 243 entry below describes, since they're now real day-specific
  evidence and render fully visible like Published/Removed, not hover-only. The pause-label
  composition ("Paused (manual) — Pending") from Task 243's own fix wave is gone too — Pending/Done
  now unconditionally override the Paused label, same as Published/Removed always have. Full suite
  (1269 tests) and build both pass; live-verified via Playwright directly against the reported
  Luckyvibe/Tuesday scenario and a full-page screenshot confirming past-day badges render at full
  opacity.
- *2026-08-20 (prior):* Schedule Planner day cells gained a second status overlay, Pending
  (amber "P" badge) / Done (blue "D" badge), mirroring the existing Confirmed ✓ / Removed ✕
  overlay but for two more real TP/AG/CG/WO Review Status values that previously showed no signal
  at all. New `buildCurrentStatusIndex` (`src/lib/scheduler/scheduleUtils.ts`) resolves one
  current Pending/Done status per (brand, platform) via the same most-recently-updated-entry rule
  `buildAgentIndex`/`buildCountryIndex` use, keyed via `BRAND_COLS` like the rest of that file —
  deliberately no date component, since Pending has no date to anchor to (unlike Confirmed/Removed,
  which match an entry's real add-date to one exact calendar day). New `isPendingStatus`/
  `isDoneStatus` in `src/lib/scoreSummary.ts` are character-for-character mirrors of the
  same-named functions already in `src/lib/queries.ts` (now cross-referenced by a comment in each
  direction). The overlay only applies on the real current week (never a past/future week —
  "Pending right now" isn't meaningful for history) and only onto a day that already has an
  active/paused plan slot for that brand+platform — it never creates a chip where none exists.
  Exact-date Confirmed/Removed evidence still wins when both would apply (`isPending`/`isDone`
  gated on `!hasDateEvidence`), so a cell shows at most one badge. A paused day's tooltip composes
  the pause label with a pending/done suffix (e.g. "Paused (manual) — Pending") instead of the
  overlay silently replacing it. Unlike Confirmed/Removed, Pending/Done do NOT exempt a past day's
  chip from the existing "ghosting" effect (Task 173) — since `isPastDay` covers any day strictly
  before today, including earlier days of the current week, a Pending/Done badge on e.g. Monday's
  cell viewed on Thursday still ghosts until hover/focus/touch, same as any other unconfirmed
  plan-only chip. Deliberately not wired into the CSV/Excel export or landing-grid preview,
  matching the existing Confirmed/Removed precedent there (now two more states joining that same
  documented export gap — see Known Issues). Built via 4 subagent-driven-development tasks plus a
  final whole-branch review that caught 3 Important findings after the task-scoped reviews had all
  passed clean — the pause-label-overwrite and ghosting-exemption bugs above, plus a missing
  cross-reference comment on `queries.ts`'s mirrored functions — all fixed in a same-day follow-up
  before the branch was considered done, a normal part of this project's process. Full suite (1272
  tests, 9 new) and build both pass; live-verified via Playwright on BITP/Alf Casino — set Pending
  then Done via Edit Entry, confirmed both badges/tooltips render on the current week and neither
  leaks into the previous week, confirmed an existing ✓/✕ cell is unaffected, reverted the test
  entry afterward. Spec:
  `docs/superpowers/specs/2026-08-20-schedule-planner-pending-done-status-design.md`. Plan:
  `docs/superpowers/plans/2026-08-20-schedule-planner-pending-done-status.md`. Task 243.
- *2026-08-18 (prior):* Add Brand Tab modal (self-service Brand Tab creation, Task 232) no
  longer forces Trust Pilot on as a disabled "always tracked" checkbox — every platform, including
  TP, is now an ordinary unchecked-by-default checkbox, and Wizard of Odds is a new fourth option
  alongside TP/AG/CG. `buildDynamicTabColumns` (`src/lib/dynamicTabRegistry.ts`) now appends TP's
  columns conditionally like every other platform (new `TP_COLUMNS`/`WO_COLUMNS` blocks), and
  `getTabPlatforms` (`src/lib/tab-configs.ts`) derives a dynamic tab's platform list purely from
  its actual columns instead of hardcoding TP — the 11 hardcoded tabs' legacy behavior is
  untouched. Live-verified end to end (create → correct AG/WO-only columns, no TP → delete).
  Task 235.
- *2026-08-18 (prior):* One-time live backfill of PMS task assignees for every already-linked
  Schedule Planner → PMS task (`schedule_pms_links`, 104 rows across 9 tabs as of this run) — the
  push-on-activate Agent→Assignee sync (Task 231) only sets assignee at task-creation time, so every
  task created before that logic went live (or before a brand's Agent value existed yet) sat
  unassigned in PMS despite a real Agent now being on file. Ran as a plain Node script against the
  live Supabase REST API (read-only, anon key) and the live PMS API (`PMS_API_TOKEN`, same as
  `pmsSync.ts`'s server-side flow) — no code changed, no deploy involved. Resolution logic
  hand-mirrors `buildAgentIndex` exactly (most-recently-updated entry's Agent per brand) and
  `resolveAssigneeId`'s case-insensitive PMS-team match, so this can't disagree with what the live
  sync itself would compute. Dry-run first (zero writes) reported 70 tasks would move from
  unassigned to a real assignee and 0 would have an *existing* assignee overwritten — every write
  was purely additive, never a reassignment away from a human's own PMS action — before applying.
  Verified the exact PATCH shape (`{assigneeIds: [id]}`, no `labelIds` key) is a true partial update
  first, against one real task, confirming its existing `AG`/`Client` labels survived untouched.
  Applied: 69 further PATCH calls (the 70th was the verification task itself), 69/69 succeeded, a
  second dry-run pass afterward confirmed all 70 read back correctly assigned and the remaining 34
  (brands with no Agent on file) were correctly left alone. No schema change, no new code — purely a
  one-time live data-sync action requested directly, not part of any file-based feature.
- *2026-08-18 (prior):* Schedule Planner's day-cell tooltip now shows the brand's Agent and
  Country below its existing status/assignee text, and every native browser `title=` tooltip
  across the dashboard (34 sites in 14 files — Sidebar, Overview's Brands Performance badges,
  Score Summary, the 3 Breakdown components, Brand Tabs, Topbar, Review Removal Assessment,
  Platform Removed Badge, Account Usage Badges, Schedule Planner itself) was converted to the one
  shared `Tooltip.tsx` component (dark navy box, portal-rendered), per an explicit request to make
  tooltip design uniform dashboard-wide, matching Overview's existing Brands Performance style. New
  `buildCountryIndex` (`src/lib/scheduler/scheduleUtils.ts`) mirrors `buildAgentIndex`'s exact
  most-recently-updated-entry resolution rule, just reading `Country` instead of `Agent` — kept as
  its own function so `buildAgentIndex`'s existing PMS-push contract is untouched. `Tooltip.tsx`
  gained a `block` prop (fills a table cell/card/nav-row's full width instead of shrink-wrapping to
  content — the default, still correct for small icon/badge triggers), content silently no-ops when
  falsy (needed for Sidebar's collapsed-only labels), and a new `useTooltip` hook for the few
  triggers that couldn't be wrapped in a second `<span>`: `ScheduleCell`'s platform chip (would have
  moved keyboard focus off the element whose `:focus-visible` CSS drives its past-day ghosting) and
  the percentage-width bar segments in `BreakdownStatGrid`/`BreakdownRankedList` (a wrapper span
  would have broken `width:N%`, which resolves against the immediate parent). Both extracted into
  their own small components (`PlatformChip`, `BarSegmentButton` ×2) since a hook can't be called a
  variable number of times inside a `.map()` callback. Full suite (1185 tests) and build both pass;
  live-verified via Playwright — Schedule Planner's Amonbet Casino TP-removed chip now reads
  "Trustpilot: Removed / Agent: ANN / Country: Germany" in the unified navy design (matching the
  reporter's own screenshot), Score Summary's header/brand-cell tooltips and Overview's
  SuccessRateBadge tooltip render correctly, the collapsed Sidebar icon rail is unaffected, and the
  Proxy/Country Breakdown bar segments' `width:%` was measured via `getBoundingClientRect()` post-fix
  to confirm the layout-preservation approach actually works (85.7%/14.3% and 71.9%/28.1% both
  matched their labels exactly). A handful of already-interactive triggers (a `<Link>`/`<a>`/`<button>`
  inside a `.map()`, e.g. Score Summary's brand-name link, Brand Tabs' inline "Open link" icon,
  TabScheduleSection's brand-name link) were wrapped in the plain (non-hook) `Tooltip` component
  rather than refactored into their own components — a deliberate, accepted minor accessibility
  trade-off (an extra, visually-invisible focusable wrapper before the real link, i.e. one extra tab
  stop) rather than a broader per-site refactor for a purely cosmetic task. Found, but explicitly
  out of scope and left unfixed: `Login.tsx` has a real, pre-existing Rules-of-Hooks violation (an
  early `if (session) return <Navigate ... />` on line 12, before 7 more `useState`/`useEffect`
  calls) — reproducible today (triggers "Rendered fewer hooks than expected" the moment a persisted
  session resolves after mount) and unrelated to this task; see Known Issues.
- *2026-08-18 (prior):* Added self-service Brand Tab creation — any approved user can now create
  (and delete) a Brand Tab from the sidebar's "+ Add Brand Tab" affordance, with no code change and
  no deploy, finally reversing the decision Task 219 explicitly declined ("new tabs are rare
  structural events") at the user's own request. New `custom_tabs` table (migration
  `20260818130000_add_custom_tabs.sql`, applied live; `name` unique, `platforms text[]`,
  `created_by` actor email, full 4-policy RLS) is the source of truth. The 11 hardcoded tabs in
  `TAB_COLUMN_CONFIGS` are untouched and never mirrored into that table. A new pure, Deno-safe
  `src/lib/dynamicTabRegistry.ts` generates each dynamic tab's column list from one canonical
  template (the base TP set, plus an AG and/or CG block — deliberately not freely customizable, so
  anything created going forward has one consistent naming scheme unlike the 11 legacy tabs) and
  holds an in-memory registry that `tab-configs.ts`'s getters (`getTabColumns`, `getBrandNameCol`,
  `hasMultiPlatform`, `getTabPlatforms`) fall back to, so no per-tab logic anywhere needs to know a
  tab is "dynamic" vs. "hardcoded." `OPERATIONAL_TABS` (`src/lib/tabs.ts`) is mutated **in place**
  on register/unregister rather than reassigned, which is what lets all ~12 of its existing
  importers pick up a new tab with zero call-site changes. Frontend registration happens during
  `AuthContext`'s session bootstrap (before `ProtectedRoute` stops showing its spinner);
  `generate-weekly-schedule` registers once per invocation. Two rulings made mid-plan, both worth
  remembering: (1) the obvious wiring (`tab-configs.ts` importing `dynamicTabRegistry.ts`) would
  have closed a real circular import, since `tabs.ts` eagerly reads `TAB_COLUMN_CONFIGS` at its own
  top level — resolved with a synchronous resolver-injection pattern instead
  (`setDynamicColumnsResolver`, called as a side effect of `dynamicTabRegistry.ts`'s own module
  load), which has no promise and therefore no race window, but does mean an Edge Function that
  imports only `tab-configs.ts` is silently blind to dynamic tabs (now documented in a comment right
  at the setter); (2) `fetchCustomTabs` in the auth bootstrap fails open (`.catch(() => [])`) rather
  than rejecting the `Promise.all` and wedging `loading` at `true` forever — the same fail-open shape
  was applied to `generate-weekly-schedule`'s own call in the final fix wave, so a transient
  `custom_tabs` failure can't abort the weekly cron for all 11 real tabs.
  Built via 8 subagent-driven-development tasks with per-task review, then one whole-branch review
  whose 13 findings were all fixed in a single follow-up fix wave. The 4 that a per-task review
  could not have seen, and are the reason that review exists: three `OPERATIONAL_TABS` consumers
  (`SchedulePlanner.tsx`, `AddReviewAccountModal.tsx`, `EditEntryModal.tsx`) computed their tab
  dropdown options at **module scope**, snapshotting the array at import time and thereby falsifying
  the plan's core "zero call-site changes" claim for exactly the mid-session case the feature
  exists for; `AddBrandTabModal` and the delete-confirmation dialog were both `z-40` while the
  mobile drawer that opens them is `z-[45]`/`z-50`, making the whole feature unreachable on a phone;
  `generate-weekly-schedule` re-registered dynamic tabs every invocation without ever clearing
  stale ones, so a warm Deno isolate accumulated deleted tabs across invocations (the same
  isolate-state bug class as Task 178's entry-cache growth — fixed with a new `resetDynamicTabs()`);
  and `registerDynamicTabs`/`unregisterDynamicTab` had no guard against a `custom_tabs` row named
  after a hardcoded tab, which RLS alone permits, so a row named e.g. `'Hanan'` would have made
  `isDynamicTab('Hanan')` true and let an unregister splice a real tab out of `OPERATIONAL_TABS`.
  Also closed in that wave: slug-collision and slug-safety validation on the tab name (a name
  slugifying onto an existing tab's URL creates a permanently unreachable tab), a submit/close race
  in `AddBrandTabModal`, and a missing affected-row check on `deleteCustomTab`'s delete. Full suite
  (1185 tests) and build both pass. **Pending manual deploy:** `supabase functions deploy
  ai-assistant` (its system prompt's hardcoded tab list now discloses that dynamic tabs may exist —
  text-only change, nothing else in that function touched) and `generate-weekly-schedule`, which
  was already undeployed before this feature and now additionally carries the per-invocation
  registration. Spec:
  `docs/superpowers/specs/2026-08-18-self-service-brand-tab-creation-design.md`. Plan:
  `docs/superpowers/plans/2026-08-18-self-service-brand-tab-creation.md`. Task 232.
- *2026-08-18 (prior):* Schedule Planner → PMS sync now also carries Agent ↔
  Assignee. Push direction: when a cell activates, the brand's Agent (from
  its most-recently-updated entry — a brand's entries don't always agree on
  one Agent, e.g. Rooster Partners' Spinjo/Spinsup each have 3 — via new
  `buildAgentIndex` in `src/lib/scheduler/scheduleUtils.ts`) is matched
  case/whitespace-insensitively against the real "Forum Team" PMS roster
  (Ivan Pamonag, Operations Team, Leo Sulano, Ann, Jen, Lai — fetched live
  via `GET /api/teams/{id}`, not hardcoded) and set as the created task's
  assignee in the same PATCH call that already sets labels. No match (an
  agent not on the PMS team, e.g. a real "Venus" value in production data, or
  placeholder junk) leaves the task unassigned — never blocks creation. Pull
  direction, read-only: `pullScheduleFromPms` now also reports each linked
  task's current PMS assignee on every tab visit, shown as a tooltip addition
  on `ScheduleCell`'s existing chip (`Assigned to <name>`) — never written
  back to `brand_schedule` or `entries`, purely informational. Both live
  end-to-end round-tripped against the deployed function before shipping
  (push with a lowercase "jen" correctly resolved and assigned to the real
  PMS user "Jen"; a follow-up pull correctly reported it back), same
  create-then-delete verification discipline as every other live PMS check
  in this feature's history. Deployed the same session — see
  `supabase functions list` for current version.
- *2026-08-18 (prior):* Deployed `sync-schedule-pms` (`supabase db push` +
  `supabase secrets set PMS_API_TOKEN=...` + `supabase functions deploy sync-schedule-pms`,
  confirmed `ACTIVE` via `supabase functions list`) — the Schedule Planner → PMS task sync entry
  directly below is now live server-side. The first real deploy attempt failed outright
  (`WORKER_ERROR` on every invocation, no usable logs surfaced by the CLI) and needed two rounds of
  live debugging via a series of minimal diagnostic redeploys against the real function slug, since
  local `deno check`/`deno run` didn't reproduce either failure:
  1. **`src/lib/supabase.ts`'s `SITE_URL` export threw at module load, crashing the function before
     any request handling ran.** It guarded a `window.location.origin` read with only `typeof
     window !== 'undefined'` — true in Supabase's real Edge Runtime (which defines a `window`
     global), but `window.location` itself is undefined there, so `.origin` threw. No previously
     deployed function had ever imported this file (`notify-brand-removed` deliberately avoids all
     `src/lib` imports; `ai-assistant`'s only cross-imports are 2 small, unrelated files), so this
     was a real, latent bug that simply had nothing to trigger it before now. Fixed by also
     requiring `window.location` truthy before reading `.origin`.
  2. **Extensionless relative imports that `deno check` sometimes tolerated actually broke the real
     deploy bundler outright** (`"Module not found ... Maybe add a '.ts' extension"`), contradicting
     this file's own prior note (below) that `ai-assistant`'s successful deploy proved the bundler
     resolves these fine — that was only proven for the 2 small files `ai-assistant` actually
     imports, not this feature's much broader `queries.ts`-rooted chain. Fixed the 4 blocking
     imports across `countryFlags.ts`, `reviewRemovalAssessment.ts` (×3), and `tabs.ts` (needed by
     `generate-weekly-schedule` too, once *that* function is eventually deployed).
  Both fixes verified against the live deployed function directly (`curl`), not just locally: a
  `push` created a real task in the "Forum Team" PMS project and a real `schedule_pms_links` row, a
  `pull` returned cleanly, and both test artifacts were deleted afterward. One unrelated mistake
  made while debugging, worth recording: an early diagnostic request against the *already-deployed*
  `notify-brand-removed` function (used to sanity-check that service-role auto-injection works at
  all) was built with a syntactically-complete but semantically-fake payload — it passed that
  function's field validation and triggered 11 real notification emails with placeholder ("x")
  content to real approved users. No corrective action was possible after the fact (the function
  only sends, doesn't retract); flagged to the user directly when found. Still pending: add
  `VITE_SYNC_SCHEDULE_PMS_URL` to Vercel env and redeploy the frontend (see the Known Issues bullet
  below for the exact URL and the 2 remaining live-verification steps a final review flagged).
- *2026-08-18 (prior):* Added Schedule Planner → PMS task sync — activating a platform chip on
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
  `docs/superpowers/plans/2026-08-17-schedule-planner-pms-sync.md`. Task 231.

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

- **Correction (2026-08-20, verified live against the real Supabase project): most of this
  section's scattered "Pending manual deploy" bullets for `ai-assistant`, `generate-weekly-schedule`,
  `sync-schedule-pms`, and `review-removal-assessment` are stale — the actual functions were deployed
  at some point without this doc being updated (the same concurrent-session/no-worktree drift Task 246's
  own Recent Changes entry already flagged for this exact period).** Verified directly via
  `supabase functions list` and `supabase db query "select * from cron.job"` (read-only) rather than
  trusted from any doc:
  - `ai-assistant` — **ACTIVE, version 39** (redeployed just now, 2026-08-20, to close the one real gap
    found: v38, deployed earlier the same day, predated Task 246's paused-tab exclusion). Current
    behavior: correctly excludes archived tabs (Task 240) and paused tabs (Task 246), and resolves
    agent ownership from `brand_agent_assignments` (Task 242). No longer a pending item.
  - `generate-weekly-schedule` — **ACTIVE, version 8, deployed 2026-08-18.** The `generate-weekly-schedule-monday`
    `pg_cron` job (`0 1 * * 1`) is **active** in the live database — the weekly auto-generation cron
    described as "never deployed since Task 178" throughout this doc has in fact been running since
    2026-08-18. Real remaining gap: this deployed version predates Task 240's archived-tab and Task 246's
    paused-tab exclusion (both landed after 2026-08-18), so the Monday cron can still auto-generate a
    schedule for an archived or paused tab until it's redeployed — a real, narrow, low-frequency gap
    (only matters on a Monday for a tab archived/paused since 08-18), not a "feature doesn't exist" gap.
  - `sync-schedule-pms` — **ACTIVE, version 12, deployed 2026-08-20 23:35 local**, which already
    includes Task 247's `syncStatus` action and its final-review fixes. Backend is fully live for all
    three sync directions (push, pull, status).
  - `review-removal-assessment` — **ACTIVE, version 4, deployed 2026-08-25** (redeployed same-day
    to ship the Task 262 accuracy overhaul; migration `20260814150000_add_ai_review_analysis.sql`
    from the original feature is unaffected, still applied, still confirmed via `supabase migration
    list`, no pending migrations at all).
  - **Correction (2026-08-25, verified directly via Vercel CLI, not assumed): `VITE_REVIEW_REMOVAL_
    ASSESSMENT_URL` was NOT actually unset — it was already present in Vercel Production (set
    2026-08-14, the original feature's own deploy day).** The line below claiming it was still
    pending was itself stale, the same class of doc drift this whole note exists to flag. The
    frontend has since been pushed to `origin/main` and redeployed on Vercel (Production, confirmed
    Ready) with the Task 262 overhaul, so the "🤖 Analyze Review" button is now fully live end to
    end — no longer a pending item at all.
  - **What's still genuinely pending, confirmed absent from both local `.env` and (as best determined
    without Vercel CLI access in that session) production:** `VITE_SYNC_SCHEDULE_PMS_URL` in Vercel —
    the only remaining blocker for the Schedule Planner PMS sync (all 3 directions), whose backend is
    fully deployed and tested, waiting purely on this one frontend env var + a Vercel redeploy. Value:
    `https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/sync-schedule-pms`.
  Treat every "Pending manual deploy" bullet appearing *below* this note as potentially stale for the
  same reason — verify against `supabase functions list`/`supabase migration list` before re-doing or
  reporting on any of them, rather than trusting the bullet text alone.
- **Resolved (2026-08-26, Task 267).** `supabase functions deploy sync-schedule-pms` — deployed
  (version 14, confirmed `ACTIVE` via `supabase functions list`) the same session, along with the
  frontend push to `origin/main`. The Done-column/Project-Paused-column remap and the manual-per-
  day-pause fix (see the Recent Changes entry above) are both fully live. Not yet independently
  live-verified against a real PMS card move (no live browser session in this session) — worth
  confirming once a real slot settles or a day gets manually paused.
- **Pending manual deploy (2026-08-25, Task 264) — deploy order matters.** The per-platform review
  analysis storage fix + `get_review_analyses` Ask AI tool need:
  1. `supabase db push` (applies the `entry_review_analyses` migration) — should run before or
     alongside the frontend push. Unlike the Schedule Planner PMS precedent below, a missing table at
     this point degrades gracefully rather than breaking the page: `BrandGroup.tsx`'s cached-analysis
     fetch fails open (`.catch(() => [])`), so the tab's real data still loads and the "Analyze Review"
     section just shows no cached result until the migration lands.
  2. `supabase functions deploy ai-assistant` (ships `get_review_analyses`).
  3. `git push origin main` (frontend — the per-platform storage read/write and the `Entry` type
     cleanup).
  Live-verify once deployed: analyze TP on a multi-platform entry, then also analyze AG on the same
  entry, then reopen the TP section and confirm it still shows its own correct cached result (the
  exact regression this task fixes, not the wrong platform's result mislabeled "Outdated"); and ask
  Ask AI a real `get_review_analyses`-shaped question (e.g. "which agent has the most removal-risk
  flags") to confirm the tool round-trips against live data.
- **Pending manual deploy (2026-08-20, Task 247) — deploy order matters this time.** The Schedule
  Planner → PMS status sync feature needs:
  1. `supabase db push` (applies the `synced_status` migration) — **must happen before or
     immediately alongside pushing this branch's frontend code to `main`/production.** The
     whole-branch review found that `fetchSchedulePmsLinks`'s widened `select` (now including
     `synced_status`) will make PostgREST reject the query outright (`42703`, unknown column) if the
     migration hasn't been applied yet — and that function is already used by the two *existing*,
     already-live PMS sync directions (push-on-activate, pull due-date/assignee drift), not just the
     new feature. Until the migration lands, deploying this branch's frontend would silently break
     both of those working features: every Brand Tab schedule visit would throw a pull-drift error
     toast, and push-on-activate would stop creating PMS tasks with no visible error at all (the
     Edge Function catches the failure per-item and still returns 200).
  2. `supabase functions deploy sync-schedule-pms` (ships the new `syncStatus` action).
  3. Confirm via `supabase functions list` (new version, `ACTIVE`).
  No new Vercel env var needed — reuses the existing `VITE_SYNC_SCHEDULE_PMS_URL`. Live verification
  (edit an entry to Published/Removed/Pending/Done, confirm the linked PMS card moves to the mapped
  column; confirm a paused link never moves; confirm a second tab visit with no further status
  change doesn't flap the task back) was not performed this session — deferred to whoever runs this
  checklist, per this project's established pattern for undeployed PMS-sync changes.
- **Resolved for the manual-pause half (2026-08-26, Task 267) — Schedule Planner → PMS status sync
  still doesn't recognize a day cycled all the way back to blank ("no schedule at all").** Originally
  filed 2026-08-20 (Task 247) as: `resolvePmsSyncStatus` only looked at `brand_platform_pause` (the
  automatic, success-rate-triggered weekly pause), never the day's own `brand_schedule` status, so a
  calendar cell manually cycled to "Paused (manual)" resolved to `'active'` instead of being excluded.
  Task 267 fixed exactly that case, per the fix direction this bullet used to name: the status-sync
  effect (`TabScheduleSection.tsx`) now fetches `brand_schedule` rows for every distinct week its
  links point at and folds a manual per-day `'paused'` status into the same `isPaused` boolean passed
  to `resolvePmsSyncStatus`, which now returns a real `'paused'` target status (routed to the PMS
  "Project Paused" column) instead of `null`. Still open: a day cycled a *third* time back to blank
  (`nextStatus` cycles `active → paused → null`) has no `brand_schedule` row and no real entry
  evidence either, so it still resolves to `'active'` rather than being excluded — deliberately left
  alone since the user's Task 267 request only covered "manually paused"/"forced paused", not the
  blank state. Fix direction if ever needed: treat a link whose day resolves to `null` (no row, or a
  row with that weekday `null`) the same as `'paused'` in the resolver.
- **Resolved (2026-08-26, Task 277).** `Login.tsx`'s Rules-of-Hooks violation (found 2026-08-18,
  Task 233) is fixed — the `if (session) return <Navigate .../>` early return now runs after all
  hook declarations, so a persisted-session re-render no longer skips hooks.
- **Self-service Brand Tab creation was never live-browser-verified end to end (Task 232).** No
  browser-automation tool was available in any implementer's or reviewer's environment for the whole
  duration of that plan, so the full create → sidebar-appears → reload-persists → delete-blocked-
  while-entries-exist → delete-succeeds flow has only been verified by reading code and by unit
  tests. The `custom_tabs` migration is applied live, so this is verifiable at any time — worth doing
  before treating the feature as proven. Specifically worth checking in a real browser: (a) a
  newly-created tab appears immediately in the Sidebar **and** in Schedule Planner's / both entry
  modals' tab dropdowns without a reload (that's the exact gap the fix wave's finding 1 closed, and
  it's the one thing unit tests can't observe); (b) the "+ Add Brand Tab" flow works from the mobile
  drawer on a narrow viewport (finding 2's `z-40` → `z-50` fix); (c) the delete-blocked path shows
  the real "still has N entries" message rather than silently succeeding.
- **`custom_tabs.created_by` (an actor email) is readable via the `anon` key (Task 232).** The
  table's select policy is `using (true)`, matching every other flag/config table in this project.
  This is consistent with the pre-existing, already-documented condition that `entries` is fully
  public-readable via `anon` (see the `entries`/`bif_review_accounts` bullet further down) — it is
  not a new class of exposure, just one more column of internal-user data on the same footing. Worth
  folding into whatever deliberate decision is eventually made about tightening `anon` read access
  project-wide, rather than fixing in isolation.
- **`deleteCustomTab`'s entries-count guard is a TOCTOU race, accepted as-is (Task 232).**
  `deleteCustomTab` (`src/lib/queries.ts`) counts `entries` rows for the tab and then deletes the
  `custom_tabs` row in a separate round-trip, so an entry inserted for that tab in the window between
  the two calls would be orphaned (its `tab` value would point at a tab that no longer has a
  `custom_tabs` row). Deliberately not fixed: closing it properly needs a Postgres RPC/transaction,
  and `entries.tab` is a free-text string with no FK to `custom_tabs` anyway (matching how tab
  identity already works for the 11 hardcoded tabs), so an orphaned row is recoverable by
  re-creating the tab with the same name. Fix direction if ever needed: move both steps into one
  `security definer` RPC.
- **Pending manual deploy (2026-08-18, Task 232):** `supabase functions deploy ai-assistant` — its
  system prompt now discloses that Brand Tabs can be created in-app and that the hardcoded 11-name
  list may be incomplete, so the model should confirm via `list_tabs` instead of claiming a tab
  doesn't exist. Text-only change, no tool/schema code touched. Until deployed, the live assistant
  can still wrongly tell a user a dynamically-created tab doesn't exist. Separately,
  `generate-weekly-schedule` (already pending deploy before this feature, see its own bullet below)
  now also carries the per-invocation `resetDynamicTabs()`/`registerDynamicTabs()` call — not a new
  blocker, just one more reason that deploy matters: until it runs, a dynamic tab's weekly schedule
  only ever generates from the page-visit trigger.
- **Pending manual deploy, final step only (2026-08-18):** steps 1-2 of the Schedule Planner → PMS
  task sync feature's deploy checklist are done — the `schedule_pms_links` migration is applied
  (`supabase db push`), `PMS_API_TOKEN` is set, and `sync-schedule-pms` is deployed and confirmed
  `ACTIVE` (see the Recent Changes entry above, including two real bugs the deploy attempt itself
  surfaced and fixed). Only step 3 remains:
  3. Add `VITE_SYNC_SCHEDULE_PMS_URL=https://krxnupmhfiduduvvlumc.supabase.co/functions/v1/sync-schedule-pms`
     to Vercel env, then redeploy the frontend.
  Until that's done, `pushScheduleActivations`/`pullScheduleDrift` (`src/lib/schedulePmsSync.ts`)
  both silently no-op — activating a Schedule Planner chip behaves exactly as it did before this
  feature shipped, no broken UI in the interim, even though the backend is already live. Separately,
  `generate-weekly-schedule`'s own already-pending deploy (see the bullet below) still additionally
  needs `PMS_API_TOKEN` set before its push-wiring does anything — already set as a project secret
  now (done above), so nothing further needed there once that function itself is eventually
  deployed. Live-verify once the Vercel env var is set: open Schedule Planner, click a blank cell
  active on a real tab, confirm a real task appears in the "Forum Team" PMS project's To Do column
  with the right title/label/due date; then edit that task's due date directly in PMS, reload the
  tab, and confirm the calendar cell moves to match. Task 231. The backend half of this exact
  round-trip (API-driven push + pull, not a human editing via the PMS UI) was already live-verified
  directly against the deployed function during the debugging above. Two more verification
  sub-steps a final review flagged as gaps in that same walkthrough are still open, since they
  specifically require a human editing via the PMS UI, not the API:
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
- **Resolved (2026-08-26, Task 277).** The PMS pull-reconciliation effect (`TabScheduleSection.tsx`)
  now guards each drifted/deleted item with the same `brandPlatforms(brand).includes(platform)`
  check the push-direction status-sync effect already had, so a hidden/restricted/flagged-removed
  combo can no longer get an orphaned `active` day written into `brand_schedule`.
- **Schedule Planner ↔ PMS pull-reconciliation can silently desync on a partial write failure
  (accepted v1 limitation, Task 231).** `TabScheduleSection.tsx`'s pull effect applies its
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
- **Correction to the bullet below and to the `ai-assistant` deploy note above: extensionless
  relative imports DO break the real Supabase deploy bundler, not just local `deno
  check`/`deno test` (found and fixed 2026-08-18, deploying `sync-schedule-pms` — see Recent
  Changes above).** The 4 imports across `countryFlags.ts`, `reviewRemovalAssessment.ts` (×3), and
  `tabs.ts` were fixed (all now have explicit `.ts` extensions) because the real deploy of
  `sync-schedule-pms` failed outright on them (`"Module not found ... Maybe add a '.ts'
  extension"`) — this repo had assumed, based on `ai-assistant`'s successful 2026-08-14 deploy,
  that the real bundler tolerates extensionless imports in general; that was only ever proven for
  the 2 small, self-contained files `ai-assistant` actually cross-imports
  (`scheduleBrandConfig.ts`, `proxyAliases.ts`/`removedPlatformBrands.ts`), never for the much
  larger `queries.ts`-rooted chain other functions need. Both `sync-schedule-pms` and
  `generate-weekly-schedule` now deno-check clean and (for `sync-schedule-pms`) deploy clean. There
  are more extensionless relative imports still elsewhere in `src/lib` not yet reachable by any
  deployed or pending function's import graph (found via a repo-wide grep, 2026-08-18: `assistant.ts`,
  `brandExport.ts`, `portalSso.ts`, `realtime.ts`, `reviewTranslation.ts`, `scoreSummaryExport.ts`
  each have at least one) — each is a landmine for whichever future Edge Function first imports it
  transitively, the same way `supabase.ts`'s `window.location.origin` bug (below) and this exact
  import gap both sat undetected until `sync-schedule-pms` was the first to actually exercise them.
  Fix direction: audit and add `.ts` extensions repo-wide in `src/lib`, rather than fixing them
  reactively one deploy at a time.
- **`src/lib/supabase.ts`'s `SITE_URL` export could throw at Edge Function module-load time —
  fixed 2026-08-18, found deploying `sync-schedule-pms` (see Recent Changes above).** Guarded a
  `window.location.origin` read with only `typeof window !== 'undefined'`, which is true in
  Supabase's real Edge Runtime (it defines a bare `window` global) even though `window.location`
  itself is undefined there — so `.origin` threw, uncaught, at the top of the module, crashing the
  whole function on every cold start with an opaque `WORKER_ERROR` and no CLI-visible logs. Fixed
  by also requiring `window.location` truthy. Worth remembering for any future frontend-shared
  `src/lib` file that references `window`/`document`/other browser-only globals, even guarded: a
  `typeof window !== 'undefined'` guard alone is not sufficient proof the code is Deno-Edge-Runtime-safe.
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
- **Resolved (2026-08-26, Task 277).** `matchesPlatform` (`BrandGroup.tsx`) now shares the same
  `brandScoped` guard `displayKpis`/`displayTotals` already used, so the table and the KPI cards
  above it can no longer disagree on a flagged brand/platform.
- **Resolved (2026-08-26, Task 277) for Confirmed/Removed/Pending/Done — the landing-grid "missed"
  marker gap remains.** Schedule Planner's CSV/Excel export (`src/lib/scheduler/scheduleExport.ts`)
  now has 5 new `<Day> Evidence` columns (Removed/Confirmed/Pending/Done, or blank), built from the
  same `resolveDateEvidenceKind`/`dateStatusIndex` the calendar's own overlay uses — closing the gap
  where a confirmed ✓ or removed ✕ chip on screen exported as blank. The existing Mon-Fri plan
  columns are untouched. Task 250's landing-grid "missed" marker (a distinct greyed chip for a past
  day whose plan wasn't confirmed) still has no export equivalent — it's a preview/summary-only
  computation, not part of this export's per-tab `rowsByPlatform`/evidence lookup at all.
- **Schedule Planner's per-tab platform-count strip can now disagree with its own grid for past days
  (2026-08-24, Task 250).** `countActivePlatformSlots` (`src/lib/scheduler/scheduleUtils.ts`) now
  gates a past day's count on real evidence (`hasDateEvidence`) rather than the raw plan, and this
  same shared function feeds both the landing-grid preview's count AND `TabScheduleSection`'s own
  count strip — but `TabScheduleSection`'s grid cells below that strip (`ScheduleCell`/
  `calendarRenderer.tsx`) were deliberately left unchanged (still plan-based, with the existing
  past-day ghosting from Task 173). A past week can therefore show, say, "TP 3" in the strip while
  the grid below still renders 5 TP chips (ghosted/faded) for that same week — the strip counts only
  the 3 with real evidence, the grid still shows all 5 planned slots at reduced opacity. This is
  spec-sanctioned (`docs/superpowers/specs/2026-08-24-schedule-planner-executed-only-preview-design.md`
  explicitly scoped `ScheduleCell` itself out of this change) but was not called out as a visible
  consequence in that spec, and is the same class of plan-vs-evidence divergence Task 173 addressed
  on the grid alone. Fix direction, if ever needed: either evidence-gate `ScheduleCell`'s past-day
  rendering to match (a bigger, deliberately-deferred change), or add a distinct "confirmed"
  sub-count to the strip so the two numbers are legibly different metrics rather than looking like
  the same one.
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
- **Resolved (2026-08-24, Task 254):** Check Status used to silently widen to an unscoped sweep
  when 2+ values were selected for Agent/Proxy/Country/Status (and for a lone "No Proxy"). The
  live `StatusCheckScope` API (`BrandGroup.tsx` → `queries.ts` → `proxy-check-status` → EC2
  `status_server.py` → `matches_scope_filters`/`status_filter_matches` in `check_review_status.py`,
  shared by all 4 platform checkers) now accepts a real array per field with OR-within-field/
  AND-across-fields matching, same semantics as `brands` already had — selecting 2 proxies now
  genuinely checks only those 2, not everything. "No Proxy" is now a real backend value too
  (matches a blank/redacted `Proxy Used` field, mirroring `resolveProxyLabel`/`isRedactedProxyValue`
  in `src/lib/proxyAliases.ts`), and On Pause/Not Done are now real checkable statuses (substring-matched,
  mirroring `BrandGroup.tsx`'s own `isOnPause`/`isNotDone`) rather than silently matching zero rows.
  This directly superseded Task 253's confirm-before-widening modal (removed, since the thing it
  warned about no longer happens) and Task 252's on-pause/not-done toast workaround (removed, since
  a zero-result toast is accurate again now that these are real filters).
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
  (Task 231), this deploy also needs `PMS_API_TOKEN` set before `generateForTab`'s push-to-PMS
  wiring does anything — it silently no-ops without it, so this isn't a new blocker on top of the
  above, just one more secret to set at the same time; see the Schedule Planner → PMS task sync
  pending-deploy bullet above for the rest of that feature's own checklist.
- **Resolved (2026-08-25, verified live, not assumed):** this bullet's original "not deployed /
  env var not set" claim (2026-08-14) was already stale by the time Task 262 checked it — the
  migration, function, and Vercel env var were all already live, and only the frontend code itself
  needed a fresh deploy, which Task 262 shipped. The AI Review Removal Assessment feature (now
  including Task 262's accuracy overhaul) is fully live end to end; the "🤖 Analyze Review" button
  in Edit Entry works. See the correction note near the top of this section for the exact
  verification. Task 225 / Task 262.
- **Resolved (2026-08-26, Task 277) — `entries` stays fully public-readable via the `anon` key
  across all tabs (`using (true)`, deliberately kept for BIF Dashboard's `postgres_changes`
  subscription, which can't target a view), but the credential fields that used to live in its
  `data` jsonb are gone, both migrated out and now hard-blocked from ever returning.**
  `Password`/`Casino Password`/`Backup Code(s)`/`Authenticator*` (8 real header-spelling variants
  across the 33 tabs) moved into a new `entry_credentials` table with approved-users-only RLS
  (`20260826150000_add_entry_credentials.sql`), via `src/lib/entryCredentials.ts` (the one place
  that resolves every variant, on both `queries.ts`'s `insertEntry`/`updateEntryData` and
  `BrandGroup.tsx`'s read-side merge — every existing UI call site unchanged). A second migration
  (`20260826160000_add_entries_no_credential_keys_check.sql`) added a hard Postgres CHECK
  constraint rejecting all 8 keys from `entries.data` outright — applying it validated every
  existing row and found zero violations (definitive, not a manual spot-check), and any future
  write path (frontend, the EC2 `check_review_status.py` scraper, or anything unaudited) that
  tries to reintroduce one now fails loudly instead of silently leaking. Frontend deployed to
  Vercel Production the same session. See Task 277 in `docs/task-history.md` for a real, recurring
  anomaly the verification pass caught (4 pre-existing rows the original migration's UPDATE
  silently missed across 2 checks, root cause never identified) — the CHECK constraint is exactly
  the reason it no longer matters whether that class of gap is fully understood.
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
- **Resolved (2026-08-26, Task 277) — confirmed correct, not a bug.** Queried live `tab_schemas`
  directly for the Wizard of Odds tab: its real headers are exactly `WoO Review Status` and
  `Wizard of Odds`, matching `scoreSummary.ts`'s `PLATFORM_STATUS_KEYS`/`PLATFORM_DATE_KEYS` for
  `wo` character-for-character. WO pause detection, the removed-post indicator, `get_review_texts`,
  and the AI Review Removal Assessment's WO framing were never actually at risk from this.
- Recharts pinned to v2; revisit if a major upgrade is available at install time.
- No dedicated `/mentions` list view — Overview's recent-mentions table is the only path to detail. Revisit if filtering needs grow.
- Sentiment column is passthrough; classification deferred.
- The Google Sheet disconnect (2026-07-07) deliberately left `check-review-status` untouched: it still pushes changed rows to the Sheet via the Apps Script web app (`APPS_SCRIPT_URL`/`APPS_SCRIPT_SECRET` Supabase secrets) whenever a Check Status run detects a change. Revisit if a truly Sheet-free dashboard is required — either remove that push call or unset those two secrets on the function.
- **Resolved (2026-08-26, Task 277) — fully root-caused.** Live `tab_schemas` query confirmed
  Trybet's real header is `Brand Name`, not `Brands` — but `TAB_COLUMN_CONFIGS['Trybet']`
  (`src/lib/tab-configs.ts`) whitelisted `'Brands'`, a column that never existed in Trybet's real
  data, so `getBrandNameCol('Trybet')` wrote new brands to a key `BrandGroup.tsx`'s live-header-based
  resolution could never find — every Trybet row's brand read as empty, not just newly-added ones.
  Fixed by correcting the one config entry to `'Brand Name'`.
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
  `generate-weekly-schedule`'s own pending deploy (below) is finally run.
  **Correction (2026-08-18):** this only proved the pattern safe for these 3 specific small files —
  deploying `sync-schedule-pms` (Task 231, see Recent Changes/Known Issues above) hit a real deploy
  failure on a *different*, larger `queries.ts`-rooted import chain the bundler genuinely rejected
  over missing `.ts` extensions. "The bundler resolves extensionless imports fine" was never a
  general fact about the bundler — read it as "these exact 3 files are proven safe," not as
  license to assume any `src/lib` cross-import will deploy cleanly. Spec/plan for the
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
