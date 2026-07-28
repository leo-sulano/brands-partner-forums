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

- Country data was already flowing into most tabs' entry row data (synced 1:1 from the Google Sheet into `entries.data['Country']`) — it was simply excluded from the per-tab column whitelist. Two tabs (SuprPlay Limited, Wizard of Odds) turned out to have no Country column in their source sheet at all; see Task 94.
- `tab-configs.ts`: inserted `'Country'` immediately after `'Account'` in all 11 tab whitelists (`TAB_COLUMN_CONFIGS`), including the `Wizard of Odds` special case where `Account` is the 2nd array element rather than the 1st.
- Sorting required no code changes — `Country` isn't a link/status column and isn't in the `isNoSortCol` blacklist, so it became clickable-sortable automatically via the existing generic comparator.
- `BrandGroup.tsx`: added a `countryFilter` state, a case-insensitively-deduped `uniqueCountries` derivation, and a `countryFiltered` step in the row-filter chain — all mirroring the existing Agent/Proxy filter pattern exactly, including the `noun="countrie"` pluralization quirk so the dropdown reads "All countries".
- Built via brainstorming → design spec → plan → subagent-driven implementation (2 tasks, each independently reviewed) → final whole-branch review (Ready to merge: Yes, no Critical/Important findings), merged to `main` after tests and build passed clean.
- Spec: `docs/superpowers/specs/2026-07-03-brand-table-country-column-design.md`. Plan: `docs/superpowers/plans/2026-07-03-brand-table-country-column.md`.

---

## Task 94: Fix Empty Country Column on Tabs With No Sheet-Side Country Data

**Date:** July 3, 2026

User QA on Task 93 found the new Country column empty on two tabs. Root-caused by querying the live `entries` table directly rather than guessing: 9 of 11 brand tabs have a real `Country` column in their Google Sheet and synced fine. `SuprPlay Limited` (409 rows) and `Wizard of Odds` (38 rows) have no `Country` column in their sheet at all — the field is simply absent from `entries.data`.

