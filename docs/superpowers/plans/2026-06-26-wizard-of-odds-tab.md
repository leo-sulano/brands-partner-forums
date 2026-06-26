# Wizard of Odds Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Wizard of Odds" as a new brand-group tab that appears in the sidebar, reads data from the matching Google Sheet tab, and supports inline editing of the WO date, status, and score columns.

**Architecture:** Three source files change: `tabs.ts` registers the tab name, `tab-configs.ts` defines its column whitelist and label shortcuts, and `BrandGroup.tsx` learns the three WO-specific column names so date-picking, status dropdowns, and score editing all work. No changes to the Edge Function or database are needed — `import-tabs` already handles any tab present in the sheet.

**Tech Stack:** TypeScript · React 19 · Tailwind v4 · Lucide React icons

## Global Constraints

- Column names in `TAB_COLUMN_CONFIGS` must match the exact Google Sheet header strings (case-sensitive).
- Always verify with `npm run build` (not `tsc --noEmit` — the root tsconfig is references-only and checks nothing).
- Tab name string must be identical everywhere it appears: `OPERATIONAL_TABS`, `TAB_COLUMN_CONFIGS`, `TAB_COLUMN_LABELS`, `TAB_ICONS`.

---

### Task 1: Register the tab and add a sidebar icon

**Files:**
- Modify: `src/lib/tabs.ts`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Produces: `'Wizard of Odds'` as a valid `OperationalTab`, routed at `/brands/wizard-of-odds`. Sidebar renders it with a `Star` icon and no platform favicons (single-platform tab with no TP/AG/CG columns yet).

- [ ] **Step 1: Add the tab to OPERATIONAL_TABS**

In `src/lib/tabs.ts`, add `'Wizard of Odds'` as the last entry:

```ts
export const OPERATIONAL_TABS = [
  'TP Brand Injection',
  'TP Affiliate',
  'Rooster Partners',
  'Revolution Casino',
  'Trybet',
  'SilverPlay',
  'SuprPlay Limited',
  'HazEmirates UAE',
  'Hanan',
  'Wizard of Odds',
] as const;
```

- [ ] **Step 2: Add the Star icon to Sidebar**

In `src/components/Sidebar.tsx`, add `Star` to the lucide-react import:

```ts
import {
  LayoutDashboard, RefreshCw, MessagesSquare, ScrollText,
  Syringe, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart,
  Link2, Users, ChevronDown, BarChart3, Bot, X, Star,
  type LucideIcon,
} from 'lucide-react';
```

Then add the entry to `TAB_ICONS`:

```ts
const TAB_ICONS: Record<string, LucideIcon> = {
  'TP Brand Injection': Syringe,
  'TP Affiliate':       Link2,
  'Rooster Partners':   Handshake,
  'Revolution Casino':  RotateCcw,
  'Trybet':             Dices,
  'SilverPlay':         Medal,
  'SuprPlay Limited':   Gamepad2,
  'HazEmirates UAE':    Plane,
  'Hanan':              Heart,
  'Wizard of Odds':     Star,
};
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

Expected: no TypeScript or Vite errors. The sidebar now shows "Wizard of Odds" with a star icon; the page loads (empty table until a sync runs).

- [ ] **Step 4: Commit**

```bash
git add src/lib/tabs.ts src/components/Sidebar.tsx
git commit -m "feat: register Wizard of Odds tab with Star sidebar icon"
```

---

### Task 2: Column whitelist and label shortcuts

**Files:**
- Modify: `src/lib/tab-configs.ts`

**Interfaces:**
- Consumes: `'Wizard of Odds'` tab name from Task 1.
- Produces: `getTabColumns('Wizard of Odds')` returns the 8-column whitelist in order. `getColLabel('Wizard of OddsScore added', 'Wizard of Odds')` returns `'WO Score'`. `getColLabel('WoO Review Status', 'Wizard of Odds')` returns `'WO Status'`. `getColLabel('Wizard of Odds', 'Wizard of Odds')` returns `'WO Date'`.

- [ ] **Step 1: Add the column whitelist**

In `src/lib/tab-configs.ts`, add `'Wizard of Odds'` to `TAB_COLUMN_CONFIGS` under the `// 1-platform tabs` comment:

```ts
  'Wizard of Odds': [
    'Agent',
    'Account',
    'Proxy Used',
    'Brand Name',
    'Wizard of Odds',
    'WoO Review Status',
    'Wizard of OddsScore added',
    'Link to the profile',
  ],
```

- [ ] **Step 2: Add tab-specific label overrides**

In `src/lib/tab-configs.ts`, add `'Wizard of Odds'` to `TAB_COLUMN_LABELS`:

```ts
const TAB_COLUMN_LABELS: Record<string, Record<string, string>> = {
  'TP Affiliate': {
    'URL PAGE': 'URL Page',
  },
  'Wizard of Odds': {
    'Wizard of Odds':           'WO Date',
    'WoO Review Status':        'WO Status',
    'Wizard of OddsScore added':'WO Score',
    'Link to the profile':      'Link',
  },
};
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

Expected: no errors. Navigate to `/brands/wizard-of-odds` in the app — the table headers should read Agent, Account, Proxy Used, Brand Name, WO Date, WO Status, WO Score, Link (once data is synced; before a sync the table is empty but columns are visible).

- [ ] **Step 4: Commit**

```bash
git add src/lib/tab-configs.ts
git commit -m "feat: add Wizard of Odds column whitelist and WO Score/Status/Date labels"
```

---

### Task 3: Wire inline editing for WO date, status, and score

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: column names `'Wizard of Odds'`, `'WoO Review Status'`, `'Wizard of OddsScore added'` from the whitelist defined in Task 2.
- Produces:
  - `'Wizard of Odds'` column renders with a date picker on click (same as Trust Pilot / Ask Gambler review added).
  - `'WoO Review Status'` column renders a `<StatusPill>` and opens a dropdown on click with options: Removed / Not Published / Still Published.
  - `'Wizard of OddsScore added'` column renders as a plain text/number input on click.
  - `'Still Published'` displays as a green pill (same as Live/Published).
  - `'Not Published'` displays as an amber pill (same as Pending).
  - Duplicating a WO row clears the three WO review fields.

- [ ] **Step 1: Add 'Wizard of Odds' to ENTRY_DATE_COLS**

`ENTRY_DATE_COLS` is the list at line ~141. Add the WO date column:

```ts
const ENTRY_DATE_COLS = [
  'Trust Pilot',
  'Ask Gambler review added',
  'Casino Guru review added',
  'Removed / Not Published / stil published date',
  'Wizard of Odds',
  'Date', 'date', 'Posted At', 'posted_at',
];
```

This makes `isDateCol('Wizard of Odds')` return `true`, which enables the date picker in inline editing and the "No Review" pill when the value is empty.

- [ ] **Step 2: Add WO columns to INLINE_EDIT_COLS and INLINE_TEXT_COLS**

`INLINE_EDIT_COLS` is at line ~283. Add the three WO columns:

```ts
const INLINE_EDIT_COLS = new Set([
  'Trust Pilot',
  'Ask Gambler review added',
  'Casino Guru review added',
  'TP Review Status',
  'Trust Pilot Review Status',
  'Trustpilot Review Status',
  'Trust pilot Review Status',
  'Review Status',
  'AG Review Status',
  'CG Review Status',
  'AG User',
  'CG User',
  'Link to the profile',
  'Wizard of Odds',
  'WoO Review Status',
  'Wizard of OddsScore added',
]);
```

`INLINE_TEXT_COLS` is at line ~298. Add the score column so it renders as a free-text input (not a date picker or status dropdown):

```ts
const INLINE_TEXT_COLS = new Set(['AG User', 'CG User', 'Link to the profile', 'Wizard of OddsScore added']);
```

- [ ] **Step 3: Add WO status options and 'Still Published' to INLINE_STATUS_OPTIONS**

`INLINE_STATUS_OPTIONS` is at line ~299. Add `'Still Published'` to the list:

```ts
const INLINE_STATUS_OPTIONS = ['Live', 'Done', 'Published', 'Still Published', 'Pending', 'On Pause', 'Not done', 'Refused', 'Removed', 'Not Published'];
```

- [ ] **Step 4: Add WO fields to CLEARED_FIELDS**

`CLEARED_FIELDS` is at line ~301. Add the WO review fields so they are nulled out when duplicating a row:

```ts
const CLEARED_FIELDS = new Set([
  'Trust Pilot',
  'TP Review Status',
  'Trust Pilot Review Status',
  'Trustpilot Review Status',
  'Trust pilot Review Status',
  'Review Status',
  'Ask Gambler review added',
  'AG Review Status',
  'Casino Guru review added',
  'CG Review Status',
  'Wizard of Odds',
  'WoO Review Status',
  'Wizard of OddsScore added',
]);
```

- [ ] **Step 5: Update StatusPill to colour 'Not Published' as amber**

`StatusPill` at line ~47. The existing amber branch only matches the string `'pending'`. Extend it to also match `'not published'`:

Find this block:
```ts
  if (v === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        <Circle className="size-3" /> {value}
      </span>
    );
  }
```

Replace with:
```ts
  if (v === 'pending' || v === 'not published') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        <Circle className="size-3" /> {value}
      </span>
    );
  }
```

Note: 'Still Published' already renders green — the existing check `v.includes('publish') && !v.includes('not pub')` matches it correctly.

- [ ] **Step 6: Verify build passes**

```bash
npm run build
```

Expected: no errors. On the Wizard of Odds tab:
- The "WO Date" column shows a date picker on click.
- The "WO Status" column shows a dropdown with Removed / Not Published / Still Published (plus the other global options).
- The "WO Score" column opens a text input on click.
- 'Still Published' renders as a green pill; 'Not Published' as amber; 'Removed' as red.

- [ ] **Step 7: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: wire inline editing for Wizard of Odds date, status, and score columns"
```
