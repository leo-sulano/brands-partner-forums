# Task History — Brands Partner Forum Dashboard

Complete log of all features and tasks completed from project start to present.

---

## Task 1: Initial Project Scaffold
**Date:** May 15, 2026

Set up the Vite + React + TypeScript + Tailwind v4 + React Router v7 project structure. Created Supabase schema with `mentions` and `sync_runs` tables. Stubbed all pages (Overview, MentionDetail, SyncStatus) and core components (Sidebar, Topbar, KpiCard, MentionsTable, StatusBadge, Toast).

---

## Task 2: Multi-Tab Architecture Migration
**Date:** May 15, 2026

Replaced the single-tab `mentions` schema with a multi-tab `entries` + `tab_schemas` design. One `entries` row stores all fields as JSONB keyed by `(tab, sheet_row_id)`. Rewrote all queries to use the new schema and added the `Entry`, `TabSchema`, and `SyncRun` TypeScript types. Added `import-tabs` and `push-to-sheet` Edge Functions.

---

## Task 3: Apps Script Web App Bridge
**Date:** May 18, 2026

Replaced Google service-account authentication with a Google Apps Script Web App acting as a bridge. Implemented `doGet` for reading tab data and `doPost` for writing edits back to the Sheet. This bypassed the need for a service account JSON and allowed Edge Functions to talk to the Sheet via HTTP.

---

## Task 4: Bidirectional Sync (Sheet ↔ Dashboard)
**Date:** May 18, 2026

Built the full bidirectional sync pipeline. `import-tabs` reads rows from the Sheet via Apps Script and upserts them into `entries`. `push-to-sheet` writes dashboard edits back to the Sheet. Added echo-loop prevention via `last_sync_tag` so a Sheet-triggered sync does not overwrite a recent dashboard edit. Rewrote queries to use the `entries` table with the `entryToMention` adapter.

---

## Task 5: Supabase Realtime Subscriptions
**Date:** May 18, 2026

Added Supabase Realtime support. `SyncStatus` page subscribes to `sync_runs` inserts so new runs appear live without a page refresh. `Overview` subscribes to `entries` changes for live KPI updates. Added debounce on bulk changes to avoid UI thrashing. Fixed unique channel names to prevent conflicts.

---

## Task 6: Brand Group Pages with Dynamic Columns
**Date:** May 18, 2026

Built the `BrandGroup` page — the core brand management view. Renders all entries for one tab in a paginated, sortable, searchable data table. Columns are rendered dynamically from `tab_schemas` headers. Added search, column sorting, page size selector, and jump-to-page controls. Fixed stale-load cancellation on tab navigation.

---

## Task 7: Tab Column Whitelists
**Date:** May 18, 2026

Added per-tab column configuration in `tab-configs.ts`. Each brand tab defines an ordered whitelist of columns to show, with optional label overrides (e.g. "TP/AG/CG Added" short labels). Configured all 9 operational tabs: TP Brand Injection, TP Affiliate, Rooster Partners, Revolution Casino, Trybet, SilverPlay, SuprPlay Limited, HazEmirates UAE, Hanan.

---

## Task 8: Edit Entry Modal
**Date:** May 19, 2026

Clicking any row in BrandGroup opens an edit modal with all tab columns pre-filled. User can edit any field and save — the change is written to Supabase and fire-and-forget pushed back to the Google Sheet. Boolean fields render as Yes/No dropdowns. Date fields are formatted as DD/MM/YYYY on open.

---

## Task 9: Platform Cards (TP / AG / CG)
**Date:** May 19, 2026

Added platform stat cards (Trustpilot, AskGamblers, CasinoGuru) to BrandGroup showing Live and Removed counts per platform. Cards are hidden for platforms not present in a given tab. Clicking a platform card filters the table to show only that platform's columns and hides the other platform cards.

---

## Task 10: Date Range Filter on BrandGroup
**Date:** May 19, 2026

Added a custom calendar date picker (DatePicker component) to BrandGroup. Filters entries by the platform-relevant date column (e.g. Trust Pilot date, AG date). Shows Published/Removed/Refused counts for the selected range. KPI cards update to reflect the filtered data. Date inputs replaced with a styled calendar dropdown.

---

## Task 11: Brand Filter & Proxy Filter Dropdowns
**Date:** May 19, 2026

Added a searchable brand filter dropdown to BrandGroup (source column is tab-aware). Added a proxy filter dropdown that derives unique proxy values from loaded entries and splices into the filter cascade. Both filters work in combination with status, platform, and date filters. Brand filter is hidden on single-brand tabs (Trybet, SilverPlay, HazEmirates UAE).

---

## Task 12: Status Filter & 7-Value Status System
**Date:** May 20, 2026

Applied a 7-value status system across all brand tabs: Published/Live, Removed, Refused/Not Published, Done, Pending, On Pause, Not Done. Added a status filter dropdown to BrandGroup. KPI cards count correctly per status — Live counts only Published; Removed counts Removed + Refused + Not Published. Done is excluded from both Live and Removed.

---

## Task 13: Add Review Account
**Date:** May 20, 2026

Added an "Add" button to BrandGroup that opens a full-field creation modal. New entries are written to Supabase and synced back to the Google Sheet. Supports all tab columns with the same form structure as the edit modal. Sync also fixed to bulk upsert instead of per-row updates for performance.

---

## Task 14: Security Hardening
**Date:** May 20–29, 2026

Moved `APPS_SCRIPT_SECRET` from URL query param to POST body to prevent it appearing in server logs. Migrated `SHARED_SECRET` from hardcoded value to Apps Script Script Properties. Removed `.claude/settings.json` from git tracking as it contained secrets.

---

## Task 15: Trustpilot Review Status Auto-Detection (Edge Function + Cron)
**Date:** May 21, 2026

Built the `check-review-status` Deno Edge Function that scrapes Trustpilot review pages to detect Published, Removed, or Refused status using text-signal parsing with multilingual coverage (10+ locales). Added a `Check Status` button to BrandGroup (TP tabs). Scheduled as a pg_cron job running every 3 days at 23:50 UTC. Every run is logged to `sync_runs`.

---

## Task 16: Overview Page Redesign
**Date:** May 21–22, 2026

Replaced the forum-mention-focused Overview with a brand operations summary. Added full-width KPI cards with color theming, a platform breakdown bar chart (TP vs AG vs CG via Recharts), per-brand-tab summary cards showing all status counts, and a date range filter that re-fetches filtered KPIs from all 9 tabs in parallel.

---

## Task 17: AG/CG Email-Based Status Detection
**Date:** May 21–29, 2026