- `SuprPlay Limited`: every single Account value ends in the identical suffix `"NNN - UK Reviews"` — the whole tab is UK-only, so there's no per-row country to parse, just a constant.
- `Wizard of Odds`: Account text reliably embeds the country as the last segment of a delimited string — `"550 l Hanan l Australia"` (rows copied from Hanan-sourced accounts, delimiter is a literal lowercase "l") or `"1182 | Test | Norway"` (delimiter is a real pipe). Confirmed 36/36 affected rows parse cleanly.
- Added `getEntryCountry(data, tab)` in `tab-configs.ts`: returns the real synced `Country` value if present, else derives one from Account text (`deriveCountryFromAccount`), else falls back to a new per-tab `TAB_DEFAULT_COUNTRY` map (mirrors the existing `TAB_DEFAULT_BRAND` pattern) — currently just `{'SuprPlay Limited': 'UK'}`.
- Wired into every place Country is read in `BrandGroup.tsx` — cell display (both the editable and read-only render branches), `uniqueCountries`, the `countryFiltered` predicate, and the sort comparator — so display, filter, and sort all agree instead of only fixing the visible cell.
- TDD: `tab-configs.test.ts` covers real-value passthrough, both Account delimiter styles, the per-tab default fallback, and the true-empty case. `npm run build` passes.
- The one function that already derived Country from Account (`EditEntryModal.tsx`'s inline edit handler) only fires live when a user manually re-saves that row's Account field — it was never a bulk backfill, which is why only 2 of 38 Wizard of Odds rows had a real value before this fix. Confirmed via code review that Add Review Account, Duplicate Account, and Move-to-tab do **not** auto-derive or persist Country either — this fix is display/sort/filter-only, computed at read time, never written back.
- Follow-up fix (same day): Duplicate Account appends `" dup"` to the Account text (`handleDuplicate` in `BrandGroup.tsx`), which corrupted the derived country for duplicated Wizard of Odds rows (e.g. `"Australia dup"` instead of `"Australia"`). `deriveCountryFromAccount` now strips one or more trailing `" dup"` suffixes before parsing. 13/13 tests pass.

---

## Task 95: Keep Checked Rows Visible With Live Status Until the View Is Re-filtered

**Date:** July 3, 2026

User reported that after Task 92's cache-invalidation fix, rows still appeared to need a filter/page click before a just-checked status (e.g. Done → Published) showed up in the right bucket. Investigation found no stale-render code path — `BrandGroup.tsx` has no memoization, so `filtered`/`sorted`/`pageRows` recompute fresh on every render off the live `entries` state. Clarified with the user that the actual want was the opposite of "instant auto-move": when a user filters to a status bucket (e.g. Done + Ask Gambler) and runs a check, they want rows that just changed to stay visible in that same list — with their new status shown in place — so they can see what the check just did, rather than having the row vanish the instant it's re-classified. Only a deliberate filter/sort/search/page interaction should cause the view to re-filter and drop the row into its real bucket.

- Added a "Refreshing statuses…" indicator (next to "Last checked") that's visible from when a check finishes until the post-check refetch actually lands — makes a previously-invisible network round-trip visible instead of the table looking frozen.
- Added `checkedViewSnapshot`: captures the visible row ids plus a signature of every active filter/sort/search/page value at the moment "Check Status" is clicked. While the current signature still matches, `pageRows` renders that exact snapshot of ids — looked up live from `entries`, so status pills reflect the latest check result — instead of recomputing from the active filters. Changing any filter, the platform toggle, sort, search, page size, or Prev/Next invalidates the signature and lifts the freeze immediately.
- KPI/summary totals (Live/Removed counts, per-platform cards) were already derived independently of `pageRows` and continue updating immediately — only the row-level table list freezes.
- `npm run build` passes.

---

## Task 96: Auto-Derive and Persist Country From Account

**Date:** July 3, 2026

Task 94's `getEntryCountry` fallback was read-time only — it never wrote anything back, and the write paths were inconsistent: Edit Account only derived Country live-as-you-type and only for the `" | "`-delimited shape; Add Review Account never derived it at all; Duplicate Account copied whatever was already stored. User asked to confirm the exact expected behavior (edit `"1303 | Test | Norway"` → `"...Germany"` should update Country to Germany) and then requested it be made automatic everywhere.

- Added `getCountryForAccount(account, tab)` in `tab-configs.ts` — the single write-time derivation rule (reuses Task 94's delimiter/"dup"-strip parsing, falls back to the tab default). Refactored `getEntryCountry` to delegate to it instead of duplicating the logic.
- **Edit Account** (`EditEntryModal.tsx`): swapped the old `' | '`-only ad-hoc split for a call to `getCountryForAccount`, so it also picks up the `l`-delimiter and per-tab default the old logic couldn't.
- **Add Review Account** (`AddReviewAccountModal.tsx`): the Account field's `onChange` now also live-derives Country (previously a fully independent manual field). Sheet-row paste is unaffected — it still fills Country from its own pasted cell.
- **Duplicate Account** (`BrandGroup.tsx` `handleDuplicate`): now recomputes Country from the duplicate's final (`" dup"`-suffixed) Account text against the target tab, instead of copying the source row's stored value as-is.
- All three write sites call the exact same `getCountryForAccount(account, tab)` signature with contextually-correct tab resolution (insert-target tab for Add/Duplicate, save-target tab for Edit) — confirmed by the final review to produce identical Country values for the same Account text regardless of which flow touched it.
- Built via brainstorming → design spec → plan → subagent-driven implementation (4 tasks, each independently reviewed) → final whole-branch review (Ready to merge: Yes, no Critical/Important findings), merged to `main` after 38/38 tests and `npm run build` passed clean. Manual interactive verification was limited to a headless boot/console-error check — the app's login wall blocks unattended click-through without test credentials.
- Spec: `docs/superpowers/specs/2026-07-03-auto-derive-country-from-account-design.md`. Plan: `docs/superpowers/plans/2026-07-03-auto-derive-country-from-account.md`.
- Out of scope (unchanged): no backfill of existing rows — Country only (re)computes the next time a row's Account is touched via Add/Edit/Duplicate; Task 94's read-time fallback still covers untouched legacy rows for display/sort/filter. No recomputation on tab-switch alone. Editing the Country field directly remains a plain manual edit.

---

## Task 97: Diagnose "Check AG Status Only Works on 2 Tabs" — Headless Chrome Blocked by Cloudflare

**Date:** July 3, 2026

User reported that clicking "Check AG" only produced real results on SilverPlay and Revolution Casino, not Rooster Partners or Hanan (all four have `AG Review Status` columns per `tab-configs.ts`). Ruled out a tab-specific cause first: Supabase data showed eligible entries (link + user + checkable status) in all four tabs, and `getTabPlatforms` gates the UI button on the same column check for all four — nothing in the code path singles out 2 tabs.

- Found the actual `status_server.py` process was running headless (`start_status_server.ps1` was last started without `-NoHeadless`). AskGamblers sits behind Cloudflare, which blocks headless Chrome outright but clears for a real headful browser — already documented in `geo_bridge.py`'s `ensure_display()` comment, but that function only forces non-headless on Linux/Xvfb; on Windows (no Xvfb) it silently stays headless.
- Reproduced directly: called `fetch_ag_review()` against one sample entry from each of the 4 AG tabs. Headless → all 4 got a ~27KB Cloudflare "Just a moment" challenge page (correctly detected and skipped as `__skip__`, so no error was ever raised — the check just silently never finds anything). Non-headless → all 4 got real ~800KB pages with actual review content.
- Verified the fix end-to-end through the real `/check-ag-status` endpoint (not a bypass) against Hanan's full 11 eligible entries with the server restarted `-NoHeadless`: `{"checked":11,"errors":0,"sheet_errors":0,"updated":0}` — clean run.
- This means the "2 working tabs" framing was misleading — the block was global (any tab checked while the server ran headless would silently fail), not tab-specific. SilverPlay/Revolution Casino "working" was most likely observed at a time the server happened to be running non-headless.
- Operational fallout from debugging: repeated hard-kills of the server process while iterating left ~30 orphaned `chrome.exe` child processes (Selenium's `driver.quit()` throws `WinError 6` on this Python 3.14 / undetected-chromedriver combo and doesn't actually terminate the process tree) — cleaned up (left the user's real browser window, identified by its actual window title, untouched). Also left port 5001 (the real port the dashboard hits via ngrok) in a stuck/orphaned-listener state that a plain process restart couldn't clear — not a WSL/Docker NAT exclusion (checked). User opted to clear it with a reboot rather than further live troubleshooting.
- Action still pending (user-side): after rebooting, run `start_status_server.ps1 -NoHeadless` once — no code changes are required, the existing `ensure_display()`/headless fallback logic already does the right thing on Linux; Windows just needs the flag passed explicitly at launch.
- No source changes in this task — diagnosis and operational fix only.

---

## Task 98: Fix CG Status Check Silently Writing False "Removed" on Cloudflare Block

**Date:** July 3, 2026

While confirming Task 97's fix also covered CG (user asked "is AG and CG both working now?"), found `check_cg_status.py` had no equivalent of AG's `_page_blocked()` guard. CasinoGuru sits behind the same Cloudflare challenge as AskGamblers, so a headless run hitting the block would fall through `fetch_cg_review`'s "user not found" path — which, for any entry whose current status was `"published"`, hard-codes the result to `("Removed", None)`. Unlike AG's silent `__skip__`, this actively **overwrites good data** with a wrong status in both Supabase and the Sheet.

- Reproduced directly: 2 real `published` CG entries (Hanan, Revolution Casino), checked headless, both came back `"Removed"` — the page never loaded (Cloudflare "Just a moment", 27KB), not because the review was actually gone.
- Found matching evidence already in production: 3 Hanan CG entries (AidenC8, Serenity9, Lincoln4) got written to `CG Review Status = Removed` by `check-review-status` within the same 15-second window on 2026-07-02 — the signature of one blocked Chrome session working through consecutive entries. Rechecked all 3 non-headless post-fix; none were found even on a fully-loaded real page, so this specific historical batch couldn't be conclusively confirmed as false positives (could be genuinely removed since, or a separate detection gap) — left as-is rather than guessing; the next real CG check on Hanan will re-evaluate them correctly under the fixed logic.
- Fix: moved `_page_blocked()` out of `check_ag_status.py` into `check_review_status.py` as a shared `page_blocked()` (both AG and CG need identical detection), updated AG's import, and added the same first-page block check to `check_cg_status.py` before it draws any "not found" conclusion. Also added CG's missing scroll-to-trigger-lazy-load step (AG already had it; CG never did, a separate possible detection gap).
- Added 4 unit tests for the shared `page_blocked()` (challenge title, other Cloudflare titles, tiny page, and a real-page-with-"captcha"-in-a-script-tag negative case) — full suite now 23/23 passing.
- Verified live: the same 2 previously-false-"Removed" entries now correctly return `__skip__` under headless/blocked conditions, and a known-published entry still correctly returns `"Published"` non-headless with the new scroll step (no regression).
- `check_wo_status.py` (Wizard of Odds) has the identical missing-guard pattern (hard-codes `"Removed"` on not-found with no block check) — not fixed here since WO wasn't part of what was asked and it's unconfirmed whether wizardofodds.com sits behind the same Cloudflare gate. Flagged for the user to decide on separately.

---

## Task 99: Hide the Non-Headless Chrome Window; Fix `.bat` Regressing to Headless

**Date:** July 3, 2026

After the user rebooted to clear the stuck port 5001 (Task 97), found the server had already been (re)started headless twice via `start_status_server.bat` — a second, undocumented launcher that hardcodes a plain `pythonw status_server.py` with no flags, silently reverting the Task 97/98 fix. Separately, the user asked whether AG/CG could run headless again to avoid a visible Chrome window popping up during checks.

- Explained the tension: true headless is exactly what Cloudflare blocks (confirmed root cause, Task 97) — going back to headless would restore the bug. Proposed the standard middle ground instead: keep Chrome non-headless (so it still passes as a real browser) but move its window off-screen, functionally invisible without tripping the headless fingerprint.
- `build_driver()` in `check_review_status.py` now adds `--window-position=-2400,-2400` whenever `headless=False`. Verified live: `driver.get_window_rect()` confirms the window renders at `(-2400, -2400)`, and a real AG check against a known entry still returns the correct real page (789KB) and status (`Published`) — Cloudflare bypass unaffected.
- Fixed `start_status_server.bat` to pass `--no-headless` (previously bare `pythonw status_server.py`, defaulting to headless) so either launcher now produces the correct, working configuration.
- Cleaned up the 3 redundant `pythonw` processes left over from the reboot (one from an earlier `.ps1` launch, two from the `.bat`) and did a single clean restart via `start_status_server.ps1 -NoHeadless` — healthy on first health check.
- `npm`-equivalent for this project (`pytest`): 23/23 passing, no regressions.

---

## Task 100: Discover Production AG/CG Checks Actually Run on EC2, Not Locally — Deploy Fixes There

**Date:** July 3, 2026

While exploring whether AG/CG/WO could run entirely on EC2 (avoiding the local-machine Chrome-window/port issues from Tasks 97–99), checked Vercel's environment variables and found **`VITE_CHECK_AG_STATUS_URL` was never set in production**. `src/lib/supabase.ts:26` falls back to `VITE_CHECK_STATUS_URL` when it's absent — which already points at the `proxy-check-status` Supabase Edge Function → EC2, the same path TP uses. This means **production AG/CG checks have been hitting EC2 all along**, not the local machine — Task 74's local-server setup was built but never actually wired into the live dashboard.

- Confirmed EC2 already has everything needed: Xvfb + `pyvirtualdisplay` + `pproxy` installed, and `ENIGMA_PW_<CC>` credentials already configured for Germany/Canada/Norway/New Zealand/Australia/UAE.
- Verified live on EC2: non-headless Chrome via `ensure_display()`'s Xvfb bypasses AskGamblers' Cloudflare challenge (785KB real page vs 27KB blocked, matching local results exactly). CasinoGuru's block on EC2 turned out to be **IP-reputation-based** (title "Attention Required!", not the "Just a moment" JS challenge) — non-headless alone doesn't clear it, but routing through the country-matched enigmaproxy does (verified: Norway proxy → exit country confirmed `no` → 894KB real page). Checked coverage: 100% of currently-eligible AG (43) and CG (4) entries already have a Country matching a configured proxy.
- Deployed today's fixed `check_review_status.py`, `check_ag_status.py`, `check_cg_status.py`, `test_check_review_status.py` to EC2 (`scp`) — EC2's copies were from June 30/July 1 and still had the pre-Task-98 CG bug (zero block detection) live in production this whole time.
- **`status_server.py` had been running on EC2 since July 1** (PID 542614) — deploying new files to disk doesn't reload an already-running Python process. Killed and restarted it (new PID 765900) so the fixes actually took effect.
- Refreshed the `EC2_STATUS_URL` Supabase secret (`supabase secrets set`) as a precaution — secret values can't be read back to confirm they're still current, so re-setting to the known-correct IP is the only way to be sure after any EC2 restart.
- Verified end-to-end through the **real production path** (dashboard → Supabase Edge Function → EC2): live CG check on Revolution Casino returned `{"checked":2,"errors":0,"updated":1}` — a genuine status change (Jeremiahh12: Published → Removed) written correctly, confirmed against a fully-loaded, non-blocked page (not a false positive).
- Net effect: production is fixed with no Vercel changes needed (there was nothing to change). The entire local-machine server setup from Tasks 97–99 (off-screen Chrome window, port 5001 fix, `.bat` fix) remains a valid, working setup for manual/local runs, but is not load-bearing for the live dashboard.

---

## Task 101: EC2 Cache/Storage Cleanup — Prevent the 8GB Root Volume From Filling Up

**Date:** July 3, 2026

User asked to confirm current disk usage on `scraper-leo` (8GB root volume) and whether any cache clearing was in place — there wasn't. Investigated and set up automated cleanup so accumulation doesn't eventually degrade performance or run the box out of space.

- Findings: 3.8G/8.0G used (48%). No `logrotate.d` entry for any of the scraper's `.log` files (append-only, unbounded growth). `/var/cache/dnf` at 151M, entirely repo metadata — `dnf clean packages` is a no-op against it, needs `dnf clean all`. `/tmp` had 230M+ in orphaned `undetected-chromedriver` temp profile dirs — UC creates one per run via `tempfile.mkdtemp()` and only removes it on a graceful exit, so crashes/timeouts/`pkill -f chrome` (the runbook's own troubleshooting step) leak them permanently.
- Determined these logs are debug/trace output, not a system of record (the real record — status changes, sync results — lives in Supabase's `mentions`/`sync_runs` tables) and carry no compliance/audit retention requirement, so short-retention rotation is appropriate rather than archiving them offsite.
- Added `/etc/logrotate.d/scraper`: rotates `~/*.log` daily, keeps 7 days compressed, `copytruncate` (so the long-running `status_server.py` process doesn't need restarting to pick up the new file). Runs via the box's existing `logrotate.timer`, no separate cron needed.
- Added `~/cleanup_tmp.sh` + daily cron (15:30 UTC, after the 14:00 scraper run): deletes stale `/tmp/tmp*` Chrome profile dirs and unpacker artifacts older than 24h (`-mmin +1440`, not `-mtime +1` — the latter's day-rounding meant files needed to be nearly 48h old before matching).
- Added weekly cron (Sun 03:00 UTC): `dnf clean all`.
- Verified live: logrotate dry-run parses cleanly; ran cleanup once immediately — `dnf clean all` reclaimed 151M → 4.1M, disk usage dropped 3.8G → 3.7G (46%). Confirmed the sweep correctly skipped today's in-progress run artifacts (mtime-gated) while removing genuinely stale ones.
- Documented the full setup in `docs/ec2-scraper-runbook.md` under a new "Maintenance / Cache Cleanup" section.
- Added a "Routine Maintenance Checklist" section (connect → health check → manual cleanup trigger → status-server restart → IP-change handling) consolidating the SSH workflow that was previously scattered across separate sections, so periodic box check-ins don't require piecing commands together from multiple places.

---

## Task 102: UI Polish — Toolbar Gap Tightening

**Date:** July 6, 2026

Tightened the vertical gap between the KPI cards, toolbar, and table card on brand tab pages from 24–32px down to a consistent 10px.

- First pass added `mt-[10px]` to the KPI grid, but Tailwind's `space-y-6` sets `margin-bottom` directly on the toolbar via a zero-specificity `:where()` rule, which won the margin-collapse against it — the gap didn't actually shrink.
- Fix: added `mb-[10px]` on the toolbar itself, overriding `space-y-6` directly instead of fighting it from the other side.
- Same-day follow-up (Task 104) had to reclaim table-card height that this freed up.

---

## Task 103: Merge TP Affiliate Brand Pair for Counts/Filter

**Date:** July 6, 2026

TP Affiliate had two Brand values ("Top10 Casinos Review Ca 2026" and "Best Online Casino in Canada 2026 | Top Rated Online Casinos") that are the same underlying campaign under different page titles, splitting its KPI counts and brand-filter results across two rows.

- Added `TAB_BRAND_GROUPS` config (`tab-configs.ts`) and a `getBrandGroup(tab, brand)` helper defining which brand values merge into one group for counting/filtering purposes, while both values remain individually selectable in dropdowns.
- Wired the group lookup into `BrandGroup.tsx`'s `brandFiltered` row-matching logic.
- Two same-day trim bugs found and fixed: `getBrandGroup` needed to trim both the config value and the live cell value before comparing (not just the incoming value), and `brandFiltered` had the same one-sided-trim gap independently — fixed to `group.some((v) => v.trim() === ...)` on both sides so a future `TAB_BRAND_GROUPS` entry with stray whitespace can't silently break filtering.
- Two stale code snippets in the design spec (both still showing the pre-fix one-sided-trim version) were caught and synced to match the shipped code during final review.
- Spec: `docs/superpowers/specs/2026-07-06-tp-affiliate-brand-group-design.md`. Plan: `docs/superpowers/plans/2026-07-06-tp-affiliate-brand-group.md`.

---

## Task 104: Reclaim Table Card Height After Toolbar-Gap Tightening

**Date:** July 6, 2026

The table card's height was calculated as `calc(100vh - 280px)`, a value calibrated back when the toolbar/KPI spacing above it was 24–32px. Task 102 tightened that spacing to 10px, leaving the freed space as dead whitespace above the pagination bar instead of letting the card grow into it. Adjusted the height calculation to reclaim that space.

---

## Task 105: 24h Grace Period Before AG/CG Marks a Review Refused

**Date:** July 6, 2026

Newly-added AskGamblers/CasinoGuru entries were flipping straight to "Refused" on their very first check, sometimes just minutes after being posted — before the review had any real chance to appear.

- `resolve_status()` now checks the entry's "review added" date and holds it at Pending for the first 24 hours before it's eligible to fall back to Refused.
- Also stopped re-checking entries already resolved to Published/Removed for AG/CG (TP behavior unchanged) — no reason to keep re-scraping a settled result.

---

## Task 106: Housekeeping — Ignore `.vercel/.env`, Untrack Stray `.pyc`, Log a Scheduled-Check Run

**Date:** July 6, 2026

Small cleanup pass alongside the day's other work: added `.vercel/.env` to local gitignore, untracked a `.pyc` file that had been committed before the repo's `__pycache__/*.pyc` gitignore rule existed, and logged a routine scheduled-check run.

---

## Task 107: Status Server Watchdog — Detect, Restart, Log, Alert

**Date:** July 6–7, 2026

Built automated recovery for `status_server.py` (the local Flask bridge behind the dashboard's "Check Status" button) so a hung/crashed process gets restarted without a manual SSH-in-and-relaunch. Spec: `docs/superpowers/specs/2026-07-06-status-server-watchdog-design.md`. Plan: `docs/superpowers/plans/2026-07-06-status-server-watchdog.md`.

**Task 1 — extracted `scripts/start_status_server_only.ps1`** out of `start_status_server.ps1`: just the "launch `status_server.py` via `pythonw`, wait, health-check" logic, with none of the blanket kill-all-python-processes or `ngrok`-restart behavior that's fine for a human-initiated restart but unsafe for something an unattended task would run every 5 minutes. `start_status_server.ps1` now delegates to it and is otherwise unchanged.

**Task 2 — `watchdog_events` table** (migration `20260706190000_add_watchdog_events.sql`): `id`, `occurred_at`, `outcome` (`restarted` | `restart_failed`), `detail`; RLS restricted to approved-user read, writes are service-role-only from the watchdog script.

**Task 3 — `scripts/watchdog.ps1` + registration:** pings `/health` every 5 min via a Windows Scheduled Task, and on failure stops the matching `python.exe`/`pythonw.exe` process and relaunches via the Task 1 helper, then best-effort logs to `scripts/watchdog.log`, writes a `watchdog_events` row, and emails `WATCHDOG_ALERT_TO` via Gmail SMTP — each of the three independent so one failing doesn't block the others. `scripts/register_watchdog_task.ps1` registers the 5-minute Scheduled Task (`ForumsDashboardWatchdog`).

- **2026-07-06 manual verification failed**: `scripts/watchdog.log` showed 3 real test runs (21:39, 22:05, 22:08), all `restart_failed` — the script correctly detected the server down and attempted the relaunch each time, but `/health` stayed unresponsive afterward in every case.
- **2026-07-07 root cause found**: `start_status_server_only.ps1` used a fixed `Start-Sleep -Seconds 6` + one 5s health-check request (~11s total) before declaring the relaunch failed. `status_server.py`'s import chain (Flask, Selenium, undetected-chromedriver) can take longer than that on a cold start, so the process was actually coming up fine — just not within the arbitrary window. Reproduced directly: a fresh helper run on a throwaway port logged the failure warning while the process was alive and answering `/health` moments later.
- **Fix**: replaced the fixed sleep+single-check with a poll loop (1s interval, 30s ceiling) in `start_status_server_only.ps1` — returns as soon as the server is actually healthy instead of giving up on a clock.
- **Re-verified end-to-end against the live port-5001 server**: unresponsive-path test now logs `restarted` (both locally and in `watchdog_events`) and `/health` recovers; failed-restart-path test (script temporarily renamed away) still correctly logs `restart_failed` within the new 30s budget — confirming the fix doesn't mask genuine failures — and immediately self-heals to `restarted` once the file is restored. Scheduled Task `ForumsDashboardWatchdog` is registered and running every 5 minutes (`LastTaskResult: 0`).
- **Task 4 — Server Health tab (completed 2026-07-09):** the plan originally targeted the standalone Check Status page (`SyncStatus.tsx`), but that page was fully removed on 2026-07-08 (Task 122) before this task was picked up. Re-scoped by user decision to add a new "Server Health" tab to the Log page (`ActivityLog.tsx`) instead, alongside its existing Activity/Edits/Deletes tabs. `fetchWatchdogEvents()` added to `queries.ts`; the tab renders `watchdog_events` rows (restarted/restart_failed, detail, relative time) using the page's existing card-list styling. Per user request, this tab (and its data fetch) is gated to `profile.email === 'leo@optinetsolutions.com'` only — stricter than the page's normal any-approved-user access. Verified live: build clean, a temporary Supabase row confirmed the tab renders and disappears correctly, then was deleted.

---

## Task 108: Fix Stale Page-Numbered AG/CG Review Links Causing False Refused

**Date:** July 6, 2026

AskGamblers/CasinoGuru review-list links are hand-pasted into the Sheet and can carry a trailing page-number segment that goes stale as the site's review order shifts over time. The checker only ever paged forward via "Load More," so a stale page-2 link permanently hid a review that had moved back to page 1, producing a false "Refused" — confirmed live on SilverPlay/StefanH959, part of a batch of 81/105 affected SilverPlay entries.

- Added `normalize_review_list_url()` to strip a trailing all-digit path segment before `driver.get()`, wired into both `fetch_ag_review()` and `fetch_cg_review()`.

---

## Task 109: Score Summary — Wire Up AG/CG Scoring (1-5 vs 1-10)

**Date:** July 7, 2026

Score Summary previously showed a real per-brand score breakdown for TrustPilot only — `PLATFORM_SCORE_KEYS.ag`/`.cg` were empty arrays, so every published AskGamblers/CasinoGuru review was silently bucketed as "Unrated." Spec: `docs/superpowers/specs/2026-07-07-score-summary-ag-cg-scoring-design.md`. Plan: `docs/superpowers/plans/2026-07-07-score-summary-ag-cg-scoring.md`. Built via superpowers:subagent-driven-development in an isolated worktree.

- **Task 1** — generalized `src/lib/scoreSummary.ts` from a hardcoded 1-5 scale to a per-platform max score (`PLATFORM_MAX_SCORE: { tp: 5, ag: 10, cg: 5 }`), wired real score keys (`AG Score added`, `CG Score added`), generalized `parseScore`/`ratingLabel` to take a `maxScore` param. New `scoreSummary.test.ts` (12 tests). A pre-existing NUL-byte corruption in `scoreSummary.ts` surfaced and was fixed during this task.
- **Task 2** — generalized `ScoreSummaryPanel.tsx`'s table (star columns, colors, colgroup widths, column totals) to render a variable number of columns per platform instead of a fixed 5 — AskGamblers now shows 10 star columns (10→1) scrolling horizontally in its own container.
- **Task 3** — added `AG Score added` (1-10) / `CG Score added` (1-5) fields to the Add Review Account modal and force-inserted them into the Edit modal via `DASHBOARD_ONLY_MODAL_FIELDS`, same convention as TP's existing `Score added` field. Edit-only — no `tab-configs.ts` whitelist change, stays out of the main brand table.
- **Task 4** — end-to-end verification: `npm run build` clean, `npm test` 36/36 passing, human-confirmed live manual browser walkthrough (real Supabase login) — AG/CG score fields render and persist, TP=5/CG=5/AG=10 star columns render correctly, no console errors.
- **Final whole-branch review** (opus): ready to merge. One Important item — AG only accepts whole-number scores 1-10, so a decimal entry (e.g. `8.4`, common for real AskGamblers ratings) is silently bucketed as Unrated — flagged as a documented no-validation design choice rather than a defect; confirmed leave-as-is. Two Minor nits fixed: extracted a shared `summarizeCounts()` helper (dedupes weighted-average math between `computeScoreSummary` and `ScoreSummaryPanel`'s `computeColumnTotals`), trimmed a stale comment referencing the already-deleted `import-tabs` Sheet-resync mechanism.
- Merged to `main` (fast-forward, `37b9d4d..aff80c5`) and pushed to origin.

---

## Task 110: Check Status Reliability — Deterministic Pagination & Opt-In Scope Filtering

**Date:** July 7, 2026

Fixed a data-loss bug in Check Status and extended it to run against only what's currently filtered on screen instead of always re-scraping every tab.

- Paginating Supabase entries via limit/offset with no `ORDER BY` let Postgres return rows in an unstable order across requests, silently dropping entries that fell on a page boundary — confirmed live: two Done AG entries on Rooster Partners were never checked because of it. Ordering by `id` makes pagination deterministic; applied the same fix to Wizard of Odds' loader, which had no pagination at all (a single request with a hard 1000-row cap).
- Removed AG/CG's fixed 10-"Load More" cap in review-list scraping so a review far down a long list isn't wrongly marked not-found, and added a Removed-stays-Removed branch to `resolve_status` so a re-checked Removed entry that's still not found doesn't fall through to Pending/Refused.
- Filtering the dashboard's Status dropdown to Live or Removed and clicking Check Status now scopes that run to exactly that status for any of TP/AG/CG/WO, letting resolved entries be re-checked on demand without re-scraping every already-settled account.
- Extended the same opt-in scoping to Brand, Agent, Proxy, and Country — all five filters now combine (AND) to scope a Check Status run to exactly what's filtered in the table. Added a shared `matches_scope_filters()` in `check_review_status.py` so the four platform loaders can't drift apart, and refactored the four `trigger*StatusCheck` functions from positional args to a `StatusCheckScope` options object.
- Follow-up: hid the dedicated Check Status nav link — its removal-detection purpose is now covered per-tab via this same scoping on each brand tab's own Check Status button. Route and page are untouched, so it's a one-line revert if needed again.

---

## Task 111: How It Works Page

**Date:** July 7, 2026

Added a new `/how-it-works` page explaining the dashboard's features to all users (public, no login gate), plus a sidebar link. Same-day follow-up fixed the topbar falling through to the generic "Brands Partner Forum" title instead of showing the page title (matching every other page), dropped the now-redundant in-page heading, removed the irrelevant Check Status feature card, and widened the layout to full-page with a 3-column desktop / responsive feature grid.

Spec: `docs/superpowers/specs/2026-07-07-how-it-works-page-design.md`. Plan: `docs/superpowers/plans/2026-07-07-how-it-works-page.md`.

---

## Task 112: Remove Inaccurate Admin Badge from Score Summary and Activity Log

**Date:** July 7, 2026

Removed the "Admin" badge from Score Summary and Activity Log in the sidebar — both pages are open to any approved user, not admin-only, despite sitting in the sidebar's "Admin" grouping.

---

## Task 113: Google Sheet Full Disconnect — Remove Remaining Write-Back Path

**Date:** July 7, 2026

Completed the Google Sheet disconnect started 2026-07-07 by deleting the last write-back Edge Functions and their now-dead frontend callers, leaving Supabase as the dashboard's sole data store.

- Deleted the `sync-sheet`, `push-to-sheet`, `import-tabs`, and `backfill-brand-hrefs` Edge Functions (repo source and live Supabase deployment).
- Removed the frontend code that only served them — `fetchSyncRuns`, `subscribeSyncRuns`, `src/types/sync.ts` — along with the dead `sync_runs` UI.
- Removed Google Sheet references from `CLAUDE.md`, `.env.example`, and type declarations; removed now-obsolete Google Sheet tasks from tracking docs.
- Noted `check-review-status` deliberately left untouched — it still pushes changed rows to the Sheet via the Apps Script web app whenever a Check Status run detects a change; `apps-script/Code.gs` and the Sheet itself are untouched.

Spec: `docs/superpowers/specs/2026-07-07-google-sheet-disconnect-design.md`. Plan: `docs/superpowers/plans/2026-07-07-google-sheet-disconnect.md`.

---

## Task 114: Unified Brand Link Field Across All Brand Tabs

**Date:** July 7, 2026

Every brand tab now has a consistently-labeled "Brand Link" field, auto-filled and re-filled on brand selection in both the Edit Entry and Add Review Account modals — previously only 3 of 11 tabs had this under inconsistent keys/labels, and the other 8 had no per-brand link at all.

- Fixed the GRG tab's URL slug: generic slug derivation turned "GRG - Gulf Recovery Group" into `grg---gulf-recovery-group`; added a targeted override so it reads `gulf-recovery-group`.
- Fixed brand-change in the edit modal only refreshing AG/CG Review Link from `brandProfiles`, leaving Brand / TP URL stale from the previous brand.
- Added `BRAND_AG_URLS`/`BRAND_CG_URLS` static fallback tables (seeded from each brand's established majority-value link) for when a brand's first entry in a tab has no other rows to derive a link from.
- Fixed brand-derived link sync on TP Affiliate (aggregates its "Brand Links" `URL PAGE__href` column the same way AG/CG links are aggregated) and Wizard of Odds (which reuses the "Link to the profile" column name for a single per-brand WO page, unlike every other tab where that column means a per-review confirmation link — scoped strictly to WO so it can't bleed into that column's other meaning).
- TP Brand Injection, TP Affiliate, and Wizard of Odds kept their existing link columns, just relabeled to "Brand Link" to avoid a data migration; the other 8 tabs got a new column backed by the existing `BRAND_TP_URLS` map. While wiring the Add modal, found it hardcoded the brand-name key as `'Brand Name'` for every tab regardless of the tab's real column (`'Brands'` for Rooster Partners/Hanan/Revolution Casino/SilverPlay/Trybet/HazEmirates UAE, etc.) — confirmed against live data this had orphaned 12 existing rows; added shared `getBrandNameCol()`/`getBrandLinkCol()` resolvers in `tab-configs.ts` so modals and `BrandGroup.tsx` resolve these from one source instead of drifting independently again, plus a migration backfilling the 12 orphaned rows.
- Hid Brand Link from table rendering (`TABLE_HIDDEN_COLS`) — it's meant to be edited via Add/Edit, not shown as an inline column.

Spec: `docs/superpowers/specs/2026-07-07-unified-brand-link-design.md`.

---

## Task 115: Google Sign-In (Login / Signup)

**Date:** July 8, 2026

Added a "Continue with Google" option to both `Login.tsx` and `Signup.tsx`, alongside (not replacing) the existing email/password flow.

- Open to any Google account, same exposure as the existing open password signup — gated by the same admin-approval flow (`profiles.approved`), since the approval trigger fires on any `auth.users` insert regardless of provider. No `AuthContext`/`ProtectedRoute`/schema changes needed.
- Fixed a related redirect bug: `ProtectedRoute`'s `<Navigate to="/login" replace />` drops the URL hash, which would silently lose a failed/cancelled Google OAuth attempt's `#error=...` fragment. Stashed the hash into `sessionStorage` at the top of `main.tsx` before React Router mounts; `Login.tsx` reads and clears it on mount.
- Built via subagent-driven-development in an isolated worktree, merged and pushed same day. Requires the Supabase Site URL to stay set to the production domain (same dependency as password reset) — if it drifts back to localhost, Google sign-in breaks too.
- Spec: `docs/superpowers/specs/2026-07-08-google-oauth-login-design.md`. Plan: `docs/superpowers/plans/2026-07-08-google-oauth-login.md`.

---

## Task 116: Getting Started Walkthrough on How It Works Page

**Date:** July 8, 2026

Added a numbered step-by-step walkthrough (login → add an entry → edit an entry → run Check Status → see the result) to the top of the How It Works page, alongside an animated GIF of the real flow.

- No video/screenshot tool exists in this environment, so the GIF is produced by `scripts/capture-getting-started.mjs`, a one-time, human-supervised Playwright script that logs in with real credentials, drives the flow against the `GRG - Gulf Recovery Group` tab using a disposable demo entry, and deletes it afterward. Run via `npm run capture:demo` (needs `npm run dev` running first, plus `CAPTURE_EMAIL`/`CAPTURE_PASSWORD` env vars).
- The Check Status backend is stubbed (`page.route` intercept) during capture so the loading/result states are deterministic regardless of whether `status_server.py` happens to be running.
- Review-pass fixes to the capture script: moved `demoEntryCreated = true` to right after the Add Account click (where the DB insert actually happens) so a later render-delay/flake can't skip cleanup and orphan a real row; added a top-level `.catch()` so a surviving exception exits cleanly instead of an unhandled-rejection warning; captured the login screenshot before filling in credentials so the committed GIF never shows a real email in plaintext; fixed the Edit Entry modal wait to gate on the Save button actually closing instead of the live-updating `<h2>` title; fixed the cleanup's final delete-confirmation wait to use the row locator instead of an exact-name match, so it doesn't resolve early and race an in-flight Supabase delete when the run fails before the rename step.
- Found and fixed a related bug while testing against GRG (a dashboard-only tab with no Google Sheet backing): `fetchTabHeaders` returned an empty list for tabs with no `tab_schemas` row, so `fetchTabKpis` couldn't resolve a status column and Overview showed 0 total despite real entries existing. Now falls back to the tab's `TAB_COLUMN_CONFIGS` whitelist, matching the fallback `BrandGroup.tsx` already used.
- Operational fallout: recovering the `sandbox@optinetsolutions.com` account during testing hit Supabase's default-mailer rate limit on both signup and password-reset emails — logged as a known backlog item (needs custom SMTP; immediate unblock is an admin-side direct password reset).
- Re-run manually whenever the UI changes enough to make the GIF stale.
- Spec: `docs/superpowers/specs/2026-07-08-getting-started-walkthrough-design.md`. Plan: `docs/superpowers/plans/2026-07-08-getting-started-walkthrough.md`.

---

## Task 117: Dashboard Favicon

**Date:** July 8, 2026

Set the browser tab favicon to the existing `Brand-Partners-Forums.webp` brand logo (already used in the sidebar), replacing the Vite default icon.

---

## Task 118: Check Status Standalone Section on How It Works

**Date:** July 8, 2026

Added a dedicated "Check Status" explanation to the How It Works page — previously the feature had no card in the Features grid at all.

- First pass added a "Check Status" card into the existing Features grid alongside Overview/Brand Tabs/etc.
- Follow-up promoted it out of the grid into its own standalone section (matching the page's Getting Started/Data Flow sections), since Check Status is a cross-cutting action rather than a page like the other Features entries — describes what it checks (Trustpilot/AskGamblers/Casino.Guru/Wizard of Odds), the per-tab/per-platform button, that a run can be scoped to whatever filters are active (status/brand/agent/proxy/country), and that it updates the status column with a toast summary on completion.
- Spec: `docs/superpowers/specs/2026-07-08-check-status-feature-card-design.md` and `docs/superpowers/specs/2026-07-08-check-status-standalone-section-design.md`. Plans: `docs/superpowers/plans/2026-07-08-check-status-feature-card.md` and `docs/superpowers/plans/2026-07-08-check-status-standalone-section.md`.

---

## Task 119: Clickable Feature Cards on How It Works

**Date:** July 8, 2026

Feature cards on the How It Works page (Overview, Score Summary, Ask AI, Activity Log, Admin Users) are now clickable, linking directly to their pages instead of being purely descriptive.

- Admin Users card only links through for admin users, matching its existing `adminOnly` gate.
- Spec: `docs/superpowers/specs/2026-07-08-clickable-feature-cards-design.md`. Plan: `docs/superpowers/plans/2026-07-08-clickable-feature-cards.md`.

---

## Task 120: Brand Tabs Modal

**Date:** July 8, 2026

Added a `BrandTabsModal` component, opened from the Brand Tabs card on How It Works, listing every brand tab as a direct link instead of requiring a sidebar hunt.

- Escape-key handling implemented as a document-level `useEffect` listener rather than a focus-dependent `onKeyDown` on the outer div, so Escape closes the modal regardless of where browser focus currently sits.
- Spec: `docs/superpowers/specs/2026-07-08-brand-tabs-modal-design.md`. Plan: `docs/superpowers/plans/2026-07-08-brand-tabs-modal.md`.

---

## Task 121: Score Summary Card Fixes on How It Works

**Date:** July 8, 2026

Two same-day corrections to the Score Summary presentation:

- `ScoreSummaryPanel.tsx`'s platform tabs now show each platform's real favicon (Trustpilot/AskGamblers/Casino.Guru), matching the icon pattern already used on Overview, instead of generic colored dots.
- The Score Summary card's copy on How It Works was rewritten to describe what it actually shows — a star-rating rollup per platform with weighted averages and rating labels — replacing vague "published counts" wording.

---

## Task 122: Remove Standalone Check Status / Full Check Page

**Date:** July 8, 2026

Fully removed the standalone Check Status page (`/sync`) and its bulk "Run Full Check" feature (Task 75's scoped tab/brand picker) — its removal-detection purpose was already covered per-tab by Task 110's opt-in scope filtering, and the sidebar link to it had already been hidden.

- Deleted `SyncStatus.tsx`, `FullCheckScopePicker.tsx`, `RunHistoryTable.tsx`, and `removedEntriesDiff.ts` (+ test) — confirmed via full dependency search that none are referenced anywhere else.
- Removed the `/sync` route and lazy import from `App.tsx`, and the `/sync` title mapping from `Topbar.tsx`.
- Removed the now-dead `fetchAllTabsStatusSummary`, `fetchRemovedEntryDetails`, `recordFullCheckRun`, `fetchFullCheckRuns`, `fetchRemovedEntriesForRun` and their types from `queries.ts`. Confirmed `triggerStatusCheck`/`triggerAgStatusCheck`/`triggerCgStatusCheck`/`triggerWoStatusCheck`/`getActiveChecks` — the functions behind every brand tab's own Check Status button — are untouched; they only call the EC2 status server directly and never read/wrote the tables below.
- Dropped the now-orphaned `full_check_runs` and `full_check_removed_entries` tables (migration `20260708150000`) — verified no Python script, Edge Function, or other migration referenced them, and the one FK (`full_check_removed_entries.entry_id → entries.id`) only pointed at `entries`, never the reverse, so nothing in any brand tab's data was affected.
- **Follow-up needed:** the Blocked PMS task "Manual Browser QA: Scoped Full Check (Task 75) & Country Auto-Derive (Task 96)" is now half-moot — Task 75's feature no longer exists, so only Task 96 (Country Auto-Derive) still needs a manual browser QA pass.

---

## Task 123: Fix Stale/Wrong AG Statuses — Watchdog Headless Regression + Per-Platform Chrome Mode

**Date:** July 9, 2026

Investigated a reported false "Refused" AG status (account 583 | Hanan | Canada, Rooster.bet) and a stuck "Done" AG status (account 1304 | Test | New Zealand, Lucky7even) — both were live-published reviews the checker had failed to detect.

- Root cause #1 (immediate): `watchdog.ps1`'s auto-restart of `status_server.py` (fires whenever `/health` goes unresponsive — several times on 2026-07-06/07 per `watchdog.log`) called `start_status_server_only.ps1` without `-NoHeadless`, silently dropping back to headless Chrome on every restart. AskGamblers/CasinoGuru's Cloudflare challenge blocks headless Chrome outright, so AG/CG checks from the live server were silently skipping (or, worse, timing-based grace logic wrote real wrong statuses) instead of finding reviews that were actually live. Manually re-ran both affected entries once the server was back on a real (non-headless) browser — both flipped to `Published`, confirmed directly in Supabase.
- Root cause #2 (deeper): fixing #1 by always forcing non-headless would have broken Trustpilot — empirically confirmed (3/3 vs 3/3 trials) that Trustpilot's bot check ("Verifying Connection") trips on a *real* headful browser but passes headless, the exact opposite of AskGamblers/CasinoGuru. A single global `--no-headless` launch flag can't satisfy both. Worse, TP's `fetch_status()` has no block-detection guard, so a blocked page silently defaults to `"Published"` — a wrong TP status could be silently written with no error signal.
- Fix: `status_server.py` now hardcodes a `PLATFORM_HEADLESS` map (`tp: True`, `ag/cg/wo: False`) and every check route uses its platform's fixed setting instead of the server-wide `--no-headless` flag/`app.config['HEADLESS']`. The CLI flag is still accepted (existing launch scripts pass it) but is now a documented no-op. `watchdog.ps1` still passes `-NoHeadless` on restart for consistency with the boot script, though it no longer affects behavior.
- Verified live through the actual dashboard endpoint (`/check-status`) post-fix for all four platforms: TP (61 entries, correct real-page loads, no false "Verifying Connection" defaults), AG (Refused → Published), CG (page loaded fully, genuinely-not-found status correctly reconfirmed, not a silent block), WO (unaffected either way — no bot-blocking observed in testing).

---

## Task 124: Score Summary Clickable Navigation + Wizard of Odds Platform

**Date:** July 9, 2026

Made Score Summary's brand names and star-count cells clickable, deep-linking into the Brands tab with brand/platform/rating filters pre-applied, and added Wizard of Odds as a fourth Score Summary platform (1-5 scale) so the feature covers all platforms.

- `src/lib/scoreSummary.ts`: `Platform` type, `PLATFORM_MAX_SCORE`, and the platform key maps now include `wo`.
- `src/lib/tab-configs.ts`: new exported `PLATFORM_SCORE_COLS` map of candidate score-column names per platform.
- `src/components/ScoreSummaryPanel.tsx`: brand-name cells and non-zero star-count cells are now links to `/brands/:tab?platform=...&brand=...[&rating=...]`; added a Wizard of Odds platform toggle.
- `src/pages/BrandGroup.tsx`: reads `platform`/`brand`/`rating` from the URL and filters accordingly (rating matches require exact score + Published status, mirroring what Score Summary counted); fixed a reactivity gap where navigating between two Score-Summary-originated links for the same tab didn't re-apply filters; added an active-filter chip with a clear action.
- Two follow-up fixes surfaced during code review: the platform KPI-card/dropdown and the brand-filter dropdown previously wrote to the URL by replacing the whole query string, which silently cleared any other active filter (brand/rating, or brand, respectively) on selection — both now merge into the existing query string instead.
- **Manual authenticated browser click-through performed** (Playwright, real login, real Supabase data) — found and fixed a real bug the automated tests missed: the rating filter resolved a platform's score column via a header list, which is always empty for schema-less/dashboard-only tabs (e.g. GRG - Gulf Recovery Group has no `tab_schemas` row), so the filter silently showed all rows instead of just the matching ones on those tabs. Fixed by checking each row's own data directly for the first populated candidate score key — the same pattern `computeScoreSummary` already uses — instead of resolving one column name per tab. `getScoreCol()` (from the initial implementation) became dead code and was removed along with its tests. Re-verified live: GRG's 5★ link now correctly shows 4 matching rows instead of all 5. All other flows (brand click, star click, same-tab reactivity, clear-chip, platform switch, WO toggle) confirmed working live.
- **Separate pre-existing bug found, not fixed here** (confirmed unrelated to this feature — reproduces on a bare Score Summary page load with zero clicks): a React "duplicate key" warning for id `139b4c61-e4a3-4a89-a27c-396023556605` plus a "concurrent rendering... recovered" error in the browser console. Needs its own investigation — likely a duplicate row or duplicate React key somewhere in Score Summary's rendering or the underlying `entries` data.
- Built via superpowers:subagent-driven-development in an isolated worktree/branch (`score-summary-clickable-nav`); 36/36 tests passing, `npm run build` clean; final whole-branch review Ready to merge; manual QA performed post-review and one additional bug found+fixed as a result.
- Spec: `docs/superpowers/specs/2026-07-08-score-summary-clickable-navigation-design.md`. Plan: `docs/superpowers/plans/2026-07-08-score-summary-clickable-navigation.md`.

---

## Task 125: Score Summary — Clickable Total Row + Avg/Rating Column Removal

**Date:** July 9, 2026

Made each per-group "Total" row in Score Summary clickable, and removed the `Avg`/`Rating` columns from both the per-group table and the cross-group "All brands" bar, across all four platforms.

- `src/components/ScoreSummaryPanel.tsx`: the `SummaryTable` `tfoot`'s "Total" cell is now a `Link` — single-brand groups link to that brand's page (same href as clicking the brand name), multi-brand groups link to the group's page with no brand filter. Styled to match the existing brand-name link.
- The `GrandTotal` ("All brands") bar intentionally stays plain text — it spans unrelated groups/tabs with no single link destination.
- Dropped the `Avg` and `Rating` `<th>`/`<td>` cells and their two `SummaryColgroup` columns from both tables; removed the now-unused `LABEL_PILL` map and `RatingLabel` import. `scoreSummary.ts`'s `summarizeCounts()` (and its test coverage) is untouched — it still computes `average`/`label`, just nothing renders them anymore.
- Spec: `docs/superpowers/specs/2026-07-09-score-summary-total-row-link-avg-rating-removal-design.md`. Plan: `docs/superpowers/plans/2026-07-09-score-summary-total-row-link-avg-rating-removal.md`.

---

## Task 126: Fix WO Check Status Failing 100% of the Time on Every Brand Tab

**Date:** July 10, 2026

`fetch_wo_review` referenced an undefined `MAX_LOAD_MORE` constant, so every real Wizard of Odds check threw a `NameError` immediately — a 100% failure rate present since the feature's first commit (2026-06-26).

- Removed the fixed page cap entirely in favor of an uncapped loop, matching the same fix already applied to AG/CG for the identical false-negative reasoning.
- That unmasked a second bug: WO runs Chrome non-headless like AG/CG but never started the Xvfb virtual display those two rely on, so Chrome failed to launch on the headless EC2 box once the `NameError` stopped short-circuiting every call. Added the same `ensure_display()` call AG/CG already use.
- Verified live against production (Vercel bundle → Edge Function → EC2): 0 errors, 3/3 updated on the real Wizard of Odds tab.

---

## Task 127: Score Summary — Remove All-Brands Total Box, Clickable Total Cells, Fix Platform-Only Filter

**Date:** July 10, 2026

Follow-on Score Summary work: dropped the standalone "All brands" grand-total box in favor of deep-linking the existing per-brand and per-group cells, then fixed a filtering bug those new links exposed.

- `cc96c92`: Removed the all-brands grand-total box; made the per-brand `Unrtd`/`Total` cells and per-group Total row's star/`Unrtd` cells deep-link into the filtered BrandGroup view (added `rating=unrated` support to BrandGroup's rating filter).
- `6be17fb`: Made the per-group Total row's numeric total cell clickable too, linking to that tab's brand page filtered to the selected platform — matching the existing Total label link.
- `5c191a5`: Found and fixed that BrandGroup's platform filter only narrowed visible status columns, not the row list, so navigating from any Score Summary Total link showed every row for the tab instead of the Published-only set the total actually counted. Added a `rating=any` sentinel that reuses the existing Published-status filter without constraining score, wired to all three Total links (per-brand, per-group label, per-group numeric).

---

## Task 128: Serialize Check Status Runs Across Platforms — Stop Concurrent-Chrome Crashes on EC2

**Date:** July 10, 2026

Two overlapping Selenium checks (different tabs/platforms) on the 2GB t2.small EC2 box were crashing one Chrome process under memory pressure, cascading into every remaining entry in that run failing with `Connection refused` — surfaced to users as a misleading "server may not be running" toast.

- Added a global lock across all four check routes so only one Selenium run happens at a time.
- Stopped swallowing the real rejection message in the dashboard's error toast.

---

## Task 129: Manual Brand Name Entry — Creatable Brand Dropdown

**Date:** July 10, 2026

Brand Name in Add Review Account (and Edit Entry, since it shares the same `BrandSelectDropdown` component) is now creatable — typing a name with no case-insensitive match in the existing list shows a `+ Add "<text>"` row that sets it as a free-typed brand, on every brand tab. Previously the field only let you pick from brands already seen in that tab's data, with no way to add a genuinely new one.

- Also fixed: the brand dropdown wasn't rendered at all in Add Review Account when a tab had no known brands yet — now always shown.
- Final whole-branch review flagged that `BrandSelectDropdown` is shared with `EditEntryModal`, so the new creatable behavior applies there too (verified working). Also surfaced a pre-existing, unrelated display bug: Trybet's table view shows "—" in its Brands column even when the value is correctly saved (see Known Issues).
- Spec: `docs/superpowers/specs/2026-07-10-manual-brand-entry-design.md`. Plan: `docs/superpowers/plans/2026-07-10-manual-brand-entry.md`.

---

## Task 130: Platform-Colored Score Star on Review Link Columns

**Date:** July 10, 2026

Adds a small filled star with the score number inside, next to the "View" link pill for TP, AG, CG, and WO review-link columns, colored per platform (TP emerald, AG red, CG green, WO amber). Only rendered when the row has a valid recorded score; fractional scores (e.g. 4.5) floor to the displayed integer instead of hiding the star.

- Darkened the TP star to `emerald-600` after an initial pass had insufficient contrast.
- Relabeled the legacy TP "Score added" field in the Edit modal (distinct from "TP Score Added") to avoid confusion — both showed identical text, but only TP Score Added feeds Score Summary (see `PLATFORM_SCORE_COLS` priority).
- Spec: `docs/superpowers/specs/2026-07-10-platform-score-star-design.md`.

---

## Task 131: Fix Account Surname Duplicate Field & Priority Position in Edit Modal

**Date:** July 10, 2026

Two related bugs in the Edit Entry modal's field ordering, both traced to the canonical header being `"Account Surname "` (trailing space):

- Legacy sheet-import rows can carry the value under a whitespace-variant key (`"Account Surname "` vs `"Account Surname"`), which rendered as a second, empty field alongside the real one — merged into a single field.
- `ACCOUNT_FIELD_PRIORITY` matched headers by exact string, so it never matched the trailing-space header and fell to the end of the field list instead of its intended slot right before Agent — now matches by trimmed label.

---

## Task 132: Fix Column Sorting on TP Brand Injection / TP Affiliate Tabs

**Date:** July 10, 2026

The fixed brand-sequence sort order applied unconditionally on these two tabs, ignoring any column the user clicked to sort by — clicking a header still toggled the sort icon and updated state, but row order never changed. The sequence order is now only used as the default when no column sort is active.

---

## Task 133: Score Summary — Floor Decimal Scores Instead of Dropping to Unrated

**Date:** July 11, 2026

Wizard of Odds' 4.5 scores were landing in the Unrated bucket on Score Summary instead of counting as 4-star, because `parseScore()` required a clean integer and rejected any decimal.

- Changed `parseScore()` in `src/lib/scoreSummary.ts` to floor a fractional score to its whole-star bucket instead of requiring an exact integer match — mirrors `parseStarScore` in `BrandGroup.tsx`, already used for the per-row star badge.
- Applied to all four platforms (TP/AG/CG/WO) rather than WO alone, so an AG `8.4` now also counts as 8-star instead of Unrated — this reverses a prior "integer-only for AG" convention that was revisited once WO exposed the same gap visibly.

---

## Task 134: Sidebar Hover-to-Expand

**Date:** July 14, 2026

When the desktop sidebar is pinned collapsed (via the existing manual toggle), hovering the mouse over it now temporarily expands it as a floating overlay on top of page content — moving the mouse away collapses it back. Content never shifts or resizes.

- `Sidebar.tsx` gained a `hoverExpanded` state; the in-flow `<aside>` still reserves its pinned width (`w-16`/`w-60`) so the layout never jumps, while a `fixed`-position overlay `<aside>` (reusing the existing `navContent`/new `header` helpers) fades in/out on hover, only ever mounting when pinned collapsed.
- Task review caught two issues in the first pass: the overlay's `z-30` collided with `BrandGroup.tsx`'s sticky toolbar (`z-40`) and sticky frozen columns (`z-30`) in the same on-screen region, and the hidden overlay stayed keyboard-focusable (`pointer-events-none` doesn't remove elements from the tab order). Fixed by raising the overlay to `z-[45]` and adding `inert={!hoverExpanded}`.
- Manual toggle, `App.tsx`, and `localStorage` persistence untouched; mobile drawer untouched.
- Spec: `docs/superpowers/specs/2026-07-13-sidebar-hover-expand-design.md`. Plan: `docs/superpowers/plans/2026-07-13-sidebar-hover-expand.md`.

---

## Task 135: Color Scheme Alignment — Violet to Blue, Sidebar Navy, Typeface

**Date:** July 15–16, 2026

Swapped the dashboard's `violet-*` interactive-accent color for `blue-*` to match the Ranking Reports reference screenshot, then iterated the sidebar and typography further based on a supplied color swatch.

- Mechanical `violet-` → `blue-` replace across 23 files (190 occurrences) plus the `--color-brand-*` tokens in `src/index.css`; Casino Guru's platform badge/dot and the decorative avatar color intentionally kept violet since they're categorical, not accent chrome.
- Sidebar background iterated `slate-900` → `indigo-950` → `#1E2A6B` (exact reference swatch) → `#000080` (standard navy) → `#000060` (final, darkened) across several same-day passes; nav text/icons set to pure white.
- Active sidebar tab restyled from a translucent blue fill to a white/`#f8fafc` pill with rounded concave corners and a blue left border; platform filter's active segment recolored to brand blue (`#2D5FED`).
- Adopted Public Sans (body) + IBM Plex Mono (numeric displays — KPIs, scores, pagination, chart axes) via self-hosted `@fontsource` packages, wired through `--font-sans`/`--font-mono` tokens.
- Spec: `docs/superpowers/specs/2026-07-15-color-scheme-alignment-design.md`. Plan: `docs/superpowers/plans/2026-07-15-color-scheme-alignment.md` (amended mid-implementation to cover a hardcoded hex accent found during Task 1 review).

---

## Task 136: Admin Users Table Full Width & Sign Out Button Styling

**Date:** July 16, 2026

Two small standalone style fixes: removed the `max-w-4xl` constraint on the Admin Users page so the table fills the page instead of being capped at a fixed width, and restyled the sign-out button to use the sidebar's navy color with a transparent background.

---

## Task 137: Self-Service Profile Photo Upload (Admin Users)

**Date:** July 16, 2026

Users can now upload their own profile photo from the Admin Users table, replacing the initials-only avatar shown throughout the app.

- Added `profiles.avatar_url`, an `avatars` Supabase Storage bucket, and a `update_own_avatar` RPC scoped to the caller's own row.
- Extracted shared avatar color/initials/validation helpers to `src/lib/avatar.ts`; refactored `Topbar`'s existing avatar rendering to use them instead of its own duplicated logic (no behavior change).
- Added `avatar_url` to the `Profile` type and `uploadAvatar`/`updateOwnAvatar` to `queries.ts`; wired the upload UI into the Admin Users table.
- Threaded `avatar_url` through Supabase Presence tracking and added an img-with-fallback avatar to Topbar's online-users stack — previously Presence only tracked email/userId and Topbar always rendered initials, so uploaded photos never appeared there. Also fixed `AuthContext`'s cached profile only refreshing on login, which left `avatar_url` stale in the current session until next sign-in even though the DB and Admin Users table were already correct.
- Post-hoc security review found `update_own_avatar` scoped the UPDATE to `auth.uid()` but never validated `new_avatar_url` itself — since it renders as `<img src>` to every admin viewing the table, a member could pass an arbitrary URL as a tracking-pixel/IP-disclosure vector. Fixed with a follow-up migration restricting the RPC to null or the caller's own object path in the `avatars` bucket, plus an `onError` fallback to initials so a broken/blocked URL no longer shows a broken-image icon.
- Spec: `docs/superpowers/specs/2026-07-16-user-profile-photo-design.md`. Plan: `docs/superpowers/plans/2026-07-16-user-profile-photo.md`.

---

## Task 138: Client-Side Avatar WebP Compression

**Date:** July 16, 2026

Uploaded avatar photos are now cropped, resized, and re-encoded as WebP in the browser before upload, following on from Task 137.

- Raised the avatar upload size cap to 15MB ahead of client-side compression (previously capped much lower since the original was uploaded as-is).
- Added `squareCropRect` and `compressAvatarImage` helpers (`src/lib/avatar.ts`) — crop to square, resize, and encode as WebP via `createImageBitmap`/canvas.
- Widened `uploadAvatar` to accept any `Blob`, not just a `File`, so the compressed output can be uploaded directly.
- Wired `AdminUsers.tsx` to compress before calling `uploadAvatar`.
- Fixed a follow-up bug: `createImageBitmap`'s default `imageOrientation` historically varies by browser, so a portrait phone photo could decode sideways — passing `'from-image'` makes EXIF rotation handling explicit instead of relying on the current browser's default.
- Spec: `docs/superpowers/specs/2026-07-16-avatar-webp-compression-design.md`. Plan: `docs/superpowers/plans/2026-07-16-avatar-webp-compression.md`.

---

## Task 139: Sidebar Navy Recolor & Add Review Account Button

**Date:** July 17, 2026

Changed the sidebar background from `#000060` to `#17225a` across all three render states (expanded, hover-expanded, mobile drawer) in `Sidebar.tsx`. The displaced `#000060` navy was repurposed as the new background for the "Add Review Account" button in `BrandGroup.tsx`, replacing its previous `blue-600`/`blue-700` styling.

---

## Task 140: Sidebar Width Fix — Mobile Drawer

**Date:** July 17, 2026

Fixed the mobile sidebar drawer width from `w-72` (288px) to `w-60` (240px) in `Sidebar.tsx`, matching the desktop hover-expanded width. Desktop's collapsed rail (`w-16`/64px) and hover-expanded panel (`w-60`/240px) already matched spec and were left unchanged; the existing click-to-pin toggle and localStorage-persisted collapsed state were kept as-is.

---

## Task 141: Center Collapsed Sidebar Icons

**Date:** July 17, 2026

Fixed collapsed-rail nav icons rendering off-center in `Sidebar.tsx`. Two compounding causes: the `<nav>` wrapper always applied `pl-3` regardless of collapse state, and collapsed brand-tab links kept the expanded-mode `rightPad` padding (`pl-3 pr-[15px]`, meant to make room for platform favicons that are hidden when collapsed). Removed the nav's left padding when collapsed and made all collapsed links use symmetric `justify-center px-3`, so icons center on the true 64px rail width.

---

## Task 142: Getting Started GIF Click-to-Zoom Lightbox

**Date:** July 17, 2026

Added click-to-zoom on the How It Works page's Getting Started GIF (`HowItWorks.tsx`). Clicking the inline GIF opens a full-screen lightbox (dark backdrop, GIF enlarged and centered, close button), dismissible via backdrop click, the X button, or Escape. Escape-to-close uses the same document-level `keydown` listener pattern as `BrandTabsModal` (the working implementation in this codebase — some other modals have a focus-dependent Escape bug). The GIF file itself still shows the pre-recolor sidebar and will be regenerated separately via `npm run capture:demo`. Spec: `docs/superpowers/specs/2026-07-17-getting-started-lightbox-design.md`.

---

## Task 143: Fix "Pending Approval" Flash on Sign-In

**Date:** July 21, 2026

Fixed a real-account login bug where approved users (confirmed with a genuinely approved admin account) briefly saw the "Pending Approval" screen for ~300-500ms immediately after signing in, before the app self-corrected to the real page.

- **Root cause** (confirmed via console-instrumented Playwright login against a live dev server, not guessed): `AuthContext`'s `onAuthStateChange` handler only sets `loading` to `false` once, during the initial mount's no-session check on the login page. When a user then submits credentials and a `SIGNED_IN` event fires, `setSession(s)` triggers an immediate re-render with `loading` still `false` (unchanged from before) and `profile` still the stale initial `null`, so `ProtectedRoute` evaluates `isApproved=false` and renders "Pending Approval" — until the async `fetchProfile()` call resolves ~300-500ms later with the real (approved) value.
- **Fix:** `AuthContext.tsx` now calls `setLoading(true)` when a new session arrives, before starting the profile fetch, so `ProtectedRoute` shows its spinner during that window instead of misjudging approval against a stale profile.
- Surfaced incidentally while regenerating `getting-started.gif` (Task 142) — the Playwright capture script briefly caught the flash as its first post-login frame; investigation confirmed it affects real email/password logins generally, not just the capture script.

---

## Task 144: Repo Gitignore Audit & Stray File Cleanup

**Date:** July 21, 2026

Audited tracked files against `.gitignore` and found several that were committed before matching ignore rules existed, plus some genuine junk that had never been ignored at all.

- Untracked (kept on disk, already covered by existing `*.tsbuildinfo`/`scripts/*.log` rules that predated these files): `tsconfig.node.tsbuildinfo` and six `scripts/*.log` files.
- Untracked and deleted from disk: `.playwright-mcp/` debug capture artifacts (5 files, committed 2026-07-16), `.superpowers/brainstorm/3217-1780911490/` scratch session state (3 files, including a `.pid` file), the stray `UsersLeoAppDataLocalTemppms_home.html` (a mis-saved Windows temp-path file), and `src/lib/queries.ts.tmp.24540.e8ca16ed553c` (a leftover editor temp file, previously flagged but not yet cleaned up).
- Added `.playwright-mcp/`, `.superpowers/`, and `*.tmp.*` rules to `.gitignore`; deduped a repeated `.vercel`/`.env*` pair in the same file.
- `These are the brands we work on daily.docx` was reviewed and left tracked — it's real content (brand roster), not a build artifact.

*Last updated: July 21, 2026*

---

## Task 145: Tab-Refocus Dashboard Flash & Pending-Approval Retry Fix

**Date:** July 21, 2026

Fixed two related `AuthContext` bugs causing the dashboard to flash a spinner or "Pending Approval" screen for already-signed-in users, reported as random logout/relogin behavior (sometimes across all open tabs at once).

- **Tab-refocus remount:** Supabase's `GoTrueClient` re-notifies auth subscribers on every tab `visibilitychange`, including via a `SIGNED_IN` event carrying the same session (not just `TOKEN_REFRESHED` as first assumed) when the session isn't near expiry. `AuthContext` was treating every re-notification as a fresh sign-in (`loading=true` + profile refetch), causing `ProtectedRoute` to swap the whole dashboard for a spinner on alt-tab. First pass only special-cased `TOKEN_REFRESHED`; corrected to check whether the session's `user` actually changed, covering all event names. Verified against a live dev server by simulating a visibility change.
- **Pending Approval flash on transient fetch error:** `fetchProfile` returned `null` on any query error, indistinguishable from a genuinely unapproved/missing profile — so a one-off network blip or Supabase hiccup during sign-in revalidation showed "Pending Approval" for fully approved users. Now retries up to 3 times with backoff before giving up. Added `AuthContext.test.ts` covering the retry behavior.
- **Outstanding:** a temporary `console.log('[auth-debug]', ...)` line added while diagnosing (commit `26fee4e`) is still present in `AuthContext.tsx:59` and should be removed once the fix is confirmed stable in production.

---

## Task 146: Cross-Dashboard Portal SSO Callback

**Date:** July 27, 2026

Built a new public route (`/auth/portal-callback`) and Edge Function (`sso-callback`) so a user who logs into the central SSO portal can land here already authenticated, then hardened it across two review rounds.

- **Core flow:** `sso-callback` verifies the portal's signed JWT (JWKS + issuer + audience + expiry), finds-or-creates the user by email, force-approves their `profiles` row (the portal is treated as the access authority — a valid token only exists because a portal admin assigned this dashboard to that user), and mints a session the frontend adopts via `supabase.auth.setSession(...)`. New `PortalCallback` page component drives the exchange.
- **StrictMode fixes:** guarded `PortalCallback` against double-invocation (duplicate network call) and handled a previously-unhandled rejected `completePortalLogin` promise.
- **Contract/validation fixes:** repaired the SSO error-code contract and required token `exp` to be present.
- **Replay protection:** added `sso_consumed_tokens` table — each token's `jti` can only be claimed once.
- **Bounded revocation:** added `profiles.sso_provisioned`/`sso_last_verified_at`, enforced by a daily `pg_cron` job giving SSO-provisioned users a 7-day verification window before re-check.
- **Admin interaction fix:** an admin's manual re-approval in Admin Users now also clears `sso_provisioned` back to `false`, so an explicit approval isn't silently undone by the next day's cron run.
- **Unrelated crash fix surfaced during review:** closed the expiry Date-range crash path fully, not just the NaN/Infinity case.
- Migration `supabase/migrations/20260727150000_add_sso_replay_and_revocation.sql` adds the replay/revocation schema and must be applied via `supabase db push` **before** the function is deployed, since the function's code assumes that table/those columns already exist.
- Spec: `docs/superpowers/specs/2026-07-27-portal-sso-callback-design.md`. Plan: `docs/superpowers/plans/2026-07-27-portal-sso-callback.md`.
- **Outstanding:** code is complete and reviewed, but the function has NOT been deployed, its three secrets (`PORTAL_JWKS_URL`, `PORTAL_ISSUER`, `SSO_AUDIENCE`) have NOT been set, the migration has NOT been pushed, and the portal owner still needs to enable SSO for this dashboard's card.

---
