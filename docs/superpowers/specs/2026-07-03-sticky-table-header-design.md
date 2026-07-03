# Sticky Table Header & Toolbar — Design

## Problem
On brand tab pages (`/brands/:tab`, rendered by `BrandGroup.tsx`), the search/filter toolbar and the table's column-header row scroll away with the data rows. On tabs with many rows, users lose sight of the column labels and active filters while scrolling.

## Scope
`src/pages/BrandGroup.tsx` (all brand tabs render through this one component) plus `src/App.tsx`'s shared `<main>` element (see v4 below — required so `<main>` can handle the table's horizontal overflow directly instead of a nested wrapper). No other page-specific changes.

## Final approach (v4 — revised three times, see history below)
The whole page is one scroll region — there is no separate scrollable area for the table. The search/filter toolbar and the column-header row both stick together, relative to `<main>`, once scrolled to the top; the date-range bar and KPI/platform summary cards above them scroll away normally and are gone by the time the toolbar+header lock in place. From that point, further scrolling moves only the data rows underneath the stuck toolbar+header.

1. **`<main>` handles horizontal overflow directly** (`src/App.tsx`): changed from `overflow-y-auto overflow-x-hidden` to `overflow-auto` (both axes). The table's own `<div className="overflow-x-auto">` wrapper is removed — the table is now a direct child of the card, and when it's wider than the viewport, `<main>` itself shows the horizontal scrollbar. This is what makes v4 different from v2 (which used a self-contained scrolling panel) — see "Why not a bounded panel" below.
2. **Toolbar**: `position: sticky; top: 0; left: 0` relative to `<main>`, opaque white background — sticks directly under the app's topbar.
3. **Column header row**: every `<th>` gets `position: sticky` with a `top` offset equal to the toolbar's live rendered height (tracked via `ResizeObserver`, since the toolbar wraps to more lines on narrow viewports and is a different height in "N selected" mode), plus an opaque background (`bg-slate-50`).
4. **Z-index layering** (unchanged from earlier revisions): sticky toolbar (z-40) > frozen corner header cells, checkbox/Account (z-30) > regular header cells (z-[25]) > table body content (existing selected-row outline z-20, frozen body cells z-10).

### Why not a bounded self-scrolling panel (v2/v3's approach)
v2 and v3 wrapped the table (and, in v2, the toolbar too) in its own `max-height` + `overflow: auto` panel, so it could scroll internally without touching `<main>`. That correctly made the header stick, and was verified working in isolation — but it silently broke the actual interaction the user wanted: scrolling with the cursor over the table hands the wheel event to the *nearest* scrollable ancestor under the cursor, which is the inner panel, not `<main>`. Since the panel has plenty of its own scroll room (hundreds of rows), `<main>` never receives any of that scroll input, so the date-range bar and KPI cards above never scroll away — exactly the bug the user reported ("it still not scroll up the the cards"). This is inherent to nested `overflow: auto` regions in the browser; there's no CSS-only way to make an inner scrollable region defer to an outer one while the outer one still has scroll room, when the pointer is over the inner one.

Removing the nested scroll region (v4) fixes this by construction — there's only one scrollable element (`<main>`) for the pointer to ever hand wheel input to, so scrolling anywhere on the page always scrolls the whole page as one unit, exactly matching normal single-page-scroll expectations.

### Trade-off accepted: horizontal scroll now spans the whole page
Because `<main>` handles the table's horizontal overflow directly, scrolling the table sideways scrolls the *entire page's* horizontal axis — the date-range bar and KPI/platform cards shift left along with the table columns, even though they're not wide enough to need their own horizontal scroll. Previously this was scoped to just the table via its own wrapper div. This was the reason the bounded-panel approach (v2) was originally chosen over this option — but it's a lesser problem than v2/v3's broken vertical-scroll interaction, and only manifests when a user actively scrolls a table sideways (most usage is vertical). No changes were made to other pages' own internal horizontal-scroll wrappers (`RunHistoryTable`, `ScoreSummaryPanel`) — they still scope their own overflow internally and are unaffected by `<main>`'s overflow-x change, since their content never overflows `<main>`'s own box.

## Design history

### v1 (rejected): whole-page sticky, table still in its own `overflow-x-auto` wrapper
Kept the table's `overflow-x-auto` div, added `position: sticky` to the toolbar (relative to `<main>`) and to the header cells inside that div. A headless-browser reproduction proved it doesn't work: header cells scrolled fully away instead of sticking. Root cause: browsers force `overflow-y` to compute to `auto` on any element whose `overflow-x` is `auto`/`scroll`, even if `overflow-y` is never set — that silently makes the horizontal-scroll div, not `<main>`, the nearest scrolling ancestor for anything sticky inside it, and since that div's height just auto-fits its content, sticky positioning inside it is inert. Confirmed further that this isn't specific to `auto`: any non-`visible` `overflow-y` value (including `hidden`, and Chromium's fallback for `clip`) creates the same scroll-container capture — there is no CSS value that lets a div have `overflow-x: auto` without also becoming a vertical scroll-container for sticky purposes, short of `overflow-y: visible`, which the browser refuses to honor next to `overflow-x: auto`.

### v2 (rejected): sticky toolbar + sticky header together, in a bounded panel
Turned the toolbar+table card into a bounded self-scrolling panel (fixing v1's root cause locally), with both the toolbar and header cells sticky inside it. Verified working in isolation via headless reproduction. Rejected only after the user reported cards not scrolling away in the live app — see "Why not a bounded panel" above.

### v3 (rejected): only the header sticks, still in a bounded panel
Misread the user's annotated-screenshot feedback as "only the header should stick, not the toolbar" and moved the toolbar back outside the panel as a plain sibling. This didn't address the actual bug (the nested-scroll-region problem), and the user's next message clarified that toolbar *and* header should stick together — v2's stacking was correct, v2's panel technique wasn't.

### v4 (current): whole-page scroll, no nested scroll region, toolbar+header sticky together
See "Final approach" above. Verified via a headless-browser reproduction matching the exact final DOM shape (including `<main>`'s `overflow: auto`, no table wrapper div, pagination as a plain sibling): scrolling the page moves the KPI cards away until fully off-screen, the toolbar+header lock in place flush with each other, further scroll moves only the rows underneath, the "N selected" toolbar height change re-flows the header's offset correctly, and horizontal scroll preserves the frozen-column z-index ordering.

## Out of scope
- No scroll shadow / border animation when the toolbar+header become stuck (existing borders provide enough separation).
- No changes to `MentionsTable`, `RunHistoryTable`, or any other table component — only `BrandGroup.tsx`'s table interacts with `<main>`'s new horizontal overflow.
- No fix for the whole-page-horizontal-scroll trade-off (see above) — accepted as-is.
