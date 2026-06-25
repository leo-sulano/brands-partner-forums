# Design: AG/CG Review Link Columns

**Date:** 2026-06-25

## Problem

The Google Sheet now has `AG Review Link` and `CG Review Link` columns for brands on 3-platform tabs. These links are already synced into the `entries.data` JSONB automatically by `import-tabs`, but they are not surfaced in the dashboard UI because the column whitelists in `tab-configs.ts` don't include them.

## Solution

Add the two new columns to the whitelist for every multi-platform tab, and add short display labels. No other changes are needed.

## Affected Tabs

All tabs with AG + CG platforms:
- Rooster Partners
- Hanan
- Revolution Casino
- SilverPlay

## Changes

### `src/lib/tab-configs.ts`

1. Add `'AG Review Link'` immediately after `'AG Review Status'` in each of the 4 tabs above.
2. Add `'CG Review Link'` immediately after `'CG Review Status'` in each of the 4 tabs above.
3. Add to `COLUMN_LABELS`:
   - `'AG Review Link': 'AG Link'`
   - `'CG Review Link': 'CG Link'`

## What Doesn't Change

- `import-tabs` — already syncs all JSONB columns from the sheet; no column mapping needed.
- `schema.sql` — JSONB `data` field is schema-flexible; no migration.
- `queries.ts` — raw `data` pass-through; no new extraction logic.
- `BrandGroup.tsx` — already detects URL values and renders them as external links.

## Rendering Behavior

Cells whose value starts with `http` are rendered as `<a target="_blank">` links. The new columns will display as "AG Link" / "CG Link" headers with clickable link cells when a URL is present, and an empty cell otherwise.
