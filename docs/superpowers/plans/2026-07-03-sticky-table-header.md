# Sticky Table Header & Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every brand tab page, keep the table's column-header row pinned to the top once it scrolls there, while data rows scroll underneath it — without breaking horizontal scroll or the frozen checkbox/Account columns. (Revised in Task 4: the toolbar does **not** stick — it scrolls away with the page like everything above it.)

**Architecture (revised twice — see Task 1 and Task 4 notes):** The table (previously wrapped in `<div className="overflow-x-auto">`) is now wrapped in its own bounded-height, self-scrolling panel (`max-height: calc(100vh - 280px)`, `overflow: auto`) that's a `flex-1 min-h-0` child of a `flex flex-col` card. The toolbar and pagination bar are normal, non-sticky siblings of this panel — they scroll with the page like before. Every `<th>` is `position: sticky; top: 0` relative to the panel. Z-index values are layered so the sticky header and the table's existing horizontally-frozen columns (checkbox + Account) don't fight over paint order.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (no component-test framework in this repo — `vitest` only covers pure-function unit tests in `src/lib/`).

**Verification approach:** This app requires a live Supabase login (email+password, admin-approved) with no test/guest bypass, so an end-to-end browser click-through of the deployed app wasn't available in this environment. Verification instead used `npm run build` (typecheck) plus a standalone HTML/CSS/JS reproduction of the exact structure (classes, sticky offsets, z-index values, `ResizeObserver` logic) driven headlessly with Playwright, asserting on real `getBoundingClientRect()` values before/after scrolling. This is how the whole-page-sticky approach was caught as broken (see Task 1) before it reached the real component. **A manual click-through in the real app is still recommended** before merging — see the note at the end of Task 3.

## Global Constraints
- Single file in scope: `src/pages/BrandGroup.tsx`. No other component or page changes.
- TypeScript strict mode — no `any`.
- Must not change data fetching, filtering, or sorting behavior — visual/layout only.
- Must not break the existing horizontally-frozen checkbox/Account columns.

---

### Task 1: Track live toolbar height; make the toolbar+table card a bounded, self-scrolling panel

- [x] **Step 1: Add the ref, state, and ResizeObserver effect**

Added after `const lastLoadedTabRef = useRef<string | null>(null);` (~line 605):

```tsx
  // Sticky toolbar: the column-header row sticks just below this element,
  // offset by its live height. The toolbar's height isn't fixed — it wraps
  // to more lines on narrow viewports and differs in "N selected" mode — so
  // a ResizeObserver keeps the offset correct in every case.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setToolbarHeight(entries[0].contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
```

- [x] **Step 2 (original, superseded): wrap the toolbar in `sticky top-0` relative to `<main>`, keep the existing `overflow-x-auto` div around the table**

This was the originally-approved approach. Built, then verified with a headless-browser reproduction (see Verification approach above) — it **does not work**: `getBoundingClientRect()` on the header cells showed them scrolling fully off-screen instead of sticking. Root cause: `<div className="overflow-x-auto">` computes `overflow-y: auto` too (browser-enforced coupling rule — confirmed via `getComputedStyle`), which makes that div — not `<main>` — the sticky containing block for anything inside it. Since that div's height just auto-fits its content, sticky positioning inside it is inert.

- [x] **Step 2 (corrected): make the card a bounded self-scrolling panel; toolbar sticky relative to it, both axes**

Card open tag, changed from `className="rounded-lg border border-slate-200 bg-white shadow-sm"` to:

```tsx
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm flex flex-col" style={{ maxHeight: 'calc(100vh - 280px)' }}>
        {/* Scrollable panel: toolbar + table share one scroll container (both
            axes) so the sticky toolbar/header below stay visible while rows
            scroll underneath, and don't drift when scrolled horizontally.
            Pagination (below) stays outside this div, always visible. */}
        <div className="overflow-auto flex-1 min-h-0">
        <div ref={toolbarRef} className="sticky top-0 left-0 z-40 bg-white">
        {selectedIds.size > 0 ? (
```

