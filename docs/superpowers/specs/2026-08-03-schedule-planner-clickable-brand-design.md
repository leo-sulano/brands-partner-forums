# Schedule Planner: Clickable Brand Name (Design)

## Problem
The Brand column in the Schedule Planner grid is plain text. Seeing a brand's full
review/outreach entries means leaving the page, switching to Brand Tabs, and manually
finding the same brand there.

## Design
Make the brand name in each row's Brand cell (`SchedulePlanner.tsx`, the `<td>` around
line 455-464) a `Link` to that brand's row on the Brand Tabs page:
`/brands/${tabToSlug(tab)}?brand=${encodeURIComponent(brand)}`.

This reuses an existing deep-link convention — `BrandGroup.tsx` already reads a `brand`
query param on load and pre-sets its `brandFilter` from it (see the `hasDeepLinkParams`
check around line 859-862), and `ScoreSummaryPanel.tsx` already links to brands this same
way. No changes needed on the `BrandGroup` side.

Visual treatment: hover color/underline on the brand text, consistent with other
clickable brand-name text in the app.

## Out of scope
- No `platform`/`status`/`rating` query params — Schedule Planner has no such filter
  selected, so the link only carries `brand`.
- No changes to `BrandGroup.tsx` — its existing deep-link handling already covers this.
