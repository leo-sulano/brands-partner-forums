# Manual Brand Name Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users type a brand name that doesn't already exist in a tab's known-brands list, in the Add Review Account modal, on every brand tab.

**Architecture:** `BrandSelectDropdown` gains a "creatable" row — typing a name with no case-insensitive match shows an `+ Add "<text>"` option that sets the typed text as the value. `AddReviewAccountModal` then always renders that dropdown for the brand field instead of falling back to a bare text input when a tab has zero known brands.

**Tech Stack:** React 19, TypeScript strict mode, Tailwind v4, lucide-react icons, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-10-manual-brand-entry-design.md`.
- This repo has no component-test harness (no React Testing Library / jsdom) — only pure-logic `.test.ts` files exist under `src/lib/`. There is no existing precedent for testing a `.tsx` component in isolation, so these tasks are verified via `npm run build` (the authoritative type-check per project convention — plain `tsc --noEmit` checks nothing here since the root tsconfig is references-only) plus manual browser verification against the running dev server, per this project's CLAUDE.md ("For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete").
- No new dependencies. No changes to `handleBrandChange`, `resolveBrandLink`, `getBrandAgUrl`, `getBrandCgUrl`, or the `availableBrands` computation — confirmed safe/unchanged by the spec.

---

### Task 1: Make `BrandSelectDropdown` creatable

**Files:**
- Modify: `src/components/BrandSelectDropdown.tsx`

**Interfaces:**
- Consumes: existing props `value: string`, `onChange: (v: string) => void`, `brands: string[]`, `disabled?: boolean` — unchanged, no new props.
- Produces: same `onChange(v: string)` contract `AddReviewAccountModal.tsx`'s `handleBrandChange` already relies on — callers cannot tell whether the value came from the list or was typed.

- [ ] **Step 1: Import the `Plus` icon**

In `src/components/BrandSelectDropdown.tsx`, change the lucide-react import (line 2) from:

```tsx
import { ChevronDown, Search, X, Check } from 'lucide-react';
```

to:

```tsx
import { ChevronDown, Search, X, Check, Plus } from 'lucide-react';
```

- [ ] **Step 2: Compute the creatable-add condition**

Directly above the `return (` statement (after the `visible` computation, currently lines 27-29), add:

```tsx
const trimmedSearch = search.trim();
const hasExactMatch = trimmedSearch !== '' && brands.some((b) => b.toLowerCase() === trimmedSearch.toLowerCase());
const showAddOption = trimmedSearch !== '' && !hasExactMatch;
```

- [ ] **Step 3: Render the "+ Add" row above the brand list**

Inside `<div className="max-h-56 overflow-y-auto py-1">` (line 77), insert the Add row as the first child, before the existing `— Select brand —` button (lines 78-85):

```tsx
{showAddOption && (
  <button
    type="button"
    onClick={() => { onChange(trimmedSearch); setOpen(false); }}
    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-violet-700 transition-colors hover:bg-violet-50"
  >
    <Plus className="size-3 shrink-0 text-violet-500" />
    <span className="flex-1 truncate">Add "{trimmedSearch}"</span>
  </button>
)}
```

- [ ] **Step 4: Suppress the redundant "No brands match" message when the Add row is showing**

Change the existing condition (line 86):

```tsx
{visible.length === 0 && (
  <div className="px-3 py-4 text-center text-xs text-slate-400">No brands match</div>
)}
```

to:

```tsx
{visible.length === 0 && !showAddOption && (
  <div className="px-3 py-4 text-center text-xs text-slate-400">No brands match</div>
)}
```

- [ ] **Step 5: Verify with `npm run build`**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Manual verification against the dev server**

Run: `npm run dev`

In the browser, open Add Review Account on a tab with several known brands (e.g. Rooster Partners):
1. Click the Brand Name field, type a name that doesn't exist (e.g. `Zzz Test Brand`). Expected: a single `+ Add "Zzz Test Brand"` row appears above the (empty) brand list, no "No brands match" text.
2. Click that row. Expected: dropdown closes, Brand Name shows `Zzz Test Brand`, Brand Link stays editable/blank.
3. Reopen the field, type the exact name of an existing brand but in different case (e.g. lowercase). Expected: no `+ Add` row — the existing brand appears in the list instead.
4. Reopen the field, type a partial match of an existing brand (e.g. first few letters). Expected: both the `+ Add "<text>"` row and the matching existing brand(s) appear together.
5. Clear the search box. Expected: `+ Add` row disappears, full brand list returns, no console errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/BrandSelectDropdown.tsx
git commit -m "feat: let BrandSelectDropdown create a new brand from typed text"
```

---

### Task 2: Always show the brand dropdown in Add Review Account

**Files:**
- Modify: `src/components/AddReviewAccountModal.tsx:270`

**Interfaces:**
- Consumes: `BrandSelectDropdown` from Task 1 (same props as before: `value`, `onChange`, `brands`).
- Produces: no external interface change — this task only changes which branch of `renderField` runs for the brand field.

- [ ] **Step 1: Remove the `availableBrands.length > 0` gate**

In `renderField` (`src/components/AddReviewAccountModal.tsx`), change line 270 from:

```tsx
{f.isBrand && availableBrands.length > 0 ? (
```

to:

```tsx
{f.isBrand ? (
```

- [ ] **Step 2: Verify with `npm run build`**

Run: `npm run build`
Expected: exits 0, no TypeScript errors. (`availableBrands` remains referenced by `BrandSelectDropdown`'s `brands` prop a few lines below, so no unused-variable warning.)

- [ ] **Step 3: Manual verification against the dev server**

Run: `npm run dev` (skip if still running from Task 1)

In the browser:
1. Open Add Review Account from a tab with existing brands (e.g. Rooster Partners) — confirm Brand Name still shows the dropdown with existing brands, unchanged from before this task (regression check).
2. Inside the modal, change **Tab / Category** to a single-brand tab with few/no known brands (e.g. `HazEmirates UAE` or `Trybet`). Expected: Brand Name still renders as the searchable dropdown (not a bare text box), showing that tab's default brand as a suggestion where one exists.
3. Type a brand-new name in that switched-tab context and select the `+ Add` row. Expected: Brand Name is set to the typed text, Brand Link is blank and freely editable.
4. Fill in the required account fields and click **Add Account**. Expected: save succeeds, no console/network errors, and the new entry appears in that tab's list with the typed brand name.

- [ ] **Step 4: Commit**

```bash
git add src/components/AddReviewAccountModal.tsx
git commit -m "fix: always show brand dropdown in Add Review Account, even with no known brands"
```