Built an Apps Script email parser (`EmailParser.gs`) that reads Gmail for AskGamblers and CasinoGuru status notification emails, extracts the casino name and new status, and writes results back to the Google Sheet. Added a `logError_` tab for parse failures. Deployed to the live clasp project with a time-based trigger. Documented per-account inbox forwarding setup for the VA team.

---

## Task 18: Auth System (Login / Signup / Approval / Roles)
**Date:** May 22, 2026

Added full Supabase email + password authentication. Created a `profiles` table with `approved` and `role` fields, auto-populated via a DB trigger on signup. New users land on a pending-approval screen until an admin approves them. Added `Login`, `Signup`, and `ResetPassword` pages. Implemented `AuthContext`, `AuthProvider`, `ProtectedRoute`, and `useAuth` hook. Overview is public; all edit actions and admin pages require an approved session.

---

## Task 19: Admin Users Page
**Date:** May 22, 2026

Built the `AdminUsers` page (admin-only). Lists all users with their approval status and role. Admins can approve/revoke access, promote/demote to admin, and remove users with a two-click confirmation. All user management actions are logged to `admin_logs`.

---

## Task 20: Activity Log
**Date:** May 22, 2026

Added an `ActivityLog` page under the Admin section. Shows all edits made from the dashboard (not from the Sheet) — editor email, tab, account name, and timestamp. Sourced from entries where `last_edited_by = 'dashboard'`. Separated from Sync Status which shows sync-run history only.

---

## Task 21: Collapsible Sidebar & Sign In Button
**Date:** May 22, 2026

Reorganized the sidebar into collapsible "Brands" and "Admin" sections. Admin section (Sync Status, Log, Users) visible only to approved users. Users link visible to admins only. Sign In button added to Topbar for logged-out visitors.

---

## Task 22: TP Affiliate Tab
**Date:** May 25, 2026

Added a new brand tab for TP Affiliate. Configured its column whitelist with a "URL Page" column rendered as a named clickable link. Assigned a distinct icon in the Sidebar. Registered the tab in `OPERATIONAL_TABS` and fixed Apps Script to support the `op=dump` operation for hyperlink extraction.

---

## Task 23: Selenium Trustpilot Status Checker (Local Server)
**Date:** May 25, 2026

Built a Selenium-based stealth status checker that scrapes Trustpilot review pages locally to detect Published, Removed, or Refused status and extract the star rating. Deployed as a local API server with token authentication. Results write back to `entries` and push to the Sheet. Used as the manual "Check Status" path for TP tabs.

---

## Task 24: Sync Status Page Improvements
**Date:** May 25, 2026

Upgraded the `SyncStatus` page with date-grouped accordion view (click a date to expand individual runs), per-run error tooltips (hover to see HTML-stripped error message), status pills, row counts (seen/upserted/skipped), and tab name surfaced in error messages. Tooltip fixed to open downward and avoid clipping.

---

## Task 25: User Presence (Online Avatars)
**Date:** May 26, 2026

Added online user presence indicators in the Topbar. Shows avatar initials for all currently active users using Supabase Presence channels.

---

## Task 26: Score Summary Page
**Date:** May 28–29, 2026

Built the `ScoreSummary` admin page. Groups all Published entries by `${tab} ${brand}` and shows average star rating, 1–5 star distribution counts, unrated count, and a grand total bar. Scoped to the 9 operational tabs. Filterable by date range and brand. Parallelized entry paging to fix slow load on large datasets. Counts Published-only by design — Removed/Refused are excluded.

---

## Task 27: AI Assistant (GPT-4o-mini Chat Widget)
**Date:** June 2, 2026

Added a floating AI chat widget on all authenticated pages. Backed by the `ai-assistant` Deno Edge Function running OpenAI gpt-4o-mini in a tool-calling loop (up to 5 rounds) with 4 read-only tools: `list_tabs`, `query_entries`, `get_entry`, `get_score_summary`. Streams responses as Server-Sent Events token by token. On MentionDetail, "Summarize this" and "Draft a reply" buttons seed the chat with context. Widget injects current page URL and entity ID into the system prompt.

---

## Task 28: Project Documentation
**Date:** June 2, 2026

Wrote complete documentation for all 9 pages of the Forums Sheet Dashboard documentation tool: Project Overview, Requirements, System Architecture, Technical Design, Installation Guide, User Manual, Features & API Docs, Workflows, and Important Notes.

---

## Task 29: Ask AI Full-Page Chat
**Date:** June 4, 2026

Added a dedicated full-page Ask AI chat interface at `/ask-ai` (protected route). The page (`AskAI.tsx`) provides a focused chat experience without the floating widget overlay. Added "Ask AI" nav link to the sidebar. Suppressed the floating assistant widget when on the `/ask-ai` route to avoid duplication. Improved AI assistant accuracy: added month filter to `query_entries`, TP/AG/CG date and status column key mappings, and richer status vocabulary and data column descriptions in the system prompt.

---

## Task 30: Overview Per-Platform Badges & Import-Tabs Fix
**Date:** June 4–5, 2026

Added per-platform live/removed totals and TP/AG/CG badges to each brand tab card on the Overview page. Each card now shows a favicon-labeled breakdown (TP / AG / CG) with live and removed counts summed correctly per platform. Fixed a sync regression in `import-tabs`: when `check-review-status` was the last editor, a subsequent Sheet onEdit trigger would overwrite auto-detected statuses and scores. Now `import-tabs` merges DB values for status/score columns when `last_edited_by` is `check-review-status`, preserving automated detections through the next sync cycle.

---

## Task 31: Full Check Status
**Date:** June 8, 2026

Consolidated per-brand status checking into a single "Run Full Check" operation on the Sync Status page. A new Full Check section shows a live status table (published/removed/pending counts + brand names per tab) and a single button that runs `triggerStatusCheck` across all tabs sequentially. Each run saves a snapshot to localStorage (up to 30 retained) and displays in a collapsible Run History accordion. History rows show delta changes vs. the previous run (↑/↓N published/removed/pending); the first run shows absolute totals. The history surfaces only brands newly transitioned away from Published per run so noise is minimised. Also restored per-tab Check Status buttons in BrandGroup (kept alongside Full Check), restored platform favicon icons to sidebar brand tabs, and fixed the Brands column filter for tabs whose `tab_schemas` hadn't yet received a newly-added Sheet column.

---

## Task 32: Mobile Responsiveness
**Date:** June 9, 2026

Overhauled the dashboard layout for mobile screens. Sidebar redesigned with overlay/slide-in behaviour and a hamburger toggle for small viewports. Topbar rebuilt (137-line rewrite) to collapse nav items and surface the mobile menu trigger. DatePicker and pagination controls adjusted for touch-friendly sizing and layout on narrow screens.

---

