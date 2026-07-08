# Clickable Feature Cards — Design Spec

**Date:** 2026-07-08
**Status:** Approved

## Overview

Make the Features grid cards on the How It Works page ([src/pages/HowItWorks.tsx](../../../src/pages/HowItWorks.tsx)) navigate to their real page when clicked, so the page doubles as a jumping-off point into the app. Not every card has a single canonical destination or is accessible to every user, so this is per-card, not blanket.

## Change

**1. Add `href?: string` to `FeatureSection`:**

```ts
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

**2. Set `href` on 5 of the 6 `FEATURES` entries:**

| Card | `href` |
|---|---|
| Overview | `/` |
| Brand Tabs | *(none — 11 tabs exist, no single canonical page; stays non-clickable)* |
| Score Summary | `/score-summary` |
| Ask AI | `/ask-ai` |
| Activity Log | `/log` |
| Admin Users | `/admin/users` |

**3. Render each card as a `Link` when clickable, a plain `div` otherwise:**

A card is clickable when it has an `href` AND (it isn't `adminOnly`, OR the current user is an admin per `useAuth().isAdmin`). Concretely:

```tsx
const { isAdmin } = useAuth(); // import from '../contexts/AuthContext'

// inside the FEATURES.map():
const clickable = Boolean(f.href) && (!f.adminOnly || isAdmin);
const cardClass = `rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5 transition-shadow ${clickable ? 'hover:shadow-md hover:border-violet-300 cursor-pointer' : ''}`;
const content = (
  <div className="flex items-start gap-3">
    {/* existing icon chip + title + admin badge + blurb + bullets, unchanged */}
  </div>
);
return clickable ? (
  <Link key={f.title} to={f.href!} className={cardClass}>{content}</Link>
) : (
  <div key={f.title} className={cardClass}>{content}</div>
);
```

`Link` comes from `react-router-dom` (new import). Admin Users keeps its existing "Admin" badge regardless of clickability — non-admins still see the card, they just can't click into it (matches today's behavior, where `/admin/users` itself already redirects non-admins to `/`, so this is a UX improvement — no dead-end click — not a new permission boundary).

No changes to card content (icon, blurb, bullets) or to the Getting Started / Check Status / Data Flow sections — this only affects the Features grid's click behavior.

## Files Changed

| File | Change |
|---|---|
| `src/pages/HowItWorks.tsx` | Add `href` to `FeatureSection` + 5 `FEATURES` entries; import `Link` and `useAuth`; wrap clickable cards in `Link` with hover styling |

## Out of Scope

- Making Brand Tabs clickable — no single canonical destination among its 11 tabs.
- Any change to which users can access `/admin/users` — the route's own admin gate (`Navigate to="/"` for non-admins) is unchanged; this only decides whether the *card* is a clickable link.
- Any change to the Getting Started, Check Status, or Data Flow sections.
