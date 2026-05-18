# Design: Brand-first Google Sheet Integration

**Date:** 2026-05-18  
**Status:** Approved  
**Sheet ID:** `1YufhZ3Wpq8vUdZhmTX96-3w4KrAQm8roXDJncXvf0wk`

---

## Goal

Connect the Forums Dashboard to the Brand Partner Forums Google Sheet so that whatever is in the sheet is reflected on the website. Data is organized by brand group (one tab per group). The team checks the site brand-by-brand daily to see review statuses (live vs. removed).

---

## Architecture

### Data flow

```
Google Sheet (one tab per brand group)
  └─► Apps Script Web App (op=dump)
        └─► import-tabs Edge Function (Supabase)
              └─► entries table (tab + sheet_row_id + data JSONB)
                    └─► React dashboard (/brands/:tab)
```

The `import-tabs` Edge Function already handles multi-tab import, loop prevention, and sync audit trail. No changes needed to the Edge Function itself.

### Google Sheet structure

- **Sheet ID:** `1YufhZ3Wpq8vUdZhmTX96-3w4KrAQm8roXDJncXvf0wk`
- **Tabs:** One per brand group — e.g. "Rooster Partners", "Revolution Group", "Hanan Brand", etc.
- **Columns per tab:** Casino name, Platform (TP/AG/CG), Status (live/removed), Date, Notes, plus any additional columns.
- **Row ID:** Apps Script generates a stable `id` value from the row number if no `id` column exists. This is the `sheet_row_id` used for upsert idempotency.

---

## Part 1: Apps Script setup (one-time)

A `Code.gs` file is added to the Google Sheet's Apps Script editor. It handles two operations:

### `GET ?secret=...&op=dump`
Returns all tabs as JSON:
```json
{
  "ok": true,
  "tabs": [
    {
      "name": "Rooster Partners",
      "headers": ["id", "casino", "platform", "status", "date", "notes"],
      "rows": [["1", "Lucky7even", "TP", "Live", "2026-05-10", "..."]]
    }
  ]
}
```

### `POST ?secret=...&op=upsert_row`
Accepts `{ tab, sheet_row_id, fields }` and writes field values back to the matching row. Used by `push-to-sheet` Edge Function for write-back.

### Row ID strategy
If the tab has no `id` column, the Apps Script assigns `row_index` (1-based data row number) as the `id`. This is stable as long as rows are not reordered. The `id` column is injected into `headers` and `rows` by the script before returning, so `import-tabs` always sees it.

### Deployment
- Deploy as **Web App**, execute as **Me**, access by **Anyone** (URL-guarded by shared secret).
- The Web App URL and shared secret are set as Supabase Edge Function secrets:
  - `APPS_SCRIPT_URL` = Web App exec URL
  - `APPS_SCRIPT_SECRET` = shared secret string

---

## Part 2: Supabase secrets configuration

Set the following in the Supabase dashboard under **Edge Functions → Secrets** (or via CLI):

| Secret | Value |
|--------|-------|
| `APPS_SCRIPT_URL` | The Web App exec URL the user provides |
| `APPS_SCRIPT_SECRET` | A shared secret string (same value in Code.gs and here) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the runtime.

> **Note:** `.env.example` uses the older names `APPS_SCRIPT_WEB_APP_URL` / `APPS_SCRIPT_SHARED_SECRET`. The Edge Function (`import-tabs/index.ts`) reads `APPS_SCRIPT_URL` and `APPS_SCRIPT_SECRET`. Set the Supabase secrets using the Edge Function names. Update `.env.example` to match as part of this work.

---

## Part 3: New query functions (`src/lib/queries.ts`)

Three functions added:

### `fetchAvailableTabs(): Promise<string[]>`
Reads `tab_schemas` table, returns list of tab names sorted alphabetically. Used by the Sidebar to build the brand group nav list dynamically. Returns `[]` if no tabs exist yet (before first sync).