## Task 33: EC2 Scraper & Operations Fixes
**Date:** June 18, 2026

Set up EC2 instance `scraper-leo` (t2.small, ap-southeast-1/Singapore) running `check_review_status.py` for scheduled and manual Trustpilot status batch runs. Added `docs/ec2-scraper-runbook.md` covering SSH access, script updates, Chrome version management, cron scheduling, cost controls, and full fresh-setup guide. Fixed TP review URLs incorrectly showing when the platform filter was restricted to CG or AG only (BrandGroup). Fixed score column confusion: `check_review_status.py` now writes star ratings only to the numeric "Score" column, no longer accidentally targeting the boolean "Score added" column.

---

## Task 34: Clickable KPI Cards with Brand Breakdown Modal
**Date:** June 18, 2026

KPI cards on the Overview page (Total Accounts, Live Reviews, Removed) are now clickable buttons. Clicking opens a modal showing a per-brand breakdown: count, proportional progress bar, and a direct link to that brand tab. Rows are sorted by count descending and filtered to non-zero entries. Taglines added below the grand total in the modal header. Escape key and overlay click close the modal.

---

## Task 35: EC2 Status Server Proxy + Supabase Edge Function
**Date:** June 18, 2026

Deployed `status_server.py` on EC2 bound to 0.0.0.0 (was localhost-only) so it accepts connections from the Supabase Edge Function. Added `supabase/functions/proxy-check-status` Edge Function that proxies dashboard check-status requests (POST `/check-status` and GET `/active-checks`) to the EC2 Flask server. EC2 URL is read from the `EC2_STATUS_URL` Supabase secret rather than hardcoded, so it survives EC2 IP changes. Raised Google Sheet push timeout to 30s with one retry on timeout to handle slow Sheets responses.

---

## Task 36: SuprPlay Limited Tab Sync Fix
**Date:** June 19, 2026

Diagnosed and fixed a data sync gap where SuprPlay Limited entries from June 15–19 were not appearing in the dashboard and 5 rows were missing IDs. Root cause: the Google Sheet tab had been renamed from "SuprPlay Limited" to "SuprPlay", causing `collectStructures` (Apps Script) and `import-tabs` to skip it entirely since both match against OPERATIONAL_TABS by exact name. The `onEdit` trigger was also not firing for the tab (same name mismatch), so new rows never received UUIDs in column A and `import-tabs` was skipping them anyway (empty `sheet_row_id` → `rowsSkipped++`). Fix: renamed the tab back to "SuprPlay Limited" in the Google Sheet, then ran `backfillAllTabIds()` to assign UUIDs to the 5 blank rows, followed by `syncToDashboard()` to trigger an immediate import.

---

## Task 37: Fix Double-Counting on Multi-Platform Brand Tabs
**Date:** June 22, 2026

Fixed a bug on multi-platform brand tab cards (Rooster Partners, Revolution Casino, SilverPlay, Hanan) where live and removed counts were being summed per platform (TP + AG + CG), causing one account live on all three platforms to count as 3 instead of 1. Switched Overview brand tab cards to use entry-level `kpis.live` / `kpis.removed` so counts are per account, not per platform-presence.

---

## Task 38: Status Bucket Simplification
**Date:** June 22, 2026

Merged all status variants into two display buckets: Live (Live + Published) and Removed (Removed + Rejected + Refused). Updated `queries.ts` status grouping logic and BrandGroup filter conditions to match. Simplified Overview brand tab card labels to "live" and "removed" and removed extra status counts, showing only the two core buckets. KPI cards and brand tab cards on Overview updated throughout.

---

## Task 39: Total KPI Card & Total Breakdown Modal
**Date:** June 22, 2026

Made the Total KPI card show live + removed combined (previously showed all-statuses count). Added clickable Live / Removed filter pill buttons on the BrandGroup page that toggle the status filter and reset pagination. Created the `TotalBreakdownModal` component: shows a proportional bar (green = live %, red = removed %), per-bucket counts with percentages, and per-brand breakdown rows sorted by count. Modal opens from the Total KPI card copy icon and closes on overlay click or Escape.

---

## Task 40: Clickable Total Row & Modal Label Cleanup
**Date:** June 22, 2026

Made the Total row in the Total Breakdown modal a clickable button that clears the status filter (resets to "All") and closes the modal, consistent with the Live and Removed rows. Shortened KPI modal titles on the Overview page from "Live / Published" and "Removed / Rejected / Refused" to "Live" and "Removed" for cleaner display.

---

## Task 41: Fix Ask AI Page (Rules of Hooks Violation)
**Date:** June 23, 2026

Fixed a React Rules of Hooks violation in `AssistantWidget` that crashed the Ask AI page. The early-return guard `if (location.pathname === '/ask-ai') return null` was placed after some hooks but before three `useEffect` calls, causing React to detect a hook count mismatch when navigating to `/ask-ai`. Moved the guard to after all hooks so the count is consistent on every render.

---

## Task 42: Remove Floating AI Assistant Bubble
**Date:** June 23, 2026

Removed the floating `AssistantWidget` bubble from the app layout while keeping the `/ask-ai` page and `ai-assistant` Edge Function fully intact. Removed `AssistantWidget` and `AssistantProvider` from `App.tsx`, and removed the Summarize / Draft reply buttons in `MentionDetail` that depended on the widget's `openWith` context.

---

## Task 43: Platform Breakdown Modal (Donut Chart Drill-Down)
**Date:** June 25, 2026

Added a `PlatformBreakdownModal` to the Overview page. Clicking a slice on the platform donut chart opens a modal showing a per-brand breakdown for that platform (TP / AG / CG) — count, proportional bar, and a direct link to the brand tab. Added to `Overview.tsx` alongside the existing chart component.

---

## Task 44: Sync Platform Filter to URL
**Date:** June 25, 2026

Platform filter state in `BrandGroup` is now reflected in the URL when the user clicks a platform card or selects from the dropdown. Navigating back or sharing the URL preserves the active platform filter. Also synced the Overview → BrandGroup navigation to pass the platform context through the URL.

---

## Task 45: AG/CG Review Link Columns (3-Platform Tabs)
**Date:** June 25, 2026

Added `AG Review Link` and `CG Review Link` columns to the three multi-platform brand tabs (Rooster Partners, Revolution Casino, SilverPlay, Hanan) in `tab-configs.ts`. Updated the platform filter column sets in `BrandGroup.tsx` so these link columns appear when the AG or CG platform filter is active.

---

## Task 46: Fix Reset Password Email Link (Localhost → Production)
**Date:** June 25, 2026

