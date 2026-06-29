# All Columns Editable — Design Spec
**Date:** 2026-06-29

## Problem
In `BrandGroup.tsx`, inline editing is gated behind a hardcoded `INLINE_EDIT_COLS` whitelist. Columns not in that set are fully read-only. The team wants every column to be editable so any data can be corrected from the dashboard without going to the Google Sheet directly.

## Scope
- **In:** BrandGroup.tsx inline editing behaviour
- **Out:** queries.ts, schema, MentionsTable, EditEntryModal, any other page or component

## Design

### 1. Remove the INLINE_EDIT_COLS whitelist
Delete the `INLINE_EDIT_COLS` Set and the `isInlineEditable()` guard that wraps cell click handlers. Every column except Account Name becomes click-to-edit. The existing type-detection logic (status → dropdown, date → text input, etc.) already runs on any header string, so it carries over automatically.

### 2. Account Name column — unchanged
Clicking the Account Name cell continues to open `EditEntryModal` (the full-field modal). No change to that code path.

### 3. Link/URL columns — split read/edit modes
Columns currently rendered as clickable `<a>` tags need a two-mode approach:

- **Read mode** (default): render the URL as a truncated `<a>` with `target="_blank"`, same as today.
- **Edit mode** (after click): replace the cell with a `<input type="text">` pre-filled with the current URL **plus** a small external-link icon button (`↗`) that opens the URL in a new tab while the input is active.
- On blur or Enter: call `saveInlineEdit()` → `updateEntryData()` — same save path used by all other inline edits.

A column is treated as a "link column" if its header name matches the existing link-detection heuristic already used in the render path (e.g. contains `URL`, `url`, or `Link`).

### 4. Save flow — no changes
`updateEntryData(id, tab, sheetRowId, fields)` in `lib/queries.ts` merges any field into the JSONB `data` blob, writes `last_edited_by = 'dashboard'`, attributes the edit to the signed-in user, and fires a non-blocking push to the Google Sheet. No new query function is needed.

Dashboard-only columns (e.g. `AG User`, `CG User`) are already excluded from the Sheet push via `DASHBOARD_ONLY_COLS` — that list stays as-is.

## UX Details
- **Click to enter edit mode** — same interaction as today's editable cells.
- **Escape to cancel** — reverts to last saved value, no save call.
- **Enter or blur to save** — triggers `saveInlineEdit()`.
- **Status columns** (header contains "status"): dropdown with the existing preset options list.
- **All other columns**: plain `<input type="text">`.
- **Link columns in edit mode**: `<input type="text">` + `↗` icon button to open URL.

## What Does NOT Change
- Column order, visibility, and tab-config whitelists
- Pagination, filters, sorting
- The `EditEntryModal` and how Account Name opens it
- `queries.ts`, Supabase schema, RLS policies
- MentionsTable (separate component, separate use case)
