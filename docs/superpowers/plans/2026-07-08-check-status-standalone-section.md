# Check Status Standalone Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the "Check Status" content off the Features grid and into its own standalone section on the How It Works page.

**Architecture:** Single-file content change to `src/pages/HowItWorks.tsx` — remove one object from the `FEATURES` array, remove its now-unused icon import, and add one new static JSX section (no new components, no new logic, no new data).

**Tech Stack:** React 19, TypeScript, Tailwind v4, lucide-react icons.

## Global Constraints

- Final page section order: Intro → "Where the data comes from" → "Getting Started" → **"Check Status"** → "Features" (6 cards).
- The new section's blurb and 3 bullets must be copied verbatim from the removed Features card — no content changes.
- `FEATURES` must return to exactly 6 entries: Overview, Brand Tabs, Score Summary, Ask AI, Activity Log, Admin Users.
- Verify with `npm run build`, not `tsc --noEmit` — this repo's root tsconfig is references-only and checks nothing on its own.

---

### Task 1: Move Check Status into its own section

**Files:**
- Modify: `src/pages/HowItWorks.tsx`

**Interfaces:**
- Consumes: the existing `FEATURES: FeatureSection[]` array and the page's existing JSX structure (Intro paragraph, "Where the data comes from" card, "Getting Started" card, "Features" label + grid) — all already present in this file.

- [ ] **Step 1: Remove the now-unused `RefreshCw` import**

Current import (top of file):

```tsx
import {
  LayoutDashboard, Handshake, RefreshCw, BarChart3, Bot, ScrollText, Users,
  type LucideIcon,
} from 'lucide-react';
```

Change to:

```tsx
import {
  LayoutDashboard, Handshake, BarChart3, Bot, ScrollText, Users,
  type LucideIcon,
} from 'lucide-react';
```

- [ ] **Step 2: Remove the `Check Status` object from `FEATURES`**

Current `FEATURES` array has this entry between `Brand Tabs` and `Score Summary`:

```tsx
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

Delete this entire object, so `Brand Tabs` is immediately followed by `Score Summary` again:

```tsx
  {
    title: 'Brand Tabs',
    icon: Handshake,
    iconColor: 'violet',
    blurb: 'One tab per brand group, the core workspace for day-to-day tracking.',
    bullets: [
      'Browse every tracked account/entry for that brand group, filterable and sortable',
      'Add, edit, or delete entries directly, this is the live source of truth',
      'Trigger a Check Status run scoped to that tab',
    ],
  },
  {
    title: 'Score Summary',
```

`FEATURES` now has exactly 6 entries: Overview, Brand Tabs, Score Summary, Ask AI, Activity Log, Admin Users.

- [ ] **Step 3: Add the standalone "Check Status" section**

In the component's returned JSX, the "Getting Started" card is currently immediately followed by the "Features" `<div>`:

```tsx
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Getting Started
        </p>
        <div className="grid gap-5 lg:grid-cols-2 lg:items-center">
          <img
            src="/getting-started.gif"
            alt="Walkthrough: logging in, adding an entry, editing it, and running Check Status"
            className="w-full rounded-lg border border-slate-200"
          />
          <ol className="space-y-2">
            {GETTING_STARTED_STEPS.map((step, i) => (
              <li key={step} className="flex gap-3 text-sm text-slate-600">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-50 text-xs font-semibold text-violet-600">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Features
        </p>
```

Insert a new section between them, so it reads:

```tsx
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Getting Started
        </p>
        <div className="grid gap-5 lg:grid-cols-2 lg:items-center">
          <img
            src="/getting-started.gif"
            alt="Walkthrough: logging in, adding an entry, editing it, and running Check Status"
            className="w-full rounded-lg border border-slate-200"
          />
          <ol className="space-y-2">
            {GETTING_STARTED_STEPS.map((step, i) => (
              <li key={step} className="flex gap-3 text-sm text-slate-600">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-violet-50 text-xs font-semibold text-violet-600">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

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

      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Features
        </p>
```

- [ ] **Step 4: Verify the build**

Run:
```bash
npm run build
```
Expected: exits 0, no TypeScript errors, no "unused import" warnings for `RefreshCw`.

- [ ] **Step 5: Visually confirm in the browser**

With `npm run dev` running, open `http://localhost:5173/how-it-works` and confirm:
- Section order top to bottom: Intro paragraph, "Where the data comes from", "Getting Started" (with GIF), **"Check Status"** (plain card, no icon, blurb + 3 bullets), "Features" label + grid
- The Features grid now shows exactly 6 cards: Overview, Brand Tabs, Score Summary, Ask AI, Activity Log, Admin Users — no "Check Status" tile among them

- [ ] **Step 6: Commit**

```bash
git add src/pages/HowItWorks.tsx
git commit -m "refactor: move Check Status into its own How It Works section"
```
