# Brand Tab Success Rate Card

## Background

Every brand tab page (`BrandGroup.tsx`) already shows summary cards at the top:
single-platform tabs (e.g. BITP) show Total/Live/Removed; three-platform tabs
(e.g. Rooster Partners) show one card per platform with Live/Removed counts.
Score Summary already computes a per-brand/per-tab "Success Rate" (`live / (live
+ removed) × 100`, date-filtered when a range is selected, all-time otherwise —
see `computeSuccessRates`/`computeTabSuccessRates` in `src/lib/scoreSummary.ts`
and [[project_score_summary_semantics]]). Brand tab pages have no equivalent —
this adds it directly to the existing summary cards, using the same formula and
the same already-computed, already-filtered counts the page uses today.

## Formula

`rate = live / (live + removed) × 100`, rounded to the nearest whole number.
`—` when `live + removed === 0` (no decided outcome yet on that platform/tab in
the current filter scope).

Computed from data BrandGroup.tsx already has:
- Single-platform tabs: `displayTotals.live` / `displayTotals.removed`
  (`BrandGroup.tsx` ~1415-1441).
- Three-platform tabs: `displayKpis[key].live` / `displayKpis[key].removed`,
  per platform (`BrandGroup.tsx` ~1374-1393).

Both already respect the active date-range filter and already exclude
platform-removed brands (`removedPlatformBrands`/`isPlatformRemoved`) — no new
data plumbing needed, this is purely a display addition reading existing state.

## 1. Single-platform tabs (Total / Live / Removed row)

Add a 4th `KpiCard` to the existing row (`BrandGroup.tsx` ~1689-1714):

- Grid changes from `sm:grid-cols-3` to `sm:grid-cols-4`.
- Label: "Success Rate". Value: rounded whole-percent string (e.g. `"73%"`) or
  `"—"`. Hint: "Live ÷ (Live + Removed)".
- Non-clickable (no `onClick`) — there's no corresponding row filter for a
  percentage.
- New `violet` color variant added to `KpiCard`'s `colorMap`
  (`src/components/KpiCard.tsx`, currently `blue`/`emerald`/`rose` only), used
  for this card so it's visually distinct from Total (blue) / Live (emerald) /
  Removed (rose).

## 2. Three-platform tabs (per-platform cards)

Add a small percentage badge to each platform card's header row
(`BrandGroup.tsx` ~1742-1751), computed from that card's own
`displayKpis[key]`:

```tsx
<div className="flex items-center gap-2 mb-3">
  <img src={PLATFORM_FAVICON[key]} ... />
  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
  <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-full px-1.5 py-0.5">
    {rate}
  </span>
  {active && <Check className="size-3 ml-auto text-blue-500" />}
</span>
```

- Badge shows the rounded whole-percent string or `—`.
- Non-interactive — doesn't affect the card's existing click-to-filter
  behavior (the whole card button still toggles `platformFilter`).
- Placed after the label, before the active checkmark, inside the existing
  header `div` (the `Check` icon keeps its `ml-auto` and stays right-aligned).

## Out of scope

- No change to Score Summary page or its Success Rate computation.
- No new filter/interaction tied to the new card or badge.
- No change to the underlying data model, `queries.ts`, or any Supabase table.
- No change to how Live/Removed are classified (`isLive`/`isRemoved` in
  `BrandGroup.tsx` stay as-is).
