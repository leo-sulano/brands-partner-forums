# Sticky Table Header & Toolbar — Design

## Problem
On brand tab pages (`/brands/:tab`, rendered by `BrandGroup.tsx`), the table's column-header row scrolls away with the data rows. On tabs with many rows, users lose sight of the column labels while scrolling.

## Scope
Single file: `src/pages/BrandGroup.tsx`. Since every brand tab (TP Brand Injection, Rooster Partners, Hanan, etc.) renders through this one component, the fix applies to all of them automatically. No other pages are in scope.

## Final approach (revised twice — see history below)
Only the **column-header row** sticks. The search/filter toolbar, the date-range bar, and the KPI/platform summary cards above the table all scroll away normally with the page, exactly like today — nothing about them changes. Once the header row (the last thing before the actual data rows) reaches the top of the scroll area, it locks in place; from that point on, only the rows scroll underneath it.

1. **Bounded scroll panel**: the table alone (previously wrapped in `<div className="overflow-x-auto">`) is now wrapped in a panel with `overflow: auto` (both axes) that is a `flex-1 min-h-0` child of a `flex flex-col` card with `max-height: calc(100vh - 280px)`. The toolbar and pagination bar are normal siblings of this panel — outside it, not sticky, not part of its scroll. `280px` is a reasonable fixed estimate covering the topbar, page padding, and pagination footer — not pixel-exact per tab (content above the table varies), but keeps the panel a sane size everywhere.
2. **Column header row**: every `<th>` gets `position: sticky; top: 0`, plus an opaque background (`bg-slate-50`, matching today's frozen-column cells), so it sticks to the top of this panel once scrolled.
3. **Z-index layering**: adding vertical stickiness to *all* header cells makes them "positioned," which changes how overlapping ties resolve (later DOM elements win ties at equal z-index) — this could break the existing horizontal freeze if not addressed:
   - Frozen corner header cells (checkbox/Account column, sticky both top+left): above other header cells (z-30)
   - Regular header cells (sticky top only): above any table body content (z-[25])
   - Table body content (existing selected-row outline z-20, frozen body cells z-10): unchanged

No changes to data fetching, filtering logic, or any other page.

## Design history

### v1 (rejected): whole-page sticky
Kept the table's `overflow-x-auto` div as-is, added `position: sticky` to the toolbar (relative to `<main>`) and to the header cells inside that div. A headless-browser reproduction of that exact structure proved it doesn't work: header cells measured via `getBoundingClientRect()` scrolled fully away instead of sticking. Root cause: browsers force `overflow-y` to compute to `auto` on any element whose `overflow-x` is `auto`/`scroll`, even if `overflow-y` is never set (confirmed via `getComputedStyle`) — that silently makes the horizontal-scroll div, not `<main>`, the nearest scrolling ancestor for anything sticky inside it, and since that div's height just auto-fits its content, sticky positioning inside it is inert. This is a spec-mandated browser behavior, not fixable with plain CSS on that element.

### v2 (rejected): sticky toolbar + sticky header together, in a bounded panel
Turned the toolbar+table card into a bounded self-scrolling panel (the fix for v1's root cause), with *both* the toolbar and the header cells sticky inside it (toolbar at `top: 0`, header at `top: <toolbar height>`, tracked live via `ResizeObserver`). Verified working via headless reproduction. Rejected after the user clarified, with an annotated screenshot, that the toolbar should **not** stick — it should scroll away with the page like the date-range bar and KPI cards above it. Only the header row should stick, and only once it reaches the top.

### v3 (current): only the header sticks
Toolbar moves back outside the scroll panel as a plain, non-sticky sibling — it scrolls away with the page. The scroll panel now wraps only the table, and the header's `top` offset is a fixed `0` instead of the toolbar's measured height, since it no longer shares a scroll container with the toolbar. This removed the `ResizeObserver`/`toolbarHeight` state entirely — no longer needed. Verified via an updated headless reproduction: scrolling the outer page moves the toolbar 1:1 with the scroll (proving it isn't sticky) while the header, once it reaches the panel's own top, stays fixed while further scrolling moves only the rows.

## Out of scope
- No scroll shadow / border animation when the header becomes stuck (existing borders on the header row provide enough separation).
- No changes to `MentionsTable`, `RunHistoryTable`, or any other table component — only `BrandGroup.tsx`'s table.
- No per-tab dynamic sizing of the panel height (fixed `calc(100vh - 280px)` estimate for every tab).
