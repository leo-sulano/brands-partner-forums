# Concave Notch Active-Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar's violet-tint active-row highlight with a solid white pill whose top-right/bottom-right corners are carved by concave notches into the dark sidebar background, matching the reference design, without repeating the prior reverted attempt's failure modes.

**Architecture:** Everything lives inside `src/components/Sidebar.tsx`. No new components, no new CSS files, no JS position tracking. Each active row grows its own `::before`/`::after` pseudo-elements (white squares with one corner rounded to full-radius) that sit just outside the row's normal box, revealing the sidebar's own background through the un-rounded remainder of the square. Because a `position: relative` row automatically paints above its `position: static` siblings (CSS 2.1 painting order — positioned descendants paint after non-positioned ones, regardless of DOM order), no `z-index` is needed for the notch to stack correctly over neighboring rows.

**Tech Stack:** React 19, Tailwind v4 utility classes (arbitrary values + `before:`/`after:` variants), no new dependencies.

## Global Constraints
- Sidebar background stays `bg-slate-900` (spec: no shift to the reference image's blue).
- No SVG, canvas, box-shadow-projection, or radial-gradient — solid `background-color` + `border-radius` only (spec requirement).
- No sibling element position-tracking, no `aria-current`-based measurement, no recalculation on scroll/resize/collapse (this is the specific thing that made the prior attempt, `c6b67aa`..`b0b9ae8`, fragile enough to fully revert).
- Notch pseudo-elements must not get clipped by `<nav>`'s own `overflow-y-auto` boundary for the first or last row in the list (the "Overview" edge case identified during planning).

---

### Task 1: Expanded-mode notch-pill active styling + bleed-room reservation

**Files:**
- Modify: `src/components/Sidebar.tsx:41-48` (`linkClass` helper)
- Modify: `src/components/Sidebar.tsx:90` (`<nav>` className)
- Modify: `src/components/Sidebar.tsx:224` (main desktop `<aside>` className)
- Modify: `src/components/Sidebar.tsx:233` (hover-expand overlay `<aside>` className)

**Interfaces:**
- Consumes: nothing new — `linkClass(isActive, isCollapsed)` keeps its existing signature and all seven existing call sites (`Sidebar.tsx:98,128,171,180,190` for `NavLink` `className` render props) are unchanged.
- Produces: `linkClass` return value now includes the notch-pill classes when `isActive && !isCollapsed`. Task 2 will extend the same function for the `isActive && isCollapsed` branch.

This task covers the geometry that makes the effect actually work (and the specific arithmetic that avoids re-breaking it):
- `<nav>`'s padding must reserve room for the pill to bleed into *without* ever exceeding `<nav>`'s own box — CSS forces an axis that's `overflow: auto` (our vertical scroll) to clip its *other* axis too, so anything that visually escapes `<nav>`'s own padding-box gets clipped or triggers a stray scrollbar.
- The notch reaches 20px above/below the row's own box. `<nav>`'s current `p-3` (12px top/bottom) isn't enough — the first/last visible row's notch would clip against `<nav>`'s scroll boundary. Expanded-mode padding grows to `pt-5 pb-5` (20px, exactly matching the notch radius) and `pr-8` (32px, 20px more than the original 12px) to reserve horizontal bleed room.
- The sidebar's own width grows by roughly the same amount the padding grew, so normal (inactive) rows don't visibly lose content width — only the reserved margin changes.

- [ ] **Step 1: Replace `linkClass` with the notch-aware version**

Replace `src/components/Sidebar.tsx:41-48`:

```tsx
const linkClass = (isActive: boolean, isCollapsed = false) =>
  [
    'flex items-center rounded-md py-2 text-sm transition-colors',
    isCollapsed ? 'justify-center px-0' : 'gap-3 px-3',
    isActive
      ? 'bg-violet-500/20 text-violet-100'
      : 'text-slate-300 hover:bg-violet-500/20 hover:text-violet-100',
  ].join(' ');
```

with:

```tsx
const linkClass = (isActive: boolean, isCollapsed = false) => {
  const base = 'flex items-center rounded-md py-2 text-sm transition-[background-color,color,margin-right] duration-200 ease-in-out';
  const layout = isCollapsed ? 'justify-center px-0' : 'gap-3 px-3';

  if (!isActive) {
    return [base, layout, 'text-slate-300 hover:bg-violet-500/20 hover:text-violet-100'].join(' ');
  }

  if (isCollapsed) {
    // Collapsed notch variant added in Task 2.
    return [base, layout, 'bg-violet-500/20 text-violet-100'].join(' ');
  }

  const notch = [
    'relative -mr-5 bg-white text-slate-900',
    "before:content-[''] before:absolute before:-top-5 before:right-0 before:h-5 before:w-5 before:rounded-tl-full before:bg-white",
    "after:content-[''] after:absolute after:-bottom-5 after:right-0 after:h-5 after:w-5 after:rounded-bl-full after:bg-white",
  ];

  return [base, layout, ...notch].join(' ');
};
```

(The `isCollapsed` branch keeps today's violet highlight as a placeholder until Task 2 replaces it — this keeps Task 1 independently testable without touching collapsed mode yet.)

- [ ] **Step 2: Reserve bleed room on `<nav>`**

Replace `src/components/Sidebar.tsx:90`:

```tsx
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
```

with:

```tsx
      <nav className={`flex-1 space-y-1 overflow-y-auto ${isCollapsed ? 'p-3' : 'pl-3 pt-5 pb-5 pr-8'}`}>
```

- [ ] **Step 3: Widen the expanded sidebar to compensate**

Replace `src/components/Sidebar.tsx:224`:

```tsx
          className={`flex flex-col h-screen bg-slate-900 text-slate-100 transition-[width] duration-200 ease-in-out overflow-hidden ${collapsed ? 'w-16' : 'w-60'}`}
```

with:

```tsx
          className={`flex flex-col h-screen bg-slate-900 text-slate-100 transition-[width] duration-200 ease-in-out overflow-hidden ${collapsed ? 'w-16' : 'w-64'}`}
```

- [ ] **Step 4: Match the hover-expand overlay width**

Replace `src/components/Sidebar.tsx:233`:

```tsx
            className={`fixed inset-y-0 left-0 z-[45] w-60 flex flex-col bg-slate-900 text-slate-100 shadow-xl transition-opacity duration-200 ease-in-out ${
```

with:

```tsx
            className={`fixed inset-y-0 left-0 z-[45] w-64 flex flex-col bg-slate-900 text-slate-100 shadow-xl transition-opacity duration-200 ease-in-out ${
```

- [ ] **Step 5: Visual verification**

Run: `npm run dev`, open the app in a browser.

Check, in the expanded (non-collapsed) desktop sidebar:
- Navigate to Overview (`/`) — the active row is a white pill with visible concave notches curving into the dark sidebar at its top-right and bottom-right, bleeding slightly past where inactive rows end. No stray floating shapes, no visible seam.
- Navigate to a brand tab and to an Admin page — same effect, consistent look.
- No horizontal scrollbar appears on the Brand Tabs list; vertical scrolling still works normally.
- Collapsed mode still shows the pre-existing violet highlight (unchanged, since Task 2 hasn't run yet) — confirms this task didn't regress collapsed mode.

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: concave notch active-pill for expanded sidebar nav"
```

---

### Task 2: Collapsed-mode notch-pill variant

**Files:**
- Modify: `src/components/Sidebar.tsx` (the `isCollapsed` branch inside `linkClass`, added in Task 1 Step 1)

**Interfaces:**
- Consumes: the `linkClass(isActive, isCollapsed)` structure from Task 1 — same `base`/`layout` local variables, same return shape.
- Produces: nothing new consumed by later tasks — this completes `linkClass`.

Collapsed rows are far narrower (the icon rail is `w-16` = 64px), so the notch radius must be smaller to avoid overwhelming the row, and must fit inside `<nav>`'s *existing* 12px padding (unchanged from today — collapsed mode was deliberately left out of Task 1's padding/width changes) rather than requiring more reserved room. 10px fits inside that 12px with a 2px safety margin on all four sides (top, bottom, and the horizontal bleed).

- [ ] **Step 1: Replace the collapsed placeholder branch**

Replace the placeholder added in Task 1:

```tsx
  if (isCollapsed) {
    // Collapsed notch variant added in Task 2.
    return [base, layout, 'bg-violet-500/20 text-violet-100'].join(' ');
  }
```

with:

```tsx
  if (isCollapsed) {
    const notch = [
      'relative -mr-2.5 bg-white text-slate-900',
      "before:content-[''] before:absolute before:-top-2.5 before:right-0 before:h-2.5 before:w-2.5 before:rounded-tl-full before:bg-white",
      "after:content-[''] after:absolute after:-bottom-2.5 after:right-0 after:h-2.5 after:w-2.5 after:rounded-bl-full after:bg-white",
    ];
    return [base, layout, ...notch].join(' ');
  }
```

- [ ] **Step 2: Visual verification**

With `npm run dev` still running:
- Click the sidebar's collapse toggle to pin it collapsed.
- Navigate between Overview, a brand tab, and an Admin page — the active icon shows a smaller white notch-pill, consistent with the expanded version but proportioned to the narrower rail.
- Confirm the icon rail's width (`w-16`) hasn't visibly changed and inactive icons look exactly as before.
- Hover over the collapsed sidebar to trigger the hover-expand overlay — confirm the expanded-style notch (from Task 1) renders correctly there too, since it reuses `navContent(false)`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: concave notch active-pill for collapsed sidebar rail"
```

---

### Task 3: Cross-state verification and edge-case pass

**Files:**
- Modify: `src/components/Sidebar.tsx` (only if verification below surfaces a fix)

**Interfaces:**
- Consumes: the completed `linkClass` from Tasks 1–2 and all the layout changes from Task 1.
- Produces: nothing — this is a verification-only task, matching the design doc's "no automated tests, visual verification via `npm run dev`" testing section.

This task exists specifically to catch the two failure modes that sank the prior attempt (stray artifacts, edge-case clipping) before calling the feature done.

- [ ] **Step 1: First/last-row clipping check**

With `npm run dev` running, in the **expanded** desktop sidebar:
- Confirm Overview (nav's first row) shows its full top notch with no clipping against the sidebar's top edge — this is the specific edge case the `pt-5` padding in Task 1 was sized to prevent.
- Scroll the Brand Tabs list to its end and activate the last visible row (or the last Admin link, whichever renders last in `<nav>`) — confirm its bottom notch isn't clipped either.

If either clips, increase `pt-5`/`pb-5` on `<nav>` (Task 1 Step 2) until the full curve is visible, and note the final value here in place of this instruction once resolved.

- [ ] **Step 2: Mobile drawer check**

Shrink the viewport (or use device emulation) below the `md:` breakpoint to trigger the mobile drawer. Open it and navigate between a few links — confirm the same white notch-pill renders correctly (the drawer's `<aside>` has no `overflow-hidden`, so this should work without further changes; this step is a regression check, not expected to require code changes).

- [ ] **Step 3: Transition smoothness check**

In the expanded sidebar, click between two different nav rows in quick succession — confirm the pill's background/margin transition (200ms, from `linkClass`'s `transition-[background-color,color,margin-right]`) animates smoothly with no visible jump or flash. Toggle the collapse/expand button while a row is active — confirm the notch doesn't visibly glitch mid-animation.

- [ ] **Step 4: Adjacent-row overlap check**

With a row active, look closely at the row immediately above and below it — confirm the notch's white curve doesn't visibly overlap or clip into the neighboring row's own background/hover state. If it does (the row height here is ~36px, shorter than many dashboards this pattern is usually built for), reduce the expanded notch radius (Task 1 Step 1: the `5`/`-5` values, e.g. to `4`/`-4`) uniformly across `-mr`, `-top`, `-bottom`, `h`, `w`, and reduce `<nav>`'s `pt-5`/`pb-5`/`pr-8` (Task 1 Step 2) and the sidebar width bump (Task 1 Steps 3–4) to match, keeping the same proportional relationships derived in Task 1.

- [ ] **Step 5: Final commit**

If Steps 1 or 4 required adjustments:

```bash
git add src/components/Sidebar.tsx
git commit -m "fix: tune concave notch sizing after cross-state visual verification"
```

If no adjustments were needed, no commit is required for this task.
