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

*Last updated: June 2, 2026*
