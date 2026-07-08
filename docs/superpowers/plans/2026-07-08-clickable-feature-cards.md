# Clickable Feature Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 5 of the 6 Features grid cards on the How It Works page navigate to their real page on click.

**Architecture:** Single-file change to `src/pages/HowItWorks.tsx` — add an optional `href` field to the existing `FeatureSection` data shape, set it on 5 of 6 entries, and render each card as a React Router `Link` (clickable) or a plain `div` (Brand Tabs always; Admin Users for non-admins) depending on an `isAdmin` check from the existing auth context. No new components, no new routes, no new dependencies.

**Tech Stack:** React 19, TypeScript, Tailwind v4, `react-router-dom` (`Link`, already a project dependency), existing `useAuth()` hook from `src/contexts/AuthContext.tsx`.

## Global Constraints

- `href` values (exact): Overview `/`, Score Summary `/score-summary`, Ask AI `/ask-ai`, Activity Log `/log`, Admin Users `/admin/users`. Brand Tabs gets no `href`.
- A card is clickable only when it has an `href` AND (`!f.adminOnly` OR `isAdmin` is true).
- Clickable cards get `hover:shadow-md hover:border-violet-300 cursor-pointer` in addition to their existing classes; non-clickable cards keep their current styling unchanged.
- No change to card content (icon, title, blurb, bullets, Admin badge) or to any other section on the page.
- Verify with `npm run build`, not `tsc --noEmit` — this repo's root tsconfig is references-only and checks nothing on its own.

---

### Task 1: Wire up clickable cards

