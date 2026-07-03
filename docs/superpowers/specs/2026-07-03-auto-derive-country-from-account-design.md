# Auto-Derive and Persist Country From Account

**Date:** 2026-07-03
**Status:** Approved

## Problem

Country display/sort/filter (Task 93/94) is read-time only — it never writes anything back. Meanwhile the write paths are inconsistent: Edit Account only derives Country from Account text live-as-you-type, and only for the `" | "`-pipe-delimited shape (misses the `" l "`-delimited shape and SuprPlay Limited's non-derivable default). Add Review Account never derives Country at all — it's a fully independent manual field. Duplicate Account copies whatever Country was already stored, rather than recomputing it for the (possibly different) duplicated Account text.

Net effect: editing an Account's embedded country (e.g. `"1303 | Test | Norway"` → `"1303 | Test | Germany"`) doesn't reliably update the stored Country, and new/duplicated accounts on SuprPlay Limited or Wizard of Odds never get a real stored Country at all.

## Goal

Whenever an entry's Account value is set or changed — via Add Review Account, Edit Account, or Duplicate Account — Country is automatically derived from the new Account text (or the tab's default) and actually persisted, so Country stays in sync with Account going forward without manual intervention.

## Design

### Approach

Introduce one write-time helper, `getCountryForAccount(account, tab)`, in `tab-configs.ts`, and call it from the three places that set Account. This reuses the exact same parsing rules already built for read-time display (Task 94's `deriveCountryFromAccount`, including the "dup"-suffix strip), so there is one derivation rule, not two.

Editing the Country field directly (without touching Account) is untouched — it's a plain manual edit. Switching tabs in Add/Edit without touching Account does not trigger recomputation — only an actual Account text change does.

### Changes

**`src/lib/tab-configs.ts`**

Add a write-time function above the existing (now refactored) `getEntryCountry`:

```ts
// Returns the country that should be set on an entry given a new/edited Account
// value and its tab: derived from the Account text, else the tab's default.
// Called whenever Account is set or changed (Add, Edit, Duplicate) to keep
// Country in sync with it.
export function getCountryForAccount(account: string | null | undefined, tab: string): string {
  return deriveCountryFromAccount(account) || TAB_DEFAULT_COUNTRY[tab] || '';
}

// Returns the country to display/sort/filter by for an entry: the real value
// synced/stored, else what getCountryForAccount would derive for it.
export function getEntryCountry(data: Record<string, string | null>, tab: string): string {
  const raw = data['Country'];
  if (raw && raw.trim()) return raw.trim();
  return getCountryForAccount(data['Account'], tab);
}
```

`deriveCountryFromAccount` and `TAB_DEFAULT_COUNTRY` are unchanged (already handle both delimiter styles and the "dup" strip from Task 94).

**`src/components/EditEntryModal.tsx`**

Replace the current ad-hoc `' | '`-only split in the Account field's `onChange` (currently: split on `' | '`, require ≥3 parts, take the last) with a call to the shared helper, using whichever tab is currently selected in the modal (`selectedTab || entry.tab`):

```ts
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

Note: unlike the current logic, an Account edit that no longer derives anything (e.g. edited down to `"1303"`) now clears the `Country` field's live value only if `country` is falsy — matching the existing spread pattern, which already leaves `Country` untouched when `country` is `''`. This is an intentional carry-over of existing behavior, not a new decision: a partially-typed Account never blanks out a previously-good Country mid-edit.

**`src/components/AddReviewAccountModal.tsx`**

`ACCOUNT_FIELDS`' generic `renderField` currently uses one shared `onChange` for every plain-text field. Add an Account-specific branch (mirroring EditEntryModal), deriving against `selectedTab`:

```ts
onChange={(e) => {
  const val = e.target.value;
  if (f.key === 'Account') {
    const country = getCountryForAccount(val, selectedTab);
    setFields((s) => ({ ...s, [f.key]: val, ...(country ? { Country: country } : {}) }));
  } else {
    setFields((s) => ({ ...s, [f.key]: val }));
  }
}}
```

Paste (Ctrl+V a full sheet row) is unchanged — it already sets `Country` directly from the pasted row's own cell via `PASTE_OFFSET_MAP`, which is a real value and takes precedence over a text-derived guess.

**`src/pages/BrandGroup.tsx` — `handleDuplicate`**

After the existing per-key copy loop builds `fields` for the new entry (which sets `fields['Account'] = `${entry.data['Account']} dup`\`), recompute Country from that new Account value against the duplicate's target tab, overriding whatever was copied:

```ts
const targetTab = duplicateTargetTab || decodedTab;
for (const entry of toInsert) {
  const fields: Record<string, string | null> = {};
  for (const k of Object.keys(entry.data)) {
    // ...existing per-key logic, unchanged...
  }
  fields['Country'] = getCountryForAccount(fields['Account'], targetTab) || null;
  // ...existing brand/AG/CG overrides, unchanged...
  await insertEntry(targetTab, fields);
}
```

This replaces the "copy Country as-is" behavior with "recompute from the final Account text," per your answer — on the 9 tabs with real Sheet-side Country data this produces the same value (their Account text already round-trips to the same country), and it now also correctly sets Country on SuprPlay Limited / Wizard of Odds duplicates.

### Testing

TDD in `tab-configs.test.ts`: add cases for `getCountryForAccount` directly (pipe-delimited, `l`-delimited, per-tab default, unparseable-and-no-default → `''`, "dup"-suffixed). `getEntryCountry`'s existing tests continue to pass unchanged since its observable behavior doesn't change, only its internal implementation (delegates to `getCountryForAccount`).

`EditEntryModal.tsx`, `AddReviewAccountModal.tsx`, and `handleDuplicate` (in `BrandGroup.tsx`) have no existing test coverage (consistent with the rest of these files — see Task 93/94) — verified via `npm run build` plus a manual click-through of your example (edit `"1303 | Test | Norway"` → `"...Germany"`, confirm Country updates to Germany).

### Out of scope

- No backfill of existing rows that predate this change — Country only gets (re)computed the next time that row's Account is touched via Add/Edit/Duplicate. `getEntryCountry`'s read-time fallback (Task 94) continues to cover untouched legacy rows for display/sort/filter.
- No recomputation on tab-switch alone (Add/Edit) — only an actual Account text change triggers it.
- No change to what happens when a user edits the Country field directly.
