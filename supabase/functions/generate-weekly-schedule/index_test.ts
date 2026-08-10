import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildTabContext, generateAllTabs } from './index.ts';

// Minimal fake of Supabase's thenable PostgrestFilterBuilder: every filter
// method returns the same builder, and awaiting it anywhere in the chain
// resolves via .then() to the fixed row list. .maybeSingle() is a real
// terminal async method (queries.ts always calls it last, never chains
// after it), so it returns a resolved promise directly instead of the
// builder.
function tableBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    range: () => builder,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then(onfulfilled: (v: { data: unknown[]; error: null }) => unknown) {
      return Promise.resolve({ data: rows, error: null }).then(onfulfilled);
    },
  };
  return builder;
}

function fakeClient(tables: Record<string, unknown[]>): SupabaseClient {
  return { from: (table: string) => tableBuilder(tables[table] ?? []) } as unknown as SupabaseClient;
}

function entry(tab: string, id: string, data: Record<string, string | null>) {
  return { id, tab, sheet_row_id: id, data, updated_at: '', last_edited_by: 'dashboard' as const, last_sync_tag: null };
}

// buildTabContext calls fetchRawEntriesByTab, which caches by tab name for
// 60s in a module-level Map inside queries.ts. Each test below uses a
// distinct tab name specifically to avoid one test's fake data leaking into
// another via that cache within this one Deno test-file process.

Deno.test('buildTabContext derives brands from raw entries, deduped and sorted, with WO platform', async () => {
  const client = fakeClient({
    entries: [
      entry('Wizard of Odds', '1', { Brands: 'WinMega' }),
      entry('Wizard of Odds', '2', { Brands: 'WinMega' }),
      entry('Wizard of Odds', '3', { Brands: 'BrandB' }),
    ],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
    brand_platform_override: [],
  });
  const ctx = await buildTabContext('Wizard of Odds', client);
  assertEquals(ctx.brands, ['BrandB', 'WinMega']);
  assertEquals(ctx.activePlatforms, ['wo']);
  assertEquals(ctx.removedPlatformBrandSet?.size ?? 0, 0);
});

Deno.test('buildTabContext falls back to TAB_DEFAULT_BRAND when no entry has a brand value', async () => {
  const client = fakeClient({
    entries: [entry('Trybet', '1', {})],
    tab_schemas: [{ headers: [] }],
    removed_platform_brands: [],
    brand_platform_override: [],
  });
  const ctx = await buildTabContext('Trybet', client);
  assertEquals(ctx.brands, ['Trybet']);
});

Deno.test('buildTabContext populates overrideMap from its table', async () => {
  const client = fakeClient({
    entries: [entry('Hanan', '1', { Brands: 'WinMega' })],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
    brand_platform_override: [{ tab: 'Hanan', brand_key: 'winmega', platform: 'tp', override_state: 'pause' }],
  });
  const ctx = await buildTabContext('Hanan', client);
  assertEquals(ctx.overrideMap?.get('Hanan::winmega::tp'), 'pause');
});

Deno.test('generateAllTabs continues past a single tab failure', async () => {
  const calls: string[] = [];
  const fakeGenerate = async (tab: string) => {
    calls.push(tab);
    if (tab === 'Trybet') throw new Error('boom');
  };
  const results = await generateAllTabs(
    ['TP Brand Injection', 'Trybet', 'Hanan'],
    '2026-08-10',
    {} as SupabaseClient,
    fakeGenerate,
  );
  assertEquals(calls, ['TP Brand Injection', 'Trybet', 'Hanan']);
  assertEquals(results['TP Brand Injection'], 'ok');
  assertEquals(results['Trybet'], 'error: boom');
  assertEquals(results['Hanan'], 'ok');
});
