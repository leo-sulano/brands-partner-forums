# Unified "Brand Link" field across all brand tabs

## Problem

Only two tabs have anything resembling a brand-constant link field today, under
two different names: `Brand / TP URL PAGE__href` (TP Brand Injection, no
explicit label) and `URL PAGE__href` (TP Affiliate, labeled "Brand Links").
Every other tab (Rooster Partners, Hanan, Revolution Casino, Trybet,
HazEmirates UAE, SilverPlay, SuprPlay Limited, GRG) has no equivalent column —
the closest thing, `Link to the profile`, was confirmed against live data to
hold 20-70+ distinct per-review confirmation links per brand
(`trustpilot.com/submitted/review?correlationid=...`), i.e. it is NOT a brand
constant on those tabs. Wizard of Odds is the one exception: it reuses that
same column name for its single WO page per brand (already fixed to
auto-sync in a prior change).

While wiring this up, a separate, pre-existing bug was found in
`AddReviewAccountModal.tsx`: it hardcodes the field key `'Brand Name'` for
every tab, but the real brand-identity column differs by tab (`Brands` for
Rooster Partners/Hanan/Revolution Casino/SilverPlay/Trybet/HazEmirates UAE,
`Brand / TP URL PAGE` for TP Brand Injection, `URL PAGE` for TP Affiliate).
Confirmed against live data: 12 rows created via "Add Review Account" are
currently brand-orphaned in the table view because of this (2 Rooster
Partners, 6 SilverPlay — 100% of its dashboard-created rows, 3 Trybet — 100%,
1 TP Brand Injection).

## Goal

1. One consistently-labeled **"Brand Link"** field on every brand tab, backed
   by whichever data source is reliable for that tab, auto-filled and
   re-filled when the brand selection changes — in both the Edit Entry modal
   and the Add Review Account modal.
2. Fix the underlying brand-key mismatch in the Add modal so new entries stop
   getting orphaned, and backfill the 12 rows already affected.
3. No data migration for the two tabs that already have this link under a
   different internal key — keep existing keys, unify only the visible label.

## Design

### Shared resolvers (`src/lib/tab-configs.ts`)

Two modals and one page currently each work out "which key holds the brand
name" independently — that duplication is exactly how the orphaning bug
happened. Replace it with shared, exported functions:

```ts
export const BRAND_COLS = ['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE', 'Account Name'];

// The column that holds this tab's brand identity.
export function getBrandNameCol(tab: string): string {
  const cols = TAB_COLUMN_CONFIGS[tab];
  return (cols && BRAND_COLS.find((c) => cols.includes(c))) || 'Brand Name';
}

// The column that holds this tab's brand-constant link (as opposed to any
// per-review confirmation link, which "Link to the profile" holds everywhere
// except Wizard of Odds).
export function getBrandLinkCol(tab: string): string {
  if (tab === 'TP Brand Injection') return 'Brand / TP URL PAGE__href';
  if (tab === 'TP Affiliate') return 'URL PAGE__href';
  if (tab === 'Wizard of Odds') return 'Link to the profile';
  return 'Brand Link';
}

// TP Affiliate's page titles have no external identity to hardcode against —
// only the tab-local consensus (brandProfiles) can supply a value there.
export function resolveBrandLink(brand: string, tab: string, tabLocalValue?: string): string {
  if (tab === 'TP Affiliate') return tabLocalValue ?? '';
  return getBrandTpUrl(brand, tab) || tabLocalValue || '';
}
```

`BrandGroup.tsx` currently defines its own local `BRAND_COLS` — replace that
with importing the one above (behavior unchanged there: it still resolves
`brandCol` from the tab's live `headers`, not from `getBrandNameCol`; only the
constant's definition moves to a single shared location).

### Label unification

- `COLUMN_LABELS['Brand / TP URL PAGE__href'] = 'Brand Link'` (new entry).
- `COLUMN_LABELS['URL PAGE__href']`: `'Brand Links'` → `'Brand Link'`.
- `TAB_COLUMN_LABELS['Wizard of Odds']['Link to the profile']`: `'Profile Link'` → `'Brand Link'`.
- Every other tab's `Link to the profile` keeps its existing `'TP Links'` label — unchanged, still the per-review confirmation link.

### New column on 8 tabs

Add `'Brand Link'` to `TAB_COLUMN_CONFIGS` for Rooster Partners, Hanan,
Revolution Casino, SilverPlay, Trybet, HazEmirates UAE, SuprPlay Limited, and
GRG - Gulf Recovery Group, positioned right after the brand-name column.
Auto-filled from the existing `BRAND_TP_URLS`/`TAB_BRAND_URLS` map, which
already covers essentially every brand across these tabs (built during a
prior change in this same area).

### `brandProfiles` (`src/pages/BrandGroup.tsx`)

Add `'Brand Link'` to the aggregated `LINK_COLS` list (alongside the
already-added `'URL PAGE__href'`), so the 8 new-column tabs also get a
tab-local fallback for brands not yet in the static map.

### Edit Entry modal (`src/components/EditEntryModal.tsx`)

Replace the three existing special-case blocks in the brand `onChange`
handler (`BRAND_TP_URL_COL`, `AFFILIATE_URL_COL`, the Wizard-of-Odds
`'Link to the profile'` check — all shipped in a prior change) with one
generic block:

```ts
const linkCol = getBrandLinkCol(tabForLookup);
if (linkCol in next) next[linkCol] = resolveBrandLink(v, tabForLookup, profile?.[linkCol]);
```

Same behavior for the 3 tabs that already worked; now also covers the 8 new
ones for free.

### Add Review Account modal (`src/components/AddReviewAccountModal.tsx`)

- The brand field's key becomes `getBrandNameCol(selectedTab)` instead of the
  hardcoded literal `'Brand Name'`, computed per render and re-injected on tab
  change the same way `AGENT_FIELD` is already conditionally spliced in.
  `handleTabChange` and `handleBrandChange` update to use the same dynamic
  key instead of the hardcoded string.
- Add a dynamically-keyed "Brand Link" field (`getBrandLinkCol(selectedTab)`),
  auto-filled via `resolveBrandLink` inside `handleBrandChange`.
- Extend `handleBrandChange` to also auto-fill `AG Review Link` /
  `CG Review Link` from `brandProfiles`, falling back to the static
  `getBrandAgUrl`/`getBrandCgUrl` maps — matching the Edit modal's existing
  behavior (currently the Add modal doesn't auto-fill either field at all).

### Backfill migration

A new file in `supabase/migrations/` (following the existing naming/format
convention) with targeted `UPDATE` statements moving the stray `Brand Name`
value into the correct column for the 12 confirmed rows, then clearing the
stray key. Run via `supabase db push`, same as prior migrations in this repo.

## Out of scope

- Any change to `Link to the profile`'s behavior on tabs other than Wizard of
  Odds — it stays the per-review confirmation link everywhere else.
- Migrating `Brand / TP URL PAGE__href` / `URL PAGE__href` to a shared literal
  key — internal keys stay as they are; only the label is unified.
- Any UI/table column reordering beyond placing the new `Brand Link` column
  next to the brand-name column.