`resetPasswordForEmail` was using `window.location.origin` as the `redirectTo` base, which produced `http://localhost:5173` when triggered from the dev server — making the reset email link unreachable. Added `VITE_SITE_URL` env var and updated `Login.tsx` to use it with a fallback to `window.location.origin`. Also updated Supabase Auth Site URL and added the production redirect URL to the Supabase allowlist.

---

## Task 47: Inline Cell Editing & AG/CG Link Auto-fill
**Date:** June 25, 2026

Added inline cell editing to BrandGroup: clicking a TP Link, AG Review Link, or CG Review Link cell opens a small inline input instead of the full edit modal, letting users paste a URL directly in the table. Account column click still opens the full edit modal. AG Review Link and CG Review Link auto-fill the corresponding date column on save.

---

## Task 48: Row Selection, Duplicate & Delete
**Group:** Duplication
**Date:** June 25, 2026

Added a checkbox column to BrandGroup for multi-row selection. A floating action bar appears when rows are selected offering Duplicate and Delete actions. Duplicate creates copies with cleared status/link fields, appends " dup" to the Account field, resets sort, and returns the user to page 1 so new rows appear at the top. Delete requires typing "delete" in a confirmation modal before proceeding. Ghost rows (all data fields empty after dedup) are filtered out after duplication. Null-date rows float to the top when sorting a date column descending. TP link cleared on duplicate. Tab cache invalidated after insert so the count reflects immediately.

---

## Task 49: Fix Duplicate "dup" Suffix Field
**Group:** Duplication
**Date:** June 25, 2026

Moved the " dup" suffix from `Account Name` to the `Account` field so the unique identifier (e.g. "1219 | Silver | Norway dup") marks the duplicate rather than the display name.

---

## Task 50: AG/CG Selenium Scraper for Review Status
**Date:** June 26, 2026

### Automation
- AskGamblers and CasinoGuru review status now detected automatically via Selenium web scraping, replacing the previous manual email-forwarding approach
- Two new scripts (`check_ag_status.py`, `check_cg_status.py`) follow the same pattern as the TP scraper — load entries with checkable statuses, visit the review page, search for the reviewer's username (with Load More pagination up to 10 times), write back Published/Removed status and star rating
- Off-site redirect guards prevent false results when the browser bounces away from the platform domain
- Added `/check-ag-status` and `/check-cg-status` routes to `status_server.py`
- Added `triggerAgStatusCheck` and `triggerCgStatusCheck` to `queries.ts`

### UI / UX
- Check Status button upgraded to a split-button dropdown — multi-platform tabs show Check TP / Check AG / Check CG / Check All; TP-only tabs keep a plain button
- Platforms run sequentially to prevent JSONB read-modify-write races

---

## Task 51: UI Polish — KPI Compaction, WO Favicon, SyncStatus Links, Schema row_index
**Date:** June 26, 2026

### UI / UX
- KPI cards compacted — reduced min-height (100px → 76px) and font size (30px → 25px) for a tighter overview layout
- Tab names in Sync Status now link directly to their brand page — newly removed reviews flagged with a red `+N new` count badge

### Bug Fixes
- Wizard of Odds favicon now loads at full resolution across all pages — raised `sz` parameter from 16/32 to 64 in Sidebar, Topbar, BrandGroup, and Overview; WO logo renders at `size-7` in Overview
- Wizard of Odds platform badge and favicon types added to Topbar — WO brand pages now display the correct badge colour

### Database
- `row_index integer` column added to `entries` table with a `(tab, row_index asc nulls last)` index, enabling future sync writes to follow Google Sheet row order exactly

---

## Task 52: Sidebar Logo & Title Color Styling
**Date:** June 26, 2026

Replaced the generic `MessagesSquare` Lucide icon in the sidebar header with the `Brand-Partners-Forums.webp` brand logo image (30×30px). Styled the "Brands Partner Forum" title with split color: "Brands" and "Forum" in white, "Partner" in violet-400. Applied to both the desktop sidebar and the mobile slide-in drawer.

---

## Task 53: Wizard of Odds Apps Script Sync Fix
**Date:** June 26, 2026

Fixed the Wizard of Odds tab showing no data in the dashboard. Root cause: `Wizard of Odds` was missing from `OPERATIONAL_TABS` in `apps-script/Code.gs`, so the Apps Script `dump` operation never included that sheet tab. The `import-tabs` Edge Function had nothing to sync for it. Added `'Wizard of Odds'` to the `OPERATIONAL_TABS` array — after redeploying the Apps Script and running a sync, all 24 WO rows will populate.

---

## Task 54: Wizard of Odds Selenium Check Status
**Date:** June 26, 2026

Added Wizard of Odds review status detection via Selenium scraping on the EC2 scraper instance. New `check_wo_status.py` script follows the same pattern as the TP checker — loads WO entries with checkable statuses, visits the review page, searches for the reviewer, and writes back Published/Removed status and star rating. Added `/check-wo-status` route to `status_server.py`. The split-button Check Status dropdown in BrandGroup now includes a "Check WO" option for WO-only tabs.

---

## Task 55: Full Check Removed Badges & Auth-Gated Platform User Columns
**Date:** June 26, 2026

Added per-brand removed count badges to the Full Check Status section on the Sync Status page, surfacing newly removed entries by brand without requiring a drill-down. Hidden the `WO User`, `AG User`, and `CG User` columns from unauthenticated (logged-out) visitors — these columns are only visible to approved signed-in users, preventing leakage of internal account identifiers.

---

## Task 56: Auto-Refuse Stale WO Entries
**Date:** June 26, 2026

WO entries whose status is "Done" and whose last update is more than 1 day old are now automatically set to "Refused" by the check status run. Prevents stale "Done" entries from artificially inflating live counts. Also improved the check status toast messages to be more descriptive.

---

## Task 57: Column Sort Direction Fixes
**Date:** June 26, 2026

Fixed three related sort-direction bugs in BrandGroup: (1) date columns with an active sort now correctly show latest-first when the up-arrow indicator is shown; (2) rows with no date value always float to the bottom regardless of sort direction; (3) the initial/default sort for date columns defaults to latest-first when no explicit sort has been set by the user.

---

## Task 58: Unified /check-status Endpoint & Dashboard-as-Source-of-Truth
**Date:** June 26, 2026

### Architecture
- AG, CG, and WO status checks unified under a single `/check-status` Edge Function endpoint — callers pass a `platform` param (`tp` | `ag` | `cg` | `wo`) instead of hitting separate routes
- Sheet→DB auto-sync fully disabled: `syncToDashboard()` call removed from Apps Script `onEdit`, 30-min cron trigger deleted, and a one-time `deleteImportTrigger()` helper added for cleanup
- Supabase `entries` is now the single source of truth; the Sheet is a read-only downstream copy
- `triggerSync` export removed from `src/lib/queries.ts`; `IMPORT_TABS_URL` / `SYNC_FUNCTION_URL` constants removed from `src/lib/supabase.ts`

