# TP-Removed Brand Flag: Badge + Score Summary Exclusion

## Problem

Some brands have had their Trustpilot page delisted entirely (Trustpilot took the
whole review page down), distinct from any single review having a "Removed" status.
Today there's no way to record this brand-level fact, so:

- These brands' historical TP reviews still count toward Score Summary totals as if
  their TP page were live, which is misleading.
- There's no visual signal in the brand-group tables that a brand's TP page is gone.

Initial known cases (mapped to real tab names — `tabDisplayName()` in
`src/lib/tabs.ts` confirms BITP = "TP Brand Injection", FTP = "TP Affiliate"):

| Tab | Brands |
|---|---|
| TP Brand Injection | NovaJackpot Casino, Lapalingo Casino, Prive Casino, Rabona Casino, Monsterwin Casino, Cazeus Casino |
| TP Affiliate | Deutschlands Online Casino Spielhalle 2026, Bestes Online Casino Deutschland, Bestes Online Casino Deutschland Spielhalle, Online Casino Deutschland, Best Online Casinos Review Nz |
| Hanan | Pribet.com, WinMega.com, RealSpin.com |

## Data model

New table, migration `supabase/migrations/<ts>_add_removed_tp_brands.sql`:

```sql
create table public.removed_tp_brands (
  id          uuid primary key default gen_random_uuid(),
  tab         text not null,
  brand       text not null,
  removed_by  text,
  removed_at  timestamptz not null default now(),
  unique (tab, brand)
);

alter table public.removed_tp_brands enable row level security;

create policy "anyone can read removed_tp_brands"
  on public.removed_tp_brands for select using (true);
create policy "approved users can insert removed_tp_brands"
  on public.removed_tp_brands for insert with check (public.is_approved());
create policy "approved users can delete removed_tp_brands"
  on public.removed_tp_brands for delete using (public.is_approved());
```

A brand is "TP-removed" purely by the existence of a `(tab, brand)` row — no boolean
column. Toggling off deletes the row. Matches [[RLS DELETE Policy]] guidance: explicit
delete policy included, not left to silently no-op.

The same migration seeds the 14 initial `(tab, brand)` pairs from the table above.

**Matching**: lookups compare `tab` exactly and `brand` case-insensitively/trimmed
(`brand.trim().toLowerCase()`), consistent with how `getBrandTpUrl` in
`tab-configs.ts` already resolves brand-keyed maps — brand casing in the sheet data
has drifted before (see `BRAND_TP_URLS` having both `"revolution"` and `"revolution
casino"` variants).

## `src/lib/queries.ts` additions

- `fetchRemovedTpBrands(): Promise<{ tab: string; brand: string }[]>` — reads the
  whole table (small, no per-tab filtering needed server-side).
- `setBrandTpRemoved(tab: string, brand: string, removed: boolean): Promise<void>` —
  `removed: true` upserts `(tab, brand)`; `false` deletes the matching row.

## Badge

New `src/components/TpRemovedBadge.tsx`: a small filled-red circle with a white X
(e.g. built on lucide's `XCircle`, red fill), `title="TP page removed"` for a hover
tooltip. Sized to sit inline next to a brand name (`size-3.5` or similar, matching
the existing `ExternalLink` icon sizing already used in these same cells).

### Where it renders

`src/pages/BrandGroup.tsx` fetches the full `removed_tp_brands` table once (same
pattern as `fetchAllEntries`), builds a `Set<string>` keyed `` `${tab}::${brand.trim().toLowerCase()}` ``,
and exposes a helper `isTpRemoved(tab, brand)`. The badge is added to all three
existing brand-cell render branches:

- `h === 'Brand / TP URL PAGE'` (~line 2070)
- `h === 'URL PAGE'` (~line 2100)
- `h === 'Brands' || h === 'Brand Name' || h === 'Brand'` (~line 2144)

In each, if `isTpRemoved(decodedTab, brandName)` is true, render the badge
immediately after the brand name/link, inside the same `<td>`.

**Out of scope**: no badge in the Brand filter dropdown, Score Summary rows, or
TopList — only the BrandGroup table cells, per confirmed scope.

## Manual toggle — Edit Entry modal

`src/components/EditEntryModal.tsx` gets a new checkbox, "TP page removed",
initialized from the current flag state for that entry's resolved brand (via
`getBrandNameCol(tab)` / `BRAND_COLS`, same resolution `BrandGroup.tsx` already uses
at line 1066). It is **not** one of the entry's own field edits — it's a separate
record.

On Save, `BrandGroup.tsx`'s modal-save handler:
1. Saves entry fields via the existing `onSave` path (unchanged).
2. If the checkbox state changed from its initial value, calls
   `setBrandTpRemoved(currentTab, resolvedBrand, newState)`.

Because the flag is keyed by `(tab, brand)`, this one save affects every row sharing
that brand name within the tab — all of them show/hide the badge immediately once the
local `removed_tp_brands` set is refetched/updated in state.

## Score Summary exclusion

`src/lib/scoreSummary.ts`:

- `computeScoreSummary`, `computeSuccessRates`, and `computeTabSuccessRates` each gain
  an optional parameter `removedTpBrands?: Set<string>` (same key format as above:
  `` `${tab}::${brand.trim().toLowerCase()}` ``).
- Inside each function's per-entry loop, when `platform === 'tp'` and the entry's
  resolved `(tab, brand)` key is present in `removedTpBrands`, the entry is skipped
  entirely (before status/date filtering) — so it's absent from star-rating counts,
  `unrated`, `total`, and from both per-brand and per-tab Success Rate (Published /
  Removed / Total) numbers alike.
- For any other platform (`ag`/`cg`/`wo`), the parameter is ignored — the brand's
  non-TP data is unaffected, since only its TP page is gone.

`src/components/ScoreSummaryPanel.tsx` (and `src/pages/ScoreSummary.tsx`, which owns
the entries fetch) additionally fetches `fetchRemovedTpBrands()` alongside entries,
builds the `Set`, and passes it into all three `computeScoreSummary` /
`computeSuccessRates` / `computeTabSuccessRates` call sites.

## Out of scope

- `BrandGroup.tsx`'s own per-tab KPI cards (Live/Removed/Done/Pending counts at the
  top of each tab page) are unaffected — they reflect whatever's currently
  filtered/displayed, not an aggregate that needs silent hiding, and the inline badge
  already makes TP-removed rows visible there.
- No badge or exclusion logic added for AG/CG/WO platforms — this flag is TP-specific
  by definition (see Problem section).
- No UI to browse/manage the full list of flagged brands outside the Edit Entry modal
  (no dedicated admin screen) — toggling happens per-brand, in context, when editing
  that brand's entries.

## Testing

- After the migration runs, the 14 seeded brands show the red badge in their
  respective tab's `BrandGroup` table, next to every row sharing that brand name.
- Score Summary, TrustPilot platform view: none of the 14 seeded brands appear in
  their tab's brand list; that tab's group Total row (star counts + Success Rate)
  reflects only the remaining, non-flagged brands.
- Score Summary, AskGamblers/CasinoGuru/Wizard of Odds platform views: seeded brands
  that also have AG/CG/WO data still appear normally, unaffected.
- Edit Entry modal: checking "TP page removed" on one row and saving immediately
  shows the badge on every other row sharing that brand in the same tab; unchecking
  removes it from all of them.
- Toggling a brand off (unchecking, saving) makes it reappear in the TP Score
  Summary and removes its badge from the table.
