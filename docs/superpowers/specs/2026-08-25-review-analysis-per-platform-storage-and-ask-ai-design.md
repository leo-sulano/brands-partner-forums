# Per-Platform Review Analysis Storage + Ask AI Aggregation Tool — Design Spec

Date: 2026-08-25

## Purpose

Two related pieces of work, the second depending on the first:

1. **Fix a real, pre-existing storage bug** in the AI Review Removal Assessment feature (Task
   225/262/263): `entries.ai_review_analysis` (and its 3 sibling columns) is a single shared slot
   per entry row, not one per platform. On a multi-platform tab (Rooster Partners, Revolution
   Casino, SilverPlay, Hanan), analyzing one platform's review overwrites any other platform's
   cached analysis for that same entry, and the *other* platform's section in `EditEntryModal`
   shows the wrong cached result mislabeled as "Outdated" (a hash mismatch, not "not yet
   analyzed"). This was never caught by Task 225's original design, which assumed 1:1 —
   true only for single-platform tabs.
2. **Give Ask AI a new tool**, `get_review_analyses`, so management can ask questions like "which
   agent has the most removal-risk flags" or "what's driving removals on Rooster Partners"
   conversationally, instead of opening entries one at a time. This replaces an earlier, larger
   idea (a dedicated aggregation page) — rejected in favor of reusing Ask AI's existing
   tool-calling infrastructure, since the underlying data (whatever's been analyzed so far) is
   exactly the kind of thing Ask AI's existing tools already expose this way.

## Scope decisions made during brainstorming (binding)

- **Coverage is sparse and organic, by design** — the tool only ever sees entries someone has
  manually clicked "🤖 Analyze Review" on. No batch/background analysis process is built. An empty
  or small result means "not yet analyzed," never "no issues found," and the tool's own
  description must say so explicitly (anti-hallucination requirement, matching every other tool in
  this file).
- **No new page, no new frontend component.** The only frontend changes are the storage-scoping
  fix itself (making the existing Edit Entry modal behavior correct), not new UI.
- **Category/pattern grouping uses structured signals already in the schema** — `overall_result`,
  and (newly persisted, see below) the two deterministic hard signals
  (`duplicateReviewTextFound`, `proxyTiedToOtherRemoval`) — not a new AI-generated category enum.
  No further edge-function schema change to the *output* shape is needed.
- **Migration for the 11 existing cached analyses**: preserve the 9 on single-platform tabs (TP
  Brand Injection ×7, TP Affiliate ×2 — unambiguously `platform = 'tp'`, since those tabs never
  render an AG/CG section); drop the 2 on multi-platform tabs (Hanan ×1, Rooster Partners ×1 —
  genuinely unknown which platform). Both are trivially re-analyzable via the existing button.

## Part A: Per-platform storage fix

### Schema

New migration, mirroring this codebase's existing per-platform-side-table pattern
(`brand_platform_pause`'s exact RLS/shape — see
`supabase/migrations/20260801090000_add_schedule_platform_and_pause.sql`):

```sql
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
```

`tab` is denormalized onto the row (not derived via join), matching `brand_platform_pause`/
`removed_platform_brands` — a tab-scoped fetch is a plain indexed `where tab = ?`.

`evidence jsonb not null` stores the full `RemovalEvidence` bundle (not just the two hard-signal
booleans) — the frontend already computes this in full before calling `saveReviewAnalysis`, so
storing it whole is free and future-proofs the Ask AI tool (and any later enhancement) against
needing another schema change just to read one more field out of it (e.g. `crossEntry.
sameProxyRemovedCount` for a richer answer than the boolean alone).

Migration also moves data and drops the old columns:

```sql
insert into public.entry_review_analyses (entry_id, tab, platform, analysis, evidence, hash, model, analyzed_at)
select id, tab, 'tp',
       ai_review_analysis,
       '{}'::jsonb, -- no evidence bundle existed before Task 262; empty object, not null
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

The 2 ambiguous rows (Hanan, Rooster Partners) are simply not selected by the `tab in (...)` list,
so they're dropped by the subsequent `drop column` — no explicit delete needed.

### `src/types/entry.ts`

Remove the 4 `ai_review_analysis*` optional fields from `Entry` — they no longer exist on
`entries`.

### `src/lib/queries.ts`

New types and functions:

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

export async function fetchEntryReviewAnalyses(tab: string, client: SupabaseClient = supabase): Promise<EntryReviewAnalysisRow[]> {
  const { data, error } = await client
    .from('entry_review_analyses')
    .select('entry_id, platform, analysis, evidence, hash, model, analyzed_at')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as EntryReviewAnalysisRow[];
}
```

`saveReviewAnalysis` gains a `platform` parameter and an `evidence` parameter, and upserts into the
new table instead of updating `entries` (mirrors `upsertBrandPlatformPause`'s exact upsert-with-
`onConflict` shape):

```ts
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
```

New small key helper (put in `src/lib/reviewRemovalAssessment.ts`, alongside the other pure helpers
this feature already owns):

```ts
export function entryReviewAnalysisKey(entryId: string, platform: Platform): string {
  return `${entryId}::${platform}`;
}
```

### `src/pages/BrandGroup.tsx`

Add `fetchEntryReviewAnalyses(decodedTab)` as a third parallel fetch alongside the existing
`Promise.all([fetchRawEntriesByTab(decodedTab), fetchTabHeaders(decodedTab)])` call. New state:

```ts
const [entryReviewAnalyses, setEntryReviewAnalyses] = useState<Map<string, EntryReviewAnalysisRow>>(new Map());
```

built via `new Map(rows.map((r) => [entryReviewAnalysisKey(r.entry_id, r.platform), r]))`. Passed
to `EditEntryModal` as a new prop `entryReviewAnalyses={entryReviewAnalyses}`.

Not threaded into any BrandGroup-level optimistic-update path after a save — the component's own
local React state already handles the current modal session (see below), matching this feature's
existing behavior (Task 225 never synced `ai_review_analysis` back into `BrandGroup`'s `entries`
state either). A closed-then-reopened modal shows the last-fetched value until the tab is
revisited, same staleness class as today.

### `src/components/EditEntryModal.tsx`

New optional prop `entryReviewAnalyses?: Map<string, EntryReviewAnalysisRow>`. For each of the 3
`<ReviewRemovalAssessment />` call sites, look up this entry+platform's cached row and pass the
resolved value down as two new props instead of relying on the component to read `entry.
ai_review_analysis*` itself:

```tsx
const cached = entryReviewAnalyses?.get(entryReviewAnalysisKey(entry.id, activePlatform));
// ...
<ReviewRemovalAssessment
  ...
  cachedAnalysis={cached?.analysis ?? null}
  cachedHash={cached?.hash ?? null}
  ...
/>
```

(repeated for the AG and CG call sites with their own literal platform.)

### `src/components/ReviewRemovalAssessment.tsx`

- `Props` gains `cachedAnalysis: ReviewRemovalAssessmentResult | null` and
  `cachedHash: string | null`, replacing the `entry.ai_review_analysis`/`entry.
  ai_review_analysis_hash` reads in the two `useState` initializers:

  ```ts
  const [result, setResult] = useState<ReviewRemovalAssessmentResult | null>(
    isValidAssessmentResult(cachedAnalysis) ? cachedAnalysis : null,
  );
  const [savedHash, setSavedHash] = useState<string | null>(cachedHash ?? null);
  ```
- `handleAnalyze`'s `saveReviewAnalysis` call gains `platform` and `evidence` (the component
  already computes `evidence` via its existing `useMemo` — no new computation needed):

  ```ts
  await saveReviewAnalysis(entry.id, tab, platform, analysis, evidence, hash, model);
  ```

No other rendering logic changes — Task 262/263's Evidence row, Root Cause, Evidence For/Against,
"For Next Time", and Why-field rendering are all untouched; this task only changes where the
cached value comes from.

## Part B: Ask AI tool

### `supabase/functions/ai-assistant/tools.ts`

New tool definition, added to `TOOL_DEFS` alongside the existing `get_score_summary`/`get_schedule`/
`get_review_texts` entries:

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

`runTool` dispatch case:

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
    .filter((row) => !(row.brand && removedSet.has(platformRemovedKey(row.tab, row.brand, row.platform as Platform))));

  if (args?.agent) {
    const wantAgent = String(args.agent).trim().toLowerCase();
    combined = combined.filter((row) => row.agent.toLowerCase() === wantAgent);
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

Reuses existing helpers unmodified: `fetchRemovedPlatformBrandSet`, `fetchArchivedTabNameSet`,
`fetchPausedTabNameSet`, `fetchAgentAssignmentRows`, `resolveAgentLabels`, `platformRemovedKey`,
`pick`, `BRAND_KEYS` — no new duplicated logic, consistent with this file's own established
cross-dashboard-consistency discipline.

Update the file's two running "which tools apply archived/paused-tab exclusion" comment lists
(currently listing 7 tools each, around the `fetchArchivedTabNameSet`/`fetchPausedTabNameSet`
definitions) to include `get_review_analyses` as an 8th entry in both.

### Mock test helper extension (`tools_test.ts`)

`mockSupabaseTables`'s builder currently supports `.eq()` but not `.in()` — this tool's second
query (`entries` filtered by a list of ids) needs it. Add:

```ts
in(key: string, values: string[]) {
  filtered = filtered.filter((r: any) => values.includes(r[key]));
  return builder;
},
```

to both `mockSupabase` and `mockSupabaseTables`'s builder objects.

## Data flow summary

1. User clicks "🤖 Analyze Review" on, say, the AG section of a Rooster Partners entry.
2. `ReviewRemovalAssessment` (already platform-scoped via its existing `platform` prop) calls
   `saveReviewAnalysis(entry.id, tab, 'ag', analysis, evidence, hash, model)`.
3. This upserts one row in `entry_review_analyses` keyed on `(entry.id, 'ag')` — the TP section's
   own cached row (if any), keyed on `(entry.id, 'tp')`, is untouched.
4. Later, someone asks Ask AI "which agent has the most removal-risk flags on AskGamblers this
   month" (date filtering is out of scope for v1, matching `get_score_summary`'s existing
   all-time-only precedent — the model can still filter `analyzed_at` client-side from the raw
   rows if asked, just not server-side yet). Ask AI calls `get_review_analyses({ platform: 'ag',
   group_by: 'agent' })`, gets exact counts, and answers from real data.

## Testing plan

- `src/lib/queries.test.ts`: update the existing `saveReviewAnalysis` describe block for the new
  signature (`entry_review_analyses` upsert with `onConflict: 'entry_id,platform'`, not an
  `entries` update) — mirror `upsertBrandPlatformPause`'s existing test shape. Add
  `fetchEntryReviewAnalyses` tests (returns mapped rows, tab-scoped).
- `src/lib/reviewRemovalAssessment.test.ts`: add tests for `entryReviewAnalysisKey`.
- `supabase/functions/ai-assistant/tools_test.ts`: new tests for `get_review_analyses` —
  raw-rows mode returns expected fields; `group_by: 'agent'` produces exact counts including
  `likely_removal_risk_count`; a brand flagged removed on the queried platform is excluded; an
  archived/paused tab's rows are excluded; an unknown `group_by`/`platform` value returns a
  clear `{ error }` instead of throwing.
- No live-verification-blocking manual test plan beyond what's already established: after
  deploying, re-run the exact Playwright walkthrough from Task 262/263 (analyze TP on a
  multi-platform entry, then analyze AG on the *same* entry, confirm the TP section still shows
  its own correct cached result afterward — this is the concrete regression this whole task
  fixes) and one real Ask AI chat query exercising `get_review_analyses`.

## Deployment

1. `supabase db push` (applies the new table + column drops).
2. `supabase functions deploy review-removal-assessment` — no code change needed in this function
   itself (it already accepts/forwards `evidence` from Task 262/263; the storage change is purely
   frontend + the table it writes to), but redeploy only if any other pending change bundles with
   it. Not required by this task specifically.
3. `supabase functions deploy ai-assistant` — ships `get_review_analyses`.
4. Frontend: normal `git push origin main` → Vercel auto-deploy, same as prior tasks.
