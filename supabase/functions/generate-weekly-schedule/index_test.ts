import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildTabContext, generateAllTabs, generateForTab } from './index.ts';

// Minimal fake of Supabase's thenable PostgrestFilterBuilder: every filter
// method returns the same builder, and awaiting it anywhere in the chain
// resolves via .then() to the fixed row list. .maybeSingle() is a real
// terminal async method (queries.ts always calls it last, never chains
// after it), so it returns a resolved promise directly instead of the
// builder. .upsert() (added for the generateForTab test below, the first
// test in this file to exercise ensureWeekGenerated's real write path via
// bulkUpsertBrandSchedule) is chainable the same way -- awaiting it resolves
// via the same .then() to { data: rows, error: null }.
function tableBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    range: () => builder,
    upsert: () => builder,
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
    brand_platform_override: [{ tab: 'Hanan', brand_key: 'winmega', platform: 'tp', override_state: 'pause', reason: 'Client requested a break', resume_at: null, set_by: 'leo@optinetsolutions.com' }],
  });
  const ctx = await buildTabContext('Hanan', client);
  assertEquals(ctx.overrideMap?.get('Hanan::winmega::tp'), {
    state: 'pause', reason: 'Client requested a break', resumeAt: null, setBy: 'leo@optinetsolutions.com',
  });
});

Deno.test('buildTabContext populates hiddenBrandSet from schedule_hidden_brands', async () => {
  const client = fakeClient({
    entries: [entry('Rooster Partners', '1', { Brands: 'Novadreams' })],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
    brand_platform_override: [],
    schedule_hidden_brands: [{ tab: 'Rooster Partners', brand: 'Novadreams' }],
    schedule_platform_restrictions: [],
  });
  const ctx = await buildTabContext('Rooster Partners', client);
  assertEquals(ctx.hiddenBrandSet?.has('Rooster Partners::novadreams'), true);
});

Deno.test('buildTabContext populates platformRestrictionMap from schedule_platform_restrictions', async () => {
  const client = fakeClient({
    entries: [entry('Revolution Casino', '1', { Brands: 'God Of Casino' })],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
    brand_platform_override: [],
    schedule_hidden_brands: [],
    schedule_platform_restrictions: [{ tab: 'Revolution Casino', brand: 'God Of Casino', allowed_platform: 'ag' }],
  });
  const ctx = await buildTabContext('Revolution Casino', client);
  assertEquals(ctx.platformRestrictionMap?.get('Revolution Casino::god of casino'), 'ag');
});

Deno.test('generateForTab pushes every combo ensureWeekGenerated just activated to PMS, with the resolved Agent', async () => {
  const client = fakeClient({
    entries: [entry('TP Affiliate', '1', { Brands: 'WinMega' })],
    tab_schemas: [{ headers: ['Brands'] }],
    removed_platform_brands: [],
    brand_platform_override: [],
    schedule_hidden_brands: [],
    schedule_platform_restrictions: [],
    brand_agent_assignments: [{ tab: 'TP Affiliate', brand: 'WinMega', platform: 'tp', agent: 'Jen' }],
  });
  const pushedBatches: unknown[][] = [];
  const fakePush = async (items: unknown[]) => {
    pushedBatches.push(items);
    return { created: [], skipped: [], failed: [] };
  };
  // generateForTab reads PMS_API_TOKEN live via Deno.env.get() at call time
  // (not a module-level const captured at import), so this test can set it
  // itself instead of depending on whatever the ambient shell happened to
  // have exported before Deno started. Restore whatever was there before
  // (or delete it) afterward so this doesn't leak into any test that runs
  // later in the same process.
  const priorToken = Deno.env.get('PMS_API_TOKEN');
  Deno.env.set('PMS_API_TOKEN', 'test-token');
  try {
    await generateForTab('TP Affiliate', '2026-08-17', client, fakePush);
  } finally {
    if (priorToken === undefined) Deno.env.delete('PMS_API_TOKEN');
    else Deno.env.set('PMS_API_TOKEN', priorToken);
  }
  assertEquals(pushedBatches.length, 1);
  const batch = pushedBatches[0] as { brand: string; platform: string; agent?: string | null }[];
  assertEquals(batch.length > 0, true);
  assertEquals(batch[0].brand, 'WinMega');
  assertEquals(batch[0].platform, 'tp');
  assertEquals(batch[0].agent, 'Jen');
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
