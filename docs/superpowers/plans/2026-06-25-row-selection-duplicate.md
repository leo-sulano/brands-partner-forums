# Row Selection & Duplicate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-row checkboxes to all brand tabs so users can select entries and duplicate them with identity fields copied and review fields cleared.

**Architecture:** All changes are self-contained in `src/pages/BrandGroup.tsx`. A `selectedIds: Set<string>` state drives checkbox rendering, the action bar, and the confirmation modal. Duplication calls the existing `insertEntry` function sequentially for each selected row.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Supabase via `insertEntry` in `src/lib/queries.ts`

## Global Constraints

- All changes in `src/pages/BrandGroup.tsx` only — no new files, no changes to `queries.ts`
- `insertEntry(tab: string, fields: Record<string, string | null>): Promise<void>` is used as-is
- Checkboxes and Duplicate action only visible to `isApproved` users (same guard as inline editing)
- Sequential inserts — no `Promise.all` — to avoid rate-limiting the Supabase + Sheet pipeline
- `npm run build` must pass after every task (project has no test runner; build is the verification gate)

---

### Task 1: Selection state, reset logic, and insertEntry import

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Produces: `selectedIds: Set<string>`, `setSelectedIds`, `showDuplicateModal: boolean`, `setShowDuplicateModal`, `duplicating: boolean`, `setDuplicating` — consumed by Tasks 2, 3, 4

- [ ] **Step 1: Add `insertEntry` to the queries import**

Find line 13 (the import from `../lib/queries`). Add `insertEntry` to it:

```tsx
import { fetchRawEntriesByTab, fetchTabHeaders, updateEntryData, triggerStatusCheck, insertEntry } from '../lib/queries';
```

- [ ] **Step 2: Add the three new state declarations**

Find the block of `useState` calls (lines 538–576). Add these three immediately after the `lastChecked` state (after line 576):

```tsx
const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
const [showDuplicateModal, setShowDuplicateModal] = useState(false);
const [duplicating, setDuplicating] = useState(false);
```

- [ ] **Step 3: Reset selectedIds on tab change**

Find the `useEffect` at line 582 that resets `page`, `search`, `brandFilter`, etc. when `decodedTab` changes. Add `setSelectedIds(new Set());` inside it alongside the other resets:

```tsx
useEffect(() => {
  if (!decodedTab) return;
  setPage(1);
  setSearch('');
  setBrandFilter('');
  setStatusFilter('all');
  setPlatformFilter('all');
  setAgentFilter('');
  setProxyFilter('');
  setDateFrom('');
  setDateTo('');
  setSortCol(null);
  setSortDir('desc');
  setJumpInput('');
  setSelectedIds(new Set());   // ← add this line
}, [decodedTab]);
```

- [ ] **Step 4: Reset selectedIds on page navigation**

After the tab-change `useEffect`, add a new `useEffect` that clears selection whenever the page changes:

```tsx
useEffect(() => {
  setSelectedIds(new Set());
}, [page]);
```

- [ ] **Step 5: Verify build passes**

```bash
npm run build
```

Expected: `✓ built in X.XXs` with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: add selection state and insertEntry import for row duplicate"
```

---

### Task 2: Checkbox column in table header and rows

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `selectedIds`, `setSelectedIds`, `pageRows`, `isApproved` (all already in scope)
- Produces: visible checkbox column in `<thead>` and each `<tbody>` row — consumed visually, no new exports

- [ ] **Step 1: Add the select-all checkbox to the table header**

Find the `<thead>` `<tr>` (around line 1254). It contains a `visibleHeaders.map(...)` that renders `<th>` cells. Add a new `<th>` as the **first child** of that `<tr>`, before the map:

```tsx
<tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
  {isApproved && (
    <th className="w-8 px-2 py-2.5">
      <input
        type="checkbox"
        aria-label="Select all on this page"
        checked={pageRows.length > 0 && pageRows.every((e) => selectedIds.has(e.id))}
        ref={(el) => {
          if (el) {
            const someSelected = pageRows.some((e) => selectedIds.has(e.id));
            const allSelected = pageRows.every((e) => selectedIds.has(e.id));
            el.indeterminate = someSelected && !allSelected;
          }
        }}
        onChange={() => {
          const allSelected = pageRows.every((e) => selectedIds.has(e.id));
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (allSelected) {
              pageRows.forEach((e) => next.delete(e.id));
            } else {
              pageRows.forEach((e) => next.add(e.id));
            }
            return next;
          });
        }}
        className="rounded border-slate-300 text-violet-600 focus:ring-violet-400 cursor-pointer"
      />
    </th>
  )}
  {visibleHeaders.map((h) => (
    /* existing <th> cells unchanged */
  ))}