### UI
- SyncStatus page heading updated from "Sheet → Supabase sync" to "Sync Log" and "Run sync now" button removed — the page now shows outbound (DB→Sheet) and status-check run history only

### Cleanup
- Stale `VITE_IMPORT_TABS_URL` env var removed from type declarations and `.env.example`
- `EmailParser.gs` removed from the Apps Script project (AG/CG email detection fully superseded by Selenium scraping from Task 50)

---

## Task 59: Inline Edit Auto-Save (No Table Refresh)
**Date:** June 26, 2026

After saving an inline cell edit, the table no longer refreshes. Replaced the `reloadRef.current()` full-refetch call in `saveInlineEdit` (`BrandGroup.tsx`) with a targeted `setEntries` optimistic update that patches only the edited row in local state. The save is immediate and flicker-free — no round-trip to re-fetch the entire table.

---

## Task 60: AG Status Check Improvements — Proxy, Scroll, CAPTCHA & Status Progression
**Date:** June 27–29, 2026

### Automation
- Added per-entry proxy support for AG status checks — each entry can specify its own proxy, passed through `triggerAgStatusCheck` and the `check-status` Edge Function to `check_ag_status.py`
- Added scroll + extended wait (3s) in `check_ag_status.py` to catch lazy-loaded review tiles that don't render immediately
- Added CAPTCHA / blocked-page guard: if the page response is shorter than a threshold or contains block signals, the script skips updating the entry's status to avoid false removals
- Relaxed the `_page_blocked` length threshold and added page-length debug logging to tune the guard without re-deploying
- Added date-based AG status auto-progression: entries whose AG status is "Done" and whose AG Added date is older than a configurable threshold are automatically advanced to "Pending" on the next check run, keeping the queue fresh

---

## Task 61: Sort State Persistence & Brand Sequence Ordering
**Date:** June 27–29, 2026

### UI / UX
- Sort column and direction per brand tab now persisted in `localStorage` — refreshing or navigating away and back preserves the user's last sort choice
- TP Brand Injection and TP Affiliate tabs now sort by date first (latest-first), then by brand sequence within the same date, matching the expected operational order
- Removed user-initiated sorting from brand-name columns across all tabs — these columns follow a fixed sequence and sorting them alphabetically was misleading
- Renamed the sidebar section label from "Brands" to "Brand Tabs" for clarity

---

## Task 62: All Columns Inline-Editable with Edit Guards
**Date:** June 29, 2026

### UI / UX
- Extended inline cell editing to all data columns in the BrandGroup table — previously only TP/AG/CG link columns were inline-editable
- Account Name, Brand, and operational status/platform columns guarded from accidental inline edits — clicking these cells still opens the full edit modal
- Fixed a fallthrough bug where clicking an empty Brand / URL PAGE cell triggered inline-edit mode instead of being a no-op

---

## Task 63: Drag-to-Select & Long-Press Row Selection
**Date:** June 29, 2026

### UI / UX
- Added drag-to-select: clicking and dragging vertically across table rows selects them all in one motion without needing to tick each checkbox individually
- Long-press on any row activates checkbox mode and selects that row, mirroring mobile list-select conventions
- Dragging back over already-selected rows deselects them (rubber-band behavior) — releasing the drag finalises the selection

---

## Task 64: Duplicate Row Refinements
**Date:** June 29, 2026

### UI / UX
- Duplicate now stamps today's date into all platform Added date columns (TP Added, AG Added, CG Added) so duplicated rows sort to the top of date-descending views immediately
- Clears AG and CG status and review link columns on duplicate (previously only TP fields were cleared), ensuring new accounts start with blank platform state
- Copies all other fields from the source row (proxy, notes, etc.) so the VA only needs to fill in the platform-specific links
- " dup" suffix placed on the `Account` identifier field (the unique key); `Account Name` display field is copied unchanged
- Fixed URL Page column label displayed as "Brand" on TP Affiliate tab, and aligned the filter label to match

---

## Task 65: Bypass Supabase 1000-Row Server Cap
**Date:** June 29, 2026

### Bug Fixes
- Supabase enforces a server-side 1000-row default cap on select queries; large brand tabs were silently returning only their first 1000 entries, truncating data without any error
- Added paginated fetching (`range(0, 999)` → `range(1000, 1999)` → …) to all entry-load functions in `queries.ts` until a page returns fewer than 1000 rows, guaranteeing full dataset retrieval

---

## Task 66: EC2 & Sheet Push Reliability + Apps Script Col Map Fix
**Date:** June 29, 2026

### Infrastructure
- Resolved Chrome renderer crashes on the EC2 scraper instance caused by insufficient shared memory — added `--disable-dev-shm-usage` Chrome flag to all Selenium launch configs
- Removed redundant Google Sheet push calls from the status-check scripts (`check_ag_status.py`, `check_cg_status.py`, `check_wo_status.py`) — sheet sync is now the dedicated responsibility of `push-to-sheet`; doing it inside status scripts was causing race conditions and timeout failures
- Fixed Apps Script receiving incorrect column indices: the `push-to-sheet` Edge Function now sends a `col_map` (column name → Sheet column letter) derived from the tab's live header row, so writes land in the right cells even when columns are reordered in the Sheet

---

## Task 67: UI Polish & Minor Fixes
**Date:** June 29, 2026

### UI / UX
- Pre-filled Yes/No boolean dropdowns in the Add Review Account modal — fields default to "No" instead of blank, reducing missed fills
- Fixed "No Review" status badge rendering with black text (was unreadable on dark badge background)
- Fixed edit modal showing stale field values after an inline cell save — modal now reads from the locally-patched entry state rather than the last full fetch
- Uniform column width for the Agent column across TP Brand Injection and TP Affiliate tabs
- Entries with the same Added date now sorted by account number descending within that date group, giving a stable secondary sort order

---

## Task 68: Backfill Brand HREFs Edge Function
**Date:** June 30, 2026

Added a one-time `backfill-brand-hrefs` Supabase Edge Function that backfills the brand TP review page URL field across all existing entries where it was absent, linking each brand row to its correct Trustpilot review page.

---

## Task 69: Edit Modal — Brand Tab Reassignment
**Date:** June 30, 2026

Added a "Brand Reassignment" section at the top of the Edit Entry modal. A Brand Tab dropdown lists all operational tabs; selecting a different tab updates the Brand Name dropdown to that tab's brands. Saving with a different tab calls `moveEntryToTab`, which re-inserts the entry under the new tab key in Supabase. Single-brand tabs fall back to a free-text Brand Name input so no field is ever lost.

