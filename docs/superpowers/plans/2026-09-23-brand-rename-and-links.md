# Brand Rename + Editable Brand Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an approved user rename a brand (globally, every tab) and edit its per-platform page links, from Edit Brand Tab's new Brands list and from Edit Entry's Brand Name field.

**Architecture:** Two new security-definer Postgres RPCs do all brand-keyed writes atomically: `rename_brand` (entries.data brand field + every public table with a `brand` column, discovered via `information_schema`, same technique as `rename_hardcoded_tab`) and `set_brand_links` (writes link values into entry columns). The client computes *which* column each platform's link lives in per tab (that mapping depends on client-side tab-rename resolution) and passes explicit `{tab, column, value}` writes to the RPCs. A small orchestrator (`src/lib/brandRename.ts`) builds those writes; UI lives in a new `TabBrandsSection` component and a pencil action in `EditEntryModal`.

**Tech Stack:** Vite 6 · React 19 · TypeScript strict · Tailwind v4 · Supabase (Postgres plpgsql RPCs, supabase-js) · Vitest

**Spec:** `docs/superpowers/specs/2026-09-23-brand-rename-and-links-design.md`

**Spec amendment (deliberate):** the spec said link writes need "no new RPC". While planning it turned out a client can't reliably select "every entry of brand X on every tab" through PostgREST (the brand lives under one of six differently named jsonb keys, several containing spaces/slashes). So links go through a `set_brand_links` RPC that shares the SQL brand-matching helper with `rename_brand`. The fallback-link preservation also moves *into* `rename_brand` (a `p_link_fills` argument) so the fill + rename happen in one transaction.

## Global Constraints

- Rename is global: every tab carrying the brand name.
- Rename to a name that already exists (different `lower(btrim())` key) is **blocked** with `a brand named "<name>" already exists`. Case/whitespace-only change is allowed.
- History/log tables keep the old name: `full_check_removed_entries`, `delete_log`, `edit_log`, `tab_archive_log`.
- Every changed entry gets one `edit_log` row (`entity_type='entry'`, `before_data` = full row before the change), same as a normal entry edit.
- Brand identity key per entry = first key of `BRAND_COLS` (`['Brands','Brand Name','Brand','Brand / TP URL PAGE','URL PAGE','Account Name']`) present in `entries.data`. SQL copy of the list must equal `tab-configs.ts`'s (enforced by a test).
- Link columns: TP → `getBrandLinkCol(tab)` unless that returns `'Link to the profile'` (then TP has no link column); AG → `'AG Review Link'`; CG → `'CG Review Link'`; WO → `'Link to the profile'`. Only platforms returned by `getTabPlatforms(tab)` count. Custom platforms: no link field.
- Verify with `npm run build` (root tsconfig is references-only; `tsc --noEmit` checks nothing) and `npx vitest run`.
- All Supabase access goes through `src/lib/queries.ts`.
- New dialogs close on Escape via a `document` keydown `useEffect` (BrandTabsModal pattern), not an `onKeyDown` on the container.
- Migration filename: `supabase/migrations/20260923120000_add_rename_brand_functions.sql`. Before pushing, check `git log origin/main -- supabase/migrations` for a concurrent session's colliding timestamp and renumber if needed.

## Review Focus

1. **Renaming to an existing brand on a *different* tab** — the user expects a clear "already exists" error and zero rows changed, not a merge. Pinned: Task 1 Step 6 live check (c).
2. **Edit Entry: rename, then press Save Changes** — the entry's form still holds pre-rename link fields; a later Save must not blank out links the rename just filled. Pinned: Task 6 `applyRenameToFields` test.
3. **Case-only rename (`librabet casino` → `Librabet Casino`)** — must succeed, not trip the collision guard or a `(tab, brand_key)` unique constraint. Pinned: Task 1 Step 6 live check (d).
4. **Blank link input** — saving a row where a link field was cleared must not wipe that link on every entry across every tab. Pinned: Task 2 `buildLinkWrites` skips empty values test.
5. **Catalog-only brand (no entries yet)** — renaming must still rename `brand_catalog`; link save must still update `brand_catalog.link`. Pinned: Task 1 Step 6 live check (a) uses a catalog-only scratch brand; `set_brand_links` updates catalog link for TP.

---

### Task 1: Database RPCs

**Files:**
- Create: `supabase/migrations/20260923120000_add_rename_brand_functions.sql`
- Test: `src/lib/brandRenameMigration.test.ts`

**Interfaces:**
- Produces (SQL, callable via `supabase.rpc`):
  - `rename_brand(p_old text, p_new text, p_link_fills jsonb default '[]') returns integer` — number of entries whose brand changed. `p_link_fills` = `[{ "tab": string, "column": string, "value": string }]`, applied only to entries of `p_old` where that column is empty, **before** renaming.
  - `set_brand_links(p_brand text, p_writes jsonb) returns integer` — `p_writes` same shape; overwrites that column on every entry of `p_brand` on that tab (non-empty values only). Also sets `brand_catalog.link` for rows of that brand/tab when a write's `"platform"` is `"tp"`.
  - `count_brand_usage(p_name text) returns table(entry_count integer, tab_count integer)`.
  - `entry_brand_col(p_data jsonb) returns text` (internal helper).

- [ ] **Step 1: Write the failing sync test**

```ts
// src/lib/brandRenameMigration.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BRAND_COLS } from './tab-configs';

// rename_brand/set_brand_links resolve an entry's brand key from a SQL copy
// of BRAND_COLS. If the two lists drift, a rename silently misses (or
// clobbers) the wrong jsonb key — so pin them together.
describe('rename_brand migration', () => {
  it('embeds the same BRAND_COLS list, in the same order, as tab-configs.ts', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20260923120000_add_rename_brand_functions.sql'),
      'utf8',
    );
    const m = sql.match(/-- BRAND_COLS-SYNC\s*\n\s*array\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const sqlCols = [...m![1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
    expect(sqlCols).toEqual(BRAND_COLS);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/brandRenameMigration.test.ts`
