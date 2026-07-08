# Check Status Feature Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing "Check Status" card to the Features grid on the How It Works page.

**Architecture:** Single-file content change — one new object appended to the existing `FEATURES` data array in `src/pages/HowItWorks.tsx`, rendered by the array's existing `.map()`. No new components, no new logic.

**Tech Stack:** React 19, TypeScript, Tailwind v4, lucide-react icons.

## Global Constraints

- Card content must match the spec verbatim: title "Check Status", icon `RefreshCw`, `iconColor: 'emerald'`, the exact blurb and 3 bullets below.
- Position: inserted immediately after the `Brand Tabs` entry in `FEATURES` (third card overall).
- Not admin-gated (no `adminOnly: true`).
- Verify with `npm run build`, not `tsc --noEmit` — this repo's root tsconfig is references-only and checks nothing on its own.

---

### Task 1: Add the Check Status card

**Files:**
- Modify: `src/pages/HowItWorks.tsx`

**Interfaces:**
- Consumes: the existing `FeatureSection` interface and `FEATURES: FeatureSection[]` array already defined in this file (no changes to the interface itself).

- [ ] **Step 1: Add the `RefreshCw` import**

In `src/pages/HowItWorks.tsx`, the current import at the top of the file reads:

```tsx
import {
  LayoutDashboard, Handshake, BarChart3, Bot, ScrollText, Users,
  type LucideIcon,
} from 'lucide-react';
```

Change it to:

```tsx
import {
  LayoutDashboard, Handshake, RefreshCw, BarChart3, Bot, ScrollText, Users,
  type LucideIcon,
} from 'lucide-react';
```

- [ ] **Step 2: Insert the new card into `FEATURES`, right after `Brand Tabs`**

The `Brand Tabs` entry currently reads:

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

Insert a new object between them, so it reads:

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
  {
    title: 'Score Summary',
```

- [ ] **Step 3: Verify the build**

Run:
```bash
npm run build
```
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Visually confirm in the browser**

With `npm run dev` running, open `http://localhost:5173/how-it-works` and confirm the Features grid now shows 7 cards in this order: Overview, Brand Tabs, **Check Status**, Score Summary, Ask AI, Activity Log, Admin Users — and that the Check Status card has an emerald icon chip with the `RefreshCw` icon.

- [ ] **Step 5: Commit**

```bash
git add src/pages/HowItWorks.tsx
git commit -m "feat: add missing Check Status card to How It Works Features grid"
```
