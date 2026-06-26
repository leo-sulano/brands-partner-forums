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

Added automated AG (AskGamblers) and CG (CasinoGuru) review status detection via Selenium scraping, replacing the previous manual email-forwarding approach. Two new scripts (`check_ag_status.py`, `check_cg_status.py`) follow the same pattern as the existing TP scraper: they load entries with checkable statuses (Done, Pending, Published), visit each brand's AG/CG review page, search for the reviewer's username in the page source (with Load More pagination up to 10 times), and write back Published/Removed status and star rating. Off-site redirect guards prevent false results when the browser is bounced away from the platform domain. Added `/check-ag-status` and `/check-cg-status` routes to `status_server.py`. Added `triggerAgStatusCheck` and `triggerCgStatusCheck` functions to `queries.ts`. Added `AG Score` / `CG Score` label mappings for the "AG Score added" / "CG Score added" Sheet columns. Updated the Check Status button in `BrandGroup`: multi-platform tabs show a split button with a per-platform dropdown (Check TP / Check AG / Check CG), TP-only tabs show a plain Check Status button. Platforms are checked sequentially to prevent JSONB read-modify-write races.

---

## Task 51: UI Polish — KPI Card Compaction, WO Favicon Fix, SyncStatus Links, Schema row_index
**Date:** June 26, 2026

Several small fixes applied in one batch:

- **KpiCard compaction:** Reduced card minimum height (100px → 76px) and value font size (30px → 25px) for a tighter overview layout.
- **Wizard of Odds favicon resolution:** Raised the Google favicon service `sz` parameter from 16/32 to 64 across Sidebar, Topbar, BrandGroup, and Overview. Overview also renders the WO logo at `size-7` (vs `size-5` for other platforms) to compensate for the larger fetch size.
- **Topbar WO type coverage:** Added `wo` to `PLATFORM_FAVICON` and `PLATFORM_BADGE_CLS` records in Topbar so WO brand-group pages render the correct favicon badge.
- **SyncStatus clickable tabs + new-removed badge:** Tab names in the per-brand status summary are now `<Link>` elements navigating to the brand page. When a Check Status run increases the removed count for any tab, a red `+N new` pill highlights the newly removed reviews.
- **Schema `row_index`:** Added `row_index integer` column to `entries` with a `(tab, row_index asc nulls last)` index, enabling future ordered sync writes.

---

*Last updated: June 26, 2026*

---
