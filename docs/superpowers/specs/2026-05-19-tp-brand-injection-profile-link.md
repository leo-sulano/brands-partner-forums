# TP Brand Injection — Add Profile Link Column

**Date:** 2026-05-19

## Summary

Add the `Link to the profile` column to the TP Brand Injection tab's column whitelist so the Profile Link field is visible and clickable in the dashboard table.

## Change

**File:** `src/lib/tab-configs.ts`

Add `'Link to the profile'` after `'Trust Pilot'` in the `TP Brand Injection` entry of `TAB_COLUMN_CONFIGS`:

```typescript
'TP Brand Injection': [
  'Account',
  'Proxy Used',
  'Account Name',
  'Brand / TP URL PAGE',
  'Trust Pilot',
  'Link to the profile',   // added
  'Review Status',
],
```

## Why No Other Changes Are Needed

- `COLUMN_LABELS` already maps `'Link to the profile'` → `'Profile Link'` (display label)
- `isLinkCol` already detects `'profile'` in the header and renders the cell as a clickable external link button
- The sheet data for this column is already synced into the `entries.data` JSONB field
