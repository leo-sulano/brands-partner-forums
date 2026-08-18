/// <reference path="./vite-env-shim.d.ts" />
// This repo is a monorepo checkout with a root node_modules present, so a
// plain `deno check supabase/functions/generate-weekly-schedule/index.ts`
// run from the repo can silently resolve `@supabase/supabase-js` via
// node_modules instead of via this directory's deno.json import map (npm:
// specifier) — a typo'd or missing deno.json would go undetected by that
// form even though it would break at actual deploy time, where no
// node_modules exists. The form that genuinely exercises the import map is:
//   deno check --no-lock --node-modules-dir=none \
//     --config supabase/functions/generate-weekly-schedule/deno.json \
//     supabase/functions/generate-weekly-schedule/index.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OPERATIONAL_TABS, tabDisplayName } from '../../../src/lib/tabs.ts';
import { BRAND_COLS, getBrandNameCol, TAB_DEFAULT_BRAND, getTabPlatforms } from '../../../src/lib/tab-configs.ts';
import { fetchRawEntriesByTab, fetchTabHeaders, fetchRemovedPlatformBrands, fetchBrandPlatformOverrides, fetchScheduleHiddenBrands, fetchScheduleRestrictedBrands, invalidateTabCache } from '../../../src/lib/queries.ts';
import { buildRemovedPlatformBrandSet, type Platform } from '../../../src/lib/removedPlatformBrands.ts';
import { buildOverrideMap } from '../../../src/lib/scheduleOverrides.ts';
import { buildHiddenBrandSet, buildPlatformRestrictionMap } from '../../../src/lib/scheduleBrandConfig.ts';
import { toISODate, mondayOf } from '../../../src/lib/scheduleBrands.ts';
import { recalculatePauses, ensureWeekGenerated, type TabContext } from '../../../src/lib/scheduler/schedulerService.ts';
import { pushScheduleToPms, type PmsSyncItem } from '../../../src/lib/scheduler/pmsSync.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Assembles the same TabContext SchedulePlanner.tsx's brand-loading effect
// builds client-side (fetchRawEntriesByTab + fetchTabHeaders +
// fetchRemovedPlatformBrands, then derive brands/activePlatforms) — kept as
// its own function so it's independently testable (Task 7) without
// re-exercising recalculatePauses/ensureWeekGenerated, which already have
// full coverage in schedulerService.test.ts.
export async function buildTabContext(tab: string, client: SupabaseClient): Promise<TabContext> {
  const [rawEntries, headers, removedPlatformBrandRows, overrideRows, hiddenBrandRows, restrictedBrandRows] = await Promise.all([
    fetchRawEntriesByTab(tab, client),
    fetchTabHeaders(tab, client),
    fetchRemovedPlatformBrands(client),
    fetchBrandPlatformOverrides(tab, client),
    fetchScheduleHiddenBrands(tab, client),
    fetchScheduleRestrictedBrands(tab, client),
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
    overrideMap: buildOverrideMap(overrideRows),
    hiddenBrandSet: buildHiddenBrandSet(hiddenBrandRows),
    platformRestrictionMap: buildPlatformRestrictionMap(restrictedBrandRows),
  };
}

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
    const items: PmsSyncItem[] = activated.map((a) => ({ tab, tabLabel: tabDisplayName(tab), brand: a.brand, platform: a.platform, date: a.date }));
    await pushFn(items, client, { apiToken: pmsApiToken });
  }
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
    } finally {
      // fetchAllTabEntries (src/lib/queries.ts) caches every tab's full
      // entry list — heavy `data` jsonb, up to ~2000+ rows per tab — in a
      // module-level Map for 60s with no write-side eviction. This loop
      // runs all 11 OPERATIONAL_TABS in one invocation, so without an
      // explicit evict here the isolate would hold every tab's cached
      // entries simultaneously by the time the loop finishes (a plausible
      // OOM risk), and since Edge isolates get reused across invocations, a
      // second invocation within that 60s window could read another tab's
      // stale cached entries. Evict after every tab, success or failure.
      invalidateTabCache(tab);
    }
  }
  return results;
}

Deno.serve(async (_req: Request): Promise<Response> => {
  const client = createClient(SUPABASE_URL, SERVICE_ROLE);
  // Computed in the runtime's local zone (UTC on Supabase Edge). This is
  // only correct because the migration's cron
  // (supabase/migrations/20260805100000_add_generate_weekly_schedule_cron.sql)
  // is scheduled at `0 1 * * 1` UTC = 09:00 Asia/Manila Monday, safely past
  // local midnight. Changing the cron time, or manually invoking this
  // function before 09:00 Manila on a Monday (00:00-08:00 Manila = 16:00-24:00
  // UTC Sunday), will silently compute the *previous* week instead.
  const weekStart = toISODate(mondayOf(new Date()));
  const results = await generateAllTabs(OPERATIONAL_TABS, weekStart, client);
  return new Response(JSON.stringify({ weekStart, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
