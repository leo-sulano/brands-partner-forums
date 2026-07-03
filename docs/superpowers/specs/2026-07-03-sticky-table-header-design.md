# Sticky Table Header & Toolbar — Design

## Problem
On brand tab pages (`/brands/:tab`, rendered by `BrandGroup.tsx`), the search/filter toolbar and the table's column-header row scroll away with the data rows. On tabs with many rows, users lose sight of the column labels and active filters while scrolling.

## Scope
Single file: `src/pages/BrandGroup.tsx`. Since every brand tab (TP Brand Injection, Rooster Partners, Hanan, etc.) renders through this one component, the fix applies to all of them automatically. No other pages are in scope. (v4/v5, since reverted, briefly touched `src/App.tsx` — see history below; v6 reverted that too.)

## Final approach (v6 — bounded self-scrolling panel, see full history below)
The toolbar and column-header row always stick together at the top of a dedicated, capped-height panel that contains the table. Everything above that panel — the date-range bar, KPI/platform summary cards — stays in normal page flow and is **always visible**; it is never scrolled past or hidden. Only the table's row data scrolls, inside its own bounded area with its own scrollbar.

1. **Bounded scroll panel**: the outer card (`rounded-lg border ... bg-white shadow-sm`) is `flex flex-col` with `max-height: calc(100vh - 280px)`. Inside it, a `flex-1 min-h-0` child with `overflow: auto` (both axes) wraps the toolbar and the table together — this inner div is the actual scroll container. The pagination bar is a sibling *outside* this scrolling div (and outside the `max-height` card... actually inside the card, but outside the scroll div), so it's always visible below the panel, never scrolled away.
2. **Toolbar**: `position: sticky; top: 0; left: 0` relative to the scroll panel (not the page) — opaque white background, sticks to the top of the panel once its rows scroll.
3. **Column header row**: every `<th>` gets `position: sticky` with a `top` offset equal to the toolbar's live rendered height (tracked via `ResizeObserver`, since the toolbar wraps to more lines on narrow viewports and is a different height in "N selected" mode), plus an opaque background (`bg-slate-50`) and `will-change: transform` (defensive mitigation for a known Chrome sticky-table-cell repaint quirk).
4. **Z-index layering**: sticky toolbar (z-40) > frozen corner header cells, checkbox/Account (z-30) > regular header cells (z-[25]) > table body content (existing selected-row outline z-20, frozen body cells z-10).
5. `calc(100vh - 280px)` is a fixed estimate covering the topbar, page padding, and pagination footer — not pixel-exact per tab (content above the table varies), but keeps the panel a sane size everywhere.

No changes to data fetching, filtering logic, or any other page.

## Design history

### v1 (rejected): whole-page sticky, table still in its own `overflow-x-auto` wrapper
Kept the table's `overflow-x-auto` div, added `position: sticky` to the toolbar (relative to `<main>`) and to the header cells inside that div. A headless-browser reproduction proved it doesn't work: header cells scrolled fully away instead of sticking. Root cause: browsers force `overflow-y` to compute to `auto` on any element whose `overflow-x` is `auto`/`scroll`, even if `overflow-y` is never set — that silently makes the horizontal-scroll div, not `<main>`, the nearest scrolling ancestor for anything sticky inside it, and since that div's height just auto-fits its content, sticky positioning inside it is inert. Confirmed further that this isn't specific to `auto`: any non-`visible` `overflow-y` value (including `hidden`, and Chromium's fallback for `clip`) creates the same scroll-container capture — there is no CSS value that lets a div have `overflow-x: auto` without also becoming a vertical scroll-container for sticky purposes, short of `overflow-y: visible`, which the browser refuses to honor next to `overflow-x: auto`.

### v2 (initially rejected, now the shipped design — see v6): sticky toolbar + sticky header together, in a bounded panel
Turned the toolbar+table card into a bounded self-scrolling panel (fixing v1's root cause locally), with both the toolbar and header cells sticky inside it. Verified working in isolation via headless reproduction.

### v3 (rejected): only the header sticks, still in a bounded panel
Misread the user's annotated-screenshot feedback as "only the header should stick, not the toolbar" and moved the toolbar back outside the panel as a plain sibling. Superseded once the user clarified toolbar *and* header should stick together.

### v4 (rejected): whole-page scroll, no nested scroll region, toolbar+header sticky together
Reconsidered v2/v3 after the user reported the KPI/date-range cards never scrolling away. Root cause identified: the bounded panel is a *nested* `overflow: auto` region, and browsers hand wheel-scroll input to the nearest scrollable ancestor under the cursor — the panel, not the page — so `<main>` never received scroll input while the pointer was over the table, and the cards above never moved. Fix: removed the nested panel entirely, made `<main>` (`src/App.tsx`) handle horizontal overflow directly (`overflow-auto` instead of `overflow-y-auto overflow-x-hidden`), and made the toolbar+header sticky relative to `<main>` instead. This traded the nested-scroll problem for (a) horizontal table-scroll now scrolling the whole page's content, including KPI cards, and (b) touching a shared layout file used by every page.

### v5 (rejected): eliminate a persistent gap introduced by v4
`<main>`'s own `p-6 md:p-8` padding meant `top: 0` in v4 didn't mean "flush with the page" — sticky's `top` is always measured from the scrolling ancestor's *padding* edge, leaving a permanent 24–32px gap above the stuck toolbar where the user reported seeing a stray row. Fix used a negative `top` offset (verified: `top: -32px` inside a 32px-padded scroller clamps flush at the true edge without affecting the element's normal, unscrolled position) to close that gap. Superseded when the user asked to revert the whole whole-page-scroll direction (v4+v5) back to v2's bounded panel — the gap problem is specific to v4's architecture and doesn't exist in v6, since the panel itself has no padding for sticky positioning to have to fight.

### v6 (current): revert to the bounded panel (v2), keep everything else
The user reconsidered and asked to go back to "table only scrollable" — KPI/date-range content always visible, never scrolled past; only the table's rows scroll, inside their own bounded panel. This is v2's architecture exactly. `src/App.tsx`'s `<main>` reverted to `overflow-y-auto overflow-x-hidden` (v4's change undone). Kept from v4/v5: the `will-change: transform` hint on the toolbar and header cells (harmless, possibly still useful against the Chrome sticky-repaint quirk) and an unrelated concurrent fix (`997c561`, raising `DatePicker`'s popup z-index above the sticky header's, since both had been z-30). Verified via the same headless reproduction used for v2 (`sticky-repro3.html`): toolbar sticks at the panel's top, header flush below it, both re-flow correctly for the "N selected" toolbar height, pagination never moves, horizontal scroll keeps the frozen-column z-index ordering and doesn't drift the toolbar.

**Known accepted trade-off (inherent to this architecture, not new in v6):** because the panel is its own nested scroll region, scrolling with the cursor over the table only scrolls the table's rows — it will never scroll the KPI/date-range content, no matter how much you scroll, because that content is permanently visible in normal page flow above the panel and is never meant to move.

## Out of scope
- No scroll shadow / border animation when the header becomes stuck (existing borders on the toolbar and header row provide enough separation).
- No changes to `MentionsTable`, `RunHistoryTable`, or any other table component — only `BrandGroup.tsx`'s table.
- No per-tab dynamic sizing of the panel height (fixed `calc(100vh - 280px)` estimate for every tab).
