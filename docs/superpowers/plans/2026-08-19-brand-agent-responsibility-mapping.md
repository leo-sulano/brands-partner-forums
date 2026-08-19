# Brand → Agent Responsibility Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the "Files & responsibility mapping" spreadsheet's authoritative Brand→Agent data into a new `brand_agent_assignments` table so Schedule Planner's display and its PMS Agent→Assignee push are both accurate, including for the 5 tabs whose entries have no `Agent` column at all.

**Architecture:** A new Supabase table holds one row per (tab, brand, platform) with an optional agent (a present row, even with `agent: null`, is authoritative). A new resolver layer in `scheduleUtils.ts` checks that table first, falling back to the existing per-entry `buildAgentIndex` heuristic. Every call site that currently reads Agent (3 PMS-push sites, 2 display/filter sites, 1 not-yet-deployed cron path) is updated to go through the new resolver, so nothing can silently diverge.

**Tech Stack:** Supabase (Postgres + RLS), TypeScript, Vitest, Deno test (generate-weekly-schedule).

**Spec:** `docs/superpowers/specs/2026-08-19-brand-agent-responsibility-mapping-design.md`

> **Note (final review fix wave):** Task 1's migration was actually committed as
> `20260819120000_add_brand_agent_assignments.sql`, not the `20260819110000` filename used
> throughout the rest of this document — renamed mid-plan after a real version collision with a
> concurrent session's migration. See `docs/task-history.md`'s Task 239 entry for the full
> incident writeup. The rest of this plan's `20260819110000` references are left as-is.

## Global Constraints

- Brand-key matching is always `lower(trim(brand))` (`normalizeBrandKey` / `generated always as (lower(btrim(brand)))`) — no punctuation stripping. Seed data must use each brand's *exact* live spelling (verified below), not the CSV's spelling where they differ.
- A present `brand_agent_assignments` row is authoritative even when `agent` is `null` — it must suppress the per-entry fallback for that exact (brand, platform), never merely "skip and defer."
- Only seed rows for platforms a tab actually tracks (`getTabPlatforms(tab)`) — never insert a row for a platform-tab combo that can't exist.
- TP Brand Injection and TP Affiliate get no new rows (the sheet has no agent data for them) — both keep using their existing per-entry `Agent` field, completely untouched by this plan.
- No in-app admin UI for this table — direct Supabase editing only, per the approved spec.

---

## Verified live brand spellings (do not re-derive — already confirmed via direct Supabase REST query against production `entries`)

| Tab | Live brand values |
|---|---|
| Rooster Partners | Fortuneplay, Lucky7even, Luckyvibe, Novadreams, Novadreams2, Play Mojo, Rocketspin, Rollero, Rooster.bet, Spinjo, Spinsup |
| Wizard of Odds | Fortuneplay, Lucky7even, LuckyVibe, PlayMojo, Rocketspin, Rollero, RoosterBet |
| Revolution Casino | God Of Casino, Midarion, Midasluck, Revolution Casino, Revolution1 |
| Trybet | Trybet.com |
| SilverPlay | Silver Play |
| SuprPlay Limited | Duelz.com, NY Spins, Voodoo Dreams |
| Hanan | Cryptoroyal.com, DachBet.com, EmirBet.com, LuckNation.com, OlympusBet.com, Pribet.com, RealSpin.com, WinMega.com, ZodiacBet.com |

The CSV said `"Trybet"` — the live value is `"Trybet.com"`. All seed data below uses the corrected `"Trybet.com"`.

---

### Task 1: Database migration — table, RLS, and seed data

**Files:**
- Create: `supabase/migrations/20260819110000_add_brand_agent_assignments.sql`

