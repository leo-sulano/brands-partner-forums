# Check Status Feature Card — Design Spec

**Date:** 2026-07-08
**Status:** Approved

## Overview

Add a "Check Status" card to the Features grid on the How It Works page ([src/pages/HowItWorks.tsx](../../../src/pages/HowItWorks.tsx)). The original 2026-07-07 How It Works spec planned this card, but it was never actually added — the live `FEATURES` array has Overview, Brand Tabs, Score Summary, Ask AI, Activity Log, and Admin Users only. Brand Tabs' existing blurb briefly mentions triggering a Check Status run; this card explains what that run actually does.

## Change

Insert one new entry into the `FEATURES` array in `HowItWorks.tsx`, positioned right after `Brand Tabs` (third card overall):

```ts
{
  title: 'Check Status',
  icon: RefreshCw,
  iconColor: 'emerald',
  blurb: 'Runs an automated checker against Trustpilot, AskGamblers, Casino.Guru, and Wizard of Odds to detect whether each entry is still live or has been removed.',
  bullets: [
    'Per-tab button; multi-platform tabs let you check all platforms at once or just one',
    'Scoped to whatever filters are active — status, brand, agent, proxy, or country — so you can re-check just a subset',
    'Updates the status column and shows a toast summary once the run completes',
  ],
},
```

- Icon `RefreshCw` matches the actual Check Status button's icon in `BrandGroup.tsx`.
- `iconColor: 'emerald'` — the only `IconColor` value not already used by an existing card.
- Import `RefreshCw` from `lucide-react` alongside the file's existing icon imports.

No other cards, no other sections, no layout changes. Not admin-gated (matches the rest of the Features grid other than Admin Users).

## Files Changed

| File | Change |
|---|---|
| `src/pages/HowItWorks.tsx` | New `RefreshCw` import; one new object inserted into `FEATURES` after `Brand Tabs` |

## Out of Scope

- A dedicated "Add Review Account" card — Brand Tabs' existing blurb already covers add/edit/delete briefly; not being split out.
- Any change to the Getting Started section added earlier today.
