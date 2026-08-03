# Schedule Planner: Clickable Brand Name (Design)

## Problem
The Brand column in the Schedule Planner grid is plain text. With many brands on a tab,
finding one specific brand's row means using the search box above the table, even when
you're already looking right at the row you want.

## Design
Make the brand name in each row's Brand cell (`SchedulePlanner.tsx`, the `<td>` around
line 456-458) clickable. Clicking it sets the existing `search` state to that brand's
exact name, which re-filters `filteredBrands` down to just that row via the existing
case-insensitive substring match (`b.toLowerCase().includes(q)`) — an exact name is
always a substring of itself, so no new matching logic is needed.

Visual treatment: `cursor-pointer` plus a hover color/underline on the brand text,
consistent with other clickable brand-name text in the app (e.g. `BrandSelectDropdown`).
No new component, no new state — one `onClick` wired to the existing `setSearch`.

## Out of scope
- No toggle-to-clear-on-second-click behavior — the search box is already visible and
  editable, so clearing it manually is one click away.
- No navigation to another page/tab. This only filters the current grid.
