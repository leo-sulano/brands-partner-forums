# Design: Trustpilot Review Status Auto-Detection

**Date:** 2026-05-21  
**Status:** Approved

## Problem

Agents post Trustpilot reviews and add the direct review URL (`profile_url`) to the dashboard. The review's status on Trustpilot changes over time (Pending → Published → Removed/Refused), but currently someone must manually visit each URL and update the status in the table. This is slow and error-prone at scale.

## Goal

Automatically detect the current state of each Trustpilot review URL and update the `status` field in `review_entries` accordingly — on a daily schedule and on demand from the UI.

## Status Lifecycle

| State | DB `status` value |
|---|---|
| Agent submitted the review | `Done` |
| Trustpilot has it under moderation | `Pending` |
| Trustpilot published it | `Published` |
| Trustpilot rejected it | `Refused` |
| Trustpilot removed it after publishing | `Removed` |

## Architecture

A new Supabase Edge Function `check-review-status` handles both the scheduled and on-demand triggers. No new database columns are needed.

### Triggers

- **Scheduled:** pg_cron runs the function daily at 08:00 UTC.
- **On-demand:** A "Check Status" button in the BrandGroup UI calls the function via HTTP POST.

### Function Flow

```
receive request
  → query review_entries WHERE profile_url IS NOT NULL AND status != 'Refused'
  → for each row:
      fetch profile_url with browser-like User-Agent header
      if HTTP 404 OR redirect away from review page → new_status = 'Removed'
      else parse __NEXT_DATA__ JSON from HTML body:
          'published' → 'Published'
          'pending'   → 'Pending'
          'refused'   → 'Refused'
          unrecognised → skip (do not mutate)
      if new_status != current status → UPDATE review_entries SET status = new_status
      wait 600ms before next request (rate-limit protection)
  → return { checked: N, updated: N, errors: N }
```

### Error Handling

- If a fetch fails (network error, unexpected HTML, missing `__NEXT_DATA__`), the row is skipped and counted in `errors`. Its status is left unchanged — a failed check never corrupts existing data.
- The function always returns HTTP 200 with the summary payload; individual row errors do not abort the run.

### Scheduling (schema.sql addition)

```sql
SELECT cron.schedule(
  'check-review-status-daily',
  '0 8 * * *',
  $$ SELECT net.http_post(
       '<SUPABASE_FUNCTION_URL>/check-review-status',
       '{}',
       'application/json'
     ) $$
);
```

`<SUPABASE_FUNCTION_URL>` is injected via environment variable at deploy time.

## New Files

| Path | Purpose |
|---|---|
| `supabase/functions/check-review-status/index.ts` | Deno Edge Function — fetch, parse, update |

## Modified Files

| Path | Change |
|---|---|
| `supabase/schema.sql` | Add pg_cron job |
| `src/pages/BrandGroup.tsx` | Add "Check Status" button + last-checked label |

## UI

A **"Check Status"** button is added to the BrandGroup toolbar alongside the existing filters.

### Button States

| State | Appearance |
|---|---|
| Idle | "Check Status" with refresh icon |
| Loading | Spinner + "Checking…", button disabled |
| Done (updates found) | Toast: "X reviews updated" |
| Done (no changes) | Toast: "All reviews up to date" |
| Error | Toast: "Check failed — try again" |

### Scope

The check runs against all rows in the **current tab** that have a `profile_url` and a non-Refused status. It does not scan the entire database.

### Last Checked Indicator

A small `"Last checked: [date] at [time]"` label sits next to the button. The timestamp is written to `localStorage` after each successful run — no DB column needed.

## Notes

- `Done` rows (agent submitted, not yet moderated) **are included** in the check. If Trustpilot has already processed them, the status updates to `Pending`, `Published`, or `Refused` automatically.
- The 600ms inter-request delay keeps the function well within Trustpilot's informal rate limits for non-API access.

## Out of Scope

- Detecting status changes for rows without a `profile_url` (nothing to fetch).
- Re-checking `Refused` rows (that state is final).
- Notifying users via email/Slack when a status changes.
- Retry logic for failed individual rows (deferred).
