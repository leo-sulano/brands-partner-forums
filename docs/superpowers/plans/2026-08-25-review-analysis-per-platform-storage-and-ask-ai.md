# Per-Platform Review Analysis Storage + Ask AI Aggregation Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the pre-existing bug where `entries.ai_review_analysis` is a single shared slot per entry instead of one per platform (causing wrong/mislabeled cached analyses on multi-platform tabs), by moving storage to a new `entry_review_analyses` table keyed by `(entry_id, platform)`; then add a new Ask AI tool, `get_review_analyses`, so management can ask conversational questions about analyzed entries (by agent, brand, platform, or outcome) instead of opening entries one at a time.

**Architecture:** New table + RLS mirroring this codebase's existing per-platform side-table pattern (`brand_platform_pause`). `queries.ts` gains a fetch + a re-scoped `saveReviewAnalysis`. Three frontend files (`ReviewRemovalAssessment.tsx`, `EditEntryModal.tsx`, `BrandGroup.tsx`) are re-wired to pass the per-platform cached value down instead of reading a shared field off `Entry`. A new Ask AI tool reuses existing helpers in `tools.ts` (`fetchRemovedPlatformBrandSet`, `fetchArchivedTabNameSet`, `fetchPausedTabNameSet`, `resolveAgentLabels`) — no new duplicated logic.

**Tech Stack:** Vite 6 · React 19 · TypeScript · Supabase (Postgres + Edge Functions) · Vitest · Deno test.

**Spec:** `docs/superpowers/specs/2026-08-25-review-analysis-per-platform-storage-and-ask-ai-design.md`

## Global Constraints

- Preserve the 9 existing cached analyses on single-platform tabs (TP Brand Injection ×7, TP Affiliate ×2) as `platform = 'tp'`; drop the 2 ambiguous ones (Hanan, Rooster Partners) — both are freely re-analyzable.
- `entry_review_analyses` gets the exact same 4-policy RLS shape as `brand_platform_pause` (anyone reads; approved users insert/update/delete).
- Store the full `RemovalEvidence` bundle (`evidence jsonb not null`), not just the two hard-signal booleans — free-form and future-proof, the frontend already computes it in full.
- The Ask AI tool's coverage is sparse and organic by design — its description must explicitly say an empty/small result means "not yet analyzed," never "no issues found." No batch/background analysis process is built.
- The tool must apply the same archived/paused-tab and `removed_platform_brands` exclusions every other data-returning tool in `tools.ts` already applies, and must resolve "agent" via the existing `resolveAgentLabels` helper — never a new, independently-computed agent lookup.
- No new frontend page or component — only the storage-scoping fix (which corrects existing modal behavior) and the new backend tool.

---

### Task 1: Migration — `entry_review_analyses` table

**Files:**
- Create: `supabase/migrations/20260825120000_add_entry_review_analyses.sql`

**Interfaces:**
- Produces: the `entry_review_analyses` table (columns: `entry_id uuid`, `tab text`, `platform text`, `analysis jsonb`, `evidence jsonb`, `hash text`, `model text`, `analyzed_at timestamptz`, primary key `(entry_id, platform)`) — consumed by Task 2's `queries.ts` functions and Task 7's Ask AI tool.
- Drops `entries.ai_review_analysis`, `ai_review_analysis_hash`, `ai_review_analysis_model`, `ai_review_analysis_at` — consumed by Task 3 (`src/types/entry.ts` must no longer declare these fields).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260825120000_add_entry_review_analyses.sql`:

```sql
-- Fixes a real storage bug in the AI Review Removal Assessment feature (Task
-- 225/262/263): entries.ai_review_analysis was a single shared slot per entry
-- row, not one per platform. On a multi-platform tab (Rooster Partners,
-- Revolution Casino, SilverPlay, Hanan), analyzing one platform's review
-- overwrote any other platform's cached analysis for that same entry, and the
-- other platform's section in EditEntryModal showed the wrong cached result
-- mislabeled "Outdated" (a hash mismatch, not "not yet analyzed").
-- docs/superpowers/specs/2026-08-25-review-analysis-per-platform-storage-and-ask-ai-design.md

create table public.entry_review_analyses (
  entry_id     uuid not null references public.entries(id) on delete cascade,
  tab          text not null,
  platform     text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  analysis     jsonb not null,
  evidence     jsonb not null,
  hash         text not null,
  model        text not null,
  analyzed_at  timestamptz not null default now(),
  primary key (entry_id, platform)
);

alter table public.entry_review_analyses enable row level security;

create policy "anyone can read entry_review_analyses"
  on public.entry_review_analyses for select using (true);
create policy "approved users can insert entry_review_analyses"
  on public.entry_review_analyses for insert with check (public.is_approved());
create policy "approved users can update entry_review_analyses"
  on public.entry_review_analyses for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete entry_review_analyses"
  on public.entry_review_analyses for delete using (public.is_approved());

