# Manual Brand Name Entry in Add Review Account

## Problem

In the **Add Review Account** modal, the Brand Name field ([BrandSelectDropdown.tsx](../../../src/components/BrandSelectDropdown.tsx)) is a dropdown-only picker limited to brands already known for the current tab (`availableBrands`, derived from `brandProfiles`). There is no way to type a brand name that hasn't appeared in existing entries yet, so a genuinely new brand can't be added on any brand tab.

Brand Link is unaffected — it's already a plain, freely-editable text input ([AddReviewAccountModal.tsx:266-324](../../../src/components/AddReviewAccountModal.tsx#L266-L324)) that just happens to get auto-filled when an existing brand is picked.

## Design

### 1. `BrandSelectDropdown.tsx` becomes a creatable combobox

- While the search box has non-empty text with no case-insensitive exact match among `brands`, show a `+ Add "<typed text>"` row at the top of the results list, above `— Select brand —` and the matched brands.
- Clicking that row calls `onChange(searchText)` with the user's exact typed casing and closes the dropdown — identical to selecting any other brand.
- If the typed text *does* case-insensitively match an existing brand, no Add row appears; the existing entry surfaces normally so users land on the canonical name/casing instead of creating a near-duplicate.
- No other behavior changes: search, clear (×), highlighting, and closed-button display all work as today, since they already just read/write `value`.

### 2. `AddReviewAccountModal.tsx` always renders the dropdown

- Remove the `availableBrands.length > 0` condition (currently at [line 270](../../../src/components/AddReviewAccountModal.tsx#L270)). `BrandSelectDropdown` renders unconditionally for the brand field, on every tab, regardless of whether that tab has any known brands yet.
- A tab with zero known brands simply shows the `+ Add` row with no other suggestions — same component, no separate plain-input code path to maintain.
- `handleBrandChange`, `resolveBrandLink`, and the AG/CG URL autofill logic are unchanged. Typing a brand-new name flows through the exact same handler as picking one from the list. `resolveBrandLink`, `getBrandAgUrl`, and `getBrandCgUrl` all gracefully return `''`/`undefined` for unrecognized brand names ([tab-configs.ts:567-597](../../../src/lib/tab-configs.ts#L567-L597)), so an unknown brand just leaves Brand Link/AG/CG links blank for the user to fill in manually — no risk of garbage autofill.

## Out of scope

- `availableBrands` still only reflects brands known for `currentTab` (via the `brandProfiles` prop). Switching tabs inside the modal still can't surface that other tab's real existing brands as dropdown suggestions — pre-existing limitation, unrelated to this request.
- Brand Link needs no changes; it already accepts free typing today.

## Testing

- Existing brand: selecting one from the dropdown still autofills Brand Link/AG/CG links as before.
- New brand: typing a name with no match shows `+ Add "<text>"`; selecting it sets Brand Name to that text and leaves Brand Link blank for manual entry.
- Case-insensitive match: typing a name that differs only in case from an existing brand shows that existing brand in the list, not an Add row.
- Tab with zero known brands (e.g. switching to another tab inside the modal): dropdown still renders, showing only the Add row when text is typed.