**Interfaces:**
- Produces: table `public.brand_agent_assignments(id uuid, tab text, brand text, brand_key text generated, platform text, agent text nullable, created_at timestamptz)`, unique on `(tab, brand_key, platform)`.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260819110000_add_brand_agent_assignments.sql
-- Brand -> Agent responsibility mapping
-- (docs/superpowers/specs/2026-08-19-brand-agent-responsibility-mapping-design.md):
--
-- Authoritative source of who owns which brand, per platform, sourced from
-- the "Files & responsibility mapping - Responsibilities" spreadsheet.
-- Schedule Planner's Agent resolution (src/lib/scheduler/scheduleUtils.ts,
-- resolveAgentForPlatform) checks this table FIRST -- a matching row, even
-- one with agent = null (the sheet's explicit "N/A"), is authoritative and
-- skips the older per-entry Agent-column heuristic (buildAgentIndex)
-- entirely for that exact (brand, platform). No row at all falls through to
-- that heuristic unchanged.
--
-- Five of 11 operational tabs (Revolution Casino, Trybet, SilverPlay, Hanan,
-- HazEmirates UAE) have no 'Agent' column in their entries' jsonb data at
-- all -- their source Google Sheets never had one -- so buildAgentIndex has
-- always resolved nothing for their brands. This table is the only way
-- those tabs' brands can ever get a real PMS assignee.
--
-- One-time seed only -- no admin UI exists to edit this table. Future
-- reassignments are made directly in the Supabase table editor, same as
-- removed_platform_brands and schedule_hidden_brands/
-- schedule_platform_restrictions.
--
-- TP Brand Injection and TP Affiliate are deliberately NOT seeded here --
-- the sheet has no agent data for either group ("BI TP"/"AFF TP" sections
-- list brand names only). Both tabs keep using their existing per-entry
-- Agent field unchanged.
--
-- Brand spellings below were verified against live entries.data via direct
-- Supabase REST query, not copied verbatim from the sheet -- one real
-- mismatch was caught this way: the sheet says "Trybet", the live brand
-- value is "Trybet.com". brand_key matching is lower+trim only (no
-- punctuation stripping), so the uncorrected spelling would have never
-- matched. Only platforms a tab actually tracks (getTabPlatforms) are
-- seeded; e.g. Trybet and SuprPlay Limited are TP-only tabs, so no ag/cg
-- rows exist for their brands even though the sheet marks those cells N/A.
--
-- Brands present in a tab's live entries but absent from this sheet
-- (Novadreams, Midasluck, Revolution1, and Hanan's flagged-removed
-- Pribet.com/RealSpin.com/WinMega.com) get no row -- they keep falling back
-- to the per-entry heuristic, unchanged from today.

create table public.brand_agent_assignments (
  id         uuid primary key default gen_random_uuid(),
  tab        text not null,
  brand      text not null,
  brand_key  text generated always as (lower(btrim(brand))) stored,
  platform   text not null check (platform in ('tp', 'ag', 'cg', 'wo')),
  agent      text,
  created_at timestamptz not null default now(),
  unique (tab, brand_key, platform)
);

alter table public.brand_agent_assignments enable row level security;

create policy "anyone can read brand_agent_assignments"
  on public.brand_agent_assignments for select using (true);
create policy "approved users can insert brand_agent_assignments"
  on public.brand_agent_assignments for insert with check (public.is_approved());
create policy "approved users can update brand_agent_assignments"
  on public.brand_agent_assignments for update using (public.is_approved()) with check (public.is_approved());
create policy "approved users can delete brand_agent_assignments"
  on public.brand_agent_assignments for delete using (public.is_approved());

-- Rooster Partners — all LAI across tp/ag/cg. Novadreams2 is explicit N/A
-- (agent = null) on all three platforms in the sheet -- authoritative,
-- overrides whatever its per-entry Agent column says.
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('Rooster Partners', 'Lucky7even', 'tp', 'LAI'),
  ('Rooster Partners', 'Lucky7even', 'ag', 'LAI'),
  ('Rooster Partners', 'Lucky7even', 'cg', 'LAI'),
  ('Rooster Partners', 'Rooster.bet', 'tp', 'LAI'),
  ('Rooster Partners', 'Rooster.bet', 'ag', 'LAI'),
  ('Rooster Partners', 'Rooster.bet', 'cg', 'LAI'),
  ('Rooster Partners', 'Spinjo', 'tp', 'LAI'),
  ('Rooster Partners', 'Spinjo', 'ag', 'LAI'),
  ('Rooster Partners', 'Spinjo', 'cg', 'LAI'),
  ('Rooster Partners', 'Fortuneplay', 'tp', 'LAI'),
  ('Rooster Partners', 'Fortuneplay', 'ag', 'LAI'),
  ('Rooster Partners', 'Fortuneplay', 'cg', 'LAI'),
  ('Rooster Partners', 'Spinsup', 'tp', 'LAI'),
  ('Rooster Partners', 'Spinsup', 'ag', 'LAI'),
  ('Rooster Partners', 'Spinsup', 'cg', 'LAI'),
  ('Rooster Partners', 'Rocketspin', 'tp', 'LAI'),
  ('Rooster Partners', 'Rocketspin', 'ag', 'LAI'),
  ('Rooster Partners', 'Rocketspin', 'cg', 'LAI'),
  ('Rooster Partners', 'Play Mojo', 'tp', 'LAI'),
  ('Rooster Partners', 'Play Mojo', 'ag', 'LAI'),
  ('Rooster Partners', 'Play Mojo', 'cg', 'LAI'),
  ('Rooster Partners', 'Luckyvibe', 'tp', 'LAI'),
  ('Rooster Partners', 'Luckyvibe', 'ag', 'LAI'),
  ('Rooster Partners', 'Luckyvibe', 'cg', 'LAI'),
  ('Rooster Partners', 'Novadreams2', 'tp', null),
  ('Rooster Partners', 'Novadreams2', 'ag', null),
  ('Rooster Partners', 'Novadreams2', 'cg', null),
  ('Rooster Partners', 'Rollero', 'tp', 'LAI'),
  ('Rooster Partners', 'Rollero', 'ag', 'LAI'),
  ('Rooster Partners', 'Rollero', 'cg', 'LAI');

-- Revolution Casino — Revolution Casino/Midarion all JEN; God Of Casino is
-- split: tp/cg explicit N/A (null), ag = JEN.
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('Revolution Casino', 'Revolution Casino', 'tp', 'JEN'),
  ('Revolution Casino', 'Revolution Casino', 'ag', 'JEN'),
  ('Revolution Casino', 'Revolution Casino', 'cg', 'JEN'),
  ('Revolution Casino', 'Midarion', 'tp', 'JEN'),
  ('Revolution Casino', 'Midarion', 'ag', 'JEN'),
  ('Revolution Casino', 'Midarion', 'cg', 'JEN'),
  ('Revolution Casino', 'God Of Casino', 'tp', null),
  ('Revolution Casino', 'God Of Casino', 'ag', 'JEN'),
  ('Revolution Casino', 'God Of Casino', 'cg', null);

-- Trybet — TP-only tab. Spelling corrected to the live "Trybet.com" (sheet
-- said "Trybet").
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('Trybet', 'Trybet.com', 'tp', 'JEN');

-- SilverPlay — tp explicit N/A (null), ag/cg = JEN.
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('SilverPlay', 'Silver Play', 'tp', null),
  ('SilverPlay', 'Silver Play', 'ag', 'JEN'),
  ('SilverPlay', 'Silver Play', 'cg', 'JEN');

-- SuprPlay Limited — TP-only tab, all JEN.
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('SuprPlay Limited', 'Duelz.com', 'tp', 'JEN'),
  ('SuprPlay Limited', 'Voodoo Dreams', 'tp', 'JEN'),
  ('SuprPlay Limited', 'NY Spins', 'tp', 'JEN');

-- Hanan — all ANN across tp/ag/cg. Pribet.com/RealSpin.com/WinMega.com
-- (flagged-removed brands) are not in the sheet and get no row here.
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('Hanan', 'ZodiacBet.com', 'tp', 'ANN'),
  ('Hanan', 'ZodiacBet.com', 'ag', 'ANN'),
  ('Hanan', 'ZodiacBet.com', 'cg', 'ANN'),
  ('Hanan', 'EmirBet.com', 'tp', 'ANN'),
  ('Hanan', 'EmirBet.com', 'ag', 'ANN'),
  ('Hanan', 'EmirBet.com', 'cg', 'ANN'),
  ('Hanan', 'Cryptoroyal.com', 'tp', 'ANN'),
  ('Hanan', 'Cryptoroyal.com', 'ag', 'ANN'),
  ('Hanan', 'Cryptoroyal.com', 'cg', 'ANN'),
  ('Hanan', 'DachBet.com', 'tp', 'ANN'),
  ('Hanan', 'DachBet.com', 'ag', 'ANN'),
  ('Hanan', 'DachBet.com', 'cg', 'ANN'),
  ('Hanan', 'OlympusBet.com', 'tp', 'ANN'),
  ('Hanan', 'OlympusBet.com', 'ag', 'ANN'),
  ('Hanan', 'OlympusBet.com', 'cg', 'ANN'),
  ('Hanan', 'LuckNation.com', 'tp', 'ANN'),
  ('Hanan', 'LuckNation.com', 'ag', 'ANN'),
  ('Hanan', 'LuckNation.com', 'cg', 'ANN');

-- Wizard of Odds — wo-only tab, all JEN. Spellings match this tab's own
-- live brand values exactly (RoosterBet/LuckyVibe/PlayMojo, distinct from
-- Rooster Partners' own Rooster.bet/Luckyvibe/Play Mojo spellings).
insert into public.brand_agent_assignments (tab, brand, platform, agent) values
  ('Wizard of Odds', 'RoosterBet', 'wo', 'JEN'),
  ('Wizard of Odds', 'Lucky7even', 'wo', 'JEN'),
  ('Wizard of Odds', 'Fortuneplay', 'wo', 'JEN'),
  ('Wizard of Odds', 'Rocketspin', 'wo', 'JEN'),
  ('Wizard of Odds', 'LuckyVibe', 'wo', 'JEN'),
  ('Wizard of Odds', 'PlayMojo', 'wo', 'JEN'),
  ('Wizard of Odds', 'Rollero', 'wo', 'JEN');
```

- [ ] **Step 2: Push the migration to the live database**

Run: `supabase db push`

This session's Supabase CLI is already authenticated and linked to the
"Brands Partner Forum" project (`krxnupmhfiduduvvlumc`) — confirmed via
`supabase projects list` showing the `●` marker on that row. If the CLI
reports it is *not* linked when this step runs, run `supabase link
--project-ref krxnupmhfiduduvvlumc` first, then retry `supabase db push`.

- [ ] **Step 3: Verify the migration applied and the seed data is correct**

Run (values from `.env`'s `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`):

```bash
curl -s "$VITE_SUPABASE_URL/rest/v1/brand_agent_assignments?select=tab,brand,platform,agent&order=tab,brand,platform" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const rows=JSON.parse(d);console.log('total rows:', rows.length);console.log('null-agent rows:', rows.filter(r=>r.agent===null).map(r=>`${r.tab}/${r.brand}/${r.platform}`));})"
```

Expected: `total rows: 71`, and the null-agent rows list contains exactly:
`Rooster Partners/Novadreams2/tp`, `Rooster Partners/Novadreams2/ag`,
`Rooster Partners/Novadreams2/cg`, `Revolution Casino/God Of Casino/tp`,
`Revolution Casino/God Of Casino/cg`, `SilverPlay/Silver Play/tp` — 6 rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260819110000_add_brand_agent_assignments.sql
git commit -m "feat: add brand_agent_assignments table with responsibility-mapping seed data"
```

