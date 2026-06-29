# Monthly Summary Report
**Brands Partner Forum Dashboard · June 2026 · ~50 commits**

---

## Headlines

- Automated status detection across **all four platforms** (TP, AG, CG, WO) via Selenium on EC2 — eliminating the previous manual email-based approach entirely.
- Migrated to a **dashboard-as-source-of-truth** architecture: Sheet→DB auto-sync disabled, Supabase `entries` is now the authoritative record, the Sheet receives outbound writes only.
- Shipped a full **brand table editing suite**: inline cell editing, drag-to-select, duplicate/delete with confirmation, all with optimistic local updates and no table refresh.
- Launched the **Ask AI full-page interface** at `/ask-ai` backed by GPT-4o-mini with 4 read-only data tools; removed the floating widget to reduce visual clutter.

---

## 1. AI Assistant (GPT-4o-mini Chat) — Jun 2–23

- Added a floating chat widget on all authenticated pages, backed by the `ai-assistant` Edge Function running a tool-calling loop (up to 5 rounds) with 4 read-only tools: `list_tabs`, `query_entries`, `get_entry`, `get_score_summary`.
- Responses streamed token-by-token via Server-Sent Events; current page URL and entity ID injected into the system prompt for context.
- Added a dedicated **/ask-ai full-page interface** — focused chat without the overlay widget. Improved accuracy via month filter, TP/AG/CG date-column key mappings, and richer status vocabulary.
- Fixed a React Rules of Hooks violation in `AssistantWidget` that crashed the Ask AI page; removed the floating bubble from the app layout while keeping the `/ask-ai` page and Edge Function intact.

## 2. Full Check Status — Jun 8

- Consolidated per-brand status checking into a single **Run Full Check** operation on the Sync Status page — published/removed/pending counts with brand names per tab.
- Each run saves a snapshot to localStorage (up to 30 retained); Run History accordion shows **delta changes** vs. the previous run (↑/↓N published/removed/pending).
- History surfaces only brands newly transitioned away from Published per run, minimising noise. First run shows absolute totals.
- Restored platform favicon icons to sidebar brand tabs; fixed the Brands column filter for tabs with stale `tab_schemas`.

## 3. EC2 Scraper Infrastructure — Jun 9 & 18

- Set up EC2 instance `scraper-leo` (t2.small, ap-southeast-1) running `check_review_status.py` for scheduled and manual TP batch runs.
- Added `docs/ec2-scraper-runbook.md`: SSH access, Chrome version management, cron scheduling, cost controls, and full fresh-setup guide.
- Deployed `status_server.py` bound to `0.0.0.0` and added the `proxy-check-status` Supabase Edge Function. EC2 URL read from `EC2_STATUS_URL` secret — survives IP changes.
- Raised Google Sheet push timeout to 30s with one retry; fixed score column confusion (star ratings now write only to the numeric Score column).
- Mobile layout overhauled — sidebar slide-in overlay, hamburger toggle, DatePicker and pagination controls resized for touch.

## 4. Multi-Platform Selenium Status Detection — Jun 26

- **AG and CG Selenium scrapers** built (`check_ag_status.py`, `check_cg_status.py`) — Load More pagination up to 10 rounds; off-site redirect guards prevent false results.
- **Wizard of Odds** checker added (`check_wo_status.py`); WO tab added to `OPERATIONAL_TABS` in Apps Script fixing the missing-data gap.
- Check Status button upgraded to a **split-button dropdown**: multi-platform tabs show Check TP / Check AG / Check CG / Check WO / Check All; single-platform tabs keep a plain button.
- Platforms run sequentially to prevent JSONB read-modify-write races. Added per-brand removed count badges to Full Check and auto-refuse stale WO "Done" entries after 1 day.
- Added per-entry proxy support for AG checks; scroll + extended wait to catch lazy-loaded reviews; CAPTCHA/blocked-page guard to skip status changes on blocked responses.

## 5. Dashboard-as-Source-of-Truth Architecture — Jun 26

