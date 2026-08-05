# Account Platform-Usage Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, next to each Account cell in `BrandGroup.tsx`, a small icon+count badge per platform (TrustPilot, AskGamblers, CasinoGuru, Wizard of Odds) indicating how many entry rows — anywhere in the dashboard, any tab — that same account has been used on.

**Architecture:** A pure function (`computeAccountPlatformUsage`) tallies platform usage per normalized Account text across every entry in the `entries` table (fetched dashboard-wide via the existing `fetchAllEntries`), producing a `Map<string, Record<Platform, number>>`. `BrandGroup.tsx` fetches and computes this map once, keyed to the same `reloadSeq` trigger the sibling `removedPlatformBrandRows` fetch already uses, and a new presentational `AccountUsageBadges` component renders the per-platform favicon+count badges next to the Account cell's existing text.

**Tech Stack:** React 19, TypeScript (strict), Vitest, Tailwind v4, existing Supabase client via `src/lib/queries.ts`.

## Global Constraints

- TypeScript strict mode. No `any` unless commented why (spec: CLAUDE.md Development Guidelines).
- All Supabase queries live in `src/lib/queries.ts` — pages/components never call `supabase.from(...)` directly (spec: CLAUDE.md Architecture Rules).
- Verify with `npm run build`, not `tsc --noEmit` — the root tsconfig is references-only and `tsc --noEmit` alone checks nothing meaningful in this repo.
- Badges must fail open: if the usage fetch fails, the Account cell renders with no badges, never an error or a blocked edit-modal click.
- No new database table, column, or migration.

---

### Task 1: Extract and export `stripDupSuffix`

**Files:**
- Modify: `src/lib/tab-configs.ts:258-269`
- Test: `src/lib/tab-configs.test.ts`

**Interfaces:**
- Produces: `export function stripDupSuffix(account: string): string` — strips one or more trailing `" dup"` suffixes (case-insensitive), e.g. `"1182 | Test | Norway dup dup"` → `"1182 | Test | Norway"`. Returns the input unchanged if there's no trailing dup suffix.

This is a pure refactor: extract the existing inline regex from `deriveCountryFromAccount` into its own exported function, so both it and the new account-usage matching logic in Task 2 use the exact same stripping rule and can't drift apart.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/tab-configs.test.ts` (after the `TAB_COLUMN_CONFIGS` describe block, before `getTabPlatforms`):

```ts
import { TAB_COLUMN_CONFIGS, getEntryCountry, getCountryForAccount, getBrandGroup, getTabPlatforms, stripDupSuffix } from './tab-configs';

describe('stripDupSuffix', () => {
  it('strips a single trailing " dup" suffix', () => {
    expect(stripDupSuffix('550 l Hanan l Australia dup')).toBe('550 l Hanan l Australia');
  });

  it('strips repeated " dup" suffixes from duplicating an already-duplicated row', () => {
    expect(stripDupSuffix('1182 | Test | Norway dup dup')).toBe('1182 | Test | Norway');
  });

  it('is case-insensitive', () => {
    expect(stripDupSuffix('358 | BI TP | Germany DUP')).toBe('358 | BI TP | Germany');
  });

  it('returns the input unchanged when there is no dup suffix', () => {
    expect(stripDupSuffix('1303 | Test | Germany')).toBe('1303 | Test | Germany');
  });

  it('returns an empty string unchanged', () => {
    expect(stripDupSuffix('')).toBe('');
  });
});
```