---

### Task 2: `fetchBrandAgentAssignments` in `src/lib/queries.ts`

**Files:**
- Modify: `src/lib/queries.ts` (add near `fetchScheduleRestrictedBrands`, around line 275)
- Test: `src/lib/queries.test.ts`

**Interfaces:**
- Consumes: nothing new (uses the existing `SupabaseClient` type and `supabase` singleton already imported at the top of `queries.ts`).
- Produces:
  ```ts
  export interface BrandAgentAssignmentRow {
    tab: string;
    brand: string;
    platform: Platform;
    agent: string | null;
  }
  export async function fetchBrandAgentAssignments(
    tab: string,
    client?: SupabaseClient,
  ): Promise<BrandAgentAssignmentRow[]>
  ```
  Tasks 4-6 import `BrandAgentAssignmentRow` and `fetchBrandAgentAssignments` from `./queries` / `../../../src/lib/queries.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/queries.test.ts`, in the `describe('queries.ts injectable Supabase client', ...)` block, right after the existing `fetchScheduleRestrictedBrands` tests (around line 151):

```ts
  it('fetchBrandAgentAssignments uses the passed-in client', async () => {
    const fakeFrom = vi.fn().mockReturnValue(chain({
      data: [{ tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp', agent: 'ANN' }],
      error: null,
    }));
    const rows = await fetchBrandAgentAssignments('Hanan', { from: fakeFrom } as any);
    expect(fakeFrom).toHaveBeenCalledWith('brand_agent_assignments');
    expect(singletonFrom).not.toHaveBeenCalled();
    expect(rows).toEqual([{ tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp', agent: 'ANN' }]);
  });

  it('fetchBrandAgentAssignments falls back to the singleton when no client is passed', async () => {
    singletonFrom.mockReturnValue(chain({ data: [], error: null }));
    await fetchBrandAgentAssignments('Hanan');
    expect(singletonFrom).toHaveBeenCalledWith('brand_agent_assignments');
  });
```

Also add `fetchBrandAgentAssignments` to the import list at the top of `src/lib/queries.test.ts` (alongside `fetchScheduleRestrictedBrands`, around line 26).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/queries.test.ts -t "fetchBrandAgentAssignments"`
Expected: FAIL — `fetchBrandAgentAssignments is not a function` / import error.

- [ ] **Step 3: Implement `fetchBrandAgentAssignments`**

Add to `src/lib/queries.ts` immediately after `fetchScheduleRestrictedBrands` (after its closing `}` around line 275):

```ts
export interface BrandAgentAssignmentRow {
  tab: string;
  brand: string;
  platform: Platform;
  agent: string | null;
}

