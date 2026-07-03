# Sticky Table Header & Toolbar — Design

## Problem
On brand tab pages (`/brands/:tab`, rendered by `BrandGroup.tsx`), the search/filter toolbar and the table's column-header row scroll away with the data rows. On tabs with many rows, users lose sight of the column labels and active filters while scrolling.

## Scope
Single file: `src/pages/BrandGroup.tsx`. Since every brand tab (TP Brand Injection, Rooster Partners, Hanan, etc.) renders through this one component, the fix applies to all of them automatically. No other pages are in scope.

## Approach (revised — see "Why not whole-page sticky" below)
The table currently sits inside `<div className="overflow-x-auto">`, which handles horizontal scrolling for wide tables and enables the existing frozen checkbox/Account columns. Verified empirically (headless-browser reproduction, see below): `position: sticky` on elements inside that div **cannot** stick relative to the page (`<main>`) — browsers force `overflow-y` to compute to `auto` on any element whose `overflow-x` is `auto`/`scroll`, even if `overflow-y` is never set. That silently makes the horizontal-scroll div itself the "nearest scrolling ancestor" for sticky descendants, and since that div's height just auto-fits its content (it never actually needs to scroll vertically on its own), sticky positioning inside it is inert — it drifts away with the page instead of sticking. This is a spec-mandated browser behavior, not fixable with plain CSS on that element.

The fix: turn the toolbar+table card into its own bounded-height, self-scrolling panel — the standard pattern used by data-grid UIs (Notion/Airtable-style tables) for exactly this combination of sticky header + frozen columns + horizontal scroll.

1. **Bounded scroll panel**: the outer card (`rounded-lg border ... bg-white shadow-sm`) gets `max-height: calc(100vh - 280px)` and `overflow: auto` (both axes — replaces the old `overflow-x-auto` div, which is removed; the table becomes a direct child of the card). The `280px` is a reasonable fixed estimate covering the topbar, page padding, and pagination footer — not pixel-exact per tab (KPI-card height varies), but keeps the panel a sane size everywhere. This card is now the sticky positioning context for everything inside it.
2. **Toolbar**: `position: sticky; top: 0; left: 0` (both axes — see "Why `left: 0` too" below), with an opaque white background, so it pins to the top of the panel once scrolled and doesn't drift sideways when the panel is scrolled horizontally.
3. **Column header row**: every `<th>` gets `position: sticky` with a `top` offset equal to the toolbar's actual rendered height, plus an opaque background (`bg-slate-50`, matching today's frozen-column cells). Sits directly below the sticky toolbar with no gap.
4. **Dynamic offset**: the toolbar's height isn't fixed — it wraps to multiple lines on narrow viewports and has a different height in "N selected" mode. A `ResizeObserver` on the toolbar element tracks its live height in state; the header's `top` offset uses that value so the two stay flush in every case.
5. **Z-index layering**: adding vertical stickiness to *all* header cells makes them "positioned," which changes how overlapping ties resolve (later DOM elements win ties at equal z-index) — this could break the existing horizontal freeze if not addressed:
   - Sticky toolbar: highest (z-40)
   - Frozen corner header cells (checkbox/Account column, sticky both top+left): above other header cells (z-30)
   - Regular header cells (sticky top only): above any table body content (z-[25])
   - Table body content (existing selected-row outline z-20, frozen body cells z-10): unchanged

### Why not whole-page sticky (the originally-approved approach)
The first version of this design kept the table's `overflow-x-auto` div as-is and just added `position: sticky` to the toolbar (outside that div, relative to `<main>`) and to the header cells (inside that div). A headless-browser reproduction of that exact structure proved it doesn't work: header cells measured via `getBoundingClientRect()` scrolled fully away instead of sticking, confirming the `overflow-x`/`overflow-y` coupling above. The bounded-panel approach was chosen over the alternative (letting `<main>` itself handle horizontal overflow) because that alternative would add a page-wide horizontal scrollbar under KPI cards too, on every brand tab, not just under the table.

### Why `left: 0` too
Once the toolbar lives inside the same scrolling container as the table (needed so both share one sticky positioning context), scrolling that container horizontally would carry the toolbar sideways along with everything else unless it's also pinned on the inline axis. Verified in the reproduction: without `left: 0`, the toolbar drifted out of view on a 300px horizontal scroll; with it, position was stable.

No changes to data fetching, filtering logic, or any other page.

## Out of scope
- No scroll shadow / border animation when the header becomes stuck (existing borders on the toolbar and header row provide enough separation).
- No changes to `MentionsTable`, `RunHistoryTable`, or any other table component — only `BrandGroup.tsx`'s table.
- No per-tab dynamic sizing of the panel height (fixed `calc(100vh - 280px)` estimate for every tab).