Expected: FAIL — `ENOENT` (migration file doesn't exist).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260923120000_add_rename_brand_functions.sql
-- Brand rename + editable brand links
-- (docs/superpowers/specs/2026-09-23-brand-rename-and-links-design.md).
-- A brand has no id: its display name is the key in entries.data (under the
-- first BRAND_COLS key the row carries) and in every table with a `brand`
-- column. rename_brand rewrites all of them in one transaction; the table
-- list is discovered via information_schema (same reasoning as
-- rename_hardcoded_tab, 20260901180000: a hardcoded list would silently stop
-- covering the next brand-keyed table someone adds). History/log tables are
-- excluded on purpose -- they record the name as it was at the time.

-- First BRAND_COLS key present in an entry's data -- mirrors how the client
-- picks a tab's brand column (BRAND_COLS.find(c => headers.includes(c))).
create or replace function public.entry_brand_col(p_data jsonb)
returns text
language sql
immutable
as $$
  select c
  from unnest(
    -- BRAND_COLS-SYNC
    array['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE', 'Account Name']
  ) with ordinality as t(c, ord)
  where p_data ? c
  order by ord
  limit 1
$$;

create or replace function public.count_brand_usage(p_name text)
returns table(entry_count integer, tab_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int, count(distinct tab)::int
  from public.entries e
  where public.entry_brand_col(e.data) is not null
    and lower(btrim(e.data ->> public.entry_brand_col(e.data))) = lower(btrim(p_name))
$$;

-- Applies [{tab, column, value, platform?}] writes to every entry of p_brand.
-- p_only_fill_empty = true leaves a non-empty existing value alone (used by
-- rename_brand to materialize hardcoded fallback links before the name they
-- are keyed by goes away). Logs each changed entry to edit_log.
create or replace function public._apply_brand_link_writes(
  p_brand text, p_writes jsonb, p_only_fill_empty boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  w jsonb;
  rec record;
  v_col text;
  v_val text;
  v_changed integer := 0;
  v_actor uuid := auth.uid();
  v_email text := coalesce((select email from auth.users where id = auth.uid()), '');
begin
  for w in select * from jsonb_array_elements(coalesce(p_writes, '[]'::jsonb)) loop
    v_col := w ->> 'column';
    v_val := btrim(coalesce(w ->> 'value', ''));
    continue when v_col is null or v_val = '';
    for rec in
      select e.* from public.entries e
      where e.tab = w ->> 'tab'
        and public.entry_brand_col(e.data) is not null
        and lower(btrim(e.data ->> public.entry_brand_col(e.data))) = lower(btrim(p_brand))
        and coalesce(e.data ->> v_col, '') is distinct from v_val
        and (not p_only_fill_empty or btrim(coalesce(e.data ->> v_col, '')) in ('', '—'))
    loop
      insert into public.edit_log (entity_type, entity_id, tab, before_data, actor_id, actor_email)
      values ('entry', rec.id, rec.tab, to_jsonb(rec), v_actor, v_email);
      update public.entries
        set data = jsonb_set(data, array[v_col], to_jsonb(v_val), true)
        where id = rec.id;
      v_changed := v_changed + 1;
    end loop;
    if w ->> 'platform' = 'tp' and not p_only_fill_empty then
      update public.brand_catalog set link = v_val
        where tab = w ->> 'tab' and brand_key = lower(btrim(p_brand));
    end if;
  end loop;
  return v_changed;
end;
$$;

create or replace function public.set_brand_links(p_brand text, p_writes jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;
  return public._apply_brand_link_writes(p_brand, p_writes, false);
end;
$$;

create or replace function public.rename_brand(p_old text, p_new text, p_link_fills jsonb default '[]'::jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new text := btrim(coalesce(p_new, ''));
  v_old_key text := lower(btrim(coalesce(p_old, '')));
  v_new_key text;
  rec record;
  v_col text;
  v_exists boolean;
  v_changed integer := 0;
  v_actor uuid := auth.uid();
  v_email text := coalesce((select email from auth.users where id = auth.uid()), '');
begin
  if not public.is_approved() then
    raise exception 'not approved';
  end if;
  if v_new = '' then
    raise exception 'brand name cannot be empty';
  end if;
  if v_old_key = '' then
    raise exception 'old brand name cannot be empty';
  end if;
  v_new_key := lower(v_new);

  -- Collision guard: a different brand already using the new name anywhere
  -- (entries or any brand-keyed table) blocks the rename. No merging.
  if v_new_key <> v_old_key then
    if exists (
      select 1 from public.entries e
      where public.entry_brand_col(e.data) is not null
        and lower(btrim(e.data ->> public.entry_brand_col(e.data))) = v_new_key
    ) then
      raise exception 'a brand named "%" already exists', v_new;
    end if;
    for rec in
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'brand'
        and table_name not in ('full_check_removed_entries', 'delete_log', 'edit_log', 'tab_archive_log')
    loop
      execute format('select exists (select 1 from public.%I where lower(btrim(brand)) = $1)', rec.table_name)
        into v_exists using v_new_key;
      if v_exists then
        raise exception 'a brand named "%" already exists', v_new;
      end if;
    end loop;
  end if;

  -- Materialize hardcoded fallback links while the old name still matches.
  perform public._apply_brand_link_writes(p_old, p_link_fills, true);

  -- Entries: rewrite the brand identity key.
  for rec in
    select e.* from public.entries e
    where public.entry_brand_col(e.data) is not null
      and lower(btrim(e.data ->> public.entry_brand_col(e.data))) = v_old_key
  loop
    v_col := public.entry_brand_col(rec.data);
    continue when rec.data ->> v_col = v_new;
    insert into public.edit_log (entity_type, entity_id, tab, before_data, actor_id, actor_email)
    values ('entry', rec.id, rec.tab, to_jsonb(rec), v_actor, v_email);
    update public.entries
      set data = jsonb_set(data, array[v_col], to_jsonb(v_new), false)
      where id = rec.id;
    v_changed := v_changed + 1;
  end loop;

  -- Every other brand-keyed table (brand_key columns are generated).
  for rec in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'brand'
      and table_name not in ('full_check_removed_entries', 'delete_log', 'edit_log', 'tab_archive_log')
  loop
    execute format('update public.%I set brand = $1 where lower(btrim(brand)) = $2', rec.table_name)
      using v_new, v_old_key;
  end loop;

  return v_changed;
end;
$$;

revoke execute on function public._apply_brand_link_writes(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.set_brand_links(text, jsonb) to authenticated;
grant execute on function public.rename_brand(text, text, jsonb) to authenticated;
grant execute on function public.count_brand_usage(text) to authenticated;
```

Before writing, confirm `information_schema.columns` includes views with a `brand` column (e.g. `bif_review_accounts` view from 20260803160000). If any view has `brand`, add it to the exclusion list — updating a non-updatable view errors. Query live:
`select table_name, (select table_type from information_schema.tables t where t.table_name=c.table_name and t.table_schema='public') from information_schema.columns c where table_schema='public' and column_name='brand';`
and add every `VIEW` row to both `not in (...)` lists.

- [ ] **Step 4: Run the sync test**

Run: `npx vitest run src/lib/brandRenameMigration.test.ts`
Expected: PASS.

- [ ] **Step 5: Push the migration**

Run: `npx supabase db push` (worktree needs its own `supabase link --project-ref <ref>` first — see memory `project_supabase_worktree_link`). Do NOT run `migration repair` or any destructive ledger command; if history drift is reported, stop and report it.
Expected: only `20260923120000_add_rename_brand_functions.sql` applied.

- [ ] **Step 6: Live-verify on a scratch brand** (SQL editor / `supabase db` query as an approved user context, or via a short node script using CAPTURE_EMAIL/CAPTURE_PASSWORD from `.env` to sign in and call `supabase.rpc`)

  (a) Insert catalog-only scratch brand: `insert into brand_catalog(tab, brand) values ('BIT', 'ZZ Rename Test');` → `rename_brand('ZZ Rename Test','ZZ Rename Test 2')` returns 0; `brand_catalog` row now `ZZ Rename Test 2`.
  (b) `count_brand_usage('Librabet Casino')` returns plausible counts (non-zero entries).
  (c) Collision: `rename_brand('ZZ Rename Test 2','Librabet Casino')` raises `a brand named "Librabet Casino" already exists`; scratch row unchanged.
  (d) Case-only: `rename_brand('ZZ Rename Test 2','zz rename test 2')` succeeds.
  (e) Cleanup: `delete from brand_catalog where brand_key = 'zz rename test 2';`

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260923120000_add_rename_brand_functions.sql src/lib/brandRenameMigration.test.ts
git commit -m "feat(db): rename_brand / set_brand_links / count_brand_usage RPCs"
```

---

### Task 2: Link-column mapping + write builders (pure)

**Files:**
- Create: `src/lib/brandRename.ts`
- Test: `src/lib/brandRename.test.ts`

**Interfaces:**
- Consumes: `getBrandLinkCol`, `getTabPlatforms`, `resolveBrandLink`, `getBrandAgUrl`, `getBrandCgUrl` from `./tab-configs`.
- Produces:
  - `export type LinkPlatform = 'tp' | 'ag' | 'cg' | 'wo';`
  - `export const LINK_PLATFORMS: LinkPlatform[] = ['tp','ag','cg','wo'];`
  - `export interface BrandLinkWrite { tab: string; column: string; value: string; platform: LinkPlatform }`
  - `export function brandLinkColumnFor(tab: string, platform: LinkPlatform): string | null`
  - `export function tabLinkPlatforms(tab: string): LinkPlatform[]` — `getTabPlatforms(tab)` ∩ LINK_PLATFORMS with a non-null column.
  - `export function buildLinkWrites(tabs: string[], links: Partial<Record<LinkPlatform, string>>): BrandLinkWrite[]` — one write per (tab, platform with non-empty trimmed value, platform enabled on tab).
  - `export function buildFallbackFills(tabs: string[], brand: string): BrandLinkWrite[]` — per tab/enabled platform, the hardcoded fallback (`tp`: `resolveBrandLink(brand, tab)`, `ag`: `getBrandAgUrl`, `cg`: `getBrandCgUrl`, `wo`: none); empties dropped.
  - `export function effectiveBrandLinks(tab: string, brand: string, profile: Record<string,string> | undefined): Partial<Record<LinkPlatform, string>>` — per enabled platform: `profile[col]` else the fallback from above, else `''`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/brandRename.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('./tab-configs', () => ({
  getBrandLinkCol: (tab: string) =>
    tab === 'BIT' ? 'Brand / TP URL PAGE__href' : tab === 'Wizard of Odds' ? 'Link to the profile' : 'Brand Link',
  getTabPlatforms: (tab: string) =>
    tab === 'BIT' ? ['tp'] : tab === 'Wizard of Odds' ? ['wo'] : tab === 'SilverPlay' ? ['tp', 'ag', 'cg', 'custom-x'] : ['tp'],
  resolveBrandLink: (brand: string) => (brand === 'rooster.bet' ? 'https://tp/rooster' : ''),
  getBrandAgUrl: (brand: string) => (brand === 'rooster.bet' ? 'https://ag/rooster' : undefined),
  getBrandCgUrl: () => undefined,
}));

import { brandLinkColumnFor, tabLinkPlatforms, buildLinkWrites, buildFallbackFills, effectiveBrandLinks } from './brandRename';

describe('brandLinkColumnFor', () => {
  it('maps TP to the tab brand-link column', () => {
    expect(brandLinkColumnFor('BIT', 'tp')).toBe('Brand / TP URL PAGE__href');
    expect(brandLinkColumnFor('SilverPlay', 'tp')).toBe('Brand Link');
  });
  it('gives TP no column on Wizard of Odds (its link col belongs to WO)', () => {
    expect(brandLinkColumnFor('Wizard of Odds', 'tp')).toBeNull();
    expect(brandLinkColumnFor('Wizard of Odds', 'wo')).toBe('Link to the profile');
  });
  it('maps AG/CG to their review-link columns', () => {
    expect(brandLinkColumnFor('SilverPlay', 'ag')).toBe('AG Review Link');
    expect(brandLinkColumnFor('SilverPlay', 'cg')).toBe('CG Review Link');
  });
});

describe('tabLinkPlatforms', () => {
  it('keeps only enabled built-in link platforms, dropping custom ones', () => {
    expect(tabLinkPlatforms('SilverPlay')).toEqual(['tp', 'ag', 'cg']);
    expect(tabLinkPlatforms('BIT')).toEqual(['tp']);
    expect(tabLinkPlatforms('Wizard of Odds')).toEqual(['wo']);
  });
});

describe('buildLinkWrites', () => {
  it('writes each non-empty link to every tab where that platform is enabled', () => {
    const w = buildLinkWrites(['BIT', 'SilverPlay'], { tp: ' https://tp/x ', ag: 'https://ag/x' });
    expect(w).toEqual([
      { tab: 'BIT', column: 'Brand / TP URL PAGE__href', value: 'https://tp/x', platform: 'tp' },
      { tab: 'SilverPlay', column: 'Brand Link', value: 'https://tp/x', platform: 'tp' },
      { tab: 'SilverPlay', column: 'AG Review Link', value: 'https://ag/x', platform: 'ag' },
    ]);
  });
  it('skips empty/blank values so clearing an input never wipes links everywhere', () => {
    expect(buildLinkWrites(['SilverPlay'], { tp: '', ag: '   ' })).toEqual([]);
  });
});

describe('buildFallbackFills', () => {
  it('emits hardcoded fallbacks for enabled platforms only', () => {
    expect(buildFallbackFills(['SilverPlay', 'BIT'], 'rooster.bet')).toEqual([
      { tab: 'SilverPlay', column: 'Brand Link', value: 'https://tp/rooster', platform: 'tp' },
      { tab: 'SilverPlay', column: 'AG Review Link', value: 'https://ag/rooster', platform: 'ag' },
      { tab: 'BIT', column: 'Brand / TP URL PAGE__href', value: 'https://tp/rooster', platform: 'tp' },
    ]);
  });
  it('emits nothing for a brand with no hardcoded links', () => {
    expect(buildFallbackFills(['SilverPlay'], 'Librabet')).toEqual([]);
  });
});

describe('effectiveBrandLinks', () => {
  it('prefers the tab profile value, falls back to hardcoded, else empty', () => {
    expect(effectiveBrandLinks('SilverPlay', 'rooster.bet', { 'Brand Link': 'https://tp/own' })).toEqual({
      tp: 'https://tp/own', ag: 'https://ag/rooster', cg: '',
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/brandRename.test.ts`
Expected: FAIL — cannot resolve `./brandRename`.

- [ ] **Step 3: Implement**

```ts
// src/lib/brandRename.ts
// Pure helpers for brand rename + editable brand links
// (docs/superpowers/specs/2026-09-23-brand-rename-and-links-design.md).
// The (tab, platform) -> entry column mapping lives here, client-side,
// because it depends on hardcoded-tab-rename resolution (getBrandLinkCol);
// the rename_brand/set_brand_links RPCs just apply the explicit writes.
import { getBrandLinkCol, getTabPlatforms, resolveBrandLink, getBrandAgUrl, getBrandCgUrl } from './tab-configs';

export type LinkPlatform = 'tp' | 'ag' | 'cg' | 'wo';
export const LINK_PLATFORMS: LinkPlatform[] = ['tp', 'ag', 'cg', 'wo'];

export interface BrandLinkWrite {
  tab: string;
  column: string;
  value: string;
  platform: LinkPlatform;
}

export function brandLinkColumnFor(tab: string, platform: LinkPlatform): string | null {
  switch (platform) {
    case 'tp': {
      const col = getBrandLinkCol(tab);
      return col === 'Link to the profile' ? null : col;
    }
    case 'ag': return 'AG Review Link';
    case 'cg': return 'CG Review Link';
    case 'wo': return 'Link to the profile';
  }
}

export function tabLinkPlatforms(tab: string): LinkPlatform[] {
  const enabled = new Set(getTabPlatforms(tab));
  return LINK_PLATFORMS.filter((p) => enabled.has(p) && brandLinkColumnFor(tab, p) !== null);
}

function fallbackLink(tab: string, brand: string, platform: LinkPlatform): string {
  if (platform === 'tp') return resolveBrandLink(brand, tab);
  if (platform === 'ag') return getBrandAgUrl(brand) ?? '';
  if (platform === 'cg') return getBrandCgUrl(brand) ?? '';
  return '';
}

export function buildLinkWrites(tabs: string[], links: Partial<Record<LinkPlatform, string>>): BrandLinkWrite[] {
  const writes: BrandLinkWrite[] = [];
  for (const tab of tabs) {
    for (const platform of tabLinkPlatforms(tab)) {
      const value = links[platform]?.trim();
      if (!value) continue;
      writes.push({ tab, column: brandLinkColumnFor(tab, platform)!, value, platform });
    }
  }
  return writes;
}

export function buildFallbackFills(tabs: string[], brand: string): BrandLinkWrite[] {
  const writes: BrandLinkWrite[] = [];
  for (const tab of tabs) {
    for (const platform of tabLinkPlatforms(tab)) {
      const value = fallbackLink(tab, brand, platform).trim();
      if (!value) continue;
      writes.push({ tab, column: brandLinkColumnFor(tab, platform)!, value, platform });
    }
  }
  return writes;
}

export function effectiveBrandLinks(
  tab: string,
  brand: string,
  profile: Record<string, string> | undefined,
): Partial<Record<LinkPlatform, string>> {
  const out: Partial<Record<LinkPlatform, string>> = {};
  for (const platform of tabLinkPlatforms(tab)) {
    const col = brandLinkColumnFor(tab, platform)!;
    out[platform] = profile?.[col] || fallbackLink(tab, brand, platform);
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/brandRename.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/brandRename.ts src/lib/brandRename.test.ts
git commit -m "feat: brand link column mapping + rename write builders"
```

---

### Task 3: Query functions

**Files:**
- Modify: `src/lib/queries.ts` (add after `addBrandToCatalog`, ~line 1304)
- Test: `src/lib/queries.test.ts` (add to import list + new `describe`)

**Interfaces:**
- Consumes: `BrandLinkWrite` from `./brandRename`; RPCs from Task 1.
- Produces:
  - `export async function renameBrand(oldName: string, newName: string, linkFills: BrandLinkWrite[] = []): Promise<number>`
  - `export async function setBrandLinks(brand: string, writes: BrandLinkWrite[]): Promise<number>`
  - `export async function fetchBrandUsage(name: string): Promise<{ entryCount: number; tabCount: number }>`

- [ ] **Step 1: Write failing tests** (append to `src/lib/queries.test.ts`; add the three names to the existing `import { … } from './queries'` block)

```ts
describe('brand rename queries', () => {
  beforeEach(() => singletonRpc.mockReset());

  it('renameBrand calls rename_brand with the fills and returns the count', async () => {
    singletonRpc.mockResolvedValue({ data: 4, error: null });
    const fills = [{ tab: 'BIT', column: 'Brand / TP URL PAGE__href', value: 'https://x', platform: 'tp' as const }];
    await expect(renameBrand('Librabet Casino', 'Librabet', fills)).resolves.toBe(4);
    expect(singletonRpc).toHaveBeenCalledWith('rename_brand', { p_old: 'Librabet Casino', p_new: 'Librabet', p_link_fills: fills });
  });

  it('renameBrand surfaces the collision error message verbatim', async () => {
    singletonRpc.mockResolvedValue({ data: null, error: { message: 'a brand named "Librabet" already exists' } });
    await expect(renameBrand('A', 'Librabet')).rejects.toThrow('a brand named "Librabet" already exists');
  });

  it('setBrandLinks calls set_brand_links', async () => {
    singletonRpc.mockResolvedValue({ data: 2, error: null });
    await expect(setBrandLinks('Librabet', [])).resolves.toBe(2);
    expect(singletonRpc).toHaveBeenCalledWith('set_brand_links', { p_brand: 'Librabet', p_writes: [] });
  });

  it('fetchBrandUsage maps the single result row', async () => {
    singletonRpc.mockResolvedValue({ data: [{ entry_count: 7, tab_count: 2 }], error: null });
    await expect(fetchBrandUsage('Librabet')).resolves.toEqual({ entryCount: 7, tabCount: 2 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/queries.test.ts -t "brand rename queries"`
Expected: FAIL — `renameBrand` is not exported.

- [ ] **Step 3: Implement** (in `queries.ts`, after `addBrandToCatalog`; add `import type { BrandLinkWrite } from './brandRename';` to the imports)

```ts
// Global brand rename (every tab) -- see rename_brand in
// 20260923120000_add_rename_brand_functions.sql. linkFills are applied to
// empty link columns of the old brand's entries first, in the same
// transaction, so hardcoded fallback links keyed by the old name survive.
// PostgrestError isn't an Error instance, so rethrow with its message.
export async function renameBrand(oldName: string, newName: string, linkFills: BrandLinkWrite[] = []): Promise<number> {
  const { data, error } = await supabase.rpc('rename_brand', { p_old: oldName, p_new: newName, p_link_fills: linkFills });
  if (error) throw new Error(error.message);
  return (data as number | null) ?? 0;
}

export async function setBrandLinks(brand: string, writes: BrandLinkWrite[]): Promise<number> {
  const { data, error } = await supabase.rpc('set_brand_links', { p_brand: brand, p_writes: writes });
  if (error) throw new Error(error.message);
  return (data as number | null) ?? 0;
}

export async function fetchBrandUsage(name: string): Promise<{ entryCount: number; tabCount: number }> {
  const { data, error } = await supabase.rpc('count_brand_usage', { p_name: name });
  if (error) throw new Error(error.message);
  const row = (data as { entry_count: number; tab_count: number }[] | null)?.[0];
  return { entryCount: row?.entry_count ?? 0, tabCount: row?.tab_count ?? 0 };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/queries.test.ts`
Expected: PASS (all, including the 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/lib/queries.test.ts
git commit -m "feat: renameBrand / setBrandLinks / fetchBrandUsage queries"
```

---

### Task 4: Shared rename dialog

**Files:**
- Create: `src/components/BrandRenameDialog.tsx`
- Modify: `src/lib/brandRename.ts` (add `performBrandRename`)
- Test: `src/lib/brandRename.test.ts` (add `performBrandRename` test)

**Interfaces:**
- Consumes: `renameBrand`, `fetchBrandUsage` (Task 3); `buildFallbackFills` (Task 2); `OPERATIONAL_TABS` from `./tabs`.
- Produces:
  - `export async function performBrandRename(oldName: string, newName: string): Promise<{ changed: number; fills: BrandLinkWrite[] }>` in `brandRename.ts`.
  - `BrandRenameDialog` default export, props `{ oldName: string; newName: string; onDone: (result: { changed: number; fills: BrandLinkWrite[] }) => void; onCancel: () => void }`. Shows "Rename "{old}" → "{new}" on {N} entries across {M} tabs?" (fetched via `fetchBrandUsage(oldName)`), Confirm/Cancel, spinner while running, error text on failure (dialog stays open). Escape = cancel via `document` keydown `useEffect` (disabled while running). z-index `z-[60]` so it stacks above the `z-50` parent modals.

- [ ] **Step 1: Failing test** (append to `src/lib/brandRename.test.ts`; extend the top of the file with these mocks, placed before the `import … from './brandRename'` line)

```ts
const { renameBrandMock } = vi.hoisted(() => ({ renameBrandMock: vi.fn() }));
vi.mock('./queries', () => ({ renameBrand: renameBrandMock }));
vi.mock('./tabs', () => ({ OPERATIONAL_TABS: ['SilverPlay', 'BIT'] }));
```

```ts
import { performBrandRename } from './brandRename';

describe('performBrandRename', () => {
  it('passes fallback fills for every operational tab and trims the new name', async () => {
    renameBrandMock.mockResolvedValue(3);
    const res = await performBrandRename('rooster.bet', '  Rooster  ');
    expect(renameBrandMock).toHaveBeenCalledWith('rooster.bet', 'Rooster', res.fills);
    expect(res.changed).toBe(3);
    expect(res.fills.map((f) => `${f.tab}:${f.platform}`)).toEqual(['SilverPlay:tp', 'SilverPlay:ag', 'BIT:tp']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/brandRename.test.ts`
Expected: FAIL — `performBrandRename` not exported.

- [ ] **Step 3: Implement `performBrandRename`** (append to `src/lib/brandRename.ts`; add imports `import { renameBrand } from './queries';` and `import { OPERATIONAL_TABS } from './tabs';`)

```ts
// The one call sequence both Edit Brand Tab and Edit Entry use. Fills are
// computed across every operational tab (rename is global) and returned so
// Edit Entry can mirror them into its still-open form (see applyRenameToFields).
export async function performBrandRename(
  oldName: string,
  newName: string,
): Promise<{ changed: number; fills: BrandLinkWrite[] }> {
  const fills = buildFallbackFills([...OPERATIONAL_TABS], oldName);
  const changed = await renameBrand(oldName, newName.trim(), fills);
  return { changed, fills };
}
```

If importing `./queries` from `brandRename.ts` creates a circular import (queries.ts imports the `BrandLinkWrite` *type* only — `import type` is erased, so it should not), verify with `npm run build`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/brandRename.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the dialog**

```tsx
// src/components/BrandRenameDialog.tsx
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchBrandUsage } from '../lib/queries';
import { performBrandRename, type BrandLinkWrite } from '../lib/brandRename';

interface Props {
  oldName: string;
  newName: string;
  onDone: (result: { changed: number; fills: BrandLinkWrite[] }) => void;
  onCancel: () => void;
}

// Confirm step shared by Edit Brand Tab's Brands list and Edit Entry's
// Brand Name pencil — both must rename identically (global, every tab).
export default function BrandRenameDialog({ oldName, newName, onDone, onCancel }: Props) {
  const [usage, setUsage] = useState<{ entryCount: number; tabCount: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    fetchBrandUsage(oldName)
      .then((u) => { if (!canceled) setUsage(u); })
      .catch(() => { if (!canceled) setUsage(null); });
    return () => { canceled = true; };
  }, [oldName]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !running) {
        e.stopPropagation();
        onCancel();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel, running]);

  async function handleConfirm() {
    setRunning(true);
    setError(null);
    try {
      onDone(await performBrandRename(oldName, newName));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename brand');
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !running && onCancel()} />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="text-sm font-semibold text-slate-800">Rename brand</h3>
        <p className="mt-2 text-sm text-slate-600">
          Rename <span className="font-medium text-slate-800">"{oldName}"</span> →{' '}
          <span className="font-medium text-slate-800">"{newName.trim()}"</span>
          {usage ? ` on ${usage.entryCount} ${usage.entryCount === 1 ? 'entry' : 'entries'} across ${usage.tabCount} ${usage.tabCount === 1 ? 'tab' : 'tabs'}` : ''}?
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Applies everywhere — schedule, removed flags, PMS links, Overview, Score Summary. Existing PMS card titles keep the old name.
        </p>
        {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={running}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60">
            {running && <Loader2 className="size-3.5 animate-spin" />}
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
```

Note the capture-phase listener + `stopPropagation`: the parent modals' own Escape handlers are bubble-phase `document` listeners, so this closes only the dialog, not the parent too. Parents also gate their Escape on `renameTarget === null` (Tasks 5/6) as a second guard.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/brandRename.ts src/lib/brandRename.test.ts src/components/BrandRenameDialog.tsx
git commit -m "feat: shared BrandRenameDialog + performBrandRename"
```

---

### Task 5: Edit Brand Tab — Brands list

**Files:**
- Create: `src/components/TabBrandsSection.tsx`
- Modify: `src/components/EditBrandTabModal.tsx` (props, render, Escape guard)
- Modify: `src/pages/BrandGroup.tsx:1397` (`LINK_COLS`), `:2233-2246` (pass `brandProfiles`, `onBrandsChanged`)

**Interfaces:**
- Consumes: `tabLinkPlatforms`, `effectiveBrandLinks`, `buildLinkWrites`, `LinkPlatform` (Task 2); `setBrandLinks` (Task 3); `BrandRenameDialog` (Task 4); `OPERATIONAL_TABS` from `../lib/tabs`; `PLATFORM_SHORT_LABEL` from `../lib/scoreSummary`.
- Produces: `TabBrandsSection` default export, props `{ tabName: string; brands: string[]; brandProfiles: Record<string, Record<string, string>>; onChanged: () => void; onChildModalOpenChange: (open: boolean) => void }`.
  `EditBrandTabModal` gains props `brandProfiles?: Record<string, Record<string, string>>` and `onBrandsChanged?: () => void`.

- [ ] **Step 1: Add BIT's TP link column to BrandGroup's brand profiles**

In `src/pages/BrandGroup.tsx` line 1397 change:

```ts
    const LINK_COLS = ['Link to the profile', 'AG Review Link', 'CG Review Link', 'URL PAGE__href', 'Brand Link'];
```
to
```ts
    const LINK_COLS = ['Link to the profile', 'AG Review Link', 'CG Review Link', 'URL PAGE__href', 'Brand / TP URL PAGE__href', 'Brand Link'];
```

(BIT's TP link lives under `Brand / TP URL PAGE__href`; without it the Brands list would show only the hardcoded fallback, never the entry's real link. Add Review Account's `resolveBrandLink` still prefers the static map first, so its prefill behavior for BIT is unchanged except gaining a tab-local fallback.)

- [ ] **Step 2: Implement `TabBrandsSection`**

```tsx
// src/components/TabBrandsSection.tsx
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { setBrandLinks } from '../lib/queries';
import { tabLinkPlatforms, effectiveBrandLinks, buildLinkWrites, type LinkPlatform } from '../lib/brandRename';
import { OPERATIONAL_TABS } from '../lib/tabs';
import { PLATFORM_SHORT_LABEL } from '../lib/scoreSummary';
import BrandRenameDialog from './BrandRenameDialog';

interface Props {
  tabName: string;
  brands: string[];
  brandProfiles: Record<string, Record<string, string>>;
  onChanged: () => void;
  onChildModalOpenChange: (open: boolean) => void;
}

interface RowState {
  name: string;
  links: Partial<Record<LinkPlatform, string>>;
}

// Edit Brand Tab's editable list of every brand on this tab: rename (global,
// every tab — via BrandRenameDialog) and per-platform page links (written to
// every entry of that brand on every tab where the platform is enabled).
export default function TabBrandsSection({ tabName, brands, brandProfiles, onChanged, onChildModalOpenChange }: Props) {
  const platforms = tabLinkPlatforms(tabName);
  const initial = useMemo(() => {
    const m: Record<string, RowState> = {};
    for (const b of brands) m[b] = { name: b, links: effectiveBrandLinks(tabName, b, brandProfiles[b]) };
    return m;
  }, [brands, brandProfiles, tabName]);
  const [rows, setRows] = useState<Record<string, RowState>>(initial);
  const [savingBrand, setSavingBrand] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowSaved, setRowSaved] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ brand: string; newName: string } | null>(null);

  useEffect(() => setRows(initial), [initial]);
  useEffect(() => onChildModalOpenChange(renameTarget !== null), [renameTarget, onChildModalOpenChange]);

  function isDirty(brand: string): boolean {
    const r = rows[brand];
    const i = initial[brand];
    if (!r || !i) return false;
    if (r.name.trim() !== i.name) return true;
    return platforms.some((p) => (r.links[p] ?? '').trim() !== (i.links[p] ?? '').trim());
  }

  function changedLinks(brand: string): Partial<Record<LinkPlatform, string>> {
    const out: Partial<Record<LinkPlatform, string>> = {};
    for (const p of platforms) {
      const v = (rows[brand].links[p] ?? '').trim();
      if (v !== (initial[brand].links[p] ?? '').trim()) out[p] = v;
    }
    return out;
  }

  async function saveLinks(brandNow: string, links: Partial<Record<LinkPlatform, string>>) {
    const writes = buildLinkWrites([...OPERATIONAL_TABS], links);
    if (writes.length > 0) await setBrandLinks(brandNow, writes);
  }

  async function handleSave(brand: string) {
    setRowError((e) => ({ ...e, [brand]: '' }));
    setRowSaved(null);
    const newName = rows[brand].name.trim();
    if (!newName) {
      setRowError((e) => ({ ...e, [brand]: 'Brand name cannot be empty.' }));
      return;
    }
    if (newName !== brand) {
      setRenameTarget({ brand, newName });
      return;
    }
    setSavingBrand(brand);
    try {
      await saveLinks(brand, changedLinks(brand));
      setRowSaved(brand);
      onChanged();
    } catch (err) {
      setRowError((e) => ({ ...e, [brand]: err instanceof Error ? err.message : 'Failed to save links' }));
    } finally {
      setSavingBrand(null);
    }
  }

  async function handleRenamed(brand: string, newName: string) {
    setRenameTarget(null);
    setSavingBrand(brand);
    try {
      await saveLinks(newName, changedLinks(brand));
      setRowSaved(newName);
    } catch (err) {
      setRowError((e) => ({ ...e, [brand]: `Renamed, but links failed: ${err instanceof Error ? err.message : 'unknown error'}` }));
    } finally {
      setSavingBrand(null);
      onChanged();
    }
  }

  if (brands.length === 0) return null;

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-500">Brands</label>
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
        {brands.map((brand) => {
          const r = rows[brand];
          if (!r) return null;
          const dirty = isDirty(brand);
          return (
            <div key={brand} className="space-y-1.5 rounded-md border border-slate-100 p-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={r.name}
                  onChange={(e) => setRows((s) => ({ ...s, [brand]: { ...s[brand], name: e.target.value } }))}
                  className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => handleSave(brand)}
                  disabled={!dirty || savingBrand !== null}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
                >
                  {savingBrand === brand && <Loader2 className="size-3 animate-spin" />}
                  Save
                </button>
              </div>
              {platforms.map((p) => (
                <div key={p} className="flex items-center gap-2">
                  <span className="w-7 shrink-0 text-[11px] font-semibold text-slate-400">{PLATFORM_SHORT_LABEL[p]}</span>
                  <input
                    type="text"
                    value={r.links[p] ?? ''}
                    placeholder="https://…"
                    onChange={(e) => setRows((s) => ({ ...s, [brand]: { ...s[brand], links: { ...s[brand].links, [p]: e.target.value } } }))}
                    className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              {rowError[brand] && <p className="text-xs text-rose-600">{rowError[brand]}</p>}
              {rowSaved === brand && <p className="text-xs text-emerald-600">Saved.</p>}
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        Renames apply to every tab. Links update every entry of the brand; a blank link is left unchanged.
      </p>
      {renameTarget && (
        <BrandRenameDialog
          oldName={renameTarget.brand}
          newName={renameTarget.newName}
          onCancel={() => setRenameTarget(null)}
          onDone={() => handleRenamed(renameTarget.brand, renameTarget.newName)}
        />
      )}
    </div>
  );
}
```

Check `PLATFORM_SHORT_LABEL` in `src/lib/scoreSummary.ts` is keyed by `Platform` (`'tp'|'ag'|'cg'|'wo'`) — `LinkPlatform` is identical, so indexing type-checks. If it's not exported with that shape, use a local `{ tp: 'TP', ag: 'AG', cg: 'CG', wo: 'WO' }`.

Note: after `handleRenamed`'s `onChanged()` the parent reloads and a fresh `brands` prop (with the new name) flows in, resetting rows via `initial`. `rowSaved` keyed by the new name then shows "Saved." on the renamed row.

- [ ] **Step 3: Wire into `EditBrandTabModal`**

In `src/components/EditBrandTabModal.tsx`:

1. Import: `import TabBrandsSection from './TabBrandsSection';`
2. Props interface — add:
```ts
  // Tab-local brand link consensus (BrandGroup's brandProfiles) — pre-fills
  // the Brands list's per-platform link inputs.
  brandProfiles?: Record<string, Record<string, string>>;
  // Fired after a brand rename or link save in the Brands list — BrandGroup
  // wires this to its reload, same as onBrandAdded.
  onBrandsChanged?: () => void;
```
3. Destructure `brandProfiles, onBrandsChanged` in the component signature.
4. State: `const [brandsChildOpen, setBrandsChildOpen] = useState(false);`
5. Escape handler (line 165) — add `&& !brandsChildOpen` to the condition and `brandsChildOpen` to the deps array.
6. Keep `localBrands` in sync with the parent after a rename. Key the effect on the list's *content*, not its identity — BrandGroup's `uniqueBrands` is a fresh array every render, so depending on `[brands]` would reset `localBrands` (and, through `TabBrandsSection`'s `initial` memo, wipe the user's unsaved row edits) on every parent re-render:
```ts
  const brandsKey = brands.join('\u0000');
  useEffect(() => {
    setLocalBrands(brands);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content-keyed on purpose, see above
  }, [brandsKey]);
```
7. Render, directly **before** the "Add a brand" block (line ~496):
```tsx
          <TabBrandsSection
            tabName={tabName}
            brands={localBrands}
            brandProfiles={brandProfiles ?? {}}
            onChanged={() => onBrandsChanged?.()}
            onChildModalOpenChange={setBrandsChildOpen}
          />
```
8. Widen the modal so link inputs are usable: line 350 `max-w-sm` → `max-w-md`.

- [ ] **Step 4: Wire in `BrandGroup`** (`src/pages/BrandGroup.tsx:2233-2246`) — add two props:

```tsx
          brandProfiles={brandProfiles}
          onBrandsChanged={() => reloadRef.current()}
```

- [ ] **Step 5: Build + tests**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass (test count ≈ previous + 15; if roughly doubled, a stray `.worktrees/` dir is being scanned — see memory `feedback_vitest_scans_nested_worktrees`).

- [ ] **Step 6: Visual check** (`npm run dev`, log in with `.env` CAPTURE_EMAIL/CAPTURE_PASSWORD)

On BIT → pencil → Edit Brand Tab: Brands list shows Librabet / Librabet Casino rows, each with one TP link input pre-filled (e.g. `https://www.trustpilot.com/review/librabet.fun`). Save disabled until edited. Escape with nothing open closes the modal. On SilverPlay: rows show TP + AG + CG inputs.

- [ ] **Step 7: Commit**

```bash
git add src/components/TabBrandsSection.tsx src/components/EditBrandTabModal.tsx src/pages/BrandGroup.tsx
git commit -m "feat: editable Brands list (rename + links) in Edit Brand Tab"
```

---

### Task 6: Edit Entry — rename pencil

**Files:**
- Modify: `src/lib/brandRename.ts` (add `applyRenameToFields`)
- Test: `src/lib/brandRename.test.ts`
- Modify: `src/components/EditEntryModal.tsx` (lines ~1-20 imports, ~180 state, ~538-562 Brand Name block)
- Modify: `src/pages/BrandGroup.tsx` (~3131, add `onBrandRenamed`)

**Interfaces:**
- Consumes: `BrandRenameDialog` (Task 4), `BrandLinkWrite` (Task 2).
- Produces:
  - `export function applyRenameToFields(fields: Record<string, string>, brandCol: string, newName: string, tab: string, fills: BrandLinkWrite[]): Record<string, string>` — returns a copy with `fields[brandCol] = newName.trim()` and, for each fill on `tab` whose column is in `fields` and currently empty (or `'—'`), that fill's value.
  - `EditEntryModal` new optional prop `onBrandRenamed?: () => void`.

- [ ] **Step 1: Failing test** (append to `src/lib/brandRename.test.ts`, add `applyRenameToFields` to the brandRename import)

```ts
describe('applyRenameToFields', () => {
  const fills = [
    { tab: 'SilverPlay', column: 'Brand Link', value: 'https://tp/r', platform: 'tp' as const },
    { tab: 'SilverPlay', column: 'AG Review Link', value: 'https://ag/r', platform: 'ag' as const },
    { tab: 'BIT', column: 'Brand / TP URL PAGE__href', value: 'https://tp/r', platform: 'tp' as const },
  ];
  it('sets the new name and mirrors fills for this tab into empty fields only', () => {
    const out = applyRenameToFields(
      { Brands: 'rooster.bet', 'Brand Link': '', 'AG Review Link': 'https://ag/own', Email: 'x' },
      'Brands', ' Rooster ', 'SilverPlay', fills,
    );
    expect(out).toEqual({ Brands: 'Rooster', 'Brand Link': 'https://tp/r', 'AG Review Link': 'https://ag/own', Email: 'x' });
  });
  it('ignores fills for other tabs and columns the form does not have', () => {
    const out = applyRenameToFields({ Brands: 'a' }, 'Brands', 'b', 'SilverPlay', fills);
    expect(out).toEqual({ Brands: 'b' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/brandRename.test.ts`
Expected: FAIL — `applyRenameToFields` not exported.

- [ ] **Step 3: Implement** (append to `src/lib/brandRename.ts`)

```ts
// Edit Entry keeps its own form state after a rename. Without mirroring the
// rename (and the fallback links rename_brand just filled into empty
// columns) into that state, pressing Save Changes afterward would write the
// stale form back — reverting this entry's brand and blanking those links.
export function applyRenameToFields(
  fields: Record<string, string>,
  brandCol: string,
  newName: string,
  tab: string,
  fills: BrandLinkWrite[],
): Record<string, string> {
  const next = { ...fields, [brandCol]: newName.trim() };
  for (const f of fills) {
    if (f.tab !== tab || !(f.column in next)) continue;
    const cur = (next[f.column] ?? '').trim();
    if (cur === '' || cur === '—') next[f.column] = f.value;
  }
  return next;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/brandRename.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the pencil to `EditEntryModal`**

1. Imports: change line 2 to `import { X, Save, Loader2, Pencil } from 'lucide-react';`, add
```ts
import BrandRenameDialog from './BrandRenameDialog';
import { applyRenameToFields } from '../lib/brandRename';
```
2. Props: add `onBrandRenamed?: () => void;` to `interface Props` and destructure it.
3. State (after `const [dateErrors…]`):
```ts
  // Inline global brand rename (docs/superpowers/specs/2026-09-23-brand-rename-and-links-design.md).
  // renameDraft !== null = the pencil's input is open; renameTarget = confirm dialog open.
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  // Name the brand had when this modal opened / after the last rename —
  // what rename_brand must match on, since fields[brandCol] may have been
  // re-picked via the dropdown without saving.
  const [savedBrand, setSavedBrand] = useState(() => (brandCol ? entry.data[brandCol] ?? '' : ''));
```
4. `handleKey` — don't close the entry modal while the dialog is open:
```ts
  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && renameTarget === null) onClose();
  }
```
5. Replace the Brand Name block (lines ~538-562, the `<div>` containing the `Brand Name` label and `BrandSelectDropdown`) with:
```tsx
              {brandCol && availableBrands && availableBrands.length > 0 && (
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">Brand Name</label>
                  {renameDraft === null ? (
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0 flex-1">
                        <BrandSelectDropdown
                          value={fields[brandCol] ?? ''}
                          onChange={(v) => {
                            /* existing onChange body unchanged */
                          }}
                          brands={availableBrands}
                          disabled={saving}
                        />
                      </div>
                      {savedBrand && (
                        <button
                          type="button"
                          title="Rename this brand everywhere"
                          onClick={() => setRenameDraft(savedBrand)}
                          disabled={saving}
                          className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => renameDraft.trim() && renameDraft.trim() !== savedBrand && setRenameTarget(renameDraft.trim())}
                        disabled={!renameDraft.trim() || renameDraft.trim() === savedBrand}
                        className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenameDraft(null)}
                        className="shrink-0 rounded-md px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
```
   The `/* existing onChange body unchanged */` marker means: move the current `onChange={(v) => { … }}` body (lines 543-557, the `brandProfiles`/`BRAND_PROFILE_LINK_COLS`/`resolveBrandLink` logic) verbatim into this spot — do not leave the comment in the code.
6. Render the dialog right before the closing tag of the modal's outermost `<div>` (after the footer):
```tsx
      {renameTarget !== null && brandCol && (
        <BrandRenameDialog
          oldName={savedBrand}
          newName={renameTarget}
          onCancel={() => setRenameTarget(null)}
          onDone={({ fills }) => {
            setFields((f) => applyRenameToFields(f, brandCol, renameTarget, selectedTab || entry.tab, fills));
            setSavedBrand(renameTarget);
            setRenameTarget(null);
            setRenameDraft(null);
            onBrandRenamed?.();
          }}
        />
      )}
```

Note: if the user re-picked a different brand in the dropdown before clicking the pencil, `savedBrand` (the persisted name) is what gets renamed and `applyRenameToFields` overwrites `fields[brandCol]` with the new name — i.e. the unsaved re-pick is discarded in favor of the rename. Acceptable: the pencil input is pre-filled with `savedBrand`, so the user sees which brand they're renaming.

- [ ] **Step 6: Wire in `BrandGroup`** (`<EditEntryModal` at ~3131): add `onBrandRenamed={() => reloadRef.current()}`.

- [ ] **Step 7: Build + tests**

Run: `npm run build && npx vitest run`
Expected: both succeed.

- [ ] **Step 8: Visual check**

BIT → edit the Librabet Casino entry → pencil next to Brand Name → input pre-filled "Librabet Casino"; Cancel returns to the picker. Escape while the confirm dialog is open closes only the dialog. (Do not actually rename a real brand during this check; the live rename test is Task 7.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/brandRename.ts src/lib/brandRename.test.ts src/components/EditEntryModal.tsx src/pages/BrandGroup.tsx
git commit -m "feat: rename brand from Edit Entry"
```

---

### Task 7: End-to-end verification, cross-dashboard check, docs

**Files:**
- Modify: `docs/task-history.md` (append entry)
- Create: `.agent/handoff/2026-09-23-brand-rename-and-links.md`

- [ ] **Step 1: Cross-dashboard grep**

Grep `src/` and `supabase/functions/` for anything that caches brand names outside the tables the RPC covers:
`BRAND_TP_URLS|TAB_BRAND_URLS|BRAND_AG_URLS|BRAND_CG_URLS|TAB_DEFAULT_BRAND|TAB_BRAND_GROUPS` and `localStorage` keys containing brand values. Expected: only `tab-configs.ts` (fallback maps — handled by fills; `TAB_BRAND_GROUPS` is `{}`; `TAB_DEFAULT_BRAND` only applies to a zero-brand tab) and `generate-weekly-schedule/index_test.ts`. `supabase/functions/ai-assistant/tools.ts` reads brand names from the DB at query time — confirm it has no hardcoded brand list; if one exists, update it + its test in this task.

- [ ] **Step 2: Live E2E on a scratch brand** (dev server, logged in)

1. Edit Brand Tab on a low-traffic tab → "Add a brand" `ZZ E2E Brand` with link `https://example.com/zz`.
2. In the new Brands list, rename it to `ZZ E2E Brand 2`, change TP link to `https://example.com/zz2`, Save → confirm dialog shows "0 entries across 0 tabs" → Rename.
3. Verify: row shows new name + link; brand filter on the tab lists `ZZ E2E Brand 2`; Schedule Planner for that tab lists it; `select brand, link from brand_catalog where brand_key like 'zz e2e%'` shows the new name + `https://example.com/zz2`.
4. Rename it to an existing brand on another tab (e.g. `Librabet Casino`) → dialog shows the "already exists" error, nothing changes.
5. Cleanup: `delete from brand_catalog where brand_key like 'zz e2e%';` and any schedule rows generated for it (`delete from brand_schedule where brand_key like 'zz e2e%';`).

Do not rename a real brand. Tell the user the feature is ready for them to perform the first real rename.

- [ ] **Step 3: Whole-branch review**

Dispatch a final reviewer over `git diff <base>..HEAD` specifically checking: SQL brand matching == client `BRAND_COLS` resolution; exclusion list covers every view/history table; no page calls `supabase.from`/`rpc` outside `queries.ts`; Escape stacking in both modals.

- [ ] **Step 4: Docs**

Append to `docs/task-history.md` (next free task number N; keep the `---` divider and literal heading format — the PMS Stop hook parses it):

```markdown
---

## Task N: Editable brand names + brand page links

Brands can now be renamed globally (every tab) from Edit Brand Tab's new Brands list or Edit Entry's Brand Name pencil, via a new atomic `rename_brand` RPC that rewrites entries.data plus every `brand`-column table (history tables excluded) and blocks collisions. Per-platform brand page links (TP/AG/CG/WO) are editable in the same list and written to every entry of the brand via `set_brand_links`; hardcoded fallback links are materialized before a rename so none are lost.
```

Write `.agent/handoff/2026-09-23-brand-rename-and-links.md` per `.agent/handoff/README.md` format: what shipped, migration pushed, verified items, accepted side effects (PMS card titles, EC2 rotation-group hash, history tables keep old name), and "first real rename still to be done by the user".

- [ ] **Step 5: Commit + push to main** (per memory `feedback_push_to_main_directly`)

```bash
git add docs/task-history.md .agent/handoff/2026-09-23-brand-rename-and-links.md
git commit -m "docs: log brand rename + editable links task"
git push origin main
```
