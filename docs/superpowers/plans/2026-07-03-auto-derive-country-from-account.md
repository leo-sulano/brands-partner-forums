# Auto-Derive Country From Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Whenever an entry's Account value is set or changed — via Add Review Account, Edit Account, or Duplicate Account — automatically derive Country from the new Account text (or the tab's default) and persist it, so Country stays in sync with Account going forward.

**Architecture:** One new write-time function, `getCountryForAccount(account, tab)`, added to `src/lib/tab-configs.ts`, reusing the existing `deriveCountryFromAccount` parser (Task 94: handles both `" | "` and `" l "` delimiters, strips a trailing `" dup"`). `getEntryCountry` (used for read-time display/sort/filter) is refactored to delegate to it, so there is one derivation rule. Three call sites wire it in: the Account field's `onChange` in `EditEntryModal.tsx` and in `AddReviewAccountModal.tsx`, and the per-entry field-building loop in `BrandGroup.tsx`'s `handleDuplicate`.

**Tech Stack:** Vite 6, React 19, TypeScript (strict), Tailwind v4, Vitest.

## Global Constraints

- TypeScript strict mode; no `any` unless commented why (per project CLAUDE.md).
- Follow existing patterns exactly — this is a small, targeted change to 4 already-reviewed files, not a redesign.
- Verify with `npm run build` (`tsc -b && vite build`), not `tsc --noEmit` alone — the root tsconfig is references-only and `tsc --noEmit` alone checks nothing in this repo.
- Editing the Country field directly (without touching Account) must remain a plain, unaffected manual edit.
- Switching tabs in Add/Edit without touching Account must NOT trigger recomputation — only an actual Account text change does.
- Spec: `docs/superpowers/specs/2026-07-03-auto-derive-country-from-account-design.md`.

---

### Task 1: Add `getCountryForAccount` and refactor `getEntryCountry`

**Files:**
- Modify: `src/lib/tab-configs.ts:231-239` (the `getEntryCountry` function)
- Test: `src/lib/tab-configs.test.ts` (existing file — add new tests, keep existing ones)

**Interfaces:**
- Consumes: the existing private `deriveCountryFromAccount(account: string | null | undefined): string` and `TAB_DEFAULT_COUNTRY: Record<string, string>` (both already defined at `tab-configs.ts:212-229`, unchanged by this task).
- Produces: `export function getCountryForAccount(account: string | null | undefined, tab: string): string` — Tasks 2, 3, and 4 import and call this exact signature.
- `getEntryCountry(data: Record<string, string | null>, tab: string): string` keeps its exact existing signature and observable behavior (only its internal implementation changes) — no consumer of `getEntryCountry` needs to change.

- [ ] **Step 1: Write the failing tests**

Open `src/lib/tab-configs.test.ts`. It currently ends with:

```ts
  it('strips repeated " dup" suffixes from duplicating an already-duplicated row', () => {
    const data = { Account: '1182 | Test | Norway dup dup', Country: null };
    expect(getEntryCountry(data, 'Wizard of Odds')).toBe('Norway');
  });
});
```

Change the import line at the top of the file from:

```ts
import { TAB_COLUMN_CONFIGS, getEntryCountry } from './tab-configs';
```

to:

```ts
import { TAB_COLUMN_CONFIGS, getEntryCountry, getCountryForAccount } from './tab-configs';
```

Then add a new `describe` block after the existing `getEntryCountry` block's closing `});`:

```ts

describe('getCountryForAccount', () => {
  it('derives Country from a pipe-delimited Account', () => {
    expect(getCountryForAccount('1303 | Test | Germany', 'Wizard of Odds')).toBe('Germany');
  });

  it('derives Country from an "l"-delimited Account', () => {
    expect(getCountryForAccount('550 l Hanan l Australia', 'Wizard of Odds')).toBe('Australia');
  });

  it('strips a trailing " dup" suffix before deriving', () => {
    expect(getCountryForAccount('1303 | Test | Germany dup', 'Wizard of Odds')).toBe('Germany');
  });

  it('falls back to the per-tab default when Account has no parseable country', () => {
    expect(getCountryForAccount('001 - UK Reviews', 'SuprPlay Limited')).toBe('UK');
  });

  it('returns empty string when unparseable and there is no tab default', () => {
    expect(getCountryForAccount('001 - UK Reviews', 'Trybet')).toBe('');
  });

  it('returns empty string for a null/empty Account', () => {
    expect(getCountryForAccount(null, 'Wizard of Odds')).toBe('');
    expect(getCountryForAccount('', 'SuprPlay Limited')).toBe('UK');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tab-configs.test.ts`
Expected: FAIL — `getCountryForAccount is not a function` (it doesn't exist yet).

- [ ] **Step 3: Add `getCountryForAccount` and refactor `getEntryCountry`**

In `src/lib/tab-configs.ts`, find:

```ts
// Returns the country to display/sort/filter by for an entry: the real value synced
// from the Sheet, else one derived from Account text, else a per-tab default.
export function getEntryCountry(data: Record<string, string | null>, tab: string): string {
  const raw = data['Country'];
  if (raw && raw.trim()) return raw.trim();
  const derived = deriveCountryFromAccount(data['Account']);
  if (derived) return derived;
  return TAB_DEFAULT_COUNTRY[tab] ?? '';
}
```

Replace with:

```ts
// Returns the country that should be set on an entry given a new/edited Account
// value and its tab: derived from the Account text, else the tab's default.
// Called whenever Account is set or changed (Add, Edit, Duplicate) to keep
// Country in sync with it.
export function getCountryForAccount(account: string | null | undefined, tab: string): string {
  return deriveCountryFromAccount(account) || TAB_DEFAULT_COUNTRY[tab] || '';
}

// Returns the country to display/sort/filter by for an entry: the real value synced
// from the Sheet, else what getCountryForAccount would derive for it.
export function getEntryCountry(data: Record<string, string | null>, tab: string): string {
  const raw = data['Country'];
  if (raw && raw.trim()) return raw.trim();
  return getCountryForAccount(data['Account'], tab);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tab-configs.test.ts`
Expected: PASS — all tests in the file (existing `TAB_COLUMN_CONFIGS` and `getEntryCountry` tests, plus the new `getCountryForAccount` tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tab-configs.ts src/lib/tab-configs.test.ts
git commit -m "feat: add getCountryForAccount for write-time Country derivation"
```

---

### Task 2: Auto-derive Country on Account edit in EditEntryModal

**Files:**
- Modify: `src/components/EditEntryModal.tsx:5` (import) and `:213-230` (the generic text-input `onChange`)

**Interfaces:**
- Consumes: `getCountryForAccount(account: string | null | undefined, tab: string): string` from Task 1.
- Produces: nothing new consumed by later tasks — this task is self-contained.

No automated test: `EditEntryModal.tsx` has no existing test coverage (consistent with Task 93/94, which left this file's siblings untested). Verified via `npm run build` and a manual check.

- [ ] **Step 1: Update the import**

In `src/components/EditEntryModal.tsx`, find:

```ts
import { getColLabel } from '../lib/tab-configs';
```

Replace with:

```ts
import { getColLabel, getCountryForAccount } from '../lib/tab-configs';
```

- [ ] **Step 2: Replace the Account-derivation logic**

Find:

```tsx
            onChange={(e) => {
              const val = e.target.value;
              if (h === 'Account') {
                const parts = val.split(' | ');
                const country = parts.length >= 3 ? parts[parts.length - 1].trim() : '';
                setFields((f) => ({ ...f, [h]: val, ...(country ? { Country: country } : {}) }));
              } else {
                setFields((f) => ({ ...f, [h]: val }));
              }
            }}
```

Replace with:

```tsx
            onChange={(e) => {
              const val = e.target.value;
              if (h === 'Account') {
                const country = getCountryForAccount(val, selectedTab || entry.tab);
                setFields((f) => ({ ...f, [h]: val, ...(country ? { Country: country } : {}) }));
              } else {
                setFields((f) => ({ ...f, [h]: val }));
              }
            }}
```

(`selectedTab` is the component's existing tab-selector state, initialized to `currentTab ?? ''` at `EditEntryModal.tsx:113`; `entry.tab` is the fallback for when no tab-switch dropdown is present. This mirrors the exact fallback pattern already used elsewhere in this component.)

- [ ] **Step 3: Type-check and build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open any brand tab, click a row to open Edit, and confirm:
- Editing Account from e.g. `"1303 | Test | Norway"` to `"1303 | Test | Germany"` live-updates the Country field in the same modal to `"Germany"`.
- Editing Account to something unparseable (e.g. deleting down to `"1303"`) leaves the Country field showing its last good value rather than clearing it (existing behavior, unchanged).
- Editing a field other than Account (e.g. Proxy Used) does not change the Country field.
- Directly typing into the Country field itself still works as a plain manual edit.

- [ ] **Step 5: Commit**

```bash
git add src/components/EditEntryModal.tsx
git commit -m "fix: derive Country from both delimiter styles and tab default on Account edit"
```

---

### Task 3: Auto-derive Country on Account entry in AddReviewAccountModal

**Files:**
- Modify: `src/components/AddReviewAccountModal.tsx:7` (import) and `:279-287` (the generic text-input `onChange` inside `renderField`)

**Interfaces:**
- Consumes: `getCountryForAccount(account: string | null | undefined, tab: string): string` from Task 1.
- Produces: nothing consumed by later tasks — self-contained.

No automated test, for the same reason as Task 2. Verified via `npm run build` and a manual check.

- [ ] **Step 1: Update the import**

In `src/components/AddReviewAccountModal.tsx`, find:

```ts
import { hasMultiPlatform, getTabColumns, TAB_DEFAULT_BRAND } from '../lib/tab-configs';
```

Replace with:

```ts
import { hasMultiPlatform, getTabColumns, TAB_DEFAULT_BRAND, getCountryForAccount } from '../lib/tab-configs';
```

- [ ] **Step 2: Add the Account-derivation branch**

Find (the final `else` branch of `renderField`, the plain-text `<input>`):

```tsx
        ) : (
          <input
            type="text"
            value={fields[f.key]}
            onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))}
            placeholder={f.link ? 'https://…' : '—'}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
          />
        )}