export async function fetchBrandAgentAssignments(
  tab: string,
  client: SupabaseClient = supabase,
): Promise<BrandAgentAssignmentRow[]> {
  const { data, error } = await client
    .from('brand_agent_assignments')
    .select('tab, brand, platform, agent')
    .eq('tab', tab);
  if (error) throw error;
  return (data ?? []) as BrandAgentAssignmentRow[];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/queries.test.ts -t "fetchBrandAgentAssignments"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: add fetchBrandAgentAssignments to queries.ts"
```

---

### Task 3: Resolution functions in `src/lib/scheduler/scheduleUtils.ts`

**Files:**
- Modify: `src/lib/scheduler/scheduleUtils.ts` (add after `buildCountryIndex`, around line 172)
- Test: `src/lib/scheduler/scheduleUtils.test.ts`

**Interfaces:**
- Consumes: `Platform` type and `normalizeBrandKey` (already imported at the top of `scheduleUtils.ts`), `Entry` type (already imported), `buildAgentIndex` (already defined in the same file).
- Produces (all exported from `scheduleUtils.ts`):
  ```ts
  export interface BrandAgentAssignmentRow {
    tab: string;
    brand: string;
    platform: Platform;
    agent: string | null;
  }
  export function buildAgentAssignmentMap(rows: BrandAgentAssignmentRow[]): Map<string, string | null>
  export function resolveAgentForPlatform(
    brandKey: string,
    platform: Platform,
    assignments: Map<string, string | null>,
    agentIndex: Map<string, string>,
  ): string | null
  export function resolveAgentForBrand(
    brandKey: string,
    platforms: Platform[],
    assignments: Map<string, string | null>,
    agentIndex: Map<string, string>,
  ): string | null
  export function buildResolvedAgentIndex(
    entries: Entry[],
    assignmentRows: BrandAgentAssignmentRow[],
    platforms: Platform[],
  ): Map<string, string>
  ```
  Tasks 4-6 call all four of these. `BrandAgentAssignmentRow` here is a
  structurally-identical duplicate of the one in `queries.ts` (deliberate —
  `scheduleUtils.ts` stays free of any import from the much heavier
  `queries.ts`, matching its existing "pure, no I/O" character; the two
  interfaces are structurally compatible so values from `fetchBrandAgentAssignments`
  pass directly into `buildAgentAssignmentMap`/`buildResolvedAgentIndex`
  with no conversion).

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/scheduler/scheduleUtils.test.ts`, at the end of the file (after the `buildAgentIndex` describe block, after line 260), and add `buildAgentAssignmentMap, resolveAgentForPlatform, resolveAgentForBrand, buildResolvedAgentIndex` to the import list at the top (line 2):

```ts
describe('buildAgentAssignmentMap', () => {
  it('keys by brandKey::platform', () => {
    const map = buildAgentAssignmentMap([
      { tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp', agent: 'ANN' },
    ]);
    expect(map.get('zodiacbet.com::tp')).toBe('ANN');
  });

  it('preserves an explicit null agent as a present key, not a missing one', () => {
    const map = buildAgentAssignmentMap([
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'tp', agent: null },
    ]);
    expect(map.has('silver play::tp')).toBe(true);
    expect(map.get('silver play::tp')).toBeNull();
  });

  it('normalizes the brand key the same way the rest of this file does (trim + lowercase)', () => {
    const map = buildAgentAssignmentMap([
      { tab: 'Hanan', brand: '  ZodiacBet.com  ', platform: 'tp', agent: 'ANN' },
    ]);
    expect(map.get('zodiacbet.com::tp')).toBe('ANN');
  });
});

describe('resolveAgentForPlatform', () => {
  it('returns the assignment table value when a row exists', () => {
    const assignments = buildAgentAssignmentMap([
      { tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp', agent: 'ANN' },
    ]);
    const agentIndex = new Map([['zodiacbet.com', 'SomeoneElse']]);
    expect(resolveAgentForPlatform('zodiacbet.com', 'tp', assignments, agentIndex)).toBe('ANN');
  });

  it('returns null (not the fallback) when the assignment row is an explicit N/A', () => {
    const assignments = buildAgentAssignmentMap([
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'tp', agent: null },
    ]);
    const agentIndex = new Map([['silver play', 'SomeoneElse']]);
    expect(resolveAgentForPlatform('silver play', 'tp', assignments, agentIndex)).toBeNull();
  });

  it('falls back to agentIndex when no assignment row exists for this brand+platform', () => {
    const assignments = buildAgentAssignmentMap([]);
    const agentIndex = new Map([['midasluck', 'Fallback']]);
    expect(resolveAgentForPlatform('midasluck', 'tp', assignments, agentIndex)).toBe('Fallback');
  });

  it('is scoped per platform — a row for tp does not affect ag resolution for the same brand', () => {
    const assignments = buildAgentAssignmentMap([
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'tp', agent: null },
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'ag', agent: 'JEN' },
    ]);
    const agentIndex = new Map<string, string>();
    expect(resolveAgentForPlatform('silver play', 'tp', assignments, agentIndex)).toBeNull();
    expect(resolveAgentForPlatform('silver play', 'ag', assignments, agentIndex)).toBe('JEN');
  });
});

describe('resolveAgentForBrand', () => {
  it('returns the first non-null platform-specific agent in platform order', () => {
    const assignments = buildAgentAssignmentMap([
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'tp', agent: null },
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'ag', agent: 'JEN' },
      { tab: 'SilverPlay', brand: 'Silver Play', platform: 'cg', agent: 'JEN' },
    ]);
    const agentIndex = new Map<string, string>();
    expect(resolveAgentForBrand('silver play', ['tp', 'ag', 'cg'], assignments, agentIndex)).toBe('JEN');
  });

  it('returns null when every platform resolves to null', () => {
    const assignments = buildAgentAssignmentMap([
      { tab: 'Rooster Partners', brand: 'Novadreams2', platform: 'tp', agent: null },
      { tab: 'Rooster Partners', brand: 'Novadreams2', platform: 'ag', agent: null },
      { tab: 'Rooster Partners', brand: 'Novadreams2', platform: 'cg', agent: null },
    ]);
    const agentIndex = new Map<string, string>();
    expect(resolveAgentForBrand('novadreams2', ['tp', 'ag', 'cg'], assignments, agentIndex)).toBeNull();
  });
});

describe('buildResolvedAgentIndex', () => {
  const entry = (data: Record<string, string | null>, updatedAt: string): Entry => ({
    id: 'x', tab: 'BITP', sheet_row_id: '1', data, updated_at: updatedAt, last_edited_by: 'dashboard', last_sync_tag: null,
  });

  it('prefers the assignment table over the per-entry heuristic', () => {
    const entries = [entry({ Brands: 'ZodiacBet.com', Agent: 'WrongAgent' }, '2026-08-01T00:00:00Z')];
    const assignmentRows = [{ tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp' as const, agent: 'ANN' }];
    const index = buildResolvedAgentIndex(entries, assignmentRows, ['tp', 'ag', 'cg']);
    expect(index.get('zodiacbet.com')).toBe('ANN');
  });

  it('falls back to the per-entry heuristic for a brand with no assignment row', () => {
    const entries = [entry({ Brands: 'Midasluck', Agent: 'Fallback' }, '2026-08-01T00:00:00Z')];
    const index = buildResolvedAgentIndex(entries, [], ['tp', 'ag', 'cg']);
    expect(index.get('midasluck')).toBe('Fallback');
  });

  it('resolves a brand that has an assignment row but no entries at all (no Agent column on this tab)', () => {
    const assignmentRows = [{ tab: 'Hanan', brand: 'ZodiacBet.com', platform: 'tp' as const, agent: 'ANN' }];
    const index = buildResolvedAgentIndex([], assignmentRows, ['tp', 'ag', 'cg']);
    expect(index.get('zodiacbet.com')).toBe('ANN');
  });

  it('has no key for a brand whose every platform resolves to null', () => {
    const assignmentRows = [
      { tab: 'Rooster Partners', brand: 'Novadreams2', platform: 'tp' as const, agent: null },
      { tab: 'Rooster Partners', brand: 'Novadreams2', platform: 'ag' as const, agent: null },
      { tab: 'Rooster Partners', brand: 'Novadreams2', platform: 'cg' as const, agent: null },
    ];
    const index = buildResolvedAgentIndex([], assignmentRows, ['tp', 'ag', 'cg']);
    expect(index.has('novadreams2')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/scheduler/scheduleUtils.test.ts -t "buildAgentAssignmentMap|resolveAgentForPlatform|resolveAgentForBrand|buildResolvedAgentIndex"`
Expected: FAIL — the four functions don't exist yet.

- [ ] **Step 3: Implement the four functions**

Add to `src/lib/scheduler/scheduleUtils.ts`, immediately after `buildCountryIndex`'s closing `}` (after line 172, before the `weeklyCompletion` doc comment):

```ts
export interface BrandAgentAssignmentRow {
  tab: string;
  brand: string;
  platform: Platform;
  agent: string | null;
}

// Keyed `${brandKey}::${platform}`. A present key -- even with a null value,
// the sheet's explicit "N/A" -- is authoritative; see resolveAgentForPlatform.
export function buildAgentAssignmentMap(rows: BrandAgentAssignmentRow[]): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const row of rows) {
    const brandKey = normalizeBrandKey(row.brand);
    map.set(`${brandKey}::${row.platform}`, row.agent);
  }
  return map;
}

// brand_agent_assignments is checked first: a matching row -- even one with
// agent === null (the sheet's explicit "N/A") -- is authoritative and skips
// the fallback entirely, so a real per-entry Agent value can be deliberately
// overridden to "unassigned." No row at all falls back to agentIndex
// (buildAgentIndex's per-entry heuristic, which has no platform concept of
// its own -- the same value is returned regardless of platform).
export function resolveAgentForPlatform(
  brandKey: string,
  platform: Platform,
  assignments: Map<string, string | null>,
  agentIndex: Map<string, string>,
): string | null {
  const key = `${brandKey}::${platform}`;
  if (assignments.has(key)) return assignments.get(key) ?? null;
  return agentIndex.get(brandKey) ?? null;
}

// One representative agent per brand, for callers that show a single value
// regardless of platform (Schedule Planner's row tooltip, Agent filter,
// landing-preview cards) -- resolved as the first non-null
// resolveAgentForPlatform result across `platforms`, in the order given
// (callers pass getTabPlatforms(tab), that tab's own platform order).
export function resolveAgentForBrand(
  brandKey: string,
  platforms: Platform[],
  assignments: Map<string, string | null>,
  agentIndex: Map<string, string>,
): string | null {
  for (const platform of platforms) {
    const agent = resolveAgentForPlatform(brandKey, platform, assignments, agentIndex);
    if (agent) return agent;
  }
  return null;
}

// Drop-in replacement for buildAgentIndex(entries) at every brand-level
// display call site -- same Map<string, string> shape (never a null-valued
// or empty-string entry, no key if unresolved), so existing consumers
// (.get(brandKey), .values(), agentFilter.includes(...)) need no changes.
// Internally merges brand_agent_assignments (via resolveAgentForBrand) over
// buildAgentIndex's per-entry fallback -- callers that need real
// platform-scoped accuracy (the PMS push) must call resolveAgentForPlatform
// directly instead, since a single merged value can't represent a brand
// whose platforms disagree (e.g. Silver Play: no TP agent, JEN on AG/CG).
export function buildResolvedAgentIndex(
  entries: Entry[],
  assignmentRows: BrandAgentAssignmentRow[],
  platforms: Platform[],
): Map<string, string> {
  const fallback = buildAgentIndex(entries);
  const assignments = buildAgentAssignmentMap(assignmentRows);
  const brandKeys = new Set<string>(fallback.keys());
  for (const key of assignments.keys()) brandKeys.add(key.split('::')[0]);
  const result = new Map<string, string>();
  for (const brandKey of brandKeys) {
    const agent = resolveAgentForBrand(brandKey, platforms, assignments, fallback);
    if (agent) result.set(brandKey, agent);
  }
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/scheduler/scheduleUtils.test.ts`
Expected: PASS (all tests in the file, including the new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduler/scheduleUtils.ts src/lib/scheduler/scheduleUtils.test.ts
git commit -m "feat: add brand_agent_assignments resolution layer to scheduleUtils"
```

---

### Task 4: Wire `TabScheduleSection.tsx`

**Files:**
- Modify: `src/components/TabScheduleSection.tsx`

**Interfaces:**
- Consumes: `fetchBrandAgentAssignments`, `BrandAgentAssignmentRow` (from `../lib/queries`, Task 2); `buildAgentAssignmentMap`, `resolveAgentForPlatform`, `buildResolvedAgentIndex` (from `../lib/scheduler/scheduleUtils`, Task 3).
- Produces: no new exports — this task only changes internal wiring. The component's existing `agentIndex` variable name and `Map<string, string>` type are preserved so its 2 existing display/filter consumers (line ~403 `agentFilter` match, line ~582 tooltip) need zero further edits.

- [ ] **Step 1: Add the import and fetch**

In `src/components/TabScheduleSection.tsx`, update the `queries` import (around line 6-17) to add `fetchBrandAgentAssignments`:

```ts
import {
  fetchRawEntriesByTab,
  fetchTabHeaders,
  fetchBrandSchedule,
  setBrandScheduleDay,
  fetchActiveBrandPlatformPauses,
  fetchRemovedPlatformBrands,
  fetchBrandPlatformOverrides,
  fetchScheduleHiddenBrands,
  fetchScheduleRestrictedBrands,
  fetchBrandAgentAssignments,
  type BrandPlatformPause,
  type BrandAgentAssignmentRow,
} from '../lib/queries';
```

Update the `scheduleUtils` import (line 25) to add the three new functions:

```ts
import { unscheduledPlatforms, buildDateStatusIndex, buildAgentIndex, buildAgentAssignmentMap, resolveAgentForPlatform, buildResolvedAgentIndex, buildCountryIndex, trailingManualPauseDays, hasNoScheduleThisWeek, PLATFORM_BADGE, PLATFORM_FULL_LABEL } from '../lib/scheduler/scheduleUtils';
```

- [ ] **Step 2: Fetch assignment rows alongside the other tab-scoped flag fetches**

In the `tabCtx` state type (around line 85-95), add a field:

```ts
  const [tabCtx, setTabCtx] = useState<{
    tab: string;
    brands: string[];
    activePlatforms: Platform[];
    entries: Entry[];
    removedPlatformBrandSet: Set<string>;
    overrideMap: Map<string, OverrideState>;
    hiddenBrandSet: Set<string>;
    platformRestrictionMap: Map<string, Platform>;
    agentAssignmentRows: BrandAgentAssignmentRow[];
    flagsLoaded: boolean;
  } | null>(null);
```

In the brand-loading effect's `Promise.all` (around line 149-156), add the fetch with the same fail-open fallback the other flag fetches already use:

```ts
        const [rawEntries, headers, removedPlatformBrandRows, overrideRows, hiddenBrandRows, restrictedBrandRows, agentAssignmentRows] = await Promise.all([
          fetchRawEntriesByTab(tab),
          fetchTabHeaders(tab),
          withFlagFallback(fetchRemovedPlatformBrands()),
          withFlagFallback(fetchBrandPlatformOverrides(tab)),
          withFlagFallback(fetchScheduleHiddenBrands(tab)),
          withFlagFallback(fetchScheduleRestrictedBrands(tab)),
          withFlagFallback(fetchBrandAgentAssignments(tab)),
        ]);
```

And add the field to the `setTabCtx(...)` call right below it (around line 164-174):

```ts
        setTabCtx({
          tab,
          brands: uniqueBrands,
          activePlatforms: platforms,
          entries: rawEntries,
          removedPlatformBrandSet: buildRemovedPlatformBrandSet(removedPlatformBrandRows),
          overrideMap: buildOverrideMap(overrideRows),
          hiddenBrandSet: buildHiddenBrandSet(hiddenBrandRows),
          platformRestrictionMap: buildPlatformRestrictionMap(restrictedBrandRows),
          agentAssignmentRows,
          flagsLoaded,
        });
```

- [ ] **Step 3: Move and replace the existing `agentIndex` memo**

The existing `agentIndex` memo (lines 306-312) sits *before* the component's
`activePlatforms` declaration (`const activePlatforms = tabCtx?.activePlatforms ?? [];`,
around line 336, inside the comment block explaining why it's declared where
it is). The replacement memo needs `activePlatforms`, so this step both
removes the old memo from its current spot and re-adds the replacement
*after* the `activePlatforms` declaration — not an in-place edit.

First, delete the existing memo entirely from lines 306-312:

```ts
  // Brand -> Agent, for PMS task assignment on push (see buildAgentIndex's own
  // doc comment for the most-recently-updated-entry resolution rule). Built
  // from the same already-loaded tabCtx.entries, no extra fetch.
  const agentIndex = useMemo(
    () => buildAgentIndex(tabCtx?.entries ?? []),
    [tabCtx],
  );
```

Then, immediately after the `const activePlatforms = tabCtx?.activePlatforms ?? [];` line (around line 336), insert:

```ts
  // Per-entry fallback only (buildAgentIndex's own heuristic) and the
  // brand_agent_assignments table, kept separate so the 3 PMS-push call
  // sites below can resolve per-platform accuracy via resolveAgentForPlatform
  // without a merged brand-level value masking a real per-platform split
  // (e.g. Silver Play: no TP agent, JEN on AG/CG).
  const rawAgentFallback = useMemo(
    () => buildAgentIndex(tabCtx?.entries ?? []),
    [tabCtx],
  );
  const agentAssignments = useMemo(
    () => buildAgentAssignmentMap(tabCtx?.agentAssignmentRows ?? []),
    [tabCtx],
  );
  // Brand -> Agent, one representative value per brand for every existing
  // display/filter consumer below (tooltip, Agent filter) -- unchanged
  // Map<string, string> shape, so those call sites need no further edits.
  // See buildResolvedAgentIndex's own doc comment for the merge rule.
  const agentIndex = useMemo(
    () => buildResolvedAgentIndex(tabCtx?.entries ?? [], tabCtx?.agentAssignmentRows ?? [], activePlatforms),
    [tabCtx, activePlatforms],
  );
```

Every downstream consumer of `agentIndex`, `dateStatusIndex`, and
`countryIndex` (all declared in this same region) is unaffected by this
reordering — only the `agentIndex` binding itself moves.

- [ ] **Step 4: Update the 3 PMS-push call sites to resolve per-platform**

Site 1 — auto-generation effect (around line 231-233):

```ts
          if (activated.length > 0) {
            pushScheduleActivations(
              activated.map((a) => ({ tab, tabLabel: tabDisplayName(tab), brand: a.brand, platform: a.platform, date: a.date, agent: resolveAgentForPlatform(a.brandKey, a.platform, agentAssignments, rawAgentFallback) })),
            ).catch((err) => {
              setToast({ message: err instanceof Error ? err.message : 'Failed to sync to PMS', kind: 'error' });
            });
          }
```

Site 2 — `handleCellClick` (around line 440):

```ts
        pushScheduleActivations([{ tab, tabLabel: tabDisplayName(tab), brand, platform, date: toISODate(addDays(weekStart, dayIndex)), agent: resolveAgentForPlatform(normalizeBrandKey(brand), platform, agentAssignments, rawAgentFallback) }]).catch((err) => {
```

Site 3 — `handleSetDayStatus` (around line 459):

```ts
        pushScheduleActivations([{ tab, tabLabel: tabDisplayName(tab), brand, platform, date: toISODate(addDays(weekStart, dayIndex)), agent: resolveAgentForPlatform(normalizeBrandKey(brand), platform, agentAssignments, rawAgentFallback) }]).catch((err) => {
```

Everything else in the file (the `agentFilter` match at line ~403 using `agentIndex.get(brandKey)`, the row tooltip at line ~582 using `agentIndex.get(brandKey)`) needs **no edits** — they keep reading the same `agentIndex` variable, which now transparently includes the new table's data via `buildResolvedAgentIndex`.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/TabScheduleSection.tsx
git commit -m "feat: resolve Agent via brand_agent_assignments in TabScheduleSection"
```

---

### Task 5: Wire `SchedulePlanner.tsx`

**Files:**
- Modify: `src/pages/SchedulePlanner.tsx`

**Interfaces:**
- Consumes: `fetchBrandAgentAssignments` (from `../lib/queries`, Task 2); `buildResolvedAgentIndex` (from `../lib/scheduler/scheduleUtils`, Task 3).
- Produces: no new exports — `TabPreview.agentIndex`'s type (`Map<string, string>`) and every consumer of it are unchanged.

- [ ] **Step 1: Update imports**

In `src/pages/SchedulePlanner.tsx` (line 9), change:

```ts
import { PLATFORM_BADGE, buildAgentIndex } from '../lib/scheduler/scheduleUtils';
```

to:

```ts
import { PLATFORM_BADGE, buildResolvedAgentIndex } from '../lib/scheduler/scheduleUtils';
```

`buildAgentIndex` is dropped from this import entirely — its only two call
sites in this file (the Agent-options dropdown effect and the landing-grid
preview effect, both fixed in Steps 2-3 below) both switch to
`buildResolvedAgentIndex`, so keeping the old import would leave it unused
and fail the build's unused-import lint. Also add `fetchBrandAgentAssignments` to this file's existing
`queries` import (alongside `fetchRawEntriesByTab`, `fetchTabHeaders`,
`fetchScheduleHiddenBrands`, `fetchScheduleRestrictedBrands`, `fetchBrandSchedule`,
etc.).

- [ ] **Step 2: Fix the Agent filter dropdown's option-collection effect**

Replace the effect around lines 145-165:

```ts
  useEffect(() => {
    let canceled = false;
    (async () => {
      const agents = new Set<string>();
      await Promise.all(
        OPERATIONAL_TABS.map(async (t) => {
          try {
            const rawEntries = await fetchRawEntriesByTab(t);
            for (const agent of buildAgentIndex(rawEntries).values()) agents.add(agent);
          } catch {
            // best-effort — a tab that fails to load just contributes no agents
          }
        }),
      );
      if (!canceled) setAgentOptions([...agents].sort());
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

with:

```ts
  useEffect(() => {
    let canceled = false;
    (async () => {
      const agents = new Set<string>();
      await Promise.all(
        OPERATIONAL_TABS.map(async (t) => {
          try {
            const [rawEntries, assignmentRows] = await Promise.all([
              fetchRawEntriesByTab(t),
              fetchBrandAgentAssignments(t).catch(() => []),
            ]);
            for (const agent of buildResolvedAgentIndex(rawEntries, assignmentRows, getTabPlatforms(t)).values()) agents.add(agent);
          } catch {
            // best-effort — a tab that fails to load just contributes no agents
          }
        }),
      );
      if (!canceled) setAgentOptions([...agents].sort());
    })();
    return () => {
      canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

(`getTabPlatforms` is already imported in this file — confirmed via its use inside the landing-preview effect at line 316.)

- [ ] **Step 3: Fix the landing-grid preview effect**

In the effect around lines 298-337, update the per-tab `Promise.all` (lines 309-315) to also fetch assignment rows, and replace the `buildAgentIndex` call (line 319) with `buildResolvedAgentIndex`:

```ts
            const [rawEntries, headers, hiddenRows, restrictedRows, scheduleRowsPerWeek, agentAssignmentRows] = await Promise.all([
              fetchRawEntriesByTab(t),
              fetchTabHeaders(t),
              fetchScheduleHiddenBrands(t),
              fetchScheduleRestrictedBrands(t),
              Promise.all(weeks.map((w) => fetchBrandSchedule(t, w))),
              fetchBrandAgentAssignments(t).catch(() => []),
            ]);
            const activePlatforms = getTabPlatforms(t);
            const hiddenSet = buildHiddenBrandSet(hiddenRows);
            const restrictionMap = buildPlatformRestrictionMap(restrictedRows);
            const agentIndex = buildResolvedAgentIndex(rawEntries, agentAssignmentRows, activePlatforms);
```

The rest of that effect (building `TabPreview`, `EMPTY_PREVIEW`, and every place that reads `preview.agentIndex`) needs **no changes** — `TabPreview.agentIndex` keeps its existing `Map<string, string>` type.

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SchedulePlanner.tsx
git commit -m "feat: resolve Agent via brand_agent_assignments in SchedulePlanner"
```

---

### Task 6: Wire `generate-weekly-schedule`'s `generateForTab`

**Files:**
- Modify: `supabase/functions/generate-weekly-schedule/index.ts`
- Test: `supabase/functions/generate-weekly-schedule/index_test.ts`

**Interfaces:**
- Consumes: `fetchBrandAgentAssignments` (from `../../../src/lib/queries.ts`, Task 2); `buildAgentIndex`, `buildAgentAssignmentMap`, `resolveAgentForPlatform` (from `../../../src/lib/scheduler/scheduleUtils.ts`, Task 3).
- Produces: `generateForTab`'s pushed `PmsSyncItem`s now carry a real `agent` field — this closes the currently-dormant gap where the not-yet-deployed cron path never set one at all.

- [ ] **Step 1: Write the failing test**

In `supabase/functions/generate-weekly-schedule/index_test.ts`, update the existing `'generateForTab pushes every combo ensureWeekGenerated just activated to PMS'` test (lines 107-140): add a `brand_agent_assignments` table to the `fakeClient(...)` call and assert the pushed item's `agent`.

Change:

```ts
Deno.test('generateForTab pushes every combo ensureWeekGenerated just activated to PMS', async () => {
  const client = fakeClient({
    entries: [entry('BITP', '1', { Brands: 'WinMega' })],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
    brand_platform_override: [],
    schedule_hidden_brands: [],
    schedule_platform_restrictions: [],
  });
```

to:

```ts
Deno.test('generateForTab pushes every combo ensureWeekGenerated just activated to PMS, with the resolved Agent', async () => {
  const client = fakeClient({
    entries: [entry('BITP', '1', { Brands: 'WinMega' })],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
    brand_platform_override: [],
    schedule_hidden_brands: [],
    schedule_platform_restrictions: [],
    brand_agent_assignments: [{ tab: 'BITP', brand: 'WinMega', platform: 'tp', agent: 'Jen' }],
  });
```

and the assertions at the end of that test:

```ts
  assertEquals(pushedBatches.length, 1);
  const batch = pushedBatches[0] as { brand: string; platform: string; agent?: string | null }[];
  assertEquals(batch.length > 0, true);
  assertEquals(batch[0].brand, 'WinMega');
  assertEquals(batch[0].platform, 'tp');
  assertEquals(batch[0].agent, 'Jen');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test --allow-env --allow-net --no-check supabase/functions/generate-weekly-schedule/index_test.ts`
Expected: FAIL — `batch[0].agent` is `undefined`, not `'Jen'`.

- [ ] **Step 3: Implement the fix in `generateForTab`**

In `supabase/functions/generate-weekly-schedule/index.ts`, update the `queries.ts` import (line 15) to add `fetchBrandAgentAssignments`:

```ts
import { fetchRawEntriesByTab, fetchTabHeaders, fetchRemovedPlatformBrands, fetchBrandPlatformOverrides, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, fetchBrandAgentAssignments, invalidateTabCache, fetchCustomTabs, fetchHiddenTabPlatforms } from '../../../src/lib/queries.ts';
```

Add a new import line right after the `pmsSync.ts` import (line 22):

```ts
import { buildAgentIndex, buildAgentAssignmentMap, resolveAgentForPlatform } from '../../../src/lib/scheduler/scheduleUtils.ts';
```

Replace `generateForTab` (lines 63-83):

```ts
export async function generateForTab(
  tab: string,
  weekStart: string,
  client: SupabaseClient,
  pushFn: (items: PmsSyncItem[], client: SupabaseClient, credentials: { apiToken: string }) => Promise<unknown> = pushScheduleToPms,
): Promise<void> {
  const ctx = await buildTabContext(tab, client);
  if (ctx.brands.length === 0 || ctx.activePlatforms.length === 0) return;
  const resumed = await recalculatePauses(tab, weekStart, ctx, client);
  const activated = await ensureWeekGenerated(tab, weekStart, ctx, resumed, client);
  // Read live (not a module-level const) so this stays testable: a
  // module-level `Deno.env.get(...)` is captured once at import time, before
  // any Deno.test() body runs, so a test could never make this gate see a
  // token it sets itself. This function runs once per HTTP invocation, so
  // there's no meaningful perf cost to reading it live each time.
  const pmsApiToken = Deno.env.get('PMS_API_TOKEN') || '';
  if (activated.length > 0 && pmsApiToken) {
    // Same resolveAgentForPlatform layer the browser-side manual push path
    // uses (TabScheduleSection.tsx) -- this cron path previously built
    // PmsSyncItem[] with no `agent` field at all, a pre-existing, previously
    // dormant gap since this function has never been deployed. Fetched here
    // (not in buildTabContext/TabContext) since recalculatePauses/
    // ensureWeekGenerated have no use for Agent data themselves. Fails open
    // (empty array) on a transient fetch error, same shape as this file's
    // other best-effort fetches (fetchCustomTabs/fetchHiddenTabPlatforms
    // above) -- a missing assignment table read must not block the push,
    // it just means every item falls back to the per-entry heuristic.
    const assignmentRows = await fetchBrandAgentAssignments(tab, client).catch(() => []);
    const agentAssignments = buildAgentAssignmentMap(assignmentRows);
    const rawAgentFallback = buildAgentIndex(ctx.entries);
    const items: PmsSyncItem[] = activated.map((a) => ({
      tab,
      tabLabel: tabDisplayName(tab),
      brand: a.brand,
      platform: a.platform,
      date: a.date,
      agent: resolveAgentForPlatform(a.brandKey, a.platform, agentAssignments, rawAgentFallback),
    }));
    await pushFn(items, client, { apiToken: pmsApiToken });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test --allow-env --allow-net --no-check supabase/functions/generate-weekly-schedule/index_test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-weekly-schedule/index.ts supabase/functions/generate-weekly-schedule/index_test.ts
git commit -m "fix: resolve Agent via brand_agent_assignments in generate-weekly-schedule's PMS push"
```

Note: `generate-weekly-schedule` itself remains **not deployed** (a pre-existing,
already-documented pending item — this task only fixes its code, matching
this project's established "fix code now, defer deploy" pattern from Task
207/218/232).

---

### Task 7: Live verification and whole-branch review

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass (no regressions in the existing suite).

Run: `deno test --allow-env --allow-net --no-check supabase/functions/generate-weekly-schedule/index_test.ts`
Expected: all tests pass.

- [ ] **Step 2: Live-verify in the browser via Playwright**

Start the dev server (`npm run dev`) if not already running, sign in using
the credentials in `.env` (`CAPTURE_EMAIL`/`CAPTURE_PASSWORD`), and using
the Playwright MCP tools:

1. Open Schedule Planner, select the **Hanan** tab (a tab with no per-entry
   Agent column at all — currently shows nothing for Agent anywhere). Hover
   a brand row's tooltip (e.g. ZodiacBet.com) and confirm it now shows
   `Agent: ANN`.
2. Open the Agent filter dropdown on the Schedule Planner landing page and
   confirm `ANN`, `JEN`, and `LAI` all now appear as options (previously
   `ANN`/`JEN` could never appear for tabs with no Agent column, and `LAI`
   only ever came from Rooster Partners' sometimes-inconsistent per-entry
   data).
3. Select the **SilverPlay** tab, hover the Silver Play row's tooltip, and
   confirm it shows `Agent: JEN` (resolved from the AG/CG assignment rows,
   since TP is explicit N/A for this brand).
4. Click a blank day cell for a Hanan brand to activate it (if
   `VITE_SYNC_SCHEDULE_PMS_URL` is set in the deployed environment — if not
   set, this step silently no-ops per this feature's existing fail-open
   design; note whichever is the case rather than treating a no-op as a
   failure).

- [ ] **Step 3: Whole-branch review**

Review the full diff across all 6 prior tasks together (`git diff main...HEAD`
or equivalent), checking specifically for:
- Every call site that previously called `buildAgentIndex(...)` directly for
  brand-level display purposes now goes through `buildResolvedAgentIndex`
  instead (grep for `buildAgentIndex(` across `src/` and
  `supabase/functions/` — the only remaining direct calls should be inside
  `scheduleUtils.ts` itself, the `rawAgentFallback` memos in
  `TabScheduleSection.tsx`/`generate-weekly-schedule/index.ts`, and the
  `scheduleUtils.test.ts`/`queries.test.ts` test files).
- The 3 PMS-push call sites in `TabScheduleSection.tsx` and the 1 in
  `generate-weekly-schedule/index.ts` all resolve per-platform via
  `resolveAgentForPlatform`, never the merged `agentIndex`.
- No other file in the repo independently re-implements Agent resolution
  (grep for `.data.Agent` and `entry.data.Agent` outside `scheduleUtils.ts`
  and its test file — none should exist).

- [ ] **Step 4: Update `docs/task-history.md`**

Append an entry documenting this task (tab/brand/platform counts, the
Trybet.com spelling correction, the generate-weekly-schedule dormant-gap
fix, and that `generate-weekly-schedule` itself is still pending deploy) —
follow the exact style of the most recent entries in that file. This
repo's Stop hook auto-syncs `docs/task-history.md` entries to the PMS
Review/QA column; no manual PMS API calls are needed.
