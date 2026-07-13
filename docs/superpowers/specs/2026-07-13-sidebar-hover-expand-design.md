# Sidebar Hover-to-Expand

## Purpose
When the desktop sidebar is pinned collapsed (via the existing manual toggle button, state persisted in `localStorage` as `sidebarCollapsed`), hovering the mouse over it should temporarily expand it as a floating overlay, without shifting or resizing the page content. Moving the mouse away collapses it back down. The existing manual pin/unpin toggle is unchanged.

## Scope
- Desktop sidebar only (`md:` breakpoint and up). The mobile drawer (`open` prop) is untouched.
- Only engages when the pinned state is `collapsed`. When pinned expanded, nothing changes — the sidebar is already full width.

## Design

### State
- New local state in `Sidebar.tsx`: `hoverExpanded` (boolean), initialized `false`.
- No changes to `App.tsx` — the pinned `collapsed`/`onToggleCollapsed` contract is unchanged.

### Structure
- The desktop `<aside>` is wrapped in a `<div>` with `onMouseEnter`/`onMouseLeave` handlers that set `hoverExpanded`, active only when `collapsed` is `true` (no-op handlers when pinned expanded).
- The in-flow `<aside>` always renders at its current width (`md:w-16` collapsed / `md:w-60` expanded) so the page layout never jumps.
- When `collapsed && hoverExpanded`, an additional `<aside>` renders as a fixed overlay:
  - `fixed inset-y-0 left-0 z-30 md:w-60`
  - Same visual treatment as the normal sidebar (`bg-slate-900 text-slate-100`, border, logo header), using `navContent(false)` (i.e., the fully-expanded nav content) so it looks identical to the pinned-expanded sidebar.
  - `shadow-xl` to read as a floating panel above page content.
  - Same `transition` duration (200ms) as the existing collapse/expand animation, applied to opacity so it fades in/out (avoids animating `width` on a `fixed` element, which is less reliable across browsers than the existing flex-based width transition).

### Interaction
- Mouse enters the collapsed strip (the wrapping div) → `hoverExpanded` becomes `true` → overlay fades in immediately. No delay: the overlay's left edge is flush with the strip, so there's no dead zone to cross.
- Mouse leaves the wrapping div (which now spans both the strip and, since the overlay is `fixed` and visually overlaps the same region, effectively the overlay too) → `hoverExpanded` becomes `false` → overlay fades out immediately.
- Clicking a nav link inside the overlay navigates normally via existing `NavLink` behavior; no special handling needed.
- The manual toggle button inside the overlay still works exactly as it does today (flips pinned `collapsed` state); after pinning expanded, the overlay is no longer needed/rendered since the in-flow aside is now full width.

### Visual
- Overlay uses the same background, border, spacing, and nav content rendering as the current pinned-expanded sidebar — it should be visually indistinguishable from "the sidebar is expanded," just floating instead of pushing content.

## Out of scope
- Keyboard/focus-triggered expand (hover-only, matching the request). This is an internal tool without a strong accessibility requirement here; can be revisited later if needed.
- Any change to mobile drawer behavior.
- Any change to the persisted `sidebarCollapsed` pin semantics.