---

## Task 70: Collapsible Desktop Sidebar
**Date:** June 30, 2026

Desktop sidebar now collapses to an icon-only rail. `sidebarCollapsed` state is persisted in localStorage. In collapsed mode each brand group section is independently collapsible, showing only brand-tab icons. The collapse toggle moved to the bottom of the sidebar. Layout locked to `h-screen` so the toggle stays visible without scrolling. Brand logo and section icons sized correctly in both expanded and collapsed states.

---

## Task 71: Overview Brands Performance Redesign
**Date:** June 30, 2026

Renamed "Brand Tabs" to "Brands Performance" in sidebar nav and the Overview page heading. Added per-tab Lucide icons in violet-100/500 to each brand card in the grid. Platform summary cards redesigned: favicon in a colored ring, a smaller donut chart on the left, and a Published/Removed percentage legend on the right. Legend rows are clickable and open the same platform breakdown modal as clicking the donut slices.

---

## Task 72: Date Highlighting & Nav Style Polish
**Date:** June 30, 2026

Today's date cells in the BrandGroup table are now rendered bold+dark; older dates are faded, making recent entries immediately scannable. Today's date in the DatePicker calendar is highlighted with a stronger violet ring. Active sidebar nav item updated to violet. Removed the vertical border lines that were appearing before platform-specific columns in the BrandGroup table.

---

## Task 73: Add/Edit Modal Overhaul
**Date:** June 30, 2026

Complete redesign of both the Add Review Account and Edit Entry modals:
- **6-column grid layout** with clearly labeled platform sections (TP / AG / CG), each collapsed to a single row
- **Filter-style searchable dropdowns** replace all native `<select>` elements across status, brand, and boolean fields
- **Country auto-fill** — Add modal derives the Country field from the Account name on input
- **Sheet row paste** — pasting a tab-separated row copied from the Google Sheet auto-populates all fields in the Add modal, eliminating manual re-entry

---

## Task 74: Geo-Aware Proxy Routing for AG/CG/WO Scrapers
**Date:** June 30, 2026

Resolved a geo-restriction issue where EC2 Singapore returned a 27K-char blocked version of AskGamblers with no reviews section.

- Added `VITE_CHECK_AG_STATUS_URL` env var so AG/CG/WO checks route through the user's local residential-IP server while TP checks stay on EC2
- Built `geo_proxy.py` resolver that maps each entry's Country field to a country-specific Enigmaproxy `pproxy` bridge address
- AG and CG scrapers now detect their exit country (`detect_exit_country`) and restart with the correct geo proxy if misrouted
- Added `--country` CLI filter for targeted single-country runs
- Switched to local `pproxy` bridges (MV2 extension stopped working on Chrome 149)
- Documented all Enigmaproxy env vars and added a geo-proxy runbook section

---

## Task 75: Scoped Full Check — Tab/Brand Picker
**Date:** July 1, 2026

Added a tab/brand scope picker to the Check Status page so "Run Full Check" can target specific tabs/brands instead of always checking everything.

- New `FullCheckScopePicker` component: tri-state checkbox tree (tabs → brands), search filter, select-all/clear-all, live selection counter
- Fixed a brand-column-detection gap so "TP Brand Injection" and "TP Affiliate" now populate real brand lists (previously always empty)
- `handleFullCheck` now skips fully-unselected tabs and sends a `brands` filter for partially-selected ones; run history is labeled "Full run" vs. "Custom — X/Y tabs, A/B brands"
- Local Python status-check server (`scripts/check_review_status.py`, `scripts/status_server.py`) gained matching brand-level filtering, with a fix for a trim mismatch between the frontend's trimmed brand names and the backend's raw comparison that could have silently skipped whitespace-dirty rows in scoped runs
- Spec: `docs/superpowers/specs/2026-07-01-scoped-full-check-design.md`; Plan: `docs/superpowers/plans/2026-07-01-scoped-full-check.md`
- **Outstanding:** no live browser click-through was performed (app now requires login, no test credentials available) — verified via build, 18/18 Python tests, and 3 independent code reviews instead. A manual pass in the browser is still recommended before relying on it daily.

---

## Task 76: Edit/Add Modal — Paste Support & Field Cleanup
**Date:** July 1, 2026

- Added Ctrl+V paste support to the Edit modal, mirroring the Add modal's sheet-row paste behavior
- Added missing fields to the Add modal and wired up their paste-map offsets
- Removed the Casino Password field from the Add Review Account modal, then hid it from the Edit modal too, with a follow-up fix to correct the paste offset map after its removal shifted downstream columns

---

## Task 77: WO Tab Edit Modal — User Name/Surname Reorder
**Date:** July 1, 2026

- WO tab duplicate now auto-fills WO Date
- Iterated the WO edit modal layout so "User Name" reliably renders positioned after "Account Surname" — required several passes to fix whitespace/trailing-space mismatches in the matching logic before the reorder held consistently

---

## Task 78: Brand-Change Auto-fill & Link Data Quality
**Date:** July 1, 2026

- Auto-fill AG/CG profile link columns when the brand changes in the edit modal
- Switched brand-change link auto-fill from "first non-empty value found" to majority-vote across that brand's rows, so a handful of mistyped/copy-pasted outlier links can no longer get locked in as the canonical one; also excluded the TP link from brand-change auto-fill since it points to a daily review page, not a per-brand profile
- Deduped a duplicate "URL PAGE__href" header in TP Affiliate that was rendering two identical link fields in the edit modal, relabeled it "Brand Links", and hardened the sheet's hyperlink-extraction script so it won't re-emit the duplicate
- Added missing brand name spelling variants (Duelz.com, NY Spins, Silver Play, Novadreams) to the TP URL map so they match their exact DB spellings

---

## Task 79: Remove Google Sheet Write-Back
**Date:** July 1, 2026

Refactored the dashboard to write directly to Supabase only, dropping the write-back path to the Google Sheet.

- Removed `pushEntryToSheet()` and `PUSH_TO_SHEET_URL` entirely
- Dropped the `sheetRowId` param from `updateEntryData()` and updated all 3 call sites
- Removed `DASHBOARD_ONLY_COLS`, which only existed to filter fields before the sheet push
- Edge Function files left in place but are no longer called
- **Note:** this changes the sync model described in the `project_sync_architecture` memory (previously bidirectional Sheet↔Dashboard) to one-way Dashboard→Supabase only. Sheet→Supabase sync via `sync-sheet` is unaffected.

---

## Task 80: UI Polish — Row Selection Highlight
**Date:** July 1, 2026

Added a violet outline highlight to selected rows in the brand tables, making the current selection visually distinct from the rest of the table.

---

