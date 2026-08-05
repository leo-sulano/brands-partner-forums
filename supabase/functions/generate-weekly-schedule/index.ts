/// <reference path="./vite-env-shim.d.ts" />
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OPERATIONAL_TABS } from '../../../src/lib/tabs.ts';
import { BRAND_COLS, getBrandNameCol, TAB_DEFAULT_BRAND, getTabPlatforms } from '../../../src/lib/tab-configs.ts';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchRemovedPlatformBrands } from '../../../src/lib/queries.ts';
import { buildRemovedPlatformBrandSet, type Platform } from '../../../src/lib/removedPlatformBrands.ts';
import { toISODate, mondayOf } from '../../../src/lib/scheduleBrands.ts';
import { recalculatePauses, ensureWeekGenerated, type TabContext } from '../../../src/lib/scheduler/schedulerService.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Assembles the same TabContext SchedulePlanner.tsx's brand-loading effect
// builds client-side (fetchRawEntriesByTab + fetchTabHeaders +
// fetchRemovedPlatformBrands, then derive brands/activePlatforms) — kept as
// its own function so it's independently testable (Task 7) without
// re-exercising recalculatePauses/ensureWeekGenerated, which already have
// full coverage in schedulerService.test.ts.
export async function buildTabContext(tab: string, client: SupabaseClient): Promise<TabContext> {
  const [rawEntries, headers, removedPlatformBrandRows] = await Promise.all([
    fetchRawEntriesByTab(tab, client),
    fetchTabHeaders(tab, client),
    fetchRemovedPlatformBrands(client),
  ]);
  const brandCol = BRAND_COLS.find((c) => headers.includes(c)) ?? getBrandNameCol(tab);
  const uniqueBrands = [...new Set(
    rawEntries
      .map((e) => e.data[brandCol])
      .filter((v): v is string => !!v && v.trim() !== ''),
  )].sort();
  if (uniqueBrands.length === 0 && TAB_DEFAULT_BRAND[tab]) uniqueBrands.push(TAB_DEFAULT_BRAND[tab]);

  return {
    brands: uniqueBrands,
    activePlatforms: getTabPlatforms(tab),
    entries: rawEntries,
    removedPlatformBrandSet: buildRemovedPlatformBrandSet(
      removedPlatformBrandRows as { tab: string; brand: string; platform: Platform }[],
    ),
  };
}

export async function generateForTab(tab: string, weekStart: string, client: SupabaseClient): Promise<void> {
  const ctx = await buildTabContext(tab, client);
  if (ctx.brands.length === 0 || ctx.activePlatforms.length === 0) return;
  const resumed = await recalculatePauses(tab, weekStart, ctx, client);
  await ensureWeekGenerated(tab, weekStart, ctx, resumed, client);
}

// Runs generateForTab for every tab independently — one tab's failure (a
// malformed entry, a transient DB error) must not stop the rest of the
// week's tabs from generating. generateFn is injectable so Task 7's tests
// can verify this isolation without needing a real Supabase client.
export async function generateAllTabs(
  tabs: readonly string[],
  weekStart: string,
  client: SupabaseClient,
  generateFn: (tab: string, weekStart: string, client: SupabaseClient) => Promise<void> = generateForTab,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const tab of tabs) {
    try {
      await generateFn(tab, weekStart, client);
      results[tab] = 'ok';
    } catch (err) {
      console.error(`[generate-weekly-schedule] ${tab} failed:`, err);
      results[tab] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return results;
}

Deno.serve(async (_req: Request): Promise<Response> => {
  const client = createClient(SUPABASE_URL, SERVICE_ROLE);
  const weekStart = toISODate(mondayOf(new Date()));
  const results = await generateAllTabs(OPERATIONAL_TABS, weekStart, client);
  return new Response(JSON.stringify({ weekStart, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
