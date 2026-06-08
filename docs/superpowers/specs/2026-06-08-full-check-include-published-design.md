# Full Check — Always Include Published

**Date:** 2026-06-08  
**Status:** Approved

## Problem

The "Run Full Check" button only checks entries with status `done` or `pending`. Published entries are never re-verified, so reviews that were live and later removed by Trustpilot go undetected.

## Goal

Full Check re-verifies every TP link regardless of current status — including Published — so any review that has been removed is caught automatically.

## Design

### Approach

Always pass `include_published: true` to the status server. No toggle, no new button — Full Check is a true full check by definition.

### Changes

**`src/lib/queries.ts`**  
Add an `includePublished` parameter (default `false` for backward-compat with per-tab checks triggered from BrandGroup):

```ts
export async function triggerStatusCheck(
  tab: string,
  includePublished = false,
): Promise<{ checked: number; updated: number; errors: number; sheet_errors?: number }>
```

Body payload changes to:
```ts
body: JSON.stringify({ tab, include_published: includePublished })
```

**`src/pages/SyncStatus.tsx`**  
`handleFullCheck` calls with `includePublished = true`:
```ts
await triggerStatusCheck(tab, true);
```

Description text updated to reflect new behavior:
> "Checks all TP links including Published — detects reviews that have been removed"

### Out of scope

- Per-tab "Check Status" buttons in BrandGroup remain unchanged (still pending/done only)
- No changes to server, schema, or history storage
