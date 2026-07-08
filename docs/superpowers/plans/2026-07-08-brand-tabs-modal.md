# Brand Tabs Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Brand Tabs" Features card on the How It Works page clickable, opening a modal that lists all 11 brand tabs as jump-off links.

**Architecture:** A new standalone modal component (`BrandTabsModal.tsx`), modeled on the existing `TotalBreakdownModal.tsx` pattern, plus a small integration change in `HowItWorks.tsx` (local open/close state, and a new render branch for the Brand Tabs card that opens the modal instead of navigating directly).

**Tech Stack:** React 19, TypeScript, Tailwind v4, `react-router-dom` (`Link`), `lucide-react` (`X` icon), existing `lib/tabs.ts` (`OPERATIONAL_TABS`, `tabToSlug`) and `lib/tab-configs.ts` (`getTabPlatforms`).

## Global Constraints

- The modal must close on backdrop click, on Escape, on its `X` button, and when a row is clicked (in addition to navigating).
- Each row shows the tab name and platform favicon badges (via `getTabPlatforms`) — no other content, no per-tab icons.
- The `PLATFORM_FAVICON` URL map is a new, small (4-entry) constant local to the new modal file — do not import it from or modify `Sidebar.tsx`.
- The Brand Tabs card gets the same hover styling (`hover:shadow-md hover:border-violet-300 cursor-pointer`) as the other clickable Features cards, but must render as a `<button>` (opens the modal), never a `<Link>` (it has no single destination).
- No changes to `FeatureSection`'s data shape (no new field) — the Brand Tabs special case is keyed off `f.title === 'Brand Tabs'` directly in the render, since it's a one-off.
- Verify with `npm run build`, not `tsc --noEmit` — this repo's root tsconfig is references-only and checks nothing on its own.

---

### Task 1: Create the BrandTabsModal component

**Files:**
- Create: `src/components/BrandTabsModal.tsx`

**Interfaces:**
- Produces: `export default function BrandTabsModal({ onClose }: { onClose: () => void }): JSX.Element` — a self-contained modal with no other required props (it reads `OPERATIONAL_TABS` itself). Task 2 imports this component and passes only `onClose`.

- [ ] **Step 1: Write the component**

```tsx
// src/components/BrandTabsModal.tsx
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

- [ ] **Step 2: Verify the build**

Run:
```bash
npm run build
```
Expected: exits 0, no TypeScript errors. (This component isn't imported anywhere yet, so this step only confirms the new file itself is syntactically and type-correct in isolation — Task 2 wires it in.)

- [ ] **Step 3: Commit**

```bash
git add src/components/BrandTabsModal.tsx
git commit -m "feat: add BrandTabsModal component"
```

---

### Task 2: Wire the modal into How It Works

**Files:**
- Modify: `src/pages/HowItWorks.tsx`

**Interfaces:**
- Consumes: `BrandTabsModal` from Task 1 (`import BrandTabsModal from '../components/BrandTabsModal'`), taking a single `onClose: () => void` prop.

- [ ] **Step 1: Add the `useState` and `BrandTabsModal` imports**

Current imports at the top of the file:

```tsx
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, Handshake, BarChart3, Bot, ScrollText, Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
```

Change to:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, Handshake, BarChart3, Bot, ScrollText, Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import BrandTabsModal from '../components/BrandTabsModal';
```

- [ ] **Step 2: Add modal state**

Current:

```tsx
export default function HowItWorks() {
  const { isAdmin } = useAuth();
  return (
```

Change to:

```tsx
export default function HowItWorks() {
  const { isAdmin } = useAuth();
  const [showBrandTabsModal, setShowBrandTabsModal] = useState(false);
  return (
```

- [ ] **Step 3: Add the Brand Tabs special case and render the modal**

Current Features grid render:

```tsx
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const clickable = Boolean(f.href) && (!f.adminOnly || isAdmin);
            const cardClass = `rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5 transition-shadow ${clickable ? 'hover:shadow-md hover:border-violet-300 cursor-pointer' : ''}`;
            const content = (
              <div className="flex items-start gap-3">
                <div
                  className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${ICON_COLOR_CLASSES[f.iconColor]}`}
                >
                  <f.icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-slate-900">{f.title}</h2>
                    {f.adminOnly && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">
                        Admin
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{f.blurb}</p>
                  <ul className="mt-2 space-y-1">
                    {f.bullets.map((b) => (
                      <li key={b} className="text-sm text-slate-500 flex gap-2">
                        <span className="text-slate-300">&bull;</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
            return clickable ? (
              <Link key={f.title} to={f.href!} className={cardClass}>
                {content}
              </Link>
            ) : (
              <div key={f.title} className={cardClass}>
                {content}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

Replace it with:

```tsx
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const clickable = Boolean(f.href) && (!f.adminOnly || isAdmin);
            const opensModal = f.title === 'Brand Tabs';
            const cardClass = `rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5 transition-shadow ${(clickable || opensModal) ? 'hover:shadow-md hover:border-violet-300 cursor-pointer' : ''}`;
            const content = (
              <div className="flex items-start gap-3">
                <div
                  className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${ICON_COLOR_CLASSES[f.iconColor]}`}
                >
                  <f.icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-slate-900">{f.title}</h2>
                    {f.adminOnly && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">
                        Admin
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{f.blurb}</p>
                  <ul className="mt-2 space-y-1">
                    {f.bullets.map((b) => (
                      <li key={b} className="text-sm text-slate-500 flex gap-2">
                        <span className="text-slate-300">&bull;</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
            if (clickable) {
              return (
                <Link key={f.title} to={f.href!} className={cardClass}>
                  {content}
                </Link>
              );
            }
            if (opensModal) {
              return (
                <button
                  key={f.title}
                  type="button"
                  onClick={() => setShowBrandTabsModal(true)}
                  className={`${cardClass} w-full text-left`}
                >
                  {content}
                </button>
              );
            }
            return (
              <div key={f.title} className={cardClass}>
                {content}
              </div>
            );
          })}
        </div>
      </div>

      {showBrandTabsModal && <BrandTabsModal onClose={() => setShowBrandTabsModal(false)} />}
    </div>
  );
}
```

Note the closing structure changed: the `{showBrandTabsModal && ...}` line sits after the Features `</div>` and before the page's outermost closing `</div>` and `);`/`}`.

- [ ] **Step 4: Verify the build**

Run:
```bash
npm run build
```
Expected: exits 0, no TypeScript errors.

- [ ] **Step 5: Visually confirm in the browser**

With `npm run dev` running and logged in, open `http://localhost:5173/how-it-works` and confirm:
- The Brand Tabs card shows the same hover highlight as the other clickable cards.
- Clicking it opens a modal titled "Brand Tabs" listing all 11 tabs, each with its name and platform favicon badges.
- Clicking a tab row navigates to that tab's page (e.g. `/brands/tp-brand-injection`) and the modal is closed.
- Clicking the backdrop, pressing Escape, or clicking the `X` all close the modal without navigating.

- [ ] **Step 6: Commit**

```bash
git add src/pages/HowItWorks.tsx
git commit -m "feat: open Brand Tabs modal from its How It Works card"
```
