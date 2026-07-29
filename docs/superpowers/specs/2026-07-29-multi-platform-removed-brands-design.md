# Multi-Platform "Page Removed" Flag

## Problem

`docs/superpowers/specs/2026-07-29-tp-removed-brands-design.md` shipped a flag for when a
brand's Trustpilot page is delisted entirely. It's TP-only: one `removed_tp_brands` table,
one checkbox in Edit Entry, one badge, one platform's Score Summary/KPI counts excluded.

Multi-platform tabs (Hanan, Rooster Partners, Revolution Casino, SilverPlay) carry the same
brand on TrustPilot, AskGamblers, and CasinoGuru independently — any one of those pages can
be delisted on its own, unrelated to the other two. Wizard of Odds is its own single-platform
tab and can have the same thing happen to its one page. Today there's no way to record "AG
page removed" or "CG page removed" or "WO page removed" at all — only TP.

This generalizes the existing TP-only flag to cover all 4 platforms (TP/AG/CG/WO)
uniformly, superseding the TP-only version shipped earlier today.

## Data model

**Migration:** rename `removed_tp_brands` → `removed_platform_brands`, add a `platform`
column, backfill existing rows to `'tp'`, and widen the uniqueness key:

```sql
alter table public.removed_tp_brands rename to removed_platform_brands;

alter table public.removed_platform_brands
  add column platform text not null default 'tp'
    check (platform in ('tp', 'ag', 'cg', 'wo'));
alter table public.removed_platform_brands alter column platform drop default;

alter table public.removed_platform_brands
  drop constraint removed_tp_brands_tab_brand_key_key;
alter table public.removed_platform_brands
  add constraint removed_platform_brands_tab_brand_key_platform_key
    unique (tab, brand_key, platform);
```

RLS policies (select/insert/update/delete, all gated on `public.is_approved()` except
select which stays open) are renamed to match the new table name; no permission logic
changes.

The 14 existing rows backfill to `platform = 'tp'` automatically via the `default 'tp'`
step above (dropped immediately after, so future inserts must specify a platform
explicitly) — zero behavior change for brands already flagged today.

**Matching:** `platformRemovedKey(tab, brand, platform)` in
`src/lib/removedPlatformBrands.ts` (renamed from `removedTpBrands.ts`) replaces
`tpRemovedKey(tab, brand)`. Same case-insensitive/trimmed brand matching as before, with an
exact platform match added: `` `${tab}::${brand.trim().toLowerCase()}::${platform}` ``.
`buildRemovedPlatformBrandSet(rows: { tab: string; brand: string; platform: Platform }[])`
replaces `buildRemovedTpBrandSet`.

## `src/lib/queries.ts`

- `fetchRemovedPlatformBrands(): Promise<{ tab: string; brand: string; platform: Platform }[]>`
  replaces `fetchRemovedTpBrands`.
- `setBrandPlatformRemoved(tab: string, brand: string, platform: Platform, removed: boolean): Promise<void>`
  replaces `setBrandTpRemoved` — same upsert/delete shape (targeting `brand_key`, per the
  earlier fix), with `platform` added to every match/insert.
- `fetchTabKpis(tab, dateFrom?, dateTo?, removedPlatformBrands?)`: the per-platform
  increments (`tpLive`/`tpRemoved`, `agLive`/`agRemoved`, `cgLive`/`cgRemoved`,
  `woLive`/`woRemoved`) each check `platformRemovedKey(tab, brand, <that platform>)`
  against the set — generalizing today's TP-only check to all four independently.

## `src/lib/scoreSummary.ts`

`computeScoreSummary`, `computeSuccessRates`, `computeTabSuccessRates` already take a
`platform: Platform` argument. Their `removedTpBrands: Set<string>` parameter is renamed
`removedPlatformBrands` and the lookup key becomes `platformRemovedKey(tab, brand, platform)`.
The `if (platform === 'tp' && ...)` gate is deleted — the platform is already part of the
key, so the exclusion is correct for whichever platform the caller passes, with no
special-casing. Viewing Score Summary's AG tab now excludes AG-flagged brands the same way
the TP tab excludes TP-flagged ones.