(This adds `stripDupSuffix` to the existing top-of-file import statement — update that one line rather than adding a second import line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tab-configs.test.ts`
Expected: FAIL — `stripDupSuffix` is not exported from `./tab-configs`.

- [ ] **Step 3: Extract and export the function**

In `src/lib/tab-configs.ts`, replace:

```ts
function deriveCountryFromAccount(account: string | null | undefined): string {
  if (!account) return '';
  const cleaned = account.replace(/(?:\s+dup)+$/i, '');
  const parts = cleaned.split(/\s*\|\s*|\s+l\s+/);
  if (parts.length < 3) return '';
  return parts[parts.length - 1].trim();
}
```

with:

```ts
// Strips one or more trailing " dup" suffixes appended by handleDuplicate in
// BrandGroup.tsx when a row is duplicated to reuse the same account
// elsewhere. Shared by deriveCountryFromAccount below and the account
// platform-usage matching rule in scoreSummary.ts's
// computeAccountPlatformUsage, so the two can't drift out of sync on what
// counts as "the same account".
export function stripDupSuffix(account: string): string {
  return account.replace(/(?:\s+dup)+$/i, '');
}

function deriveCountryFromAccount(account: string | null | undefined): string {
  if (!account) return '';
  const cleaned = stripDupSuffix(account);
  const parts = cleaned.split(/\s*\|\s*|\s+l\s+/);
  if (parts.length < 3) return '';
  return parts[parts.length - 1].trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tab-configs.test.ts`
Expected: PASS (all tests in the file, including the pre-existing `getEntryCountry`/`getCountryForAccount` dup-suffix tests, which now exercise the same code path indirectly).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tab-configs.ts src/lib/tab-configs.test.ts
git commit -m "refactor: extract stripDupSuffix from deriveCountryFromAccount"
```

---

### Task 2: Add `computeAccountPlatformUsage`

**Files:**
- Modify: `src/lib/scoreSummary.ts`
- Test: `src/lib/scoreSummary.test.ts`

**Interfaces:**
- Consumes: `stripDupSuffix(account: string): string` from Task 1 (`src/lib/tab-configs.ts`); `PLATFORM_STATUS_KEYS: Record<Platform, readonly string[]>` and `pick(data, keys): string | null` (both already defined in `scoreSummary.ts`); `Entry` type (`src/types/entry.ts`).
- Produces: `export function computeAccountPlatformUsage(entries: Entry[]): Map<string, Record<Platform, number>>` — for later tasks: the returned map is keyed by `stripDupSuffix(data['Account'])`, and every value is a fully-populated `{ tp: number, ag: number, cg: number, wo: number }` (never a partial object, never missing a key). Entries with a blank/missing `Account` are excluded from the map entirely.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/scoreSummary.test.ts` (the file already has a `makeEntry` helper at the top — reuse it, don't redefine it):

```ts
describe('computeAccountPlatformUsage', () => {
  it('counts a row once per platform that has any non-blank status value', () => {
    const entries: Entry[] = [
      makeEntry('1', 'TP Brand Injection', { Account: '358 | BI TP | Germany', 'TP Review Status': 'Published' }),
      makeEntry('2', 'Rooster Partners', {
        Account: '358 | BI TP | Germany',
        'TP Review Status': 'Removed',
        'AG Review Status': 'Published',
        'CG Review Status': 'Pending',
      }),
    ];
    const result = computeAccountPlatformUsage(entries);
    expect(result.get('358 | BI TP | Germany')).toEqual({ tp: 2, ag: 1, cg: 1, wo: 0 });
  });

  it('matches accounts across different tabs and different Account/status column name variants', () => {
    const entries: Entry[] = [
      makeEntry('1', 'Wizard of Odds', { Account: '071 | Test | UK', 'WoO Review Status': 'Published' }),
      makeEntry('2', 'Hanan', { Account: '071 | Test | UK', 'Review Status': 'Published' }),
    ];
    const result = computeAccountPlatformUsage(entries);
    expect(result.get('071 | Test | UK')).toEqual({ tp: 1, ag: 0, cg: 0, wo: 1 });
  });

  it('treats an Account and its duplicated (" dup") copy as the same account', () => {
    const entries: Entry[] = [
      makeEntry('1', 'TP Brand Injection', { Account: '1182 | Test | Norway', 'TP Review Status': 'Published' }),
      makeEntry('2', 'TP Affiliate', { Account: '1182 | Test | Norway dup', 'TP Review Status': 'Published' }),
    ];
    const result = computeAccountPlatformUsage(entries);
    expect(result.size).toBe(1);
    expect(result.get('1182 | Test | Norway')).toEqual({ tp: 2, ag: 0, cg: 0, wo: 0 });
  });

  it('excludes entries with a blank or missing Account', () => {
    const entries: Entry[] = [
      makeEntry('1', 'TP Brand Injection', { Account: '', 'TP Review Status': 'Published' }),
      makeEntry('2', 'TP Brand Injection', { 'TP Review Status': 'Published' }),
    ];
    expect(computeAccountPlatformUsage(entries).size).toBe(0);
  });

  it('does not count a platform whose status keys are all blank', () => {
    const entries: Entry[] = [
      makeEntry('1', 'TP Brand Injection', { Account: '900 | Test | Spain', 'TP Review Status': '' }),
    ];
    const result = computeAccountPlatformUsage(entries);
    expect(result.get('900 | Test | Spain')).toEqual({ tp: 0, ag: 0, cg: 0, wo: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- scoreSummary.test.ts`
Expected: FAIL — `computeAccountPlatformUsage` is not exported from `./scoreSummary`.

- [ ] **Step 3: Implement**

Add the import at the top of `src/lib/scoreSummary.ts` (alongside the existing `platformRemovedKey` import from `removedPlatformBrands`):

```ts
import { stripDupSuffix } from './tab-configs';
```

Add the function near the other `compute*` functions (after `computeTabSuccessRates`):

```ts
// One row = one "use" of whichever platform(s) it has a non-blank status
// value for (Live, Removed, Refused, Pending — the actual outcome doesn't
// matter, only that the account was used), tallied per normalized Account
// text across every tab, not just one. Powers AccountUsageBadges
// (src/components/AccountUsageBadges.tsx), shown next to the Account cell
// in BrandGroup.tsx. Matching is exact-text (via stripDupSuffix) only — see
// stripDupSuffix in tab-configs.ts for why " dup" is the one thing safe to
// strip; no other normalization (case, whitespace, id-only) is applied.
export function computeAccountPlatformUsage(entries: Entry[]): Map<string, Record<Platform, number>> {
  const platforms = Object.keys(PLATFORM_STATUS_KEYS) as Platform[];
  const result = new Map<string, Record<Platform, number>>();

  for (const e of entries) {
    const d = e.data ?? {};
    const raw = d['Account'];
    if (!raw) continue;
    const account = stripDupSuffix(raw);
    if (!account) continue;

    let counts = result.get(account);
    if (!counts) {
      counts = { tp: 0, ag: 0, cg: 0, wo: 0 };
      result.set(account, counts);
    }
    for (const p of platforms) {
      if (pick(d, PLATFORM_STATUS_KEYS[p])) counts[p] += 1;
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- scoreSummary.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoreSummary.ts src/lib/scoreSummary.test.ts
git commit -m "feat: add computeAccountPlatformUsage for dashboard-wide account tallies"
```

---

### Task 3: `AccountUsageBadges` component

**Files:**
- Create: `src/components/AccountUsageBadges.tsx`

**Interfaces:**
- Consumes: `PLATFORM_STATUS_KEYS`, `PLATFORM_LABEL`, `type Platform` from `src/lib/scoreSummary.ts`; `PLATFORM_FAVICON` from `src/lib/removedPlatformBrands.ts`.
- Produces: `export default function AccountUsageBadges({ counts }: { counts: Record<Platform, number> | undefined }): JSX.Element | null` — for Task 4: pass it the exact per-account `Record<Platform, number>` value from the map `computeAccountPlatformUsage` returns (or `undefined` if this account has no entry in the map). Renders `null` when `counts` is `undefined` or every platform count is `0`.

No test file for this task — this codebase has no component (`.tsx`) tests (only `.ts` library-function tests exist across the whole `src/` tree), so this component is covered by the `npm run build` type-check in this task's Step 2 and by live verification in Task 5.

- [ ] **Step 1: Write the component**

```tsx
import { PLATFORM_STATUS_KEYS, PLATFORM_LABEL, type Platform } from '../lib/scoreSummary';
import { PLATFORM_FAVICON } from '../lib/removedPlatformBrands';

const PLATFORM_ORDER = Object.keys(PLATFORM_STATUS_KEYS) as Platform[];

// One favicon-plus-count badge per platform this account has been used on,
// anywhere in the dashboard (see computeAccountPlatformUsage in
// scoreSummary.ts) — appended after the Account cell's own text in
// BrandGroup.tsx. A platform with zero uses renders no badge at all; an
// account with zero total uses (or not present in the usage map yet, e.g.
// before the dashboard-wide fetch resolves) renders nothing.
export default function AccountUsageBadges({ counts }: { counts: Record<Platform, number> | undefined }) {
  if (!counts) return null;
  const active = PLATFORM_ORDER.filter((p) => counts[p] > 0);
  if (active.length === 0) return null;

  return (
    <span className="ml-1.5 inline-flex items-center gap-1 align-middle">
      {active.map((p) => (
        <span
          key={p}
          title={`Used ${counts[p]} time${counts[p] === 1 ? '' : 's'} on ${PLATFORM_LABEL[p]} across the dashboard`}
          className="relative inline-flex size-4 shrink-0 items-center justify-center"
        >
          <img
            src={PLATFORM_FAVICON[p]}
            alt={PLATFORM_LABEL[p]}
            className="size-4 rounded-sm"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <span className="absolute -right-1.5 -bottom-1.5 flex size-3 items-center justify-center rounded-full bg-slate-700 text-[8px] font-bold leading-none text-white ring-1 ring-white">
            {counts[p]}
          </span>
        </span>
      ))}
    </span>
  );
}
```

- [ ] **Step 2: Verify it type-checks and builds**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (the component isn't imported anywhere yet, so this only confirms the file itself is valid — Task 4 wires it in).

- [ ] **Step 3: Commit**

```bash
git add src/components/AccountUsageBadges.tsx
git commit -m "feat: add AccountUsageBadges component"
```

---

### Task 4: Wire into BrandGroup.tsx

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `computeAccountPlatformUsage` (Task 2, `src/lib/scoreSummary.ts`); `stripDupSuffix` (Task 1, `src/lib/tab-configs.ts`); default export `AccountUsageBadges` (Task 3, `src/components/AccountUsageBadges.tsx`); `fetchAllEntries(tabs?: readonly string[]): Promise<Entry[]>` (already exists in `src/lib/queries.ts:268`, called here with no argument for a dashboard-wide fetch).

- [ ] **Step 1: Add imports**

In `src/pages/BrandGroup.tsx`, update these existing import lines:

Line 15 (queries import) — add `fetchAllEntries` to the list:

```ts
import { fetchRawEntriesByTab, fetchTabHeaders, updateEntryData, triggerStatusCheck, triggerAgStatusCheck, triggerCgStatusCheck, triggerWoStatusCheck, insertEntry, deleteEntries, moveEntryToTab, fetchRemovedPlatformBrands, setBrandPlatformRemoved, fetchAllEntries, type StatusCheckScope } from '../lib/queries';
```

Line 18 (tab-configs import) — add `stripDupSuffix` to the list:

```ts
import { getTabColumns, getColLabel, COLUMN_LABELS, TAB_DEFAULT_BRAND, getTabPlatforms, getTabSequence, getTabSequenceCol, hasMultiPlatform, getBrandTpUrl, getEntryCountry, getCountryForAccount, getBrandGroup, BRAND_COLS, TABLE_HIDDEN_COLS, PLATFORM_SCORE_COLS, stripDupSuffix } from '../lib/tab-configs';
```

Line 20 (scoreSummary import) — add `computeAccountPlatformUsage`:

```ts
import { parseScore, PLATFORM_MAX_SCORE, computeAccountPlatformUsage, type Platform } from '../lib/scoreSummary';
```

Add a new import near the other component imports (after `PlatformRemovedBadge` on line 14):

```ts
import AccountUsageBadges from '../components/AccountUsageBadges';
```

- [ ] **Step 2: Add state**

In the state declarations around line 723 (right after `removedPlatformBrandRows`), add:

```ts
const [accountUsage, setAccountUsage] = useState<Map<string, Record<Platform, number>>>(new Map());
```

- [ ] **Step 3: Add the dashboard-wide fetch effect**

Right after the existing `fetchRemovedPlatformBrands` effect (`src/pages/BrandGroup.tsx:820-826`):

```ts
useEffect(() => {
  let canceled = false;
  fetchRemovedPlatformBrands()
    .then((rows) => { if (!canceled) setRemovedPlatformBrandRows(rows); })
    .catch(() => { /* badge is decorative — a failed fetch just means no badges render */ });
  return () => { canceled = true; };
}, [reloadSeq]);
```

add:

```ts
useEffect(() => {
  let canceled = false;
  fetchAllEntries()
    .then((all) => { if (!canceled) setAccountUsage(computeAccountPlatformUsage(all)); })
    .catch(() => { /* badges are decorative — a failed fetch just means no badges render */ });
  return () => { canceled = true; };
}, [reloadSeq]);
```

This deliberately mirrors the sibling effect exactly: same `reloadSeq` dependency (dashboard-wide data, so a tab switch alone shouldn't re-trigger it, only an actual edit/delete/duplicate via `reloadRef`), same cancellation-flag pattern, same fail-open `.catch()`.

- [ ] **Step 4: Render badges in the approved-user Account cell branch**

At `src/pages/BrandGroup.tsx:2327-2338`, change:

```tsx
                      // Account column: click opens the full edit modal
                      if ((h === 'Account' || h === 'Account Name') && isApproved) {
                        return (
                          <td
                            key={h}
                            className={`px-[10px] py-2 whitespace-nowrap cursor-pointer hover:bg-blue-50 select-none sticky left-8 z-10 ${isRowSelected ? 'bg-blue-50/60' : 'bg-white'}`}
                            onClick={() => setEditEntry(entry)}
                          >
                            <CellValue header={h} value={entry.data[h] ?? null} rowData={entry.data} tab={decodedTab} />
                          </td>
                        );
                      }
```

to:

```tsx
                      // Account column: click opens the full edit modal
                      if ((h === 'Account' || h === 'Account Name') && isApproved) {
                        return (
                          <td
                            key={h}
                            className={`px-[10px] py-2 whitespace-nowrap cursor-pointer hover:bg-blue-50 select-none sticky left-8 z-10 ${isRowSelected ? 'bg-blue-50/60' : 'bg-white'}`}
                            onClick={() => setEditEntry(entry)}
                          >
                            <CellValue header={h} value={entry.data[h] ?? null} rowData={entry.data} tab={decodedTab} />
                            {h === 'Account' && (
                              <AccountUsageBadges counts={accountUsage.get(stripDupSuffix(entry.data['Account'] ?? ''))} />
                            )}
                          </td>
                        );
                      }
```

- [ ] **Step 5: Render badges in the fallback (non-approved) Account cell branch**

At `src/pages/BrandGroup.tsx:2466-2479`, change:

```tsx
                      return (
                        <td key={h} className={`px-[10px] py-2 ${(h === 'Account' || h === 'Account Name') ? `whitespace-nowrap sticky left-0 z-10 group-hover:bg-blue-50 ${isRowSelected ? 'bg-blue-50/60' : 'bg-white'}` : ''}`}>
                          <CellValue
                            header={h}
                            value={
                              h === 'Country'
                                ? (getEntryCountry(entry.data, decodedTab) || null)
                                : entry.data[h] ?? (h === brandCol ? (TAB_DEFAULT_BRAND[decodedTab] ?? null) : null)
                            }
                            rowData={entry.data}
                            tab={decodedTab}
                          />
                        </td>
                      );
```

to:

```tsx
                      return (
                        <td key={h} className={`px-[10px] py-2 ${(h === 'Account' || h === 'Account Name') ? `whitespace-nowrap sticky left-0 z-10 group-hover:bg-blue-50 ${isRowSelected ? 'bg-blue-50/60' : 'bg-white'}` : ''}`}>
                          <CellValue
                            header={h}
                            value={
                              h === 'Country'
                                ? (getEntryCountry(entry.data, decodedTab) || null)
                                : entry.data[h] ?? (h === brandCol ? (TAB_DEFAULT_BRAND[decodedTab] ?? null) : null)
                            }
                            rowData={entry.data}
                            tab={decodedTab}
                          />
                          {h === 'Account' && (
                            <AccountUsageBadges counts={accountUsage.get(stripDupSuffix(entry.data['Account'] ?? ''))} />
                          )}
                        </td>
                      );
```

- [ ] **Step 6: Run the full test suite and build**

Run: `npm test`
Expected: PASS (all tests, including the new ones from Tasks 1-2).

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: show per-platform usage badges on the Account cell"
```

---

### Task 5: Live verification

**Files:** none (no code changes — verification only).

- [ ] **Step 1: Live-verify against real Supabase data**

Using the Playwright browser tooling available in this session, sign in to the dashboard and navigate to a brand tab known to have reused accounts (e.g. via the "duplicate row" flow). Confirm:
- An account used on multiple platforms shows one badge per platform actually used, in TP → AG → CG → WO order, with the correct real favicon per platform and the correct count.
- A freshly duplicated row (same Account text plus `" dup"`) shows the same badge counts as its source row, and both counts include each other (i.e. duplicating bumps the count on the original row too, once the page reloads).
- The `Account Name` column (a different field) shows no badges.
- Clicking anywhere in the Account cell, including on a badge, still opens the Edit Entry modal — badges are not intercepting the click.
- A brand tab with an account that has never been duplicated/reused shows exactly one badge (for whichever single platform that one row uses), not zero and not multiple.

If Playwright/browser tooling or valid dashboard credentials are unavailable in this environment, note that explicitly rather than skipping silently — do not mark this step done without one or the other actually being checked.

- [ ] **Step 2: Record the outcome**

Append a dated entry to `docs/task-history.md` (per this repo's standing PMS workflow rule) summarizing what shipped and the result of the live verification (pass, or what was skipped and why).