(`left-0` in addition to `top-0` — without it, the toolbar drifts sideways when the panel is scrolled horizontally, since it now shares the same scroll container as the table. Confirmed via the reproduction: without `left-0` a 300px horizontal scroll moved the toolbar off-screen; with it, position was stable.)

`calc(100vh - 280px)` is a fixed estimate covering the topbar (56px), page padding, and pagination footer — not pixel-exact per tab (KPI-card height above the table varies), but keeps the panel a sane size everywhere without touching the shared `App.tsx` layout.

- [x] **Step 3: Verify it builds**

`npm run build` — exits 0, no TypeScript errors.

- [x] **Step 4: Verify via headless-browser reproduction**

8/8 assertions passed (toolbar sticks at panel top; header sits flush below it; frozen/regular header offsets match; header re-flows correctly when the toolbar height changes in "N selected" mode; frozen header z-index beats regular header z-index during horizontal scroll; frozen Account column stays visually pinned during horizontal scroll).

- [x] **Step 5: Commit**

Combined with Tasks 2 and 3 into a single commit (`feat: make brand tab toolbar and column headers sticky within a scrollable panel`) since all three were implemented together as one coherent change.

---

### Task 2: Make the column-header row sticky and fix z-index layering

- [x] **Step 1: Make the checkbox header cell sticky top+left**

Changed:

```tsx
                        <th className="w-8 px-2 py-2 sticky left-0 z-20 bg-slate-50">
```

to:

```tsx
                        <th className="w-8 px-2 py-2 sticky left-0 z-30 bg-slate-50" style={{ top: toolbarHeight }}>
```

- [x] **Step 2: Make every data-column header cell sticky, with correct z-index for frozen vs. regular columns**

Changed the `visibleHeaders.map` from a plain `<th>` (only Account/Account Name were positioned, via `sticky` + `left`) to:

```tsx
                      {visibleHeaders.map((h) => {
                        const isFrozenCol = h === 'Account' || h === 'Account Name';
                        return (
                        <th
                          key={h}
                          onClick={() => handleSort(h)}
                          style={{ top: toolbarHeight }}
                          className={`px-[10px] py-3 font-medium text-slate-600 whitespace-nowrap select-none sticky bg-slate-50 ${isFrozenCol ? `z-30 ${isApproved ? 'left-8' : 'left-0'}` : 'z-[25]'} ${colWidthClass(h, activePlatforms.length > 1, decodedTab)} ${!isNoSortCol(h) ? 'cursor-pointer hover:text-slate-900' : ''}`}
                        >
                          <span className="inline-flex items-center gap-1">
                            {getColLabel(h, decodedTab)}
                            {!isNoSortCol(h) && <SortIcon col={h} sortCol={sortCol} sortDir={sortDir} />}
                          </span>
                        </th>
                        );
                      })}
```

Every header cell now sticks at `top: toolbarHeight` (flush below the sticky toolbar). Frozen columns (checkbox, Account/Account Name) get `z-30` so they stay above regular header cells (`z-[25]`) during horizontal scroll — matching the pre-existing frozen-column behavior, which relied on regular header cells being unpositioned (`position: static`) and therefore always painting beneath positioned cells regardless of DOM order. Now that regular header cells are also `position: sticky` (needed for the vertical offset), they became positioned too, so the frozen columns need an explicit higher z-index to keep winning that comparison. `z-[25]` for regular header cells also keeps them above the table body's existing z-20 selected-row outline and z-10 frozen body cells, so a header cell scrolling in front of body rows still renders on top.

- [x] **Step 3: Verify it builds**

`npm run build` — exits 0, no TypeScript errors.

- [x] **Step 4: Verify via headless-browser reproduction**

Included in the same 8-assertion pass as Task 1 Step 4 (frozen-vs-regular z-index ordering, header offset consistency across both frozen and non-frozen columns).

- [x] **Step 5: Commit**

Combined into the same commit as Task 1 (see Task 1 Step 5).

---

### Task 3: Keep the pagination footer outside the scrolling panel

Discovered while wiring up Task 1: putting `overflow: auto` + bounded height directly on the outer card (as first drafted) would make the pagination bar — a sibling after the table inside that same card — scroll away with the rows too, which isn't the intent (pagination controls should stay visible like the toolbar/header do).