-- Preserve the 9 existing cached analyses on tabs where the platform is
-- unambiguous (these tabs never render an AG/CG section, so the existing
-- single-slot column can only ever have been for 'tp'). The 2 rows on
-- multi-platform tabs (Hanan, Rooster Partners) are genuinely ambiguous —
-- deliberately not migrated, and simply re-analyzable via the existing
-- "Analyze Review" button.
insert into public.entry_review_analyses (entry_id, tab, platform, analysis, evidence, hash, model, analyzed_at)
select id, tab, 'tp',
       ai_review_analysis,
       '{}'::jsonb,
       ai_review_analysis_hash,
       ai_review_analysis_model,
       ai_review_analysis_at
from public.entries
where ai_review_analysis is not null
  and tab in ('TP Brand Injection', 'TP Affiliate');

alter table public.entries
  drop column ai_review_analysis,
  drop column ai_review_analysis_hash,
  drop column ai_review_analysis_model,
  drop column ai_review_analysis_at;
```

- [ ] **Step 2: Verify the SQL is syntactically well-formed**

Run: `supabase db diff --linked -f entry_review_analyses_check` (this generates a diff against the linked project without applying anything — if the new migration file has a syntax error, this command fails with a parse error). If `supabase db diff` isn't available/usable in this environment, instead carefully re-read the file once end-to-end for balanced parens/quotes and correct column/table names matching every other migration file's style in `supabase/migrations/`.

Expected: no syntax error reported (or, if verified by re-reading, no formatting inconsistency vs. `supabase/migrations/20260801090000_add_schedule_platform_and_pause.sql`'s style).

Do **not** run `supabase db push` in this task — applying the migration to the live database is a deliberate, separate deploy step at the end of this plan (see the final task), not part of any individual task's verification.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260825120000_add_entry_review_analyses.sql
git commit -m "feat: add entry_review_analyses table, migrate unambiguous cached analyses"
```

---

### Task 2: `src/lib/queries.ts` — per-platform fetch + save

**Files:**
- Modify: `src/lib/queries.ts`
- Modify: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: `entry_review_analyses` table (Task 1), `RemovalEvidence` type (`src/lib/reviewRemovalEvidence.ts`, already exists), `Platform` type (already imported in this file from `./removedPlatformBrands.ts`).
- Produces: `EntryReviewAnalysisRow` interface, `fetchEntryReviewAnalyses(tab, client?)`, revised `saveReviewAnalysis(entryId, tab, platform, analysis, evidence, hash, model, client?)` — consumed by Task 4 (component) and Task 6 (`BrandGroup.tsx`).

- [ ] **Step 1: Write the failing tests**

In `src/lib/queries.test.ts`, add this import (alongside the existing `import type { ReviewRemovalAssessmentResult } from './reviewRemovalAssessment.ts';` near line 63):

```ts
import type { RemovalEvidence } from './reviewRemovalEvidence.ts';
```