```

Replace with:

```tsx
        ) : (
          <input
            type="text"
            value={fields[f.key]}
            onChange={(e) => {
              const val = e.target.value;
              if (f.key === 'Account') {
                const country = getCountryForAccount(val, selectedTab);
                setFields((s) => ({ ...s, [f.key]: val, ...(country ? { Country: country } : {}) }));
              } else {
                setFields((s) => ({ ...s, [f.key]: val }));
              }
            }}
            placeholder={f.link ? 'https://…' : '—'}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
          />
        )}
```

(`selectedTab` is this component's existing tab-selector state, already in scope inside `renderField` — see `AddReviewAccountModal.tsx:135`.)

- [ ] **Step 3: Type-check and build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open any brand tab, click "Add", and confirm:
- Typing an Account value like `"999 | Test | France"` live-fills the Country field with `"France"`.
- Typing an Account value with no derivable country on the SuprPlay Limited tab (select it from the Tab dropdown first) fills Country with `"UK"`.
- Pasting a full tab-delimited sheet row (Ctrl+V) still fills Country from the pasted row's own cell, unaffected by this change.

- [ ] **Step 5: Commit**

```bash
git add src/components/AddReviewAccountModal.tsx
git commit -m "feat: auto-derive Country from Account when adding a review account"
```

---

### Task 4: Recompute Country on Duplicate Account

**Files:**
- Modify: `src/pages/BrandGroup.tsx:15` (import) and `:1026-1041` (`handleDuplicate`)

**Interfaces:**
- Consumes: `getCountryForAccount(account: string | null | undefined, tab: string): string` from Task 1.
- Produces: nothing consumed by later tasks — this is the last task.

No automated test, for the same reason as Tasks 2 and 3 (`handleDuplicate` has no existing coverage). Verified via `npm run build` and a manual check.

- [ ] **Step 1: Update the import**

In `src/pages/BrandGroup.tsx`, find:

```ts
import { getTabColumns, getColLabel, COLUMN_LABELS, TAB_DEFAULT_BRAND, getTabPlatforms, getTabSequence, getTabSequenceCol, hasMultiPlatform, getBrandTpUrl, getEntryCountry } from '../lib/tab-configs';
```

Replace with:

```ts
import { getTabColumns, getColLabel, COLUMN_LABELS, TAB_DEFAULT_BRAND, getTabPlatforms, getTabSequence, getTabSequenceCol, hasMultiPlatform, getBrandTpUrl, getEntryCountry, getCountryForAccount } from '../lib/tab-configs';
```

- [ ] **Step 2: Recompute Country after building each duplicate's fields**

Find:

```ts
      const targetTab = duplicateTargetTab || decodedTab;
      for (const entry of toInsert) {
        const fields: Record<string, string | null> = {};
        for (const k of Object.keys(entry.data)) {
          if (k === 'Account') fields[k] = entry.data[k] ? `${entry.data[k]} dup` : null;
          else if (k === 'Trust Pilot' || k === 'Wizard of Odds') fields[k] = todayStr;
          else if (CLEAR_ON_DUPLICATE.has(k)) fields[k] = null;
          else fields[k] = entry.data[k] ?? null;
        }
        // Apply brand override if selected
        if (duplicateBrand && brandCol) fields[brandCol] = duplicateBrand;
```

Replace with:

```ts
      const targetTab = duplicateTargetTab || decodedTab;
      for (const entry of toInsert) {
        const fields: Record<string, string | null> = {};
        for (const k of Object.keys(entry.data)) {
          if (k === 'Account') fields[k] = entry.data[k] ? `${entry.data[k]} dup` : null;
          else if (k === 'Trust Pilot' || k === 'Wizard of Odds') fields[k] = todayStr;
          else if (CLEAR_ON_DUPLICATE.has(k)) fields[k] = null;
          else fields[k] = entry.data[k] ?? null;
        }
        // Country tracks the duplicated Account text (with its " dup" suffix
        // stripped by getCountryForAccount), not the source row's stored value.
        fields['Country'] = getCountryForAccount(fields['Account'], targetTab) || null;
        // Apply brand override if selected
        if (duplicateBrand && brandCol) fields[brandCol] = duplicateBrand;
```

- [ ] **Step 3: Type-check and build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open the Wizard of Odds tab, select a row whose Account looks like `"NNN l Hanan l <Country>"`, duplicate it, and confirm the new row's Country column shows the plain country name (e.g. `"Australia"`), not `"Australia dup"`. Also duplicate a row on a tab with real Sheet-side Country data (e.g. Rooster Partners) and confirm the duplicate's Country still matches the original's country.

- [ ] **Step 5: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "fix: recompute Country from Account text on Duplicate Account"
```

---

## Self-Review Notes

- **Spec coverage:** `getCountryForAccount` (Task 1), Edit Account wiring (Task 2), Add Review Account wiring (Task 3), Duplicate Account wiring (Task 4) — all three write flows from the spec are covered, plus the shared helper they all depend on.
- **Type consistency:** `getCountryForAccount(account: string | null | undefined, tab: string): string` is defined once in Task 1 and called with that exact signature in Tasks 2, 3, and 4 — no drift.
- **No placeholders:** every step has literal before/after code and exact file paths/line numbers, re-verified against the current state of each file immediately before writing this plan (accounting for other in-flight changes to `BrandGroup.tsx` from concurrent work on this shared branch).
