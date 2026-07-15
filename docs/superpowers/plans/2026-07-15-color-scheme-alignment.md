# Color Scheme Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the dashboard's `violet-*` interactive-accent color for `blue-*` (and the sidebar's dark background from `slate-900` to `indigo-950`) to match the Ranking Reports reference screenshot, without touching layout, component structure, or the Casino Guru/avatar colors that intentionally stay violet.

**Architecture:** This is a mechanical, codebase-wide find-and-replace across 23 files (190 `violet-*` occurrences) plus 5 CSS custom property values in `src/index.css`. A blanket `sed` replace of `violet-` → `blue-` is run first, then 5 specific lines (Casino Guru's platform badge/dot colors and one decorative avatar color) are reverted back to violet since they're categorical/semantic colors, not accent chrome.

**Tech Stack:** Vite · React 19 · TypeScript · Tailwind v4 (utility classes only, no config file — theme tokens live in `src/index.css`'s `@theme` block)

## Global Constraints

- Palette-only change — no layout, component structure, or copy changes (per spec).
- Casino Guru's platform badge/dot stays violet in exactly these 5 spots (do not rename): `src/components/Topbar.tsx` line with `cg: 'bg-violet-100 text-violet-700 border border-violet-200'`; `src/pages/Overview.tsx` line with `cg: { label: 'CG', cls: 'bg-violet-50 text-violet-600 border border-violet-200', ...}`; `src/pages/BrandGroup.tsx` both `{ ..., label: 'Casino Guru', dot: 'bg-violet-500' }` lines (there are two, at different line numbers for two separate dropdown components).
- Topbar's `AVATAR_COLORS` array keeps `'bg-violet-500'` as its first entry (decorative, not accent chrome) — do not rename.
- Sidebar's `border-slate-800` header/footer borders are unchanged — only `bg-slate-900` (the panel background) becomes `bg-indigo-950`.
- Verification is `npm run build` (this project's `tsc --noEmit` alone does not catch everything — always use the full build).
- No deploy in this pass — local (`npm run dev`) only.

---

### Task 1: Update `--color-brand-*` tokens in `src/index.css`

**Files:**
- Modify: `src/index.css:3-9`

**Interfaces:**
- Produces: `--color-brand-50/100/500/600/700` CSS custom properties, consumed via Tailwind's `bg-brand-*` / `text-brand-*` / `border-brand-*` / `focus:ring-brand-*` utility classes in `AssistantWidget.tsx`, `AskAI.tsx`, `MentionDetail.tsx`, `StatusBadge.tsx`, `MentionsTable.tsx`, `TopList.tsx`. No consumer needs code changes — only the token values change.

- [ ] **Step 1: Edit the `@theme` block**

Current content at `src/index.css:3-9`:
```css
@theme {
  --color-brand-50: #eef2ff;
  --color-brand-100: #e0e7ff;
  --color-brand-500: #6366f1;
  --color-brand-600: #4f46e5;
  --color-brand-700: #4338ca;
}
```

Replace with:
```css
@theme {
  --color-brand-50: #eff6ff;
  --color-brand-100: #dbeafe;
  --color-brand-500: #3b82f6;
  --color-brand-600: #2563eb;
  --color-brand-700: #1d4ed8;
}
```

- [ ] **Step 2: Visually confirm no build-time CSS error**

Run: `npm run build`
Expected: build succeeds (exit code 0), no CSS/theme errors in output.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "style: update --color-brand tokens from indigo to blue"
```

---

### Task 2: Sidebar dark background — `slate-900` → `indigo-950`

**Files:**
- Modify: `src/components/Sidebar.tsx:224,233,252`

**Interfaces:**
- No exported interface changes — visual only.

- [ ] **Step 1: Replace all 3 occurrences of `bg-slate-900` with `bg-indigo-950`**

At `src/components/Sidebar.tsx:224`:
```tsx
          className={`flex flex-col h-screen bg-slate-900 text-slate-100 transition-[width] duration-200 ease-in-out overflow-hidden ${collapsed ? 'w-16' : 'w-60'}`}
```
becomes:
```tsx
          className={`flex flex-col h-screen bg-indigo-950 text-slate-100 transition-[width] duration-200 ease-in-out overflow-hidden ${collapsed ? 'w-16' : 'w-60'}`}
```

At `src/components/Sidebar.tsx:233`:
```tsx
            className={`fixed inset-y-0 left-0 z-[45] w-60 flex flex-col bg-slate-900 text-slate-100 shadow-xl transition-opacity duration-200 ease-in-out ${
```
becomes:
```tsx
            className={`fixed inset-y-0 left-0 z-[45] w-60 flex flex-col bg-indigo-950 text-slate-100 shadow-xl transition-opacity duration-200 ease-in-out ${
```

At `src/components/Sidebar.tsx:252`:
```tsx
          <aside className="relative z-50 flex flex-col w-72 bg-slate-900 text-slate-100 h-full shadow-xl">
```
becomes:
```tsx
          <aside className="relative z-50 flex flex-col w-72 bg-indigo-950 text-slate-100 h-full shadow-xl">
```

- [ ] **Step 2: Verify no `bg-slate-900` remains in the file**

Run: `grep -n "bg-slate-900" src/components/Sidebar.tsx`
Expected: no output (no matches).

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "style: sidebar background from slate-900 to indigo-950"
```

---

### Task 3: Bulk rename `violet-*` → `blue-*` accent classes (with Casino Guru / avatar exceptions)

**Files:**
- Modify (blanket replace, all 23): `src/pages/ActivityLog.tsx`, `src/pages/AdminUsers.tsx`, `src/components/EditEntryModal.tsx`, `src/pages/HowItWorks.tsx`, `src/pages/MentionDetail.tsx`, `src/components/DatePicker.tsx`, `src/pages/Login.tsx`, `src/components/BrandTabsModal.tsx`, `src/pages/BrandGroup.tsx`, `src/components/AddReviewAccountModal.tsx`, `src/components/TotalBreakdownModal.tsx`, `src/components/AssistantWidget.tsx`, `src/pages/Signup.tsx`, `src/components/SelectDropdown.tsx`, `src/components/Topbar.tsx`, `src/pages/AskAI.tsx`, `src/components/ScoreSummaryPanel.tsx`, `src/pages/Overview.tsx`, `src/components/BrandSelectDropdown.tsx`, `src/pages/ResetPassword.tsx`, `src/components/ProtectedRoute.tsx`, `src/components/Sidebar.tsx`, `src/components/MentionsTable.tsx`
- Then revert (5 exception lines): `src/components/Topbar.tsx`, `src/pages/Overview.tsx`, `src/pages/BrandGroup.tsx` (×2)

**Interfaces:**
- No exported interface changes — visual only.

- [ ] **Step 1: Run the blanket replace**

```bash
sed -i 's/violet-/blue-/g' \
  "src/pages/ActivityLog.tsx" \
  "src/pages/AdminUsers.tsx" \
  "src/components/EditEntryModal.tsx" \
  "src/pages/HowItWorks.tsx" \
  "src/pages/MentionDetail.tsx" \
  "src/components/DatePicker.tsx" \
  "src/pages/Login.tsx" \
  "src/components/BrandTabsModal.tsx" \
  "src/pages/BrandGroup.tsx" \
  "src/components/AddReviewAccountModal.tsx" \
  "src/components/TotalBreakdownModal.tsx" \
  "src/components/AssistantWidget.tsx" \
  "src/pages/Signup.tsx" \
  "src/components/SelectDropdown.tsx" \
  "src/components/Topbar.tsx" \
  "src/pages/AskAI.tsx" \
  "src/components/ScoreSummaryPanel.tsx" \
  "src/pages/Overview.tsx" \
  "src/components/BrandSelectDropdown.tsx" \
  "src/pages/ResetPassword.tsx" \
  "src/components/ProtectedRoute.tsx" \
  "src/components/Sidebar.tsx" \
  "src/components/MentionsTable.tsx"
```

Expected: command exits 0, no output.

- [ ] **Step 2: Verify no `violet-` remains anywhere**

Run: `grep -rn "violet-" src/`
Expected: no matches (0 results). This confirms Step 1 ran across every file that had `violet-`.

- [ ] **Step 3: Revert the Casino Guru platform badge in `Topbar.tsx`**

Find (now reads, after Step 1's replace):
```tsx
  cg: 'bg-blue-100 text-blue-700 border border-blue-200',
```
in the `PLATFORM_BADGE_CLS` object (originally `src/components/Topbar.tsx:20`). Change back to:
```tsx
  cg: 'bg-violet-100 text-violet-700 border border-violet-200',
```

- [ ] **Step 4: Revert the avatar color in `Topbar.tsx`**

Find (now reads, after Step 1's replace) inside the `AVATAR_COLORS` array (originally `src/components/Topbar.tsx:25`):
```tsx
const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-indigo-500',
];
```
Change the first entry back to:
```tsx
const AVATAR_COLORS = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-indigo-500',
];
```

- [ ] **Step 5: Revert the Casino Guru platform badge in `Overview.tsx`**

Find (now reads, after Step 1's replace), in the `PLATFORM_BADGE` object (originally `src/pages/Overview.tsx:61`):
```tsx
  cg: { label: 'CG', cls: 'bg-blue-50 text-blue-600 border border-blue-200', icon: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=16' },
```
Change back to:
```tsx
  cg: { label: 'CG', cls: 'bg-violet-50 text-violet-600 border border-violet-200', icon: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=16' },
```

- [ ] **Step 6: Revert both Casino Guru dropdown-option dots in `BrandGroup.tsx`**

`BrandGroup.tsx` has two separate platform-filter dropdown option lists, each with a `cg` entry (originally at `src/pages/BrandGroup.tsx:335` and `:444`). Find both occurrences (now reading, after Step 1's replace):
```tsx
  { value: 'cg',  label: 'Casino Guru',  dot: 'bg-blue-500' },
```
and
```tsx
  { key: 'cg' as const, label: 'Casino Guru', dot: 'bg-blue-500' },
```
Change both back to:
```tsx
  { value: 'cg',  label: 'Casino Guru',  dot: 'bg-violet-500' },
```
and
```tsx
  { key: 'cg' as const, label: 'Casino Guru', dot: 'bg-violet-500' },
```

- [ ] **Step 7: Verify exactly 5 `violet-` occurrences remain, in the expected files**

Run: `grep -rn "violet-" src/ | wc -l`
Expected: `5`

Run: `grep -rln "violet-" src/`
Expected: exactly three files listed — `src/components/Topbar.tsx` (2 matches: CG badge + avatar color), `src/pages/Overview.tsx` (1 match: CG badge), `src/pages/BrandGroup.tsx` (2 matches: both CG dropdown dots).

- [ ] **Step 8: Run the build**

Run: `npm run build`
Expected: build succeeds (exit code 0), no TypeScript or CSS errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "style: swap violet accent to blue, keep CG badge and avatar color violet"
```

---

### Task 4: Local visual verification

**Files:** none (manual verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Vite starts, prints a local URL (e.g. `http://localhost:5173`).

- [ ] **Step 2: Visually check the following in a browser**

- Sidebar: background is now deep navy (indigo-950) instead of slate-900; active/hover nav items and the "Partner" wordmark accent are blue instead of violet.
- Overview page (`/`): KPI card icon circles, hover states on the tab-summary cards, and the "Navigate"-style hover backgrounds are blue.
- A brand tab page (e.g. `/brands/rooster-partners`): dropdown active/hover states, focus rings on inputs, and button colors are blue. Confirm the Casino Guru filter option's dot is still **violet** (not blue) — this is the intentional exception.
- Confirm the Casino Guru platform badge (small "CG" pill shown next to brand tab titles, e.g. on a tab using CG) is still **violet**, distinct from Trustpilot's blue badge.
- Open a modal (e.g. "Add Review Account"): confirm input focus rings and the submit button are blue.
- Confirm no visual regressions (no layout shifts, no missing colors, no broken hover states) compared to before the change.

- [ ] **Step 3: Report back**

No code changes in this step — confirm to the user that the local visual check passed, or note any discrepancy found.

---

## Self-Review Notes

- Spec coverage: sidebar bg (Task 2), primary accent violet→blue (Task 3), `--color-brand-*` tokens (Task 1), CG badge/avatar exceptions preserved (Task 3 steps 3-6), build verification (Tasks 1 & 3), visual verification (Task 4). All spec sections covered.
- No placeholders: every step has literal before/after code or an exact command with expected output.
- Type consistency: no new functions/types introduced — this is a class-name-only change, so there's no signature drift risk.
