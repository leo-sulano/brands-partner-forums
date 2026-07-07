# How It Works Page — Design Spec

**Date:** 2026-07-07
**Status:** Approved

## Overview

Add a static "How it works" page explaining what the dashboard does and how its main features fit together. Visible to every logged-in user (not admin-gated), linked from the sidebar top links after "Ask AI". No data fetching — pure content page.

## Route & Nav

| File | Change |
|---|---|
| `src/App.tsx` | Add lazy-loaded `HowItWorks` page; new protected route `/how-it-works` inside `AppLayout` + `ProtectedRoute`, alongside the other top-level routes |
| `src/components/Sidebar.tsx` | Add an entry to `topLinks` after Ask AI: `{ to: '/how-it-works', label: 'How it works', icon: BookOpen, end: true }` (import `BookOpen` from `lucide-react`) |

## Page: `src/pages/HowItWorks.tsx`

Static content, styled consistent with existing card conventions (`rounded-xl border border-slate-200 bg-white shadow-sm`, icon chips `size-10 rounded-lg bg-{color}-50 text-{color}-500`, section eyebrow text `text-xs font-semibold uppercase tracking-widest text-slate-400`).

### 1. Intro

Short paragraph: this dashboard tracks negative-review/mention removal requests for managed brands across Trustpilot, AskGamblers, Casino.Guru, and Wizard of Odds, and centralizes status, reporting, and an AI assistant over that data.

### 2. Data flow

Brief blurb, not a diagram: entries originated from a Google Sheet the team maintained; today entries are edited directly in the dashboard, which is the live source of truth. Status changes come from automated checks (see "Check Status" below), not manual sheet edits.

### 3. Feature grid

A data-driven array of section objects (icon, title, blurb, bullets), mapped to a responsive grid of cards (`grid gap-4 md:grid-cols-2`). Seven entries:

| Card | Icon | Content |
|---|---|---|
| Overview | `LayoutDashboard` | Landing page — KPI rollups per brand tab (live/removed/pending/done), platform breakdown chart, recent mentions feed |
| Brand Tabs | `Handshake` | One tab per brand group; the core workspace — browse, add, edit, and delete tracked accounts/entries per platform |
| Check Status | `RefreshCw` | Per-tab "Check Status" button runs an automated checker against TP/AG/CG/WO to detect live/removed state, scoped by status/brand/agent/proxy/country filters |
| Score Summary | `BarChart3` | Admin-only rollup of published counts per brand, used for reporting |
| Ask AI | `Bot` | Chat assistant (gpt-4o-mini) that answers questions over the dashboard's data, read-only |
| Activity Log | `ScrollText` | Admin-only audit trail of entry edits and admin actions (approvals, revokes, role changes), with restore |
| Admin Users | `Users` | Admin-only user approval and role management gate |

Each card notes when a feature is admin-only via a small badge/label, since the page itself is visible to all users but some linked features are gated.

## Data Model

None — no Supabase queries, no new types.

## Files Changed

| File | Change |
|---|---|
| `src/pages/HowItWorks.tsx` | New static page |
| `src/App.tsx` | New lazy import + route |
| `src/components/Sidebar.tsx` | New top link + icon import |

## Out of Scope

- Screenshots or diagrams — text and icons only, matching the rest of the dashboard's UI density.
- Role-based content variation (admins and non-admins see the same page; admin-only features are simply labeled).
- Search/anchor links or a table of contents — single scroll page.
