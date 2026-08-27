// Every Edge Function isolate that reads getActiveOperationalTabs() or
// getTabPlatforms(tab) must call this once per invocation first. Isolates
// are reused across invocations, and each of the four registries below only
// ever grows via its own register/apply call -- without a reset+reapply
// here, a warm isolate keeps stale state (a deleted custom tab, an unhidden
// platform, an unarchived/unpaused tab) forever. This exact sequence used to
// be hand-copied inline in generate-weekly-schedule/index.ts; factored out
// here so a second Edge Function (sync-schedule-pms's syncAllStatuses
// action) can't drift from it by hand-copying a second time.
import type { SupabaseClient } from '@supabase/supabase-js';
import { registerHiddenTabPlatforms, resetHiddenTabPlatforms } from './tab-configs.ts';
import { fetchCustomTabs, fetchHiddenTabPlatforms, fetchArchivedTabs, fetchPausedTabs } from './queries.ts';
import { registerDynamicTabs, resetDynamicTabs } from './dynamicTabRegistry.ts';
import { applyArchivedTabs, resetArchivedTabs } from './archivedTabRegistry.ts';
import { applyPausedTabs, resetPausedTabs } from './pausedTabRegistry.ts';

export async function bootstrapTabRegistries(client: SupabaseClient, logPrefix: string): Promise<void> {
  const customTabs = await fetchCustomTabs(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch custom tabs:`, err);
    return [];
  });
  resetDynamicTabs();
  registerDynamicTabs(customTabs);

  const hiddenPlatforms = await fetchHiddenTabPlatforms(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch hidden tab platforms:`, err);
    return [];
  });
  resetHiddenTabPlatforms();
  registerHiddenTabPlatforms(hiddenPlatforms);

  const archivedTabs = await fetchArchivedTabs(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch archived tabs:`, err);
    return [];
  });
  resetArchivedTabs();
  applyArchivedTabs(archivedTabs);

  const pausedTabs = await fetchPausedTabs(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch paused tabs:`, err);
    return [];
  });
  resetPausedTabs();
  applyPausedTabs(pausedTabs);
}
