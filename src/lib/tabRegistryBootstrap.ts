// Every Edge Function isolate that reads getActiveOperationalTabs() or
// getTabPlatforms(tab) must call this once per invocation first. Isolates
// are reused across invocations, and each of the four registries below only
// ever grows via its own register/apply call -- without a reset+reapply
// here, a warm isolate keeps stale state (a deleted custom tab, an unhidden
// platform, an unarchived/unpaused tab) forever. This exact sequence used to
// be hand-copied inline in generate-weekly-schedule/index.ts; factored out
// here so a second Edge Function (sync-schedule-pms's syncAllStatuses
// action) can't drift from it by hand-copying a second time.
//
// The browser has its own, intentionally-separate bootstrap sequence for
// these same registries (plus a fifth, toolbar filters, that has no
// server-side reader) -- see the Promise.all block in
// src/contexts/AuthContext.tsx's onAuthStateChange handler. It never resets
// first (a fresh page load has nothing stale to clear) and can't reuse this
// function as-is; kept as two hand-written sequences on purpose, so a future
// change to one should check the other for drift rather than assuming they
// stay in sync automatically.
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

  // Fail-open, per this project's established convention for cross-invocation
  // registry bootstraps: a failed fetch here leaves the hidden-platforms
  // registry empty for this tick, so getTabPlatforms(tab) reports MORE
  // platforms than the dashboard actually shows -- the opposite failure bias
  // from resolveAndSyncTabStatuses's own hidden/restricted/removed-platform
  // exclusion fetches (src/lib/scheduler/pmsSync.ts), which fail closed: a
  // rejected fetch there skips the whole tab rather than under-excluding a
  // brand+platform that should have stayed hidden. Self-correcting on the
  // next successful tick either way; the asymmetry is spec-conformant (the
  // plan mandated fail-open here), just worth flagging so it isn't mistaken
  // for a bug by a future reader comparing the two.
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