## Task 81: Close Auth Gap on Main Dashboard Routes
**Date:** July 2, 2026

Found that `ProtectedRoute` only wrapped the secondary pages (`/sync`, `/log`, `/ask-ai`, `/score-summary`, `/admin/users`) — the main dashboard routes (`/`, `/mentions/:id`, `/brands/:tab`) sat outside the guard and were reachable without logging in.

- Moved all dashboard routes inside `ProtectedRoute` in `App.tsx`, so the entire app now requires an approved session except `/login`, `/signup`, `/reset-password`
- Updated `CLAUDE.md`'s stale "Auth: none in app" architecture note to describe the actual Supabase Auth + admin-approval flow

---

## Task 82: Fix TP Status Reverting to "Done" After Check

**Date:** July 2, 2026

Fixed a bug where checking review status (TP, and by extension AG/CG since they share the same code path) would correctly detect "Published" and show it on the dashboard, but the status would silently flip back to "Done" shortly after.

- Root cause: `update_entry()` in `scripts/check_review_status.py` patched Supabase without setting `last_edited_by`. The `import-tabs` Sheet→Dashboard sync only preserves a row's status/score columns against a stale Sheet value when `last_edited_by === 'check-review-status'` — since that marker was never written, the next scheduled Sheet sync overwrote the freshly-detected status back to whatever was still in the Sheet.
- Fix: `update_entry()` now stamps `last_edited_by: 'check-review-status'` on every patch, activating the existing `import-tabs` protection.
- Added a regression test (`test_update_entry_marks_status_as_check_review_status_authoritative`) asserting the payload includes the marker.
- Restarted the local `status_server.py` + ngrok tunnel so the fix is live immediately.

---

## Task 83: Fix CG Status False-Positive "Published" Detection

**Date:** July 2, 2026

Fixed a bug reported live where CasinoGuru status checks marked reviews "Published" for accounts whose reviews were never actually posted or visible (confirmed on 2 real entries: Serenity9/OlympusBet, Lincoln4/LuckNation).

- Root cause: `fetch_cg_review()` in `scripts/check_cg_status.py` matched the username via a raw substring search over the full `page_source`. CasinoGuru embeds a hidden "users who found this helpful" like-tooltip (`class="tooltip-user-row"`) on every review that reuses the exact same author-name markup as a genuine review byline — so a user who merely clicked "helpful" on someone else's review (not authored one) matched and got marked Published. Confirmed live: the username never appeared in the page's rendered visible text (`body.text`) in either false-positive case.
- Fix: presence is now checked against the page's rendered visible text (which the hidden tooltip never populates) instead of raw HTML. Star-rating extraction still uses HTML context, but now skips any occurrence sitting inside a `tooltip-user-row` block when locating that context.
- Verified live against both known-bad entries (now correctly return "Removed") and one confirmed genuine published review on the same page (still correctly returns "Published").
- Checked AskGamblers (`check_ag_status.py`) for the same failure mode against 3 live entries — its review markup only appears in genuinely visible text, no hidden-tooltip reuse found — left unchanged since there's no evidence of the same bug there.
- **Follow-up (same day):** applied the same visible-text presence check to `fetch_ag_review()` in `check_ag_status.py` as a precaution — it shared the identical raw-`page_source` substring-match pattern with no confirmed live false positive, but the fix is low-risk. Verified against 2 genuine published AG reviews (still correctly return "Published"); full test suite (19 tests) passes.

---

## Task 84: Delete/Edit Audit Log with Restore

**Date:** July 2, 2026

Added full audit logging for account (profiles) and row (entries) deletes and edits, with admin-only restore. Previously both were permanent — a delete left no trace, and an edit only stamped who/when without keeping the prior value.

