# Color Scheme Alignment — Design Spec

**Date:** 2026-07-15
**Status:** Approved

## Purpose

Align the Brands Partner Forum dashboard's accent color palette with the reference screenshot from the Ranking Reports app (`localhost:3000`), which uses a deep navy (`#1e1b4b`) and blue (`#2563eb`) color scheme. This is a palette-only change — no layout, component structure, or copy changes.

## Current State

Two overlapping, inconsistent accent systems exist today:
1. Tailwind's `violet-*` utility classes — 190 occurrences across 23 files (Sidebar, Topbar, Overview, modals, dropdowns, forms, BrandGroup, etc.)
2. A custom `--color-brand-*` indigo scale defined in `src/index.css` (`#eef2ff` / `#e0e7ff` / `#6366f1` / `#4f46e5` / `#4338ca`) — used in ~6 files (AssistantWidget, AskAI, MentionDetail, StatusBadge, MentionsTable, TopList)

Neither matches the reference screenshot.

## Target Palette

| Element | Current | New |
|---|---|---|
| Sidebar background (`bg-slate-900`) | `#0f172a` | `indigo-950` (`#1e1b4b`) |
| Primary interactive accent (sidebar active/hover nav, buttons, links, focus rings, icon-circle backgrounds) | `violet-*` (all shades) | `blue-*` (same shade numbers, e.g. `violet-50`→`blue-50`, `violet-100`→`blue-100`, `violet-400`→`blue-400`, `violet-500`→`blue-500`, `violet-600`→`blue-600`, `violet-700`→`blue-700`) |
| `--color-brand-50` | `#eef2ff` | `#eff6ff` (blue-50) |
| `--color-brand-100` | `#e0e7ff` | `#dbeafe` (blue-100) |
| `--color-brand-500` | `#6366f1` | `#3b82f6` (blue-500) |
| `--color-brand-600` | `#4f46e5` | `#2563eb` (blue-600) |
| `--color-brand-700` | `#4338ca` | `#1d4ed8` (blue-700) |

## Explicitly Unchanged

- **Casino Guru's platform badge** stays violet (`bg-violet-100 text-violet-700` and related `PLATFORM_BADGE_CLS` / `PLATFORM_BADGE` / `PLATFORM_COLORS` entries) — it's a categorical/semantic color distinguishing it from Trustpilot (blue), AskGamblers (amber), and Wizard of Odds (indigo/green), not part of the interactive-accent system being swapped.
- KPI card semantic colors (`blue` / `emerald` / `rose` options in `KpiCard.tsx`) — `blue` already matches the target palette.
- Avatar colors (`AVATAR_COLORS` in Topbar) — decorative, not part of the accent system.
- All layouts, component structure, spacing, and copy.

## Scope of Change

Mechanical rename across all files currently using `violet-*` Tailwind classes for **interactive accent purposes** (not the CG badge), plus the 5 token values in `src/index.css`. Files affected include but are not limited to: `Sidebar.tsx`, `Topbar.tsx`, `Overview.tsx`, `BrandGroup.tsx` (largest, 57 occurrences), `BrandTabsModal.tsx`, `BrandSelectDropdown.tsx`, `TotalBreakdownModal.tsx`, `AddReviewAccountModal.tsx`, `EditEntryModal.tsx`, `DatePicker.tsx`, `SelectDropdown.tsx`, `ProtectedRoute.tsx`, `ScoreSummaryPanel.tsx`, `ActivityLog.tsx`, `AdminUsers.tsx`, `Login.tsx`, `Signup.tsx`, `ResetPassword.tsx`, `HowItWorks.tsx`, `AskAI.tsx`, `MentionDetail.tsx`, `MentionsTable.tsx`, `AssistantWidget.tsx`, `StatusBadge.tsx`, `TopList.tsx`.

Each file needs individual review during implementation to confirm a given `violet-*` usage is interactive-accent (rename to `blue-*`) rather than the CG semantic badge (leave as-is).

## Testing / Verification

- `npm run build` must pass (per project convention — `tsc --noEmit` alone doesn't catch everything here).
- Visual check via local dev server (`npm run dev`): sidebar, Overview KPI cards/hover states, a brand tab page (BrandGroup), a modal (e.g. Add Review Account), and the CG platform badge to confirm it's still visually distinct.
- Deploy is out of scope for this pass — "work on local first" per the user's request; a follow-up conversation will cover pushing/deploying once local is confirmed.