</tr>
```

- [ ] **Step 2: Add the per-row checkbox cell in tbody**

Find `pageRows.map((entry) => (` (around line 1293). Each entry renders a `<tr>` with `visibleHeaders.map((h) => { ... })` generating `<td>` cells. Add a checkbox `<td>` as the **first child** of the entry `<tr>`, before `visibleHeaders.map`:

```tsx
<tr key={entry.id} className="transition-colors">
  {isApproved && (
    <td className="w-8 px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        aria-label="Select row"
        checked={selectedIds.has(entry.id)}
        onChange={() =>
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(entry.id)) {
              next.delete(entry.id);
            } else {
              next.add(entry.id);
            }
            return next;
          })
        }
        className="rounded border-slate-300 text-violet-600 focus:ring-violet-400 cursor-pointer"
      />
    </td>
  )}
  {visibleHeaders.map((h) => {
    /* existing cell rendering unchanged */
  })}
</tr>
```

Note: `onClick={(e) => e.stopPropagation()}` on the `<td>` prevents the row click (which opens the Account modal) from firing when clicking the checkbox cell.

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```

Expected: `✓ built in X.XXs` with no errors.

- [ ] **Step 4: Manual check in dev server**

Start `npm run dev`, open any brand tab. Verify:
- Narrow checkbox column appears before Account
- Header checkbox checks/unchecks all visible rows
- Header checkbox shows indeterminate state when some rows are checked
- Clicking a checkbox cell does not open the Account modal

- [ ] **Step 5: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: add checkbox column to brand table for row selection"
```

---

### Task 3: Selection action bar

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `selectedIds`, `setSelectedIds`, `setShowDuplicateModal`
- Produces: action bar UI — replaces search/filter bar when selection is non-empty

- [ ] **Step 1: Wrap the search/filter bar in a conditional**

Find the outer `<div>` of the search/filter bar (starts around line 1169, ends around line 1248). Wrap it with a ternary: when `selectedIds.size > 0`, render the action bar instead:

```tsx
{selectedIds.size > 0 ? (
  <div className="flex items-center gap-3 px-1 py-2">
    <span className="text-sm font-medium text-violet-700">
      ✓ {selectedIds.size} selected
    </span>
    <button
      onClick={() => setShowDuplicateModal(true)}
      className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
    >
      Duplicate
    </button>
    <button
      onClick={() => setSelectedIds(new Set())}
      className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
    >
      Clear selection
    </button>
  </div>
) : (
  <div className="...">  {/* existing search/filter bar — no changes inside */}
    ...
  </div>
)}
```

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```

Expected: `✓ built in X.XXs` with no errors.

- [ ] **Step 3: Manual check in dev server**

Open any brand tab. Check one or more rows. Verify:
- Search/filter bar disappears and action bar appears with correct count
- "Clear selection" button deselects all and restores the search/filter bar
- "Duplicate" button is present (it will open the modal once Task 4 is done)

