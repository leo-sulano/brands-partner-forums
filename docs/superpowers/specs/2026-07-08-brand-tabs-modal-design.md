# Brand Tabs Modal — Design Spec

**Date:** 2026-07-08
**Status:** Approved

## Overview

The "Brand Tabs" card on the How It Works Features grid ([src/pages/HowItWorks.tsx](../../../src/pages/HowItWorks.tsx)) currently isn't clickable (unlike its 5 siblings, made clickable earlier today) because it has no single destination — there are 11 brand tabs. Instead of linking to one page, clicking it now opens a modal listing all 11 tabs, each a jump-off point to its own page.

## Change

**1. New component `src/components/BrandTabsModal.tsx`**, modeled on the existing `TotalBreakdownModal.tsx` pattern (fixed-position overlay, click-backdrop-to-close, Escape-to-close, header with title + `X` close button):

```tsx
import { X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { OPERATIONAL_TABS, tabToSlug } from '../lib/tabs';
import { getTabPlatforms } from '../lib/tab-configs';

interface Props {
  onClose: () => void;
}

const PLATFORM_FAVICON: Record<'tp' | 'ag' | 'cg' | 'wo', string> = {
  tp: 'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=16',
  ag: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=16',
  cg: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=16',
  wo: 'https://www.google.com/s2/favicons?domain=wizardofodds.com&sz=64',
};

export default function BrandTabsModal({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl">

        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Brand Tabs</h2>
            <p className="text-xs text-slate-400 mt-0.5">Jump to any brand tab</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-violet-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-4 pb-4 space-y-1.5 max-h-[70vh] overflow-y-auto">
          {OPERATIONAL_TABS.map((tab) => {
            const platforms = getTabPlatforms(tab);
            return (
              <Link
                key={tab}
                to={`/brands/${tabToSlug(tab)}`}
                onClick={onClose}
                className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5 hover:bg-violet-50 hover:border-violet-200 transition-colors"
              >
                <span className="text-sm font-medium text-slate-700 truncate">{tab}</span>
                <span className="flex items-center gap-1 shrink-0 ml-2">
                  {platforms.map((p) => (
                    <img
                      key={p}
                      src={PLATFORM_FAVICON[p]}
                      alt={p}
                      className="size-3.5 rounded-sm"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ))}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

**2. `src/pages/HowItWorks.tsx` changes:**

- Import `useState` from `react`, and `BrandTabsModal` from `../components/BrandTabsModal`.
- Add `const [showBrandTabsModal, setShowBrandTabsModal] = useState(false);` inside the component.
- Render `{showBrandTabsModal && <BrandTabsModal onClose={() => setShowBrandTabsModal(false)} />}` once, near the end of the returned JSX (sibling to the page's top-level `<div className="space-y-6">` content, matching where other modals are conditionally rendered elsewhere in this codebase).
- In the Features grid render loop, special-case the Brand Tabs card: it gets the same hover styling as a clickable card, but renders as a `<button type="button" className="... w-full text-left">` that calls `setShowBrandTabsModal(true)` on click, instead of a `<Link>`. Concretely, the three render branches become: `Link` (has `href`, admin check passes) → `button` (title is `'Brand Tabs'`) → plain `div` (Admin Users, non-admin). No new field is added to `FeatureSection` for this — it's a one-off keyed off `f.title === 'Brand Tabs'`, since only one card needs this behavior (adding a generic `onClick` field to the data shape for a single consumer would be premature).

## Files Changed

| File | Change |
|---|---|
| `src/components/BrandTabsModal.tsx` | New component |
| `src/pages/HowItWorks.tsx` | Add modal state + render; Brand Tabs card becomes a button that opens the modal |

## Out of Scope

- Extracting/sharing `PLATFORM_FAVICON` between `Sidebar.tsx` and the new modal — duplicated as a small, stable 4-entry constant rather than refactoring an unrelated file for a second use.
- Per-tab Lucide icons (like the sidebar's `TAB_ICONS` map) — not reused or duplicated; the modal relies on the tab name and platform badges only.
- Any change to the other 5 Features cards' click behavior (already shipped).
