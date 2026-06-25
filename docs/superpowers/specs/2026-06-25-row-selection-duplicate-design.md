# Row Selection & Duplicate — Design Spec

**Date:** 2026-06-25
**Status:** Approved

## Overview

Add per-row checkboxes to all brand tabs so users can select one or more entries and duplicate them. Duplicates copy identity fields and leave review progress fields blank.

---

## 1. Selection State

- `selectedIds: Set<string>` added to `BrandGroup.tsx` component state.
- Resets to empty `Set` on tab change and on page navigation.
- Only available on authenticated (approved) views — same guard as inline editing.

---

## 2. Checkbox Column

- New column prepended before **Account** in the table header and every data row.
- Width: `w-8` (32px), non-sortable, not part of `visibleHeaders` whitelist logic.
- **Header cell:** "select all on current page" checkbox.
  - Checked: all `pageRows` are in `selectedIds`.
  - Indeterminate: some (but not all) `pageRows` are in `selectedIds`.
  - Clicking toggles between select-all and deselect-all for the current page only.
- **Row cell:** checkbox that toggles the entry's `id` in/out of `selectedIds`.
- Row click (opens Account modal) is unaffected — only the checkbox cell triggers selection.

---

## 3. Action Bar

- Rendered in place of the search/filter bar when `selectedIds.size > 0`.
- Contents: `"✓ {n} selected"` · **Duplicate** button (violet, primary style) · **Clear selection** (ghost text button).
- The search box, brand filter, proxy filter, status filter, and Check Status button are hidden while the action bar is active; they reappear when selection is cleared.

---

## 4. Confirmation Modal

Triggered by clicking **Duplicate** in the action bar.

```
Duplicate {n} rows?
This will create {n} new entries copying account details.
Review dates and statuses will be blank.

[Cancel]   [Duplicate]
```

- **Cancel:** closes modal, selection remains.
- **Duplicate:** proceeds with duplication, closes modal.

---

## 5. Duplication Logic

For each selected entry, call `insertEntry(tab, fields)` where `fields` is derived from `entry.data` with the following rules:

**Copied (kept as-is):**
- Account
- Proxy Used
- Account Name
- Agent
- Brands / Brand Name / Brand / Brand / TP URL PAGE / URL PAGE
- Any other column not in the cleared list below

**Cleared (set to `null`):**

| Category | Columns |
|----------|---------|
| TP date | `Trust Pilot` |
| TP status | `TP Review Status`, `Trust Pilot Review Status`, `Trustpilot Review Status`, `Trust pilot Review Status`, `Review Status` |
| AG date | `Ask Gambler review added` |
| AG status | `AG Review Status` |
| AG link | `AG Review Link` |
| CG date | `Casino Guru review added` |
| CG status | `CG Review Status` |
| CG link | `CG Review Link` |

Inserts are fired sequentially (not in parallel) to avoid rate-limiting the Supabase + Google Sheet pipeline.

---

## 6. Post-Duplication

- **Success:** table reloads via `reloadRef.current()`, `selectedIds` clears, toast: `"{n} rows duplicated"`.
- **Partial failure:** if any insert throws, stop, reload table, show error toast: `"Duplicated {k} of {n} rows — an error occurred"`.
- A loading spinner replaces the Duplicate button text during the operation; the Cancel button is disabled while in-flight.

---

## 7. Scope

- Applies to all brand tabs (the feature is inside `BrandGroup.tsx` which handles all brand routes).
- No changes to `queries.ts` — `insertEntry` is used as-is.
- No new files — all changes are in `BrandGroup.tsx`.
- No changes to the Google Sheet sync logic — `insertEntry` already handles the push.
