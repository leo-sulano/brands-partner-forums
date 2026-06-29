# All Columns Editable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every column in the BrandGroup table inline-editable (except Account Name, which already opens a modal).

**Architecture:** All changes are confined to `src/pages/BrandGroup.tsx`. The gate keeping columns read-only is the `INLINE_EDIT_COLS` Set at lines 289–309 and the `if (INLINE_EDIT_COLS.has(h) && isApproved)` check at line 1783. Removing both opens inline editing to all columns automatically — the type-detection helpers (`isStatusCol`, `isDateCol`, `isLinkCol`) already handle any column. Link columns get a small extra affordance: an open-in-tab icon shown alongside the text input in edit mode.

**Tech Stack:** React 19 · TypeScript · Tailwind v4 · Supabase (`updateEntryData` in `lib/queries.ts`)

## Global Constraints

- Verify with `npm run build` (not `tsc --noEmit`) — root tsconfig is references-only and reports nothing.
- No changes to `lib/queries.ts`, `lib/supabase.ts`, schema, or any other file.
- Dashboard-only columns (`AG User`, `CG User`) must not be pushed to the Sheet — already handled by `DASHBOARD_ONLY_COLS` in `queries.ts`, no action needed.
- Account Name column must continue to open `EditEntryModal`, not become inline-editable.
- `Brand / TP URL PAGE` and `URL PAGE` columns must keep their named-link display (early-return blocks above the editable section); they are not made inline-editable.

---

### Task 1: Remove INLINE_EDIT_COLS whitelist and open all columns to inline editing

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**What this task does:**
1. Delete `INLINE_EDIT_COLS` and `INLINE_TEXT_COLS` sets.
2. Change the single guard condition that gates inline editing from `INLINE_EDIT_COLS.has(h) && isApproved` to just `isApproved`.
3. Update the placeholder inside the text input to use `isDateCol`/`isLinkCol` instead of the deleted `INLINE_TEXT_COLS`.
4. In edit mode, wrap the text input for link columns in a flex row with an open-tab icon button.
5. Build and smoke-test.

- [ ] **Step 1: Delete `INLINE_EDIT_COLS` and `INLINE_TEXT_COLS`**

In `src/pages/BrandGroup.tsx`, find and delete these two constants (currently lines 288–307):

```tsx
// DELETE all of this block:
// Columns that support inline editing directly in the table cell.
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
const INLINE_TEXT_COLS = new Set(['AG User', 'CG User', 'Link to the profile', 'Wizard of OddsScore added']);
```

- [ ] **Step 2: Change the inline-edit guard condition**

Find this line (around line 1783 after Step 1 shifts line numbers slightly):

```tsx
if (INLINE_EDIT_COLS.has(h) && isApproved) {
```

Replace with:

```tsx
if (isApproved) {
```

No other change to this block.

- [ ] **Step 3: Update the text input placeholder**

Inside the text-input branch (the `else` branch of `isStat ? <select> : <input>`), find:

```tsx
placeholder={INLINE_TEXT_COLS.has(h) ? 'Enter username…' : 'DD/MM/YYYY'}
```

Replace with:

```tsx
placeholder={isDateCol(h) ? 'DD/MM/YYYY' : isLinkCol(h) ? 'https://…' : ''}
```

- [ ] **Step 4: Add open-tab icon for link columns in edit mode**

The text input is currently returned as a bare `<input>` element. Replace just the non-status branch with a conditional that wraps link columns:

Find the non-status branch of the `isStat` ternary. It currently looks like:

```tsx
) : (
  <input
    autoFocus
    type="text"
    disabled={savingCell}
    value={editingCell.value}
    onChange={(e) => setEditingCell((c) => c ? { ...c, value: e.target.value } : c)}
    onBlur={() => saveInlineEdit(entry, h, editingCell.value)}
    onKeyDown={(e) => {
      if (e.key === 'Enter') { e.currentTarget.blur(); }
      if (e.key === 'Escape') setEditingCell(null);
    }}
    placeholder={isDateCol(h) ? 'DD/MM/YYYY' : isLinkCol(h) ? 'https://…' : ''}
    className="w-full rounded border border-violet-400 px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
  />
)}
```

Replace it with:

```tsx
) : isLinkCol(h) ? (
  <div className="flex items-center gap-1">
    <input
      autoFocus
      type="text"
      disabled={savingCell}
      value={editingCell.value}
      onChange={(e) => setEditingCell((c) => c ? { ...c, value: e.target.value } : c)}
      onBlur={() => saveInlineEdit(entry, h, editingCell.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur(); }
        if (e.key === 'Escape') setEditingCell(null);
      }}
      placeholder="https://…"
      className="w-full rounded border border-violet-400 px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
    />
    {editingCell.value && (
      <a
        href={editingCell.value.startsWith('http') ? editingCell.value : `https://${editingCell.value}`}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 text-blue-500 hover:text-blue-700"
        title="Open link"
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink className="size-4" />
      </a>
    )}
  </div>
) : (
  <input
    autoFocus
    type="text"
    disabled={savingCell}
    value={editingCell.value}
    onChange={(e) => setEditingCell((c) => c ? { ...c, value: e.target.value } : c)}
    onBlur={() => saveInlineEdit(entry, h, editingCell.value)}
    onKeyDown={(e) => {
      if (e.key === 'Enter') { e.currentTarget.blur(); }
      if (e.key === 'Escape') setEditingCell(null);
    }}
    placeholder={isDateCol(h) ? 'DD/MM/YYYY' : ''}
    className="w-full rounded border border-violet-400 px-2 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
  />
)}
```

`ExternalLink` is already imported at the top of the file.

- [ ] **Step 5: Verify the build passes**

```bash
npm run build
```

Expected: no TypeScript errors, build succeeds. If there are errors about `INLINE_EDIT_COLS` or `INLINE_TEXT_COLS` still being referenced somewhere, search for them and remove the references.

```bash
# Search for any remaining references to the deleted sets:
grep -n "INLINE_EDIT_COLS\|INLINE_TEXT_COLS" src/pages/BrandGroup.tsx
```

Expected: no output (zero matches).

- [ ] **Step 6: Manual smoke-test in the browser**

Start the dev server:
```bash
npm run dev
```

Open the app and navigate to any brand group tab. Verify:

| Scenario | Expected |
|---|---|
| Click a previously read-only text cell (e.g. "Account Number") | Cell enters edit mode with a text input |
| Type a value and press Enter | Cell saves, value shows in the table |
| Click a status column (e.g. "TP Review Status") | Dropdown appears with the preset options |
| Click a link column (e.g. "AG Review Link") | Text input + `↗` icon appear; icon opens current URL in new tab |
| Press Escape in any editable cell | Cell reverts to original value, no save |
| Click "Account Name" cell | Full `EditEntryModal` opens (unchanged) |
| Click "Brand / TP URL PAGE" cell | No edit mode — stays as a named link (unchanged) |
| Non-approved / guest session | No cells become editable |

- [ ] **Step 7: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: make all columns inline-editable in BrandGroup table"
```
