# Concave Notch Active-Tab Effect

## Purpose
Recreate the "carved outside corner" active-nav effect from the reference design (blue sidebar, white active pill, concave curves bleeding past the sidebar edge) inside the existing `Sidebar.tsx`, adapted to this app's dark (`slate-900`) sidebar and scrollable brand-tabs list.

## Prior attempt (context)
`0e8b9dd` → `b0b9ae8` (2026-07-13ish) built and then fully reverted an active-tab pill/glow/notch feature. Two specific failure modes drove that:
1. A separate sibling "glow" element tracked the active row's on-screen position via `aria-current`, recalculating on route change, collapse toggle, section open/close, nav scroll, and window resize — a lot of moving parts for a purely visual effect.
2. A concave S-curve notch attempt in that lineage produced a stray floating circle artifact.

This design avoids both: the notch lives entirely in the active row's own `::before`/`::after` pseudo-elements (no sibling element, no position measurement, no recalculation), and uses solid `border-radius` corner-cuts rather than shadow/gradient projection.

## Scope
- Applies to all `NavLink` rows sharing the existing `linkClass()` helper: top links (Overview, Ask AI, How it works), the Brand Tabs list, and Admin links (Score Summary, Log, Users).
- Applies in both desktop states — expanded (`md:w-60`) and collapsed (`md:w-16`) — and in the hover-expand overlay and the mobile drawer, since all reuse the same row markup and helper.
- Sidebar background stays `bg-slate-900` (dark). No shift to the reference image's blue.

## Design

### Technique
Per row, when `isActive`:
- The row itself becomes a solid white rectangle (`bg-white`, `text-slate-900` for icon/label), no rounding needed on its own right corners — they're covered by the notch pieces below.
- Two small (20×20px expanded / ~14×14px collapsed) squares, `bg-slate-900` (the sidebar's own color), sit at the pill's outer top-right and bottom-right corners via `before:`/`after:` Tailwind variants. Each has `border-radius` set only on the corner facing the pill, rounding that square's own corner into transparency and revealing the white pill underneath — this is what reads as the sidebar curving inward around the pill.
- Nothing here reads `aria-current`, measures a bounding box, or listens for scroll/resize. Switching the active row is a plain class toggle on whichever row is active; no shared state.

### The scroll/overflow constraint
The Brand Tabs `<nav>` needs `overflow-y-auto` (the list can be long). CSS overflow is coupled per-axis: an element can't have one axis `auto` (scrollable) and the other truly `visible` — the browser forces both axes to clip together. A pill that tried to bleed past `<nav>`'s own box into the main content area would get clipped, or trigger a stray horizontal scrollbar.

Fix: reserve ~20-24px of extra width inside the sidebar's own box (both `<nav>` and `<aside>`) beyond today's visual row column. The active pill's protrusion lands inside that reserved space — it never actually overflows `<nav>`'s clipped box, so no scrollbar risk and no clipping surprises. The pill still visually "escapes" the normal row column into a lighter, floating look; it's just contained a touch earlier than the literal sidebar/main-content DOM boundary.

### Sizing
- Expanded: curve radius 20px, pill protrudes 20px past the (reserved) sidebar edge.
- Collapsed (icon rail, w-16): smaller radius/protrusion (~14px) proportional to the narrower row, so the curve doesn't overwhelm a 64px-wide rail.

### States
- **Expanded / hover-expand overlay / mobile drawer:** full notch effect as described above; all three reuse the same row markup and `linkClass()`-equivalent helper, so one implementation covers all of them.
- **Collapsed icon rail:** same mechanics at the smaller size.
- **Transition:** background-color/opacity transition on switching active items (~150-200ms), matching the sidebar's existing transition durations (e.g. the 200ms collapse/expand width transition, the icon rotation transitions).

## Testing / verification
No automated tests exist for `Sidebar.tsx` today (it's presentational). Verification is visual via `npm run dev`:
- Click through Overview, a brand tab, and an Admin page in expanded, collapsed, hover-expanded, and mobile-drawer states.
- Confirm no stray floating-circle or seam artifacts (the specific failure mode from the reverted attempt) in any state.
- Confirm no horizontal scrollbar appears on the Brand Tabs list, and vertical scrolling still works normally.
- Confirm the collapse/expand width transition (200ms) doesn't produce a visual glitch on the active pill mid-animation.

## Out of scope
- Any change to the sidebar's background color (staying dark `slate-900`, not the reference image's blue).
- Any change to the collapsed-mode toggle/pin behavior, hover-expand mechanics, or mobile drawer open/close behavior beyond the row's own active-state styling.
- Keyboard-focus-visible styling beyond whatever the browser/Tailwind defaults already provide (matching the rest of the sidebar's current a11y posture).
