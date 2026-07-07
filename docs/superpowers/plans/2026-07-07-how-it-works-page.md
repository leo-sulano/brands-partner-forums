# How It Works Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static "How it works" page that explains the dashboard's purpose and feature set, linked from the sidebar top links.

**Architecture:** One new presentational page component (`src/pages/HowItWorks.tsx`) rendering a hardcoded intro + data-flow blurb + a data-driven grid of feature cards. Wired in via a new lazy route in `src/App.tsx` and a new top-level nav link in `src/components/Sidebar.tsx`. No data fetching, no new types, no Supabase involvement.

**Tech Stack:** React 19 + TypeScript, React Router v7 (lazy route), Tailwind v4 utility classes, lucide-react icons.

## Global Constraints

- Page is visible to every logged-in user (not admin-gated) — per spec section "Route & Nav".
- Nav link goes in `topLinks` in `Sidebar.tsx`, positioned after "Ask AI" — per spec section "Route & Nav".
- Card styling must match existing conventions: `rounded-xl border border-slate-200 bg-white shadow-sm`, icon chips `size-10 rounded-lg bg-{color}-50 text-{color}-500`, section eyebrow `text-xs font-semibold uppercase tracking-widest text-slate-400` — per spec section "Page".
- Seven feature cards, exact icon/content per spec's table: Overview (`LayoutDashboard`), Brand Tabs (`Handshake`), Check Status (`RefreshCw`), Score Summary (`BarChart3`, admin-only), Ask AI (`Bot`), Activity Log (`ScrollText`, admin-only), Admin Users (`Users`, admin-only).
- No screenshots/diagrams, no role-based content variation beyond an "Admin" badge, no table of contents — per spec "Out of Scope".
- **Testing note:** this feature is pure static JSX plus a literal data array — no conditional logic, no data fetching, no existing page in this repo has a component-level test (only `src/lib/*.test.ts` exist, testing pure logic). There is nothing meaningful to unit-test. Verification for every task is `npm run build` (runs `tsc -b && vite build`, the project's established convention — see repo memory on this), and the final task adds a manual dev-server browser check, per the project rule that UI changes must be exercised in a browser before being called done.

---

### Task 1: Create the HowItWorks page component

**Files:**
- Create: `src/pages/HowItWorks.tsx`

**Interfaces:**
- Produces: `export default function HowItWorks(): JSX.Element` — a page component with no props, consumed by Task 2's route wiring.

- [ ] **Step 1: Write the page component**

Create `src/pages/HowItWorks.tsx`:

```tsx
import {
  LayoutDashboard, Handshake, RefreshCw, BarChart3, Bot, ScrollText, Users,
  type LucideIcon,
} from 'lucide-react';

type IconColor = 'blue' | 'violet' | 'emerald' | 'amber' | 'rose' | 'slate';

interface FeatureSection {
  title: string;
  icon: LucideIcon;
  iconColor: IconColor;
  blurb: string;
  bullets: string[];
  adminOnly?: boolean;
}

const ICON_COLOR_CLASSES: Record<IconColor, string> = {
  blue:    'bg-blue-50 text-blue-500',
  violet:  'bg-violet-50 text-violet-500',
  emerald: 'bg-emerald-50 text-emerald-500',
  amber:   'bg-amber-50 text-amber-500',
  rose:    'bg-rose-50 text-rose-500',
  slate:   'bg-slate-100 text-slate-500',
};

const INTRO =
  "This dashboard is the team's internal tool for tracking review-removal requests across Trustpilot, AskGamblers, Casino.Guru, and Wizard of Odds. It centralizes brand-by-brand entry tracking, automated status checks, and reporting in one place — plus an AI assistant that can answer questions over the data.";

const DATA_FLOW =
  "Entries used to live in a shared Google Sheet that synced into this dashboard. Today the dashboard is edited directly and is the live source of truth — the Sheet is no longer the operational record. Status changes (live vs. removed) come from the automated Check Status runs below, not manual edits.";

const FEATURES: FeatureSection[] = [
  {
    title: 'Overview',
    icon: LayoutDashboard,
    iconColor: 'blue',
    blurb: 'The landing page — a rollup of where every brand tab stands right now.',
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
    blurb: 'One tab per brand group — the core workspace for day-to-day tracking.',
    bullets: [
      'Browse every tracked account/entry for that brand group, filterable and sortable',
      'Add, edit, or delete entries directly — this is the live source of truth',
      'Trigger a Check Status run scoped to that tab',
    ],
  },
  {
    title: 'Check Status',
    icon: RefreshCw,
    iconColor: 'emerald',
    blurb: 'Automated detection of whether a review or profile is still live or has been removed.',
    bullets: [
      'Runs per platform (TP/AG/CG/WO) from the Check Status button on each brand tab',
      'Scoped by status, brand, agent, proxy, and country filters so you only re-check what changed',
      "Writes results back into the entry's status column automatically",
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
    adminOnly: true,
  },
  {
    title: 'Ask AI',
    icon: Bot,
    iconColor: 'violet',
    blurb: "A chat assistant that can answer questions over the dashboard's data.",
    bullets: [
      "Read-only — it can look up and summarize entries, it can't edit anything",
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
    adminOnly: true,
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

export default function HowItWorks() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">How it works</h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{INTRO}</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Where the data comes from
        </p>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{DATA_FLOW}</p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
          Features
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
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
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks and builds**

Run: `npm run build`
Expected: Exits 0, no TypeScript errors. `HowItWorks.tsx` isn't imported anywhere yet, so an unused-file warning is not expected (TS doesn't warn on unreferenced files by default in this project's config) — the build should be clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/HowItWorks.tsx
git commit -m "feat: add How It Works page component"
```

---

### Task 2: Wire the route

**Files:**
- Modify: `src/App.tsx:18` (add lazy import), `src/App.tsx:76` (add route)

**Interfaces:**
- Consumes: `HowItWorks` default export from Task 1 (`src/pages/HowItWorks.tsx`).
- Produces: route path `/how-it-works`, available for Task 3's nav link to point to.

- [ ] **Step 1: Add the lazy import**

In `src/App.tsx`, after the existing `AskAI` import line:

```tsx
const AskAI        = lazy(() => import('./pages/AskAI'));
```

add:

```tsx
const HowItWorks    = lazy(() => import('./pages/HowItWorks'));
```

- [ ] **Step 2: Add the route**

In `src/App.tsx`, inside the `<Route element={<ProtectedRoute />}>` block, after the `/ask-ai` route:

```tsx
            <Route path="/ask-ai" element={<AskAI />} />
```

add:

```tsx
            <Route path="/how-it-works" element={<HowItWorks />} />
```

- [ ] **Step 3: Verify it type-checks and builds**

Run: `npm run build`
Expected: Exits 0, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add /how-it-works route"
```

---

### Task 3: Add the sidebar nav link and verify in-browser

**Files:**
- Modify: `src/components/Sidebar.tsx:3-8` (icon import), `src/components/Sidebar.tsx:35-38` (`topLinks` array)

**Interfaces:**
- Consumes: route path `/how-it-works` from Task 2.

- [ ] **Step 1: Import the `BookOpen` icon**

In `src/components/Sidebar.tsx`, the current import block is:

```tsx
import {
  LayoutDashboard, ScrollText,
  Syringe, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart,
  Link2, Users, ChevronDown, ChevronLeft, ChevronUp, BarChart3, Bot, X, Star, LifeBuoy,
  type LucideIcon,
} from 'lucide-react';
```

Change the first line to add `BookOpen`:

```tsx
import {
  LayoutDashboard, ScrollText, BookOpen,
  Syringe, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart,
  Link2, Users, ChevronDown, ChevronLeft, ChevronUp, BarChart3, Bot, X, Star, LifeBuoy,
  type LucideIcon,
} from 'lucide-react';
```

- [ ] **Step 2: Add the nav link**

Current `topLinks`:

```tsx
const topLinks = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/ask-ai', label: 'Ask AI', icon: Bot, end: true },
];
```

Change to:

```tsx
const topLinks = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/ask-ai', label: 'Ask AI', icon: Bot, end: true },
  { to: '/how-it-works', label: 'How it works', icon: BookOpen, end: true },
];
```

- [ ] **Step 3: Verify it type-checks and builds**

Run: `npm run build`
Expected: Exits 0, no TypeScript errors.

- [ ] **Step 4: Manual browser verification**

Run: `npm run dev`, open the printed local URL, log in.

Check:
- Sidebar shows "How it works" after "Ask AI", with a book icon.
- Clicking it navigates to `/how-it-works` and highlights the link as active.
- The page renders the intro paragraph, the "Where the data comes from" card, and a 2-column grid (on desktop width) of 7 feature cards, each with an icon, title, blurb, and bullets; Score Summary, Activity Log, and Admin Users show the "Admin" badge.
- Collapse the sidebar (chevron at the bottom) — the "How it works" icon still shows with a tooltip on hover, consistent with the other top links.
- Resize to mobile width (or use the hamburger) — the mobile drawer also shows the new link and navigating closes the drawer.

Stop the dev server once confirmed.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: add How It Works link to sidebar"
```
