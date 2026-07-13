# Sidebar Hover-to-Expand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the desktop sidebar is pinned collapsed, hovering over it temporarily expands it as a floating overlay (without shifting page content); moving the mouse away collapses it back.

**Architecture:** `Sidebar.tsx` gains one new local state (`hoverExpanded`). The existing in-flow `<aside>` keeps reserving its current width (`w-16`/`w-60`) so the page layout never jumps. A wrapping `<div>` with `onMouseEnter`/`onMouseLeave` (active only when `collapsed` is `true`) toggles `hoverExpanded`. When `collapsed && hoverExpanded`, a second `<aside>` renders as a `fixed` overlay on top of the page content, showing the fully-expanded nav (`navContent(false)`), faded in/out via `opacity` + `pointer-events`. The pinned toggle button and its `App.tsx`/`localStorage` contract are untouched.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (className-only styling, no new deps).

## Global Constraints

- Desktop only (`md:` breakpoint and up) — mobile drawer (`open` prop path) is untouched.
- Hover-expand only ever engages when the pinned `collapsed` prop is `true`. When pinned expanded, nothing changes.
- No changes to `App.tsx`, the `collapsed`/`onToggleCollapsed` prop contract, or `localStorage` persistence.
- This codebase has no component-level test harness (`@testing-library/react` is not installed; `vitest` here only covers pure functions in `src/lib/`) — do not introduce one for this change. Verify via `npm run build` (type-check) and manual browser interaction, per this project's established convention (see `feedback_verify_with_npm_build` — `tsc --noEmit` alone checks nothing here).

---

### Task 1: Hover-to-expand overlay on the desktop sidebar

**Files:**
- Modify: `src/components/Sidebar.tsx:201-218` (desktop `<aside>` block) and imports/state near the top of the component (`src/components/Sidebar.tsx:69-73`)

**Interfaces:**
- Consumes: existing `SidebarProps` (`open`, `onClose`, `collapsed`, `onToggleCollapsed`) — unchanged. Existing `navContent(isCollapsed: boolean)` closure — unchanged, reused as-is for both the in-flow aside and the overlay.
- Produces: no new exported interface. Purely internal behavior change to the desktop rendering branch of `Sidebar`.

- [ ] **Step 1: Add `hoverExpanded` state and a shared `header(isCollapsed)` render helper**

In `src/components/Sidebar.tsx`, add the new state next to the existing `brandsOpen`/`adminOpen` state (around line 71-72):

```tsx
  const [brandsOpen, setBrandsOpen] = useState(true);
  const [adminOpen, setAdminOpen] = useState(true);
  const [hoverExpanded, setHoverExpanded] = useState(false);
```

Immediately before the `navContent` closure (around line 74), factor the header markup (currently inlined at lines 207-216) into its own closure so it can be reused for both the in-flow sidebar and the hover overlay without duplication:

```tsx
  const header = (isCollapsed: boolean) => (
    <div className={`py-5 flex items-center border-b border-slate-800 ${isCollapsed ? 'justify-center px-3' : 'px-4 gap-2'}`}>
      <img src="/Brand-Partners-Forums.webp" alt="logo" className="size-[30px] shrink-0" />
      {!isCollapsed && (
        <span className="font-semibold tracking-tight whitespace-nowrap">
          <span className="text-white">Brands </span>
          <span className="text-violet-400">Partner</span>
          <span className="text-white"> Forum</span>
        </span>
      )}
    </div>
  );
```

- [ ] **Step 2: Replace the desktop `<aside>` block with a hover-wrapped in-flow aside plus overlay**

Replace this block (`src/components/Sidebar.tsx:203-218`):

```tsx
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col h-screen bg-slate-900 text-slate-100 transition-[width] duration-200 ease-in-out overflow-hidden ${collapsed ? 'md:w-16' : 'md:w-60'}`}
      >
        <div className={`py-5 flex items-center border-b border-slate-800 ${collapsed ? 'justify-center px-3' : 'px-4 gap-2'}`}>
          <img src="/Brand-Partners-Forums.webp" alt="logo" className="size-[30px] shrink-0" />
          {!collapsed && (
            <span className="font-semibold tracking-tight whitespace-nowrap">
              <span className="text-white">Brands </span>
              <span className="text-violet-400">Partner</span>
              <span className="text-white"> Forum</span>
            </span>
          )}
        </div>
        {navContent(collapsed)}
      </aside>
```

with:

```tsx
      {/* Desktop sidebar */}
      <div
        className="hidden md:block relative shrink-0"
        onMouseEnter={() => collapsed && setHoverExpanded(true)}
        onMouseLeave={() => collapsed && setHoverExpanded(false)}
      >
        <aside
          className={`flex flex-col h-screen bg-slate-900 text-slate-100 transition-[width] duration-200 ease-in-out overflow-hidden ${collapsed ? 'w-16' : 'w-60'}`}
        >
          {header(collapsed)}
          {navContent(collapsed)}
        </aside>

        {collapsed && (
          <aside
            className={`fixed inset-y-0 left-0 z-30 w-60 flex flex-col bg-slate-900 text-slate-100 shadow-xl transition-opacity duration-200 ease-in-out ${
              hoverExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
            }`}
          >
            {header(false)}
            {navContent(false)}
          </aside>
        )}
      </div>
```

> **Post-implementation correction:** task review found `z-30` collides with `BrandGroup.tsx`'s sticky toolbar (`z-40`) and sticky frozen columns (`z-30`) in the same screen region, and that `opacity`/`pointer-events` alone leave the hidden overlay keyboard-focusable. The shipped code fixes both: `z-30` → `z-[45]`, and adds `inert={!hoverExpanded}` to this `<aside>`. See `docs/superpowers/specs/2026-07-13-sidebar-hover-expand-design.md` for the corrected values.

Note: the `hidden md:block` + `md:flex`/`md:w-*` classes move from the `<aside>` onto the new wrapping `<div>` (as plain `hidden md:block`), since the wrapper is now what needs to be hidden below `md`. The inner `<aside>` elements no longer need `md:` prefixes on their own width/display classes because they're already inside the `md:`-gated wrapper.

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: builds with no TypeScript errors (this project's `tsc -b` is the only meaningful static check here — see Global Constraints).

- [ ] **Step 4: Manual verification in the browser**

Run: `npm run dev`, open the app, log in.
1. Click the collapse toggle at the bottom of the sidebar to pin it collapsed.
2. Move the mouse over the collapsed strip — confirm a full-width sidebar overlay fades in on top of the page content (page content does not shift or resize).
3. Move the mouse away — confirm the overlay fades back out, leaving the collapsed strip.
4. While the overlay is expanded, click a nav link — confirm it navigates correctly.
5. Click the collapse toggle inside the overlay to pin it expanded — confirm the sidebar now stays expanded in-flow (pushing content, as before) and hovering away does nothing odd.
6. Resize the window below the `md` breakpoint — confirm the desktop sidebar (and overlay) are hidden and the mobile hamburger drawer still opens/closes as before.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: expand sidebar on hover when pinned collapsed"
```