## Badge

`TpRemovedBadge` (`src/components/TpRemovedBadge.tsx`) becomes a small labeled pill instead
of a bare circle-X — same solid-red fill, but with the platform's 2-letter code as text
(`TP`/`AG`/`CG`/`WO`) instead of an X, tooltip `"<Platform label> page removed"`. Renders at
the same size class as before (`size-3.5`-ish height, inline with the brand name).

`BrandGroup.tsx` computes, per brand, the list of platforms actually active for that tab
(`getTabPlatforms(decodedTab)`) and flagged in `removedPlatformBrandSet`, and renders one
badge per flagged platform, in a row, immediately after the brand name — so a brand with
both TP and AG removed on a 3-platform tab shows two badges side by side; a brand with only
TP removed shows one.

## Edit Entry modal

Replaces the single "TP page removed" checkbox with one checkbox per platform active on the
current tab (`getTabPlatforms(currentTab)` — 1 checkbox for TP-only or WO-only tabs, 3 for
Hanan/Rooster Partners/Revolution Casino/SilverPlay), each labeled `"<Platform label> page
removed"` (TrustPilot / AskGamblers / CasinoGuru / Wizard of Odds).

`Props.onSave` becomes `(fields, newTab?, removedPlatforms?: Platform[]) => Promise<void>` —
the full set of currently-checked platforms, not a single boolean. `initialTpRemoved?:
boolean` becomes `initialRemovedPlatforms?: Platform[]`. The modal tracks a local
`Set<Platform>` of checked platforms, seeded from the prop, and passes its current contents
to `onSave` on Save.

`BrandGroup.tsx`'s save handler compares the returned set against the entry's initial
per-platform state (computed once per render, same as the current `initialTpRemovedForEditEntry`
pattern) and calls `setBrandPlatformRemoved(tab, brand, platform, removed)` once for each
platform whose checked state actually changed — never for platforms untouched by the user,
preserving the existing "only write on change" guard per platform independently.

## KPI cards

`BrandGroup.tsx`'s per-platform cards (`countPlatform('tp' | 'ag' | 'cg')` for
multi-platform tabs, and the single-platform-tab branch of `displayTotals`) each exclude
brands flagged removed for that specific platform — the single-platform branch uses
whichever platform is `activePlatforms[0]` (today always `'tp'` for TP-only tabs, `'wo'` for
Wizard of Odds) instead of assuming `'tp'`. `Overview.tsx`'s global per-platform totals
(fed by `fetchTabKpis`) get the same treatment automatically once `fetchTabKpis` is
generalized.

## Out of scope

- No changes to the Brand filter dropdown, TopList, or any other surface not already
  touched by the original TP-only feature.
- No cross-platform inference — flagging a brand's TP page removed says nothing about its
  AG/CG/WO pages; each platform is flagged independently, exactly as designed for TP alone
  today.
- No migration UI/tooling beyond the one-time SQL backfill above — this is a single
  in-place schema change, not a dual-write/dual-read rollout.

## Testing

- After the migration, all 14 previously-seeded rows still show their TP badge and are
  still excluded from Score Summary's TrustPilot view and the Trust Pilot KPI cards —
  zero regression from today's shipped behavior.
- Flagging a 3-platform tab's brand (e.g. Hanan) as AG-removed (not TP) shows an "AG" badge
  only, excludes it from Score Summary's AskGamblers view and the Ask Gambler KPI card, and
  leaves its TP/CG data and badges untouched.
- Flagging the same brand as both TP- and AG-removed shows two badges, excludes it from
  both platforms' views independently, and leaves CG untouched.
- Flagging a Wizard of Odds brand as WO-removed shows a "WO" badge and excludes it from
  that tab's own KPI card (its only platform).
- Unchecking any one platform's checkbox in Edit Entry (while others stay checked) removes
  only that platform's flag/badge/exclusion, leaving the others exactly as they were.