### `fetchEntriesByTab(tab: string): Promise<BrandEntry[]>`
Fetches all `entries` rows where `tab = ?`, ordered by `updated_at DESC`. Maps each row's JSONB `data` to a `BrandEntry` shape with fallback column name resolution (same `getField` pattern already in use).

```typescript
export interface BrandEntry {
  id: string;
  tab: string;
  source_row_id: string;
  casino: string;
  platform: string | null;   // TP / AG / CG
  status: string;            // live / removed / new / etc.
  date: string | null;
  notes: string | null;
}
```

Column name fallbacks for `entryToBrandEntry`:
- `casino` ← `casino`, `Casino`, `casino_name`, `Casino Name`, `name`, `Name`
- `platform` ← `platform`, `Platform`
- `status` ← `status`, `Status`
- `date` ← `date`, `Date`, `posted_at`, `Posted At`
- `notes` ← `notes`, `Notes`, `note`, `Note`

### `fetchTabKpis(tab: string): Promise<TabKpis>`
Fetches all entries for the tab, counts by status value.

```typescript
export interface TabKpis {
  total: number;
  live: number;
  removed: number;
}
```

"Live" = status contains "live" (case-insensitive). "Removed" = status contains "removed" (case-insensitive). All others count toward total only.

---

## Part 4: New page — `src/pages/BrandGroup.tsx`

**Route:** `/brands/:tab`  
**URL encoding:** tab name is URL-encoded, e.g. `Rooster Partners` → `/brands/Rooster%20Partners`

### Layout

```
┌──────────────────────────────────────────────────────┐
│ [Total: 10]   [Live: 7]   [Removed: 3]               │  ← KPI row (3 KpiCards)
├──────────────────────────────────────────────────────┤
│ Casino        Platform   Status     Date       Notes  │
│ Lucky7even    TP         🟢 Live    2026-05-10  —      │
│ Fortuneplay   TP         🔴 Removed 2026-05-08  —      │
│ ...                                                   │
└──────────────────────────────────────────────────────┘
```

### Behaviour
- Fetches `fetchTabKpis(tab)` and `fetchEntriesByTab(tab)` in parallel on mount.
- Each table row is clickable → navigates to `/mentions/:id`.
- Status displayed as a colored pill: green for live, red for removed, grey for anything else.
- Realtime subscription via `subscribeEntries()` — re-fetches on any `entries` change (same debounce pattern as Overview).
- Loading skeleton and error state (same pattern as Overview).

---

## Part 5: Sidebar update (`src/components/Sidebar.tsx`)

- Fetches `fetchAvailableTabs()` on mount.
- Renders a "Brands" section below the existing nav items, with one `NavLink` per tab: `/brands/:encodedTab`.
- Active state highlights the current brand group.
- If no tabs loaded yet (before first sync), shows a muted "No brands synced yet" placeholder.
- Tab names truncated with `truncate` if longer than sidebar width.

---

## Part 6: App.tsx — new route

Add:
```tsx
<Route path="/brands/:tab" element={<BrandGroup />} />
```

---

## Part 7: Topbar update (`src/components/Topbar.tsx`)

Add handling for `/brands/` prefix: decode the `:tab` param and show it as the page title.

```typescript
pathname.startsWith('/brands/')
  ? decodeURIComponent(pathname.replace('/brands/', ''))
  : ...
```

---

## Error handling

| Scenario | Behaviour |
|----------|-----------|
| Apps Script unreachable | `import-tabs` writes `error` sync_run; dashboard shows last synced data |
| Tab has no recognisable columns | `BrandEntry` fields fall back to empty string / null; row still renders |
| `tab_schemas` empty (no sync yet) | Sidebar shows placeholder; Overview still works |
| Row click on missing entry | `MentionDetail` shows "Entry not found" (already handled) |

---

## Out of scope

- Filtering within a brand group table (by platform, status, date range)
- Bulk status edit across multiple rows
- Cron schedule for automatic sync (manual trigger via Sync Status page is sufficient for now)
- RLS policies (Vercel password protection guards the deploy)
