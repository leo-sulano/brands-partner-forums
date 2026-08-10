# Manual Review Text Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human manually type/edit review text in the Edit Entry modal, reusing the
modal's existing save mechanism — no new backend logic, no new flag, scraper always wins on
overwrite.

**Architecture:** `BrandGroup.tsx` adds the tab's review-text key(s) to the `headers` array it
already builds for the modal (same pattern as its existing "always show this column" checks).
`EditEntryModal.tsx` excludes those keys from its generic per-field rendering loop (so they don't
render twice) and wires its existing `ReviewTextBlock` call sites to the same `fields`/`setFields`
state every other field already uses. `ReviewTextBlock.tsx` becomes a controlled `<textarea>`
instead of a read-only `<div>`, clearing any shown translation on edit.

**Tech Stack:** Vite/React/TypeScript, Tailwind v4. No backend/Python changes.

## Global Constraints

- No scraper-side changes — Python files are untouched by this plan. The scraper's existing
  merge-PATCH write (`update_entry()`) is left exactly as-is; it will continue to overwrite
  whatever is in `entries.data` whenever it successfully extracts real text, including a manually
  typed value. This is intentional, not a gap.
- No new persisted state (no "manual"/"locked" flag, no new jsonb key, no new table).
- Translation stays ephemeral (not persisted) — unchanged from the existing design. Editing the
  textarea clears any `translated`/`error` state already shown for that block.
- Review text must still never render in the review table or get copied on duplicate-entry — this
  plan does not touch either of those paths, and must not accidentally reintroduce the keys there.
- Match this modal's existing styling/patterns exactly (the `disabled={saving}` convention every
  other field already uses, the `mb-1.5 block text-xs font-medium text-slate-500` label class).
- No automated test added for `ReviewTextBlock.tsx`/`EditEntryModal.tsx` changes — this repo has
  no React component rendering test precedent (no `@testing-library/react`), matching the
  established convention from the original translation-modal feature.

---

### Task 1: `BrandGroup.tsx` — include review-text keys in the modal's `headers`