- [ ] **Step 4: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: add selection action bar with duplicate and clear buttons"
```

---

### Task 4: Confirmation modal and duplication logic

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `selectedIds`, `setSelectedIds`, `showDuplicateModal`, `setShowDuplicateModal`, `duplicating`, `setDuplicating`, `entries`, `decodedTab`, `reloadRef`, `setToast`, `insertEntry`
- Produces: working end-to-end duplicate flow

- [ ] **Step 1: Add the CLEARED_FIELDS constant**

Add this constant near the top of the file, alongside the other module-level constants (e.g., near `BRAND_COLS` around line 277):

```tsx
const CLEARED_FIELDS = new Set([
  'Trust Pilot',
  'TP Review Status',
  'Trust Pilot Review Status',
  'Trustpilot Review Status',
  'Trust pilot Review Status',
  'Review Status',
  'Ask Gambler review added',
  'AG Review Status',
  'AG Review Link',
  'Casino Guru review added',
  'CG Review Status',
  'CG Review Link',
]);
```

- [ ] **Step 2: Add the `handleDuplicate` function**

Add this function inside the `BrandGroup` component, near the other async handlers (e.g., after `saveInlineEdit`):

```tsx
async function handleDuplicate() {
  const toInsert = entries.filter((e) => selectedIds.has(e.id));
  setDuplicating(true);
  let done = 0;
  try {
    for (const entry of toInsert) {
      const fields: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(entry.data)) {
        fields[k] = CLEARED_FIELDS.has(k) ? null : v;
      }
      await insertEntry(entry.tab, fields);
      done++;
    }
    reloadRef.current();
    setSelectedIds(new Set());
    setToast({ message: `${done} row${done === 1 ? '' : 's'} duplicated`, kind: 'success' });
  } catch {
    reloadRef.current();
    setToast({
      message: `Duplicated ${done} of ${toInsert.length} rows — an error occurred`,
      kind: 'error',
    });
  } finally {
    setDuplicating(false);
    setShowDuplicateModal(false);
  }
}
```

- [ ] **Step 3: Add the confirmation modal JSX**

Find the block of modals near the bottom of the component's return (around lines 1494–1531, where `EditEntryModal`, `AddReviewAccountModal`, and `TotalBreakdownModal` are rendered). Add the duplicate modal after them:

```tsx
{showDuplicateModal && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    onClick={() => { if (!duplicating) setShowDuplicateModal(false); }}
  >
    <div
      className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4"
      onClick={(e) => e.stopPropagation()}
    >
      <h2 className="text-base font-semibold text-slate-900 mb-2">
        Duplicate {selectedIds.size} row{selectedIds.size === 1 ? '' : 's'}?
      </h2>
      <p className="text-sm text-slate-500 mb-6">
        This will create {selectedIds.size} new{' '}
        {selectedIds.size === 1 ? 'entry' : 'entries'} copying account details.
        Review dates and statuses will be blank.
      </p>
      <div className="flex justify-end gap-3">
        <button
          onClick={() => setShowDuplicateModal(false)}
          disabled={duplicating}
          className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleDuplicate}
          disabled={duplicating}
          className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
        >
          {duplicating && <Loader2 className="size-4 animate-spin" />}
          {duplicating ? 'Duplicating…' : 'Duplicate'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Ensure `Loader2` is imported from lucide-react**

Find the lucide-react import line (near the top of the file). Confirm `Loader2` is in it; add it if missing:

```tsx
import { ..., Loader2 } from 'lucide-react';
```

- [ ] **Step 5: Verify build passes**

```bash
npm run build
```

Expected: `✓ built in X.XXs` with no errors.

- [ ] **Step 6: End-to-end manual test**

Open any brand tab in the dev server. Select 2–3 rows. Click Duplicate.

Verify:
- Modal shows correct count ("Duplicate 3 rows?")
- Cancel closes modal, selection stays intact
- Confirm: spinner appears, modal stays open with Cancel disabled
- After success: modal closes, selection clears, toast "3 rows duplicated" appears
- New rows appear in the table with identity fields copied and date/status/link columns empty

- [ ] **Step 7: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: add duplicate confirmation modal and row duplication logic"
```