**Files:**
- Modify: `src/pages/HowItWorks.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `../contexts/AuthContext` (already exists, exposes `isAdmin: boolean`); `Link` from `react-router-dom` (already a project dependency, used elsewhere in this codebase e.g. `src/pages/Login.tsx`).

- [ ] **Step 1: Add `Link` and `useAuth` imports**

Current imports at the top of the file:

```tsx
import {
  LayoutDashboard, Handshake, BarChart3, Bot, ScrollText, Users,
  type LucideIcon,
} from 'lucide-react';
```

Change to:

```tsx
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, Handshake, BarChart3, Bot, ScrollText, Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
```

- [ ] **Step 2: Add `href` to the `FeatureSection` interface**

Current:

```tsx
interface FeatureSection {
  title: string;
  icon: LucideIcon;
  iconColor: IconColor;
  blurb: string;
  bullets: string[];
  adminOnly?: boolean;
}
```

Change to:

```tsx
interface FeatureSection {
  title: string;
  icon: LucideIcon;
  iconColor: IconColor;
  blurb: string;
  bullets: string[];
  adminOnly?: boolean;
  href?: string;
}
```

- [ ] **Step 3: Add `href` to 5 of the 6 `FEATURES` entries**

The full current `FEATURES` array:

```tsx
const FEATURES: FeatureSection[] = [
  {
    title: 'Overview',
    icon: LayoutDashboard,
    iconColor: 'blue',
    blurb: 'The landing page, a rollup of where every brand tab stands right now.',
    bullets: [
      'KPI cards per brand tab: live, removed, pending, and done counts',
      'Platform breakdown chart across Trustpilot, AskGamblers, Casino.Guru, and Wizard of Odds',
      'A feed of recent mentions for quick scanning',
    ],
  },
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
    icon: BarChart3,
    iconColor: 'amber',
    blurb: 'A rollup of published counts per brand, used for reporting.',
    bullets: [
      'Counts only Published entries by design (raw sheet totals run higher because they include Removed/Refused)',
    ],
  },
  {
    title: 'Ask AI',
    icon: Bot,
    iconColor: 'violet',
    blurb: "A chat assistant that can answer questions over the dashboard's data.",
    bullets: [
      "Read-only, it can look up and summarize entries, it can't edit anything",
      'Supports voice input where the browser allows it',
    ],
  },
  {
    title: 'Activity Log',
    icon: ScrollText,
    iconColor: 'slate',
    blurb: 'An audit trail of who changed what.',
    bullets: [
      'Tracks entry edits and admin actions (approvals, revokes, role changes)',
      'Edited or deleted entries can be restored from here',
    ],
  },
  {
    title: 'Admin Users',
    icon: Users,
    iconColor: 'rose',
    blurb: 'User approval and role management.',
    bullets: [
      'New signups need admin approval before they can access the dashboard',
      'Admins can promote/demote other admins and revoke access',
    ],
    adminOnly: true,
  },
];
```

Replace it with (only the `href` lines are new — `Brand Tabs` is unchanged):

```tsx
const FEATURES: FeatureSection[] = [
  {
    title: 'Overview',
    icon: LayoutDashboard,
    iconColor: 'blue',
    blurb: 'The landing page, a rollup of where every brand tab stands right now.',
    bullets: [
      'KPI cards per brand tab: live, removed, pending, and done counts',
      'Platform breakdown chart across Trustpilot, AskGamblers, Casino.Guru, and Wizard of Odds',
      'A feed of recent mentions for quick scanning',
    ],
    href: '/',
  },
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
    icon: BarChart3,
    iconColor: 'amber',
    blurb: 'A rollup of published counts per brand, used for reporting.',
    bullets: [
      'Counts only Published entries by design (raw sheet totals run higher because they include Removed/Refused)',
    ],
    href: '/score-summary',
  },
  {
    title: 'Ask AI',
    icon: Bot,
    iconColor: 'violet',
    blurb: "A chat assistant that can answer questions over the dashboard's data.",
    bullets: [
      "Read-only, it can look up and summarize entries, it can't edit anything",
      'Supports voice input where the browser allows it',
    ],
    href: '/ask-ai',
  },
  {
    title: 'Activity Log',
    icon: ScrollText,
    iconColor: 'slate',
    blurb: 'An audit trail of who changed what.',
    bullets: [
      'Tracks entry edits and admin actions (approvals, revokes, role changes)',
      'Edited or deleted entries can be restored from here',
    ],
    href: '/log',
  },
  {
    title: 'Admin Users',
    icon: Users,
    iconColor: 'rose',
    blurb: 'User approval and role management.',
    bullets: [
      'New signups need admin approval before they can access the dashboard',
      'Admins can promote/demote other admins and revoke access',
    ],
    adminOnly: true,
    href: '/admin/users',
  },
];
```

- [ ] **Step 4: Read `isAdmin` and render cards conditionally**

Inside the component, current:

```tsx
export default function HowItWorks() {
  return (
```

Change to:

```tsx
export default function HowItWorks() {
  const { isAdmin } = useAuth();
  return (
```

Then, the current Features grid render:

```tsx
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5">
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
            </div>
          ))}
        </div>
```

Replace it with:

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
```

- [ ] **Step 5: Verify the build**

Run:
```bash
npm run build
```
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Visually confirm in the browser**

With `npm run dev` running and logged in as an admin account, open `http://localhost:5173/how-it-works` and confirm:
- Overview, Score Summary, Ask AI, Activity Log, and Admin Users cards show a hover highlight (shadow + violet border) and the pointer cursor, and clicking each navigates to `/`, `/score-summary`, `/ask-ai`, `/log`, and `/admin/users` respectively.
- The Brand Tabs card shows no hover highlight and is not a link (inspect the rendered DOM — it should be a `<div>`, not an `<a>`).

Since only an admin account is available for this check, also read the final `HowItWorks.tsx` code once to confirm the `!f.adminOnly || isAdmin` condition would correctly render Admin Users as a non-clickable plain `<div>` for a non-admin session (this can't be visually exercised without a second, non-admin test account, but the logic is short enough to verify by inspection).

- [ ] **Step 7: Commit**

```bash
git add src/pages/HowItWorks.tsx
git commit -m "feat: make Feature cards clickable, linking to their pages"
```