**Files:**
- Modify: `src/pages/BrandGroup.tsx` (around lines 2483-2506, the `headers` prop's IIFE passed to `EditEntryModal` — re-read the live file first, since exact line numbers may have shifted since this plan was written)

**Interfaces:**
- Consumes: `getTabPlatforms` (already imported from `../lib/tab-configs`), `PLATFORM_REVIEW_TEXT_KEYS` (already imported from `../lib/scoreSummary`, used at this file's existing `REVIEW_TEXT_KEYS` constant definition near the top of the file).
- Produces: nothing new for later tasks — this task's only effect is that `EditEntryModal`'s
  `headers` prop now always includes each active platform's canonical review-text key
  (`'TP Review Text'`, `'AG Review Text'`, `'CG Review Text'`, or `'WO Review Text'`) for the
  current tab, whether or not the current entry already has a value for it.

No automated test — this is a small addition to an existing, untested JSX-construction block
(same convention as the file's existing `'Agent'`/`'Brand Link'` "always show this column" checks
immediately below it, which also have no tests).

- [ ] **Step 1: Read the current live block**

Read `src/pages/BrandGroup.tsx` around where `EditEntryModal`'s `headers` prop is built (search
for `const hdrs = [...filteredFull, ...extras];`). Confirm the surrounding structure still matches
what's described below before editing — if it has diverged, adapt precisely rather than guessing.

- [ ] **Step 2: Add the review-text keys**

Immediately after the existing block:
```tsx
            // Same fix for 'Brand Link' — newly added to tabs whose tab_schemas
            // predates it, so it won't be in fullHeaders until a sync runs.
            if (getTabColumns(decodedTab)?.includes('Brand Link') && !hdrs.includes('Brand Link')) {
              const brandIdx = brandCol ? hdrs.indexOf(brandCol) : -1;
              if (brandIdx !== -1) hdrs.splice(brandIdx + 1, 0, 'Brand Link');
              else hdrs.push('Brand Link');
            }
```
add:
```tsx
            // Review text (TP/AG/CG/WO Review Text) has no Sheet/tab_schemas origin at all —
            // it's written only by the Selenium scrapers into entries.data. Force it into
            // headers for every platform this tab actually tracks, whether or not the current
            // entry has a value yet, so EditEntryModal's fields/handleSave (which only ever
            // touches whatever's in headers) can display AND save a manually-typed value.
            for (const p of getTabPlatforms(decodedTab)) {
              const reviewTextKey = PLATFORM_REVIEW_TEXT_KEYS[p][0];
              if (!hdrs.includes(reviewTextKey)) hdrs.push(reviewTextKey);
            }
```

- [ ] **Step 3: Run the full frontend suite and build to confirm no regression**

Run: `npm test` then `npm run build`
Expected: both pass. (No existing test should be affected — this only changes what's included in
a prop passed into `EditEntryModal`, not any tested pure-logic module.)

- [ ] **Step 4: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: include review-text keys in Edit Entry modal headers"
```

---

### Task 2: `ReviewTextBlock.tsx` — editable textarea, clear translation on edit

**Files:**
- Modify: `src/components/ReviewTextBlock.tsx` (full file, currently 77 lines)

**Interfaces:**
- Consumes: `shouldShowTranslateButton`, `translateReviewText` (unchanged, from `../lib/reviewTranslation`).
- Produces: `export default function ReviewTextBlock({ value, onChange, disabled }: Props)` where
  `Props = { value: string; onChange: (v: string) => void; disabled?: boolean }` — a breaking
  change to this component's public interface. Task 3 updates all three call sites in
  `EditEntryModal.tsx` to match this new signature in the same PR, so there is no intermediate
  broken state once both tasks land, but Task 2 alone WILL leave `EditEntryModal.tsx` failing to
  typecheck until Task 3 also lands — this is expected and acceptable given both tasks are part
  of one small plan executed back-to-back; do not attempt to keep the old `{ text }` prop shape
  working as a compatibility shim.

No automated test — component rendering has no test precedent in this repo (see Global
Constraints).

- [ ] **Step 1: Replace the file**

Replace the full contents of `src/components/ReviewTextBlock.tsx` with:

```tsx
import { useMemo, useState } from 'react';
import { Loader2, Languages } from 'lucide-react';
import { shouldShowTranslateButton, translateReviewText } from '../lib/reviewTranslation';

const TRANSLATE_FAILURE_MESSAGE = 'Unable to translate this review at the moment. Please try again later.';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function ReviewTextBlock({ value, onChange, disabled }: Props) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showButton = useMemo(() => (value ? shouldShowTranslateButton(value) : false), [value]);

  function handleChange(next: string) {
    onChange(next);
    // The shown translation (and any error) no longer corresponds to the edited
    // text — clear both so nothing stale sits next to the new original.
    setTranslated(null);
    setError(null);
  }

  async function handleTranslate() {
    if (!value) return;
    setTranslating(true);
    setError(null);
    try {
      const result = await translateReviewText(value);
      if (!result?.trim()) {
        setError(TRANSLATE_FAILURE_MESSAGE);
        setTranslated(null);
      } else {
        setTranslated(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : TRANSLATE_FAILURE_MESSAGE);
    } finally {
      setTranslating(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="mb-1.5 block text-xs font-medium text-slate-500">Original Review</label>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="No review content yet — type one here"
        rows={4}
        className="w-full whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20 disabled:opacity-50"
      />

      {showButton && !translated && (
        <button
          type="button"
          onClick={handleTranslate}
          disabled={translating || disabled}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
        >
          {translating ? <Loader2 className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}
          {translating ? 'Translating…' : 'Translate to English'}
        </button>
      )}

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {translated?.trim() && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">English Translation</label>
          <div className="whitespace-pre-wrap break-words rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-700">
            {translated}
          </div>
        </div>
      )}
    </div>
  );
}
```

Note what changed from the previous version: the `text: string | null` prop is gone (replaced by
`value`/`onChange`/`disabled`); the early-return "No review content available." paragraph is gone
(an empty, editable `<textarea>` with a placeholder communicates the same thing); the read-only
`<div>` became a `<textarea>`; a new `handleChange` wraps the caller's `onChange` to also clear
`translated`/`error`. The Translate button, error display, and translation display are otherwise
unchanged.

- [ ] **Step 2: Do not run the full build yet**

This component's new prop shape doesn't match its call sites in `EditEntryModal.tsx` until Task 3
lands — `npm run build` will fail on this component in isolation. Skip straight to committing;
Task 3 will restore a green build.

- [ ] **Step 3: Commit**

```bash
git add src/components/ReviewTextBlock.tsx
git commit -m "feat: make ReviewTextBlock an editable textarea, clear translation on edit"
```

---

### Task 3: `EditEntryModal.tsx` — exclude from generic rendering, wire to `fields` state

**Files:**
- Modify: `src/components/EditEntryModal.tsx`

**Interfaces:**
- Consumes: `ReviewTextBlock`'s new `{ value, onChange, disabled }` props (Task 2).
- Produces: nothing new for later tasks — this is the final wiring point for this plan.

No automated test — same reasoning as Tasks 1-2.

- [ ] **Step 1: Read the current live file**

Read `src/components/EditEntryModal.tsx` in full and confirm it still matches the structure
described below (the `visibleHeaders` filter, the three `ReviewTextBlock` call sites, and the
`getReviewText` import) before editing — if it has diverged since this plan was written, adapt
precisely rather than guessing.

- [ ] **Step 2: Extend `visibleHeaders` to exclude the review-text keys**

Replace:
```tsx
  // Bucket headers into sections (skip brandCol — shown in the top bar)
  const visibleHeaders = headers.filter(
    (h) => !(brandCol && h === brandCol && currentTab && availableBrands && availableBrands.length > 0)
  );
```
with:
```tsx
  // Bucket headers into sections (skip brandCol — shown in the top bar; skip the four
  // review-text keys — they're rendered explicitly via ReviewTextBlock below, not the
  // generic per-header loop, so they'd otherwise render a second time as a plain input)
  const REVIEW_TEXT_KEY_NAMES = new Set(['TP Review Text', 'AG Review Text', 'CG Review Text', 'WO Review Text']);
  const visibleHeaders = headers.filter(
    (h) => !(brandCol && h === brandCol && currentTab && availableBrands && availableBrands.length > 0)
      && !REVIEW_TEXT_KEY_NAMES.has(h)
  );
```

- [ ] **Step 3: Wire the Trust Pilot / Wizard of Odds section's `ReviewTextBlock`**

Replace:
```tsx
              {(tabPlatforms.includes('tp') || tabPlatforms.includes('wo')) && (
                <div className="mt-3">
                  <ReviewTextBlock
                    text={getReviewText(entry.data, tabPlatforms.includes('wo') ? 'wo' : 'tp')}
                  />
                </div>
              )}
```
with:
```tsx
              {(tabPlatforms.includes('tp') || tabPlatforms.includes('wo')) && (
                <div className="mt-3">
                  <ReviewTextBlock
                    value={fields[tabPlatforms.includes('wo') ? 'WO Review Text' : 'TP Review Text'] ?? ''}
                    onChange={(v) => setFields((f) => ({ ...f, [tabPlatforms.includes('wo') ? 'WO Review Text' : 'TP Review Text']: v }))}
                    disabled={saving}
                  />
                </div>
              )}
```

- [ ] **Step 4: Wire the AskGamblers section's `ReviewTextBlock`**

Replace:
```tsx
              {tabPlatforms.includes('ag') && (
                <div className="mt-3">
                  <ReviewTextBlock text={getReviewText(entry.data, 'ag')} />
                </div>
              )}
```
with:
```tsx
              {tabPlatforms.includes('ag') && (
                <div className="mt-3">
                  <ReviewTextBlock
                    value={fields['AG Review Text'] ?? ''}
                    onChange={(v) => setFields((f) => ({ ...f, ['AG Review Text']: v }))}
                    disabled={saving}
                  />
                </div>
              )}
```

- [ ] **Step 5: Wire the Casino Guru section's `ReviewTextBlock`**

Replace:
```tsx
              {tabPlatforms.includes('cg') && (
                <div className="mt-3">
                  <ReviewTextBlock text={getReviewText(entry.data, 'cg')} />
                </div>
              )}
```
with:
```tsx
              {tabPlatforms.includes('cg') && (
                <div className="mt-3">
                  <ReviewTextBlock
                    value={fields['CG Review Text'] ?? ''}
                    onChange={(v) => setFields((f) => ({ ...f, ['CG Review Text']: v }))}
                    disabled={saving}
                  />
                </div>
              )}
```

- [ ] **Step 6: Remove the now-unused `getReviewText` import**

Replace:
```tsx
import { PLATFORM_LABEL, getReviewText, type Platform } from '../lib/scoreSummary';
```
with:
```tsx
import { PLATFORM_LABEL, type Platform } from '../lib/scoreSummary';
```
`getReviewText` is no longer called anywhere in this file (all three call sites now read directly
from `fields[key]`, matching the exact key string, since review text has only one canonical key
name per platform — unlike TP's status column, there's no multi-variant fallback to resolve).
`getReviewText`/`PLATFORM_REVIEW_TEXT_KEYS` remain defined and exported from `scoreSummary.ts` for
other consumers (`BrandGroup.tsx`'s `REVIEW_TEXT_KEYS` constant, and any future analysis-overview
task) — this step only removes an unused import from this one file.

- [ ] **Step 7: Run the full frontend suite and build to confirm everything is green again**

Run: `npm test` then `npm run build`
Expected: both pass — this is the step that resolves Task 2's expected intermediate build failure.
If the build still fails, re-check Steps 2-6 were applied exactly (a leftover `text={...}` prop or
the old `getReviewText` import are the most likely causes).

- [ ] **Step 8: Commit**

```bash
git add src/components/EditEntryModal.tsx
git commit -m "feat: wire ReviewTextBlock to fields state for manual entry/editing"
```

---

## Self-Review Notes (for the plan author, not a task)

- **Spec coverage:** Scraper always wins / no new flag ✅ (no Python files touched anywhere in
  this plan). Always an editable textarea ✅ Task 2. Editing clears translation ✅ Task 2's
  `handleChange`. Applies uniformly to all four platforms ✅ Task 3 (all three call sites updated
  identically in shape, TP/WO sharing the existing ternary). `BrandGroup.tsx` header inclusion ✅
  Task 1. Exclusion from generic rendering loop ✅ Task 3 Step 2.
- **Placeholder scan:** no TBD/TODO. Task 2's "this will leave the build red until Task 3 lands"
  note is a concrete, expected, explained state — not a vague placeholder.
- **Type consistency:** `ReviewTextBlock`'s new `Props` (`value: string; onChange: (v: string) =>
  void; disabled?: boolean`) defined once in Task 2, used identically at all three call sites in
  Task 3. The literal key strings (`'TP Review Text'`, `'WO Review Text'`, `'AG Review Text'`,
  `'CG Review Text'`) match exactly across Task 1's `PLATFORM_REVIEW_TEXT_KEYS[p][0]` values, Task
  3's `REVIEW_TEXT_KEY_NAMES` set, and Task 3's three call sites — verified against
  `scoreSummary.ts`'s existing `PLATFORM_REVIEW_TEXT_KEYS` definition
  (`{ tp: ['TP Review Text'], ag: ['AG Review Text'], cg: ['CG Review Text'], wo: ['WO Review Text'] }`),
  not re-typed from memory.