- [x] **Step 1: Restructure so pagination is a flex sibling outside the scroll div**

Removed the old `<div className="overflow-x-auto">` wrapper around just `<table>` (superseded by the panel div from Task 1, which now wraps toolbar + table together). The pagination `<div>` (the `{/* Pagination bar */}` block, conditionally rendered on `!loading && sorted.length > 0`) is now a direct sibling of the `overflow-auto flex-1 min-h-0` div, both inside the `flex flex-col` card — so it renders below the scrollable rows but is never part of the scrolled content.

- [x] **Step 2: Verify it builds**

`npm run build` — exits 0, no TypeScript errors.

- [x] **Step 3: Verify via headless-browser reproduction**

Rebuilt the reproduction with the exact final structure (bounded flex-column card → scroll panel div → pagination sibling) and confirmed: pagination bar's `getBoundingClientRect()` top position is identical before and after scrolling 700px inside the panel.

- [x] **Step 4: Commit**

Combined into the same commit as Task 1 (see Task 1 Step 5).

- [ ] **Step 5 (manual — do before merging): click through the real app**

Superseded by Task 4's manual-check note below (the toolbar's sticky behavior changed after this step was written).

---

### Task 4: Un-stick the toolbar — only the column header should stick

The user reviewed a live screenshot (multi-platform "Revolution Casino" tab, which has a date-range bar + 3 platform summary boxes above the table) and clarified with an annotated image: the toolbar should **not** stick. It should scroll away with the page exactly like the date-range bar and summary boxes above it. Only the column-header row should stick, and only once it reaches the top.

- [x] **Step 1: Remove the toolbar's sticky wrapper; move it outside the scroll panel**

The toolbar (both the normal filter-bar and the "N selected" variant, rendered via one ternary) is now a plain child of the outer `flex flex-col` card, rendered *before* the scroll-panel div — no wrapping `<div>`, no `ref`, no sticky/z-index classes. The scroll-panel div (`overflow-auto flex-1 min-h-0`) now wraps only the `<table>`.

- [x] **Step 2: Remove the now-unused `toolbarRef`/`toolbarHeight` state and `ResizeObserver` effect**

Deleted entirely — nothing needs to measure the toolbar's height anymore, since the header no longer shares a scroll container with it.

- [x] **Step 3: Change every sticky `<th>` from `style={{ top: toolbarHeight }}` to a plain `top-0` class**

Both the checkbox `<th>` and the `visibleHeaders.map` `<th>` now use `sticky top-0` (Tailwind class, no inline style) instead of the toolbar-height offset.

- [x] **Step 4: Verify it builds**

`npm run build` — exits 0, no TypeScript errors.

- [x] **Step 5: Verify via headless-browser reproduction**

Rebuilt the reproduction with the toolbar as a plain sibling above the scroll panel. 8/8 assertions passed: scrolling the outer page moves the toolbar 1:1 (proving it's not sticky, both for a small scroll and after scrolling to the page's true max); the header never overlaps the toolbar; the header stays fixed at the panel's top while further scrolling moves only the rows; frozen/regular header alignment and z-index ordering still hold; pagination still doesn't move.

- [ ] **Step 6: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "fix: only the column-header row sticks, not the toolbar"
```

- [ ] **Step 7 (manual — do before merging): click through the real app**

Log into the dashboard and confirm on at least two tabs — a simple one (e.g. TP Brand Injection) and a multi-platform one with more content above the table (e.g. Revolution Casino, which has the date-range bar + 3 platform summary boxes):
- The toolbar, date-range bar, and summary/KPI boxes all scroll away normally with the page — none of them stick.
- The column-header row sticks once it reaches the top of its panel; pagination stays visible at the bottom the whole time.
- Selecting a row (switching to "N selected" toolbar) doesn't jump or clip anything, since that toolbar is no longer part of any sticky calculation.
- Horizontal scroll: the frozen checkbox + Account columns stay pinned left and render above the header cells and rows scrolling underneath.
- The bounded panel height looks reasonable (the `calc(100vh - 280px)` estimate is approximate, not exact, for every tab — especially ones with more content above the table like Revolution Casino).
