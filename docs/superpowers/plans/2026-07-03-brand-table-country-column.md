# Brand Table Country Column, Filter, and Sort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a sortable Country column immediately after Account on every brand tab table, with a dropdown filter to narrow rows by country.

**Architecture:** Country data already flows into every entry's schema-less `data` bag (synced 1:1 from the Google Sheet). This is purely a column-whitelist edit in `tab-configs.ts` plus filter-state wiring in `BrandGroup.tsx` that mirrors the existing Agent/Proxy filter pattern exactly. No schema, migration, or Edge Function changes.

**Tech Stack:** Vite 6, React 19, TypeScript (strict), Tailwind v4, Vitest.

## Global Constraints

- TypeScript strict mode; no `any` unless commented why (per project CLAUDE.md).
- Tailwind v4 utility classes only — no new global CSS.
- Follow existing UI component patterns exactly (`BrandFilterDropdown`, `FilterDropdown`) — do not introduce new dropdown components.
- Verify with `npm run build` (`tsc -b && vite build`), not `tsc --noEmit` — the root tsconfig is references-only and `tsc --noEmit` alone checks nothing in this repo.
- Spec: `docs/superpowers/specs/2026-07-03-brand-table-country-column-design.md`.

---

### Task 1: Whitelist Country in every tab's column config

**Files:**
- Modify: `src/lib/tab-configs.ts:5-147` (the `TAB_COLUMN_CONFIGS` object)
- Test: `src/lib/tab-configs.test.ts` (new file)

**Interfaces:**
- Consumes: nothing new — `TAB_COLUMN_CONFIGS: Record<string, string[]>` already exists.
- Produces: every tab's array now contains `'Country'` immediately after `'Account'`. Task 2 relies on `headers.includes('Country')` being true whenever the tab's live sheet has that header (unaffected by this task — that check already exists generically).

- [ ] **Step 1: Write the failing test**

Create `src/lib/tab-configs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TAB_COLUMN_CONFIGS } from './tab-configs';

describe('TAB_COLUMN_CONFIGS', () => {
  it('places Country immediately after Account in every tab', () => {
    for (const [tab, cols] of Object.entries(TAB_COLUMN_CONFIGS)) {
      const accountIdx = cols.indexOf('Account');
      expect(accountIdx, `${tab} has no Account column`).toBeGreaterThanOrEqual(0);
      expect(cols[accountIdx + 1], `${tab}: Country should immediately follow Account`).toBe('Country');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tab-configs.test.ts`
Expected: FAIL — `Wizard of Odds: Country should immediately follow Account` (and all other tabs) because `Country` is not yet in any array.

- [ ] **Step 3: Insert `'Country'` after `'Account'` in every tab**

In `src/lib/tab-configs.ts`, replace the entire `TAB_COLUMN_CONFIGS` object (lines 5-147) with:

```ts
export const TAB_COLUMN_CONFIGS: Record<string, string[]> = {
  // 3-platform tabs
  'Rooster Partners': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Agent',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'AG Review Link',
    'AG User',
    'Casino Guru review added',
    'CG Review Status',
    'CG Review Link',
    'CG User',
  ],
  'Hanan': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'AG Review Link',
    'AG User',
    'Casino Guru review added',
    'CG Review Status',
    'CG Review Link',
    'CG User',
  ],
  'Revolution Casino': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'AG Review Link',
    'AG User',
    'Casino Guru review added',
    'CG Review Status',
    'CG Review Link',
    'CG User',
  ],
  // 1-platform tabs
  'TP Brand Injection': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Agent',
    'Brand / TP URL PAGE',
    'Trust Pilot',
    'Link to the profile',
    'Review Status',
  ],
  'TP Affiliate': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Agent',
    'URL PAGE',
    'Trust Pilot',
    'Link to the profile',
    'Review Status',
  ],
  'Trybet': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'Trust pilot Review Status',
  ],
  'HazEmirates UAE': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'Trust pilot Review Status',
  ],
  'SuprPlay Limited': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Agent',
    'Brand Name',
    'Trust Pilot',
    'Link to the profile',
    'Review Status',
  ],
  'SilverPlay': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'AG Review Link',
    'AG User',
    'Casino Guru review added',
    'CG Review Status',
    'CG Review Link',
    'CG User',
  ],
  'Wizard of Odds': [
    'Agent',
    'Account',
    'Country',
    'Proxy Used',
    'Brand Name',
    'Wizard of Odds',
    'WoO Review Status',
    'Wizard of OddsScore added',
    'Link to the profile',
    'User Name',
  ],
  // Dashboard-only tab, no Google Sheet backing — entries come from Add Review Account.
  'GRG - Gulf Recovery Group': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Agent',
    'Brand Name',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tab-configs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tab-configs.ts src/lib/tab-configs.test.ts
git commit -m "feat: add Country column to every brand tab, right after Account"
```

---

### Task 2: Wire a Country filter into BrandGroup

**Files:**
- Modify: `src/pages/BrandGroup.tsx` (4 locations — filter state, tab-change reset, unique-values derivation, filter chain, and toolbar render)

**Interfaces:**
- Consumes: `entries: Entry[]` (already in scope), `headers: string[]` (already in scope, resolved per-tab visible headers), `BrandFilterDropdown` component (already defined in this file, takes `{ value: string; onChange: (v: string) => void; brands: string[]; noun?: string }`).
- Produces: `countryFilter` state and `countryFiltered` array, consumed by the existing `platformFiltered` assignment immediately below it.

No automated test is added for this task: it wires new state into an already-untested 1700+ line stateful component, mirroring the existing Agent/Proxy filter code exactly (also untested). Verification is `npm run build` (type-check) plus a manual browser check, matching how the existing Agent/Proxy filters were verified in this codebase.