- AG, CG, and WO checks **unified under a single `/check-status` endpoint**; callers pass a `platform` param instead of hitting separate routes.
- **Sheet→DB auto-sync fully disabled**: `syncToDashboard()` removed from Apps Script `onEdit`, 30-min cron trigger deleted, `deleteImportTrigger()` helper added for cleanup.
- Supabase `entries` is now the single source of truth; the Sheet is a read-only downstream copy. `triggerSync`, `IMPORT_TABS_URL`, and `SYNC_FUNCTION_URL` removed from the frontend.
- SyncStatus page renamed to **Sync Log** — shows outbound (DB→Sheet) and status-check run history only. `EmailParser.gs` removed (AG/CG email detection superseded by Selenium).

## 6. Overview Page & KPI Improvements — Jun 22–25

- Fixed double-counting on multi-platform tabs — switched to entry-level `kpis.live / kpis.removed` so one account live on all three platforms counts as 1, not 3.
- Merged all status variants into two display buckets: **Live** (Live + Published) and **Removed** (Removed + Rejected + Refused). Updated queries and filter conditions throughout.
- KPI cards are now **clickable buttons** opening per-brand breakdown modals (count, proportional bar, direct link to tab). Total KPI card shows live + removed combined.
- Added **PlatformBreakdownModal** — clicking a donut chart slice shows a per-brand breakdown for that platform with proportional bars and tab links.
- Platform filter state now synced to URL; navigating back or sharing a link preserves the active platform filter.

## 7. Brand Table Editing & Row Management — Jun 25–29

- Added **inline cell editing** — clicking a TP Link, AG Review Link, or CG Review Link cell opens an input in the table without opening the full edit modal. Review link saves auto-fill the corresponding Added date.
- All columns made inline-editable (Jun 29); Account Name, Brand, and operational columns guarded from accidental edits.
- **Drag-to-select** rows by dragging across the table; long-press triggers checkbox mode; dragging back deselects. Floating action bar offers Duplicate and Delete when rows are selected.
- Duplicate: creates copies with cleared status/link fields, stamps today's TP/AG/CG Added date, sorts to top. Delete: requires typing "delete" in a confirmation modal.
- After save, table no longer refreshes — targeted `setEntries` optimistic update patches only the edited row in local state, eliminating flicker.
- Sort state persisted per tab in localStorage; brand sequence ordering fixed for TP Brand Injection and TP Affiliate tabs (date-first, then brand sequence).

## 8. Data Reliability & Bug Fixes — Jun 25–29

- Bypassed the Supabase **1,000-row server-side cap** via paginated fetches across all entry-load functions — previously silently truncating large datasets.
- Fixed three sort-direction bugs: date columns now default latest-first; no-date rows float to bottom regardless of direction; up-arrow indicator correctly reflects sort state.
- Fixed Reset Password email generating a localhost link from the dev server — added `VITE_SITE_URL` env var with production URL and updated Supabase Auth allowlist.
- Resolved sheet push failures and Chrome renderer crashes on EC2; removed stale sheet push calls from status check scripts.
- Added `WO User`, `AG User`, `CG User` column visibility gating — hidden from unauthenticated visitors. Sidebar replaced generic icon with brand logo; "Partner" segment styled in violet.

---

## Status at End of Month — Jun 29, 2026

| Area | State | Status |
|---|---|---|
| Status Detection | All 4 platforms (TP, AG, CG, WO) automated via EC2 Selenium scrapers with per-entry proxy support. | Stable |
| Data Architecture | Dashboard is source of truth; Sheet→DB sync disabled; outbound DB→Sheet write path only. | Stable |
| Brand Table Editing | Full inline editing, drag-to-select, duplicate/delete, optimistic updates — all shipped. | Stable |
| AI Assistant | Full-page /ask-ai live. Floating widget removed. Edge Function deployed. | Stable |
| EC2 Infrastructure | Scraper running; 1,000-row pagination fix applied; Chrome crashes resolved on status server. | Stable |
| Outstanding | CG and WO proxy coverage limited — AG now has per-entry proxy; CG/WO proxy parity TBD. | Pending |

---

*Generated 2026-06-29 · Brands Partner Forum · Optinet Solutions*