Add `fetchEntryReviewAnalyses` and `EntryReviewAnalysisRow` to the existing named import block from `'./queries'` (the block starting `import { fetchBrandSchedule, ...}` near line 22) — add `fetchEntryReviewAnalyses` to that list (no type import needed there; `EntryReviewAnalysisRow` isn't referenced by name in the tests below).

Replace the existing `describe('saveReviewAnalysis', ...)` block (currently around line 858-883, using `SAMPLE_ANALYSIS`/`singletonFrom`) with:

```ts
const SAMPLE_ANALYSIS = { overall_result: 'no_clear_removal_reason' } as unknown as ReviewRemovalAssessmentResult;
const SAMPLE_EVIDENCE = {
  crossEntry: { sameProxyCount: 0, sameProxyRemovedCount: 0, sameProxySameCountryCount: 0, exampleBrands: [] },
  brandHistory: { totalReviews: 0, liveCount: 0, removedCount: 0, successRatePct: null },
  crossPlatform: { applicable: false },
  hardSignals: { duplicateReviewTextFound: false, proxyTiedToOtherRemoval: false },
} as unknown as RemovalEvidence;

describe('saveReviewAnalysis', () => {
  it('upserts into entry_review_analyses keyed by entry_id and platform', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const fakeFrom = vi.fn().mockReturnValue({ upsert });

    await saveReviewAnalysis('entry-1', 'Rooster Partners', 'tp', SAMPLE_ANALYSIS, SAMPLE_EVIDENCE, 'hash-abc', 'gpt-4o', { from: fakeFrom } as any);

    expect(fakeFrom).toHaveBeenCalledWith('entry_review_analyses');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_id: 'entry-1',
        tab: 'Rooster Partners',
        platform: 'tp',
        analysis: SAMPLE_ANALYSIS,
        evidence: SAMPLE_EVIDENCE,
        hash: 'hash-abc',
        model: 'gpt-4o',
      }),
      { onConflict: 'entry_id,platform' },
    );
  });

  it('throws if the upsert fails', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: new Error('db down') });
    const fakeFrom = vi.fn().mockReturnValue({ upsert });

    await expect(
      saveReviewAnalysis('entry-1', 'Rooster Partners', 'tp', SAMPLE_ANALYSIS, SAMPLE_EVIDENCE, 'hash-abc', 'gpt-4o', { from: fakeFrom } as any),
    ).rejects.toThrow('db down');
  });

  it('falls back to the singleton client when none is passed', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    singletonFrom.mockReturnValue({ upsert });

    await saveReviewAnalysis('entry-1', 'Rooster Partners', 'ag', SAMPLE_ANALYSIS, SAMPLE_EVIDENCE, 'hash-abc', 'gpt-4o');

    expect(singletonFrom).toHaveBeenCalledWith('entry_review_analyses');
  });
});

describe('fetchEntryReviewAnalyses', () => {
  it('uses the passed-in client and selects the expected columns, scoped to the tab', async () => {
    const selectSpy = vi.fn().mockReturnValue({
      eq: (key: string, value: string) => ({
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: key === 'tab' && value === 'Rooster Partners' ? [{ entry_id: 'e1', platform: 'tp', analysis: SAMPLE_ANALYSIS, evidence: SAMPLE_EVIDENCE, hash: 'h', model: 'gpt-4o', analyzed_at: '2026-08-25T00:00:00Z' }] : [], error: null }),
      }),
    });
    const fakeFrom = vi.fn().mockReturnValue({ select: selectSpy });

    const rows = await fetchEntryReviewAnalyses('Rooster Partners', { from: fakeFrom } as any);

    expect(fakeFrom).toHaveBeenCalledWith('entry_review_analyses');
    expect(selectSpy).toHaveBeenCalledWith('entry_id, platform, analysis, evidence, hash, model, analyzed_at');
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_id).toBe('e1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- queries.test.ts -t "saveReviewAnalysis|fetchEntryReviewAnalyses"`
Expected: FAIL — `fetchEntryReviewAnalyses` is not exported yet, and `saveReviewAnalysis`'s call signature doesn't match (still takes the old 5-argument, no-client shape).

- [ ] **Step 3: Update `src/lib/queries.ts`**

Add this import near the top of the file, alongside the existing `import type { ReviewRemovalAssessmentResult } from './reviewRemovalAssessment.ts';`:

```ts
import type { RemovalEvidence } from './reviewRemovalEvidence.ts';
```

Replace the existing `saveReviewAnalysis` function (currently lines ~860-882) with:

```ts
export interface EntryReviewAnalysisRow {
  entry_id: string;
  platform: Platform;
  analysis: ReviewRemovalAssessmentResult;
  evidence: RemovalEvidence;
  hash: string;
  model: string;
  analyzed_at: string;
}

// Caches a generated AI Review Removal Assessment, one row per (entry, platform) — a
// multi-platform entry (Rooster Partners, Revolution Casino, SilverPlay, Hanan) can have
// independent cached analyses for TP/AG/CG without one overwriting another. Deliberately
// not routed through logChange/edit_log — this is a derived/cached artifact regenerated
// from the entry's own existing fields, not a user edit to business data.
export async function saveReviewAnalysis(
  entryId: string,
  tab: string,
  platform: Platform,
  analysis: ReviewRemovalAssessmentResult,
  evidence: RemovalEvidence,
  hash: string,
  model: string,
  client: SupabaseClient = supabase,
): Promise<void> {
  const { error } = await client
    .from('entry_review_analyses')
    .upsert(
      { entry_id: entryId, tab, platform, analysis, evidence, hash, model, analyzed_at: new Date().toISOString() },
      { onConflict: 'entry_id,platform' },
    );
  if (error) throw error;
  invalidateTabCache(tab);
}

export async function fetchEntryReviewAnalyses(tab: string, client: SupabaseClient = supabase): Promise<EntryReviewAnalysisRow[]> {
  const { data, error } = await client
    .from('entry_review_analyses')
    .select('entry_id, platform, analysis, evidence, hash, model, analyzed_at')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as EntryReviewAnalysisRow[];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- queries.test.ts`
Expected: PASS — the new/updated tests pass, and no other test in this file (which has many describe blocks) regresses.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: store review analyses per (entry, platform) instead of one shared slot"
```

---

### Task 3: Type cleanup + key helper

**Files:**
- Modify: `src/types/entry.ts`
- Modify: `src/lib/reviewRemovalAssessment.ts`
- Modify: `src/lib/reviewRemovalAssessment.test.ts`

**Interfaces:**
- Produces: `entryReviewAnalysisKey(entryId: string, platform: Platform): string` — consumed by Task 6 (`BrandGroup.tsx`, to build the lookup map) and Task 5 (`EditEntryModal.tsx`, to look up this entry+platform's cached row).
- Removes the 4 `ai_review_analysis*` fields from `Entry` — this is expected to make `src/components/ReviewRemovalAssessment.tsx` fail to compile until Task 4 fixes it; that is Task 4's job, not this task's.

- [ ] **Step 1: Remove the old fields from `src/types/entry.ts`**

Replace the `Entry` interface (currently):

```ts
export interface Entry {
  id: string;
  tab: string;
  sheet_row_id: string;
  data: Record<string, string | null>;
  updated_at: string;
  last_edited_by: 'dashboard' | 'sheet';
  last_sync_tag: string | null;
  ai_review_analysis?: Record<string, unknown> | null;
  ai_review_analysis_hash?: string | null;
  ai_review_analysis_model?: string | null;
  ai_review_analysis_at?: string | null;
}
```

with:

```ts
export interface Entry {
  id: string;
  tab: string;
  sheet_row_id: string;
  data: Record<string, string | null>;
  updated_at: string;
  last_edited_by: 'dashboard' | 'sheet';
  last_sync_tag: string | null;
}
```

- [ ] **Step 2: Write the failing test for the new key helper**

In `src/lib/reviewRemovalAssessment.test.ts`, add (near the top-level describe blocks, after the existing imports):

```ts
import { entryReviewAnalysisKey } from './reviewRemovalAssessment';
```

(add `entryReviewAnalysisKey` to the existing named-import list from `'./reviewRemovalAssessment'` if there already is one in this file, rather than a separate import statement — check the file's current import block first.)

Add this test:

```ts
describe('entryReviewAnalysisKey', () => {
  it('combines entryId and platform with a stable separator', () => {
    expect(entryReviewAnalysisKey('entry-1', 'tp')).toBe('entry-1::tp');
  });

  it('produces distinct keys for the same entry across different platforms', () => {
    const tp = entryReviewAnalysisKey('entry-1', 'tp');
    const ag = entryReviewAnalysisKey('entry-1', 'ag');
    expect(tp).not.toBe(ag);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- reviewRemovalAssessment.test.ts -t "entryReviewAnalysisKey"`
Expected: FAIL — `entryReviewAnalysisKey` is not exported yet.

- [ ] **Step 4: Add the helper to `src/lib/reviewRemovalAssessment.ts`**

Add this function anywhere among the other small exported helpers in the file (e.g. directly after the `sha256Hex` helper or near `hashAssessmentInput`):

```ts
export function entryReviewAnalysisKey(entryId: string, platform: Platform): string {
  return `${entryId}::${platform}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- reviewRemovalAssessment.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/entry.ts src/lib/reviewRemovalAssessment.ts src/lib/reviewRemovalAssessment.test.ts
git commit -m "feat: remove single-slot analysis fields from Entry, add entryReviewAnalysisKey helper"
```

---

### Task 4: `src/components/ReviewRemovalAssessment.tsx` — read/write per-platform

**Files:**
- Modify: `src/components/ReviewRemovalAssessment.tsx`

**Interfaces:**
- Consumes: revised `saveReviewAnalysis` (Task 2, now `(entryId, tab, platform, analysis, evidence, hash, model)`).
- Produces: two new required props, `cachedAnalysis: ReviewRemovalAssessmentResult | null` and `cachedHash: string | null` — consumed by Task 5 (`EditEntryModal.tsx`).

This task is expected to fix the compile break Task 3 introduced (this file currently reads `entry.ai_review_analysis`/`entry.ai_review_analysis_hash`, which no longer exist on `Entry`).

- [ ] **Step 1: Update `Props` and the two `useState` initializers**

Replace the `Props` interface:

```ts
interface Props {
  entry: Entry;
  tab: string;
  platform: Platform;
  status: string;
  reviewText: string;
  headers: string[];
  fields: Record<string, string>;
  tabEntries: Entry[];
  brand: string;
  cachedAnalysis: ReviewRemovalAssessmentResult | null;
  cachedHash: string | null;
  disabled?: boolean;
}
```

Update the component signature and the two `useState` initializers:

```ts
export default function ReviewRemovalAssessment({ entry, tab, platform, status, reviewText, headers, fields, tabEntries, brand, cachedAnalysis, cachedHash, disabled }: Props) {
  const [result, setResult] = useState<ReviewRemovalAssessmentResult | null>(
    isValidAssessmentResult(cachedAnalysis) ? cachedAnalysis : null,
  );
  // Tracked as state (not read directly off a prop on every render) so a
  // successful analyze/re-analyze can update the "last saved" baseline
  // without mutating the prop — React props are treated as read-only.
  const [savedHash, setSavedHash] = useState<string | null>(cachedHash ?? null);
```

(the rest of the component body below these two lines — `currentHash`, `loading`, `error`, `expanded`, `behavioralFields`, `evidence` — is unchanged.)

- [ ] **Step 2: Update `handleAnalyze`'s `saveReviewAnalysis` call**

Change:

```ts
      await saveReviewAnalysis(entry.id, tab, analysis, hash, model);
```

to:

```ts
      await saveReviewAnalysis(entry.id, tab, platform, analysis, evidence, hash, model);
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: this file now compiles clean, but `EditEntryModal.tsx` (Task 5's file) will show 3 "missing required prop" errors (`cachedAnalysis`/`cachedHash`) for its 3 `<ReviewRemovalAssessment />` call sites — that is expected and correct, Task 5 fixes those next. Confirm the errors are confined to `EditEntryModal.tsx` and there are no errors reported for `ReviewRemovalAssessment.tsx` itself.

- [ ] **Step 4: Commit**

```bash
git add src/components/ReviewRemovalAssessment.tsx
git commit -m "feat: read/write cached review analysis via per-platform props instead of entry.ai_review_analysis"
```

---

### Task 5: `src/components/EditEntryModal.tsx` — look up the per-platform cached row

**Files:**
- Modify: `src/components/EditEntryModal.tsx`

**Interfaces:**
- Consumes: `entryReviewAnalysisKey` (Task 3), `EntryReviewAnalysisRow` type (Task 2), `ReviewRemovalAssessment`'s new `cachedAnalysis`/`cachedHash` props (Task 4).
- Produces: a new optional prop `entryReviewAnalyses?: Map<string, EntryReviewAnalysisRow>` — consumed by Task 6 (`BrandGroup.tsx`).

This task is expected to fix the 3 compile errors Task 4 introduced.

- [ ] **Step 1: Add the new import and prop**

Add to the existing import from `'../lib/reviewRemovalAssessment'` if one exists in this file already, otherwise add a new import line:

```ts
import { entryReviewAnalysisKey } from '../lib/reviewRemovalAssessment';
import type { EntryReviewAnalysisRow } from '../lib/queries';
```

Add the new prop to the `Props` interface (after the existing `tabEntries?: Entry[];` line):

```ts
  tabEntries?: Entry[];
  entryReviewAnalyses?: Map<string, EntryReviewAnalysisRow>;
```

Add `entryReviewAnalyses` to the component's destructured parameter list (after `tabEntries`):

```ts
export default function EditEntryModal({ entry, headers, onClose, onSave, currentTab, availableBrands, brandCol, brandProfiles, tabEntries, entryReviewAnalyses, initialRemovedPlatforms, initialRemovedPlatformDates, initialOverrides }: Props) {
```

- [ ] **Step 2: Resolve the cached row per call site**

Add this helper right after the existing `const brand = brandCol ? (fields[brandCol] || entry.data[brandCol] || '') : '';` line:

```ts
  const cachedFor = (platform: Platform) => entryReviewAnalyses?.get(entryReviewAnalysisKey(entry.id, platform));
```

At the TP/WO call site, add two props (the `activePlatform` variable already exists in that block):

```tsx
                    <ReviewRemovalAssessment
                      entry={entry}
                      tab={entry.tab}
                      platform={activePlatform}
                      status={pick(fields, PLATFORM_STATUS_KEYS[activePlatform]) ?? ''}
                      reviewText={fields[reviewTextKey] ?? ''}
                      headers={headers}
                      fields={fields}
                      tabEntries={tabEntries ?? EMPTY_ENTRIES}
                      brand={brand}
                      cachedAnalysis={cachedFor(activePlatform)?.analysis ?? null}
                      cachedHash={cachedFor(activePlatform)?.hash ?? null}
                      disabled={saving}
                    />
```

At the AG call site:

```tsx
                  <ReviewRemovalAssessment
                    entry={entry}
                    tab={entry.tab}
                    platform="ag"
                    status={pick(fields, PLATFORM_STATUS_KEYS.ag) ?? ''}
                    reviewText={fields['AG Review Text'] ?? ''}
                    headers={headers}
                    fields={fields}
                    tabEntries={tabEntries ?? EMPTY_ENTRIES}
                    brand={brand}
                    cachedAnalysis={cachedFor('ag')?.analysis ?? null}
                    cachedHash={cachedFor('ag')?.hash ?? null}
                    disabled={saving}
                  />
```

At the CG call site:

```tsx
                  <ReviewRemovalAssessment
                    entry={entry}
                    tab={entry.tab}
                    platform="cg"
                    status={pick(fields, PLATFORM_STATUS_KEYS.cg) ?? ''}
                    reviewText={fields['CG Review Text'] ?? ''}
                    headers={headers}
                    fields={fields}
                    tabEntries={tabEntries ?? EMPTY_ENTRIES}
                    brand={brand}
                    cachedAnalysis={cachedFor('cg')?.analysis ?? null}
                    cachedHash={cachedFor('cg')?.hash ?? null}
                    disabled={saving}
                  />
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: this file's own errors are resolved. `src/pages/BrandGroup.tsx` will not error (its `<EditEntryModal ... />` invocation doesn't yet pass `entryReviewAnalyses`, but the prop is optional, so this compiles — Task 6 wires the real data next).

- [ ] **Step 4: Commit**

```bash
git add src/components/EditEntryModal.tsx
git commit -m "feat: resolve per-platform cached review analysis in EditEntryModal"
```

---

### Task 6: `src/pages/BrandGroup.tsx` — fetch and pass the per-tab analyses map

**Files:**
- Modify: `src/pages/BrandGroup.tsx`

**Interfaces:**
- Consumes: `fetchEntryReviewAnalyses` (Task 2), `entryReviewAnalysisKey` (Task 3), `EditEntryModal`'s new `entryReviewAnalyses` prop (Task 5).

After this task, the whole project builds cleanly again — this is the last task in the frontend chain.

- [ ] **Step 1: Add the import and state**

Add `fetchEntryReviewAnalyses` and `entryReviewAnalysisKey` to this file's existing imports (extend the `from '../lib/queries'` import list, and add a new import line for `entryReviewAnalysisKey`):

```ts
import { fetchRawEntriesByTab, fetchTabHeaders, updateEntryData, triggerStatusCheck, triggerAgStatusCheck, triggerCgStatusCheck, triggerWoStatusCheck, insertEntry, deleteEntries, moveEntryToTab, fetchRemovedPlatformBrands, setBrandPlatformRemoved, fetchBrandPlatformOverrides, setBrandPlatformOverride, clearBrandPlatformOverride, fetchAllEntries, archiveTab, fetchEntryReviewAnalyses, type StatusCheckScope, type EntryReviewAnalysisRow } from '../lib/queries';
import { entryReviewAnalysisKey } from '../lib/reviewRemovalAssessment';
```

Add new state near the existing `const [entries, setEntries] = useState<Entry[]>([]);` line:

```ts
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entryReviewAnalyses, setEntryReviewAnalyses] = useState<Map<string, EntryReviewAnalysisRow>>(new Map());
```

- [ ] **Step 2: Fetch it alongside entries/headers**

Change:

```ts
        const [rawEntries, tabHeaders] = await Promise.all([
          fetchRawEntriesByTab(decodedTab),
          fetchTabHeaders(decodedTab),
        ]);
```

to:

```ts
        const [rawEntries, tabHeaders, analysisRows] = await Promise.all([
          fetchRawEntriesByTab(decodedTab),
          fetchTabHeaders(decodedTab),
          fetchEntryReviewAnalyses(decodedTab),
        ]);
```

Then, in the same async block, after the existing `setEntries(realEntries);` line, add:

```ts
        setEntryReviewAnalyses(new Map(analysisRows.map((r) => [entryReviewAnalysisKey(r.entry_id, r.platform), r])));
```

- [ ] **Step 3: Pass it to `EditEntryModal`**

Add one line to the existing `<EditEntryModal ... />` invocation (right after `tabEntries={entries}`):

```tsx
          tabEntries={entries}
          entryReviewAnalyses={entryReviewAnalyses}
```

- [ ] **Step 4: Verify the build and tests**

Run: `npm run build` — expected: PASS with zero TypeScript errors, project-wide.
Run: `npm test` — expected: PASS, full suite, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/pages/BrandGroup.tsx
git commit -m "feat: fetch and pass per-tab review analyses map into EditEntryModal"
```

---

### Task 7: Ask AI tool — `get_review_analyses`

**Files:**
- Modify: `supabase/functions/ai-assistant/tools.ts`
- Modify: `supabase/functions/ai-assistant/tools_test.ts`

**Interfaces:**
- Consumes: `entry_review_analyses` table (Task 1); existing helpers already in `tools.ts` (`fetchRemovedPlatformBrandSet`, `fetchArchivedTabNameSet`, `fetchPausedTabNameSet`, `fetchAgentAssignmentRows`, `resolveAgentLabels`, `platformRemovedKey`, `pick`, `BRAND_KEYS`).
- Produces: the `get_review_analyses` entry in `TOOL_DEFS` and its `runTool` dispatch case.

This task is independent of Tasks 2-6 (it only depends on Task 1's table existing) and can be worked from a fresh read of `tools.ts` without any frontend context.

- [ ] **Step 1: Extend the mock test helpers to support `.in()`**

In `supabase/functions/ai-assistant/tools_test.ts`, both `mockSupabase` and `mockSupabaseTables`'s builder objects need an `in()` method (currently only `eq()`/`select()`/`order()`/`limit()`/`then()` — see lines ~122-183). Add, to both builders, right after their existing `eq(key, value)` method:

```ts
        in(key: string, values: string[]) {
          filtered = filtered.filter((r: any) => values.includes(r[key]));
          return builder;
        },
```

- [ ] **Step 2: Write the failing tests**

Add `runTool` (already imported) usage plus these new tests to `tools_test.ts` (append near the other `runTool`-based tests, e.g. after the `successRateByField` test block):

```ts
Deno.test('get_review_analyses returns raw rows with resolved brand and agent', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'likely_removal_risk', risk_score: 80, confidence: 'high', root_cause: { label: 'proxy pattern' } }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [],
    paused_tabs: [],
    removed_platform_brands: [],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', {});
  assertEquals(result.total, 1);
  assertEquals(result.rows[0].brand, 'Acme');
  assertEquals(result.rows[0].agent, 'Lai');
  assertEquals(result.rows[0].overall_result, 'likely_removal_risk');
  assertEquals(result.rows[0].root_cause, 'proxy pattern');
});

Deno.test('get_review_analyses group_by="agent" produces exact counts including likely_removal_risk_count', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'likely_removal_risk' }, analyzed_at: '2026-08-25T00:00:00Z' },
      { entry_id: 'e2', tab: 'Rooster Partners', platform: 'ag', analysis: { overall_result: 'no_clear_removal_reason' }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
      { id: 'e2', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [],
    paused_tabs: [],
    removed_platform_brands: [],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', { group_by: 'agent' });
  assertEquals(result.total, 2);
  assertEquals(result.groups[0].value, 'Lai');
  assertEquals(result.groups[0].count, 2);
  assertEquals(result.groups[0].likely_removal_risk_count, 1);
});

Deno.test('get_review_analyses excludes a brand flagged removed on the queried platform', async () => {
  const tables = {
    entry_review_analyses: [
      { entry_id: 'e1', tab: 'Rooster Partners', platform: 'tp', analysis: { overall_result: 'likely_removal_risk' }, analyzed_at: '2026-08-25T00:00:00Z' },
    ],
    entries: [
      { id: 'e1', tab: 'Rooster Partners', data: { Brands: 'Acme', Agent: 'Lai' }, updated_at: '2026-08-25T00:00:00Z' },
    ],
    tab_archive_log: [],
    paused_tabs: [],
    removed_platform_brands: [{ tab: 'Rooster Partners', brand: 'Acme', platform: 'tp' }],
    brand_agent_assignments: [],
  };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', {});
  assertEquals(result.total, 0);
});

Deno.test('get_review_analyses rejects an invalid group_by value', async () => {
  const tables = { entry_review_analyses: [], entries: [], tab_archive_log: [], paused_tabs: [], removed_platform_brands: [], brand_agent_assignments: [] };
  const result: any = await runTool(mockSupabaseTables(tables), 'get_review_analyses', { group_by: 'nonsense' });
  assertEquals(typeof result.error, 'string');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `deno test --allow-env --allow-net supabase/functions/ai-assistant/tools_test.ts -- --filter get_review_analyses` (or `deno test supabase/functions/ai-assistant/tools_test.ts` for the whole file if the `--filter` flag isn't available in this environment's Deno version)
Expected: FAIL — `get_review_analyses` is not a recognized tool name yet (`runTool` falls through to `{ error: 'unknown tool: get_review_analyses' }`), and the `.in()` mock addition has no caller yet.

- [ ] **Step 4: Add the tool definition to `TOOL_DEFS`**

In `supabase/functions/ai-assistant/tools.ts`, add this object to the `TOOL_DEFS` array (insert it right after the existing `get_review_texts` entry, before the closing `];`):

```ts
  {
    type: 'function',
    function: {
      name: 'get_review_analyses',
      description:
        'Returns AI-generated review-removal-risk assessments from the dashboard\'s per-entry ' +
        '"🤖 Analyze Review" feature. Coverage is SPARSE and OPPORTUNISTIC: only entries someone ' +
        'has manually clicked "Analyze Review" on exist here — this is not run automatically or ' +
        'on every removed/refused review. An empty or small result means "not yet analyzed", ' +
        'never "no removal-risk issues found" — do not imply broader coverage than what is ' +
        'actually returned. Without group_by, returns individual analyzed entries (tab, brand, ' +
        'agent, platform, overall_result, risk_score, confidence, root_cause, analyzed_at). With ' +
        'group_by ("agent", "brand", "platform", or "overall_result"), returns exact counts per ' +
        'group plus how many were "likely_removal_risk", sorted most-common-first — prefer this ' +
        'over manually counting rows yourself for "which X has the most" questions. The "agent" ' +
        'field/group is resolved per-brand the same way get_success_rate_by_field and Schedule ' +
        'Planner do (an authoritative brand-agent mapping first, falling back to each entry\'s own ' +
        'recorded Agent value). Brands flagged removed on the queried platform (see ' +
        'get_removed_platform_flags) are excluded, as are archived/paused tabs — same exclusions ' +
        'as every other tool here.',
      parameters: {
        type: 'object',
        properties: {
          tab: { type: 'string', description: 'optional: restrict to one tab (exact name from list_tabs)' },
          platform: { type: 'string', enum: ['tp', 'ag', 'cg', 'wo'] },
          agent: { type: 'string', description: 'optional: restrict to one resolved agent name' },
          group_by: { type: 'string', enum: ['agent', 'brand', 'platform', 'overall_result'] },
          limit: { type: 'number', description: 'max rows or groups to return, default 25, max 50' },
        },
      },
    },
  },
```

- [ ] **Step 5: Add the `runTool` dispatch case**

Add this case to `runTool`, right before the final `return { error: `unknown tool: ${name}` };` line:

```ts
  if (name === 'get_review_analyses') {
    const validPlatforms: Platform[] = ['tp', 'ag', 'cg', 'wo'];
    if (args?.platform && !validPlatforms.includes(args.platform)) {
      return { error: `platform must be one of: ${validPlatforms.join(', ')}` };
    }
    const validGroupBy = ['agent', 'brand', 'platform', 'overall_result'];
    if (args?.group_by && !validGroupBy.includes(args.group_by)) {
      return { error: `group_by must be one of: ${validGroupBy.join(', ')}` };
    }

    let q = supabase.from('entry_review_analyses').select('entry_id, tab, platform, analysis, analyzed_at');
    if (args?.tab) q = q.eq('tab', args.tab);
    if (args?.platform) q = q.eq('platform', args.platform);

    const [{ data: analysisRows, error }, removedSet, archivedSet, pausedSet, assignmentRows] = await Promise.all([
      q,
      fetchRemovedPlatformBrandSet(supabase),
      fetchArchivedTabNameSet(supabase),
      fetchPausedTabNameSet(supabase),
      fetchAgentAssignmentRows(supabase),
    ]);
    if (error) throw error;

    const filteredAnalysisRows = (analysisRows ?? []).filter((r: any) => !archivedSet.has(r.tab) && !pausedSet.has(r.tab));
    if (filteredAnalysisRows.length === 0) return { total: 0, rows: [] };

    const entryIds = [...new Set(filteredAnalysisRows.map((r: any) => r.entry_id))];
    const { data: entryRows, error: entryError } = await supabase
      .from('entries')
      .select('id, tab, data, updated_at')
      .in('id', entryIds);
    if (entryError) throw entryError;

    const entryById = new Map((entryRows ?? []).map((e: any) => [e.id, e]));
    const agentLabels = resolveAgentLabels(entryRows ?? [], assignmentRows);

    let combined = filteredAnalysisRows
      .map((r: any) => {
        const entry = entryById.get(r.entry_id);
        const brand = (entry ? pick(entry.data, BRAND_KEYS) : null) ?? '';
        const agent = agentLabels.get(r.entry_id) ?? '';
        return {
          id: r.entry_id,
          tab: r.tab,
          platform: r.platform,
          brand,
          agent,
          overall_result: r.analysis?.overall_result ?? null,
          risk_score: r.analysis?.risk_score ?? null,
          confidence: r.analysis?.confidence ?? null,
          root_cause: r.analysis?.root_cause?.label ?? null,
          analyzed_at: r.analyzed_at,
        };
      })
      .filter((row: any) => !(row.brand && removedSet.has(platformRemovedKey(row.tab, row.brand, row.platform as Platform))));

    if (args?.agent) {
      const wantAgent = String(args.agent).trim().toLowerCase();
      combined = combined.filter((row: any) => row.agent.toLowerCase() === wantAgent);
    }

    const limit = Math.min(Number(args?.limit) || 25, 50);

    if (args?.group_by) {
      const buckets = new Map<string, { value: string; count: number; likely_removal_risk_count: number }>();
      for (const row of combined) {
        const key = args.group_by === 'agent' ? (row.agent || '(unassigned)')
          : args.group_by === 'brand' ? (row.brand || '(unknown)')
          : args.group_by === 'platform' ? row.platform
          : (row.overall_result ?? '(unknown)');
        const isRisk = row.overall_result === 'likely_removal_risk';
        const existing = buckets.get(key);
        if (existing) {
          existing.count++;
          if (isRisk) existing.likely_removal_risk_count++;
        } else {
          buckets.set(key, { value: key, count: 1, likely_removal_risk_count: isRisk ? 1 : 0 });
        }
      }
      const groups = [...buckets.values()].sort((a, b) => b.count - a.count);
      return { total: combined.length, groups: groups.slice(0, limit) };
    }

    return { total: combined.length, rows: combined.slice(0, limit) };
  }
```

- [ ] **Step 6: Update the two running exclusion-list comments**

In the comment above `buildArchivedTabNameSet` (currently reading `"Applied to the 7 tools that return review data or tab names: list_tabs, query_entries, get_score_summary, get_success_rate_by_field, get_schedule, get_paused_combos, get_review_texts."`), change `7 tools` to `8 tools` and append `, get_review_analyses` to the list.

In the comment above `buildPausedTabNameSet` (currently `"Applied alongside archivedSet at the exact same 7 filter points archived-tab exclusion already covers: list_tabs, query_entries, get_score_summary, get_success_rate_by_field, get_schedule, get_paused_combos, get_review_texts."`), make the same `7` → `8` and list update.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `deno test --allow-env --allow-net supabase/functions/ai-assistant/tools_test.ts`
Expected: PASS — the full existing suite plus the 4 new tests, no regressions.

Also run: `deno check supabase/functions/ai-assistant/tools.ts` and `deno check supabase/functions/ai-assistant/index.ts`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/ai-assistant/tools.ts supabase/functions/ai-assistant/tools_test.ts
git commit -m "feat: add get_review_analyses Ask AI tool for agent/brand/platform aggregation"
```

---

### Task 8: Final integration check

**Files:** none (verification only).

**Interfaces:** none — this task verifies Tasks 1-7 together.

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm test`
Expected: PASS, all files, no regressions.

- [ ] **Step 2: Run the full frontend build**

Run: `npm run build`
Expected: PASS, zero TypeScript errors.

- [ ] **Step 3: Run the full Deno suite for ai-assistant**

Run: `deno test --allow-env --allow-net supabase/functions/ai-assistant/tools_test.ts`
Expected: PASS.

- [ ] **Step 4: Verify no remaining reference to the old single-slot fields**

Run:
```bash
grep -rn "ai_review_analysis" src/ supabase/functions/review-removal-assessment/ docs/superpowers/specs/2026-08-14-ai-review-removal-assessment-design.md
```
Expected: zero matches in `src/` and `supabase/functions/review-removal-assessment/` (the old spec doc is historical and may still mention the old column name — that's fine, it's not code). If any match appears in actual code, that is a real gap introduced by this plan and must be fixed before proceeding.

- [ ] **Step 5: Manual note for the human operator (not automatable in this session)**

This step has no command to run — record it as a follow-up:
- Deploy: `supabase db push` (applies the migration — **do this before** deploying the frontend, since the frontend's new `fetchEntryReviewAnalyses`/`saveReviewAnalysis` calls will 404/`42P01` against a table that doesn't exist yet otherwise), then `supabase functions deploy ai-assistant` (ships `get_review_analyses`), then `git push origin main` (frontend).
- Live-verify the exact regression this plan fixes: open a multi-platform entry (e.g. a Rooster Partners row with a TP review), click "🤖 Analyze Review" on the TP section, then also analyze the AG section on the *same* entry, then reopen the TP section and confirm it still shows its own correct cached result (not the AG one, not marked incorrectly "Outdated").
- Live-verify `get_review_analyses` via a real Ask AI chat query once deployed (e.g. "which agent has the most removal-risk flags").

- [ ] **Step 6: Commit (only if Step 4 required fixes)**

If Step 4 found and fixed a stray reference, commit that fix. Otherwise skip — there is nothing to commit.