- [ ] **Step 1: Add `countryFilter` state**

In `src/pages/BrandGroup.tsx`, find:

```ts
  const [agentFilter, setAgentFilter] = useState('');
  const [proxyFilter, setProxyFilter] = useState('');
  const { isApproved, session } = useAuth();
```

Replace with:

```ts
  const [agentFilter, setAgentFilter] = useState('');
  const [proxyFilter, setProxyFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const { isApproved, session } = useAuth();
```

- [ ] **Step 2: Reset `countryFilter` on tab change**

Find:

```ts
      setAgentFilter('');
      setProxyFilter('');
      setDateFrom('');
      setDateTo('');
```

Replace with:

```ts
      setAgentFilter('');
      setProxyFilter('');
      setCountryFilter('');
      setDateFrom('');
      setDateTo('');
```

- [ ] **Step 3: Derive `uniqueCountries`**

Find:

```ts
  const uniqueProxies = headers.includes('Proxy Used')
    ? (() => {
        const seen = new Map<string, string>();
        for (const e of entries) {
          const v = e.data['Proxy Used'];
          if (v && v.trim()) {
            const key = v.trim().toLowerCase();
            if (!seen.has(key)) seen.set(key, v.trim());
          }
        }
        return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      })()
    : [];
```

Replace with (adds `uniqueCountries` right after `uniqueProxies`, same de-dup logic):

```ts
  const uniqueProxies = headers.includes('Proxy Used')
    ? (() => {
        const seen = new Map<string, string>();
        for (const e of entries) {
          const v = e.data['Proxy Used'];
          if (v && v.trim()) {
            const key = v.trim().toLowerCase();
            if (!seen.has(key)) seen.set(key, v.trim());
          }
        }
        return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      })()
    : [];

  const uniqueCountries = headers.includes('Country')
    ? (() => {
        const seen = new Map<string, string>();
        for (const e of entries) {
          const v = e.data['Country'];
          if (v && v.trim()) {
            const key = v.trim().toLowerCase();
            if (!seen.has(key)) seen.set(key, v.trim());
          }
        }
        return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      })()
    : [];
```

- [ ] **Step 4: Insert `countryFiltered` into the filter chain**

Find:

```ts
  const proxyFiltered = proxyFilter
    ? agentFiltered.filter((e) => e.data['Proxy Used']?.trim().toLowerCase() === proxyFilter.toLowerCase())
    : agentFiltered;

  // Platform filter only affects visible columns, not row filtering.
  const platformFiltered = proxyFiltered;
```

Replace with:

```ts
  const proxyFiltered = proxyFilter
    ? agentFiltered.filter((e) => e.data['Proxy Used']?.trim().toLowerCase() === proxyFilter.toLowerCase())
    : agentFiltered;

  const countryFiltered = countryFilter
    ? proxyFiltered.filter((e) => e.data['Country']?.trim().toLowerCase() === countryFilter.toLowerCase())
    : proxyFiltered;

  // Platform filter only affects visible columns, not row filtering.
  const platformFiltered = countryFiltered;
```

- [ ] **Step 5: Render the Country filter dropdown**

Find:

```tsx
          {uniqueProxies.length > 1 && (
            <BrandFilterDropdown
              noun="proxie"
              value={proxyFilter}
              onChange={(v) => { setProxyFilter(v); setPage(1); }}
              brands={uniqueProxies}
            />
          )}
```

Replace with:

```tsx
          {uniqueProxies.length > 1 && (
            <BrandFilterDropdown
              noun="proxie"
              value={proxyFilter}
              onChange={(v) => { setProxyFilter(v); setPage(1); }}
              brands={uniqueProxies}
            />
          )}
          {uniqueCountries.length > 1 && (
            <BrandFilterDropdown
              noun="countrie"
              value={countryFilter}
              onChange={(v) => { setCountryFilter(v); setPage(1); }}
              brands={uniqueCountries}
            />
          )}
```

(`noun="countrie"` mirrors the existing `noun="proxie"` quirk two blocks up — `BrandFilterDropdown` naively appends `"s"` to the noun for its plural label, so `"countrie" + "s"` renders "All countries" / "Search countries…".)

- [ ] **Step 6: Type-check and build**

Run: `npm run build`
Expected: exits 0, no TypeScript errors (do not rely on `tsc --noEmit` alone — see Global Constraints).

- [ ] **Step 7: Manual verification in the browser**

Run: `npm run dev`, open a brand tab (e.g. `/brands/Rooster%20Partners`), and confirm:
- "Country" column header appears immediately after "Account".
- Clicking the "Country" header sorts the table by country (asc/desc toggle, chevron icon updates).
- A "All countries" filter dropdown appears in the toolbar next to the Proxy filter (only if the tab has >1 distinct country); selecting a country filters the table to matching rows; the dropdown search box filters the country list as you type; clicking the "×" or "All countries" clears the filter.
- Switching tabs resets the country filter back to "All countries".

- [ ] **Step 8: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: add Country filter dropdown to brand tables"
```

---

## Self-Review Notes

- **Spec coverage:** Column placement (Task 1), sorting (no-op, confirmed not in `isNoSortCol` — verified in spec, no task needed since it's already correct behavior), filter (Task 2). All three spec requirements covered.
- **Type consistency:** `uniqueCountries: string[]`, `countryFilter: string`, `setCountryFilter: (v: string) => void` — matches the exact shapes `BrandFilterDropdown` already expects (used identically by `uniqueProxies`/`proxyFilter`).
- **No placeholders:** every step has literal before/after code.