- New `delete_log`/`edit_log` tables (kept separate so rare deletes aren't buried under routine edit volume) snapshot the full row immediately before every delete/update in `queries.ts`, covering `deleteEntries`, `updateEntryData`, `updateMentionStatus`, `moveEntryToTab`, `deleteProfile`, and `updateProfile`.
- `/log` (`ActivityLog.tsx`) gained "Edits" and "Deletes" tabs alongside its existing feed, each with an admin-only Restore action; restoring an edit itself writes a new edit_log row so it can be undone again.
- RLS split by entity type: entry rows follow the existing anyone-can-read `entries` policy, account rows are admin-only-read like `admin_logs`. Restoring is admin-only for both, enforced at the RLS level for accounts (new `profiles` insert policy) and via the audit table's admin-only update policy plus the UI gate for entries.
- Spec: `docs/superpowers/specs/2026-07-02-delete-edit-audit-restore-design.md`. Plan: `docs/superpowers/plans/2026-07-02-delete-edit-audit-restore.md`.

---

## Task 85: Per-Brand Newly-Removed Drilldown on Check Status Run History

**Date:** July 2, 2026

Added a drilldown into `RunHistoryTable` so a completed Check Status run shows exactly which entries newly disappeared from each platform, broken out per brand, instead of only a total removed count.

- New `full_check_runs`/`full_check_removed_entries` tables record a per-platform snapshot of removed entries on every full check run (`recordFullCheckRun` in `queries.ts`).
- `diffRemovedEntries` (`src/lib/removedEntriesDiff.ts`, with Vitest unit tests — first test file in the repo, so added Vitest config/setup) computes the newly-removed set between consecutive runs.
- `fetchRemovedEntryDetails` reads back per-platform removal snapshots for a run; `RunHistoryTable.tsx` renders the per-brand diff groups inline, replacing ~165 lines of the old summary-only view in `SyncStatus.tsx`.
- Same-day follow-up fixes: corrected a diff-groups key-matching bug, aggregated diff groups by tab and allowed retry after a failed fetch, fixed a React key collision, and documented a counting-unit mismatch between the run summary and drilldown detail.
- Spec: `docs/superpowers/specs/2026-07-02-newly-removed-drilldown-design.md`. Plan: `docs/superpowers/plans/2026-07-02-per-brand-newly-removed-drilldown.md`.

---

## Task 86: AG/CG Password Fields on Entry Edit Modal

**Date:** July 2, 2026

Added AG/CG password fields to `EditEntryModal`, next to the existing AG User/CG User fields.

- Dashboard-only columns with no backing Google Sheet column, so `import-tabs` now merges them back from the existing DB row on every sync — otherwise the next scheduled Sheet resync would silently wipe them.

---

## Task 87: Add GRG – Gulf Recovery Group Brand Tab

**Date:** July 2, 2026

Added GRG (Gulf Recovery Group) as a new dashboard-only, TP-only brand tab — no Google Sheet backing; entries are created directly via the Add Review Account modal.

- Column config mirrors the other single-brand TP-only tabs (Trybet, HazEmirates UAE).
- Follow-up same day: added an Agent field matching SuprPlay Limited's TP-only template, then linked GRG's Trustpilot URL and widened its Agent column to match TP Affiliate.

---

## Task 88: Fix Add Review Account Modal — Agent Field Only Showed for GRG

**Date:** July 2, 2026

Fixed the Add Review Account modal's Agent field to appear for any tab whose column config includes it, not only GRG.

- Root cause: the field was gated by a hardcoded GRG-only tab check left over from adding GRG's Agent field. Replaced with a lookup against each tab's column config, so TP Affiliate, SuprPlay Limited, and Wizard of Odds also get the Agent input.

---

## Task 89: Fix Brand Name Free-Text Fallback for Single-Brand Tabs

**Date:** July 2, 2026

Fixed the Brand Name field rendering as free text instead of a dropdown in both the Add Review Account and Edit modals for single-brand, dashboard-only tabs like GRG, which have no historical brand data to populate the dropdown from.

- Falls back to `TAB_DEFAULT_BRAND` when a tab has no brand history, so GRG now gets the same dropdown UX as TP Affiliate.

---

## Task 90: Brand Drilldown as a Published/Removed Table

**Date:** July 3, 2026

Replaced the per-brand pill row in the Check Status run-history drilldown (`RunHistoryTable.tsx`) with a Brand/Published/Removed table, and redefined "Removed" to mean this run's newly-removed entries instead of each brand's cumulative removed total.

- Added `publishedBrandCounts` to `TabStatusRow` (`queries.ts`), mirroring the existing `removedBrandCounts` counter so each brand's whole current published total is available alongside its removed count.
- New `tabBrandGroups` helper sources table rows from the existing `diffGroups` (brands with ≥1 newly-removed entry this run), replacing the old `row.removedBrands` list — a brand with only historical removals and nothing new this run no longer gets a row.
- Click-to-expand behavior (individual newly-removed account/platform links) is unchanged, just moved from inline pills into the table.
- Built via brainstorming → plan → subagent-driven implementation (2 tasks, each independently reviewed) → final whole-branch review, all in an isolated worktree/branch merged back to `main` after tests and build passed clean.
- Spec: `docs/superpowers/specs/2026-07-02-brand-drilldown-table-design.md`. Plan: `docs/superpowers/plans/2026-07-02-brand-drilldown-table.md`.

---

## Task 91: Diagnose AG Status Check Failures — Add Persistent Error Logging

**Date:** July 3, 2026

Investigated a PMS ticket reporting "2 status checks failed" on AskGamblers, whose generic toast wording ("server may not be running") implied the local status server was down. Confirmed the server and ngrok tunnel were healthy — the `errors` count is actually per-*entry*, incremented in `check_ag_for_tab()` only when `fetch_ag_review()` raises during a single page scrape, most likely from an unwrapped `driver.page_source`/`current_url`/`title` call throwing after a swallowed 25s page-load timeout on a slow or Cloudflare-challenged AG page.

The exact two failing entries were unrecoverable: `start_status_server.ps1` launches Flask via `pythonw.exe` with no console and no output redirection, so every `print()` — including the per-entry `ERROR:` line — was silently discarded.

- Added `log_check_error()` in `check_review_status.py`, writing timestamped per-entry exceptions to `scripts/status_check_errors.log` via a dedicated non-propagating logger.
- Wired it into the four existing print-only exception handlers: TP's `fetch_status()`, and the per-entry loops in `check_ag_status.py`, `check_cg_status.py`, `check_wo_status.py`.
- No behavior change to status detection itself — purely additive diagnostics so the next failed check is actually investigatable. Full test suite (19 tests) still passes.
- Follow-up: `scripts/status_server.py` needs a restart (via `start_status_server.ps1`) to pick up the change — not yet restarted since that kills all `python`/`pythonw` processes on the host.

---

## Task 92: Fix Check Status Table Not Refreshing After Completion

**Date:** July 3, 2026

Fixed a bug where clicking "Check Status" (TP/AG/CG/WO) on a brand tab would run the check and update the database, but the visible table stayed on stale data — appearing to ignore the just-completed check while filters (status, platform, brand, agent, proxy) remained exactly as selected.

- Root cause: `fetchAllTabEntries` in `queries.ts` caches each tab's entries for 60 seconds (`tabEntryCache`). Every entry-mutating function (`updateEntryData`, `insertEntry`, `deleteEntries`, `moveEntryToTab`) calls `invalidateTabCache(tab)` right after writing — except the four Check Status trigger functions, which update `entries` via the Selenium backend but never invalidated the cache. The post-check reload (`reloadRef.current()`) could therefore silently serve the pre-check cached snapshot within the TTL window.
- Fix: added `invalidateTabCache(tab)` to `triggerStatusCheck`, `triggerAgStatusCheck`, `triggerCgStatusCheck`, and `triggerWoStatusCheck`, matching the existing convention used by all other entry mutators.
- Filter/sort/pagination state was already correctly preserved across reloads (same-tab reload path in `BrandGroup.tsx`) — only the underlying entry data was stale.

---

## Task 93: Country Column, Filter, and Sort on Brand Tables

**Date:** July 3, 2026

Added a "Country" column to every brand tab table, positioned immediately after "Account", with sorting and a dropdown filter.

- Country data was already flowing into every entry's row data (synced 1:1 from the Google Sheet into `entries.data['Country']`) — it was simply excluded from the per-tab column whitelist, so this was a whitelist + filter-wiring change, not a data-modeling one.
- `tab-configs.ts`: inserted `'Country'` immediately after `'Account'` in all 11 tab whitelists (`TAB_COLUMN_CONFIGS`), including the `Wizard of Odds` special case where `Account` is the 2nd array element rather than the 1st.
- Sorting required no code changes — `Country` isn't a link/status column and isn't in the `isNoSortCol` blacklist, so it became clickable-sortable automatically via the existing generic comparator.
- `BrandGroup.tsx`: added a `countryFilter` state, a case-insensitively-deduped `uniqueCountries` derivation, and a `countryFiltered` step in the row-filter chain — all mirroring the existing Agent/Proxy filter pattern exactly, including the `noun="countrie"` pluralization quirk so the dropdown reads "All countries".
- Built via brainstorming → design spec → plan → subagent-driven implementation (2 tasks, each independently reviewed) → final whole-branch review (Ready to merge: Yes, no Critical/Important findings), merged to `main` after tests and build passed clean.
- Spec: `docs/superpowers/specs/2026-07-03-brand-table-country-column-design.md`. Plan: `docs/superpowers/plans/2026-07-03-brand-table-country-column.md`.

---

*Last updated: July 3, 2026*

---
