# Check Status Standalone Section — Design Spec

**Date:** 2026-07-08
**Status:** Approved

## Overview

The "Check Status" card added earlier today to the Features grid on the How It Works page ([src/pages/HowItWorks.tsx](../../../src/pages/HowItWorks.tsx)) moves out into its own standalone section instead — matching the treatment "Getting Started" and "Where the data comes from" already get. The Features grid returns to 6 cards.

## Change

**1. Remove from `FEATURES`:** delete the `Check Status` object added by the previous change (title, icon `RefreshCw`, iconColor `emerald`, blurb, 3 bullets) from the `FEATURES` array. `FEATURES` returns to: Overview, Brand Tabs, Score Summary, Ask AI, Activity Log, Admin Users.

**2. Remove the now-unused `RefreshCw` import** from the `lucide-react` import at the top of the file — no icon chip is used in the new standalone section.

**3. Add a new standalone section**, positioned after the "Getting Started" card and before the "Features" label/grid:

```tsx
<div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5">
  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
    Check Status
  </p>
  <p className="text-sm text-slate-600 leading-relaxed">
    Runs an automated checker against Trustpilot, AskGamblers, Casino.Guru, and Wizard of Odds to detect whether each entry is still live or has been removed.
  </p>
  <ul className="mt-3 space-y-1">
    <li className="text-sm text-slate-500 flex gap-2">
      <span className="text-slate-300">&bull;</span>
      <span>Per-tab button; multi-platform tabs let you check all platforms at once or just one</span>
    </li>
    <li className="text-sm text-slate-500 flex gap-2">
      <span className="text-slate-300">&bull;</span>
      <span>Scoped to whatever filters are active — status, brand, agent, proxy, or country — so you can re-check just a subset</span>
    </li>
    <li className="text-sm text-slate-500 flex gap-2">
      <span className="text-slate-300">&bull;</span>
      <span>Updates the status column and shows a toast summary once the run completes</span>
    </li>
  </ul>
</div>
```

Content is unchanged from the removed card's blurb and 3 bullets — only the presentation (plain card instead of icon-chip grid tile) and location change. This mirrors the existing "Where the data comes from" card's structure (eyebrow label + paragraph), extended with the bullet-list markup already used inside Features cards.

Final page order: Intro paragraph → "Where the data comes from" card → "Getting Started" card → **"Check Status" card** → "Features" label + grid (6 cards).

## Files Changed

| File | Change |
|---|---|
| `src/pages/HowItWorks.tsx` | Remove `Check Status` from `FEATURES`; remove `RefreshCw` import; add new standalone "Check Status" section between Getting Started and Features |

## Out of Scope

- Any change to the section's copy/content — verbatim reuse of the blurb and bullets from the removed Features card.
- Any change to the Getting Started section or the Features grid's remaining 6 cards.
