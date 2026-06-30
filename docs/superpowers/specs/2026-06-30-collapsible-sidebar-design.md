# Collapsible Sidebar — Design Spec

**Date:** 2026-06-30
**Status:** Approved

## Overview

Add a collapse/expand toggle to the desktop sidebar so users can reclaim horizontal space without losing navigation access. Collapsed state shows icons only; expanded state is the current full layout. Mobile drawer behavior is unchanged.

## State

- `sidebarCollapsed: boolean` lives in `AppLayout` in `App.tsx`, matching the existing pattern for `sidebarOpen`.
- Initialized from `localStorage.getItem('sidebarCollapsed') === 'true'` so the preference survives page refresh.
- Persisted to `localStorage` on every toggle.
- Passed to `Sidebar` as a `collapsed` prop.

## Sidebar: Expanded (~220px)

Current layout, no visual changes.

## Sidebar: Collapsed (~60px)

| Element | Behavior |
|---|---|
| Header logo text | Hidden; globe icon remains |
| Toggle chevron | Stays visible; rotates to point right (`›`) |
| Section headings (BRAND TABS, ADMIN) | Hidden |
| Section expand/collapse chevrons | Hidden |
| Nav item labels | Hidden |
| Nav item icons | Centered, full width of narrow sidebar |
| Platform favicons (TP/AG/CG) | Hidden |
| Star/badge icons | Hidden |
| Hover tooltip | Each icon gets `title="<label>"` for browser tooltip |

## Toggle Button

- A `ChevronLeft` / `ChevronRight` icon (already available via lucide-react) placed at the end of the sidebar header row.
- On click: flips `collapsed`, persists to `localStorage`.
- `ChevronLeft` when expanded (click to collapse), `ChevronRight` when collapsed (click to expand).

## Animation

- `transition-[width] duration-200 ease-in-out` on the sidebar element.
- Nav item text wrapped in a `<span>` with `overflow-hidden` + `opacity-0`/`opacity-100` transition so labels fade rather than clip abruptly.

## Layout Impact

- The main content area already uses `flex-1` and fills remaining space automatically — no changes needed.
- Topbar: no changes needed (already full-width).

## Mobile

Drawer behavior is unchanged. The `collapsed` prop has no effect on mobile (drawer always shows full sidebar when open).

## Files Changed

| File | Change |
|---|---|
| `src/App.tsx` | Add `sidebarCollapsed` state + `localStorage` init/persist; pass `collapsed` prop to `<Sidebar>` |
| `src/components/Sidebar.tsx` | Accept `collapsed?: boolean` prop; conditional rendering of labels, section headings, favicons; animate width; toggle chevron button in header |

## Out of Scope

- Topbar collapse indicator or any topbar changes.
- Keyboard shortcut for collapse.
- Context API — prop drilling matches existing pattern and is sufficient.
