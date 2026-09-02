// Every Edge Function isolate that reads getActiveOperationalTabs() or
// getTabPlatforms(tab) must call this once per invocation first. Isolates
// are reused across invocations, and each of the five registries below only
// ever grows via its own register/apply call -- without a reset+reapply
// here, a warm isolate keeps stale state (a deleted custom tab, an unhidden
// platform, an unarchived/unpaused tab, a stale hardcoded-tab-rename) forever.
// This exact sequence used to be hand-copied inline in
// generate-weekly-schedule/index.ts; factored out here so a second Edge
// Function (sync-schedule-pms's syncAllStatuses action) can't drift from it
// by hand-copying a second time.
//
// The browser has its own, intentionally-separate bootstrap sequence for
// these same registries (plus a sixth, toolbar filters, that has no
// server-side reader) -- see the Promise.all block in
// src/contexts/AuthContext.tsx's onAuthStateChange handler. It never resets
// first (a fresh page load has nothing stale to clear) and can't reuse this
// function as-is; kept as two hand-written sequences on purpose, so a future
// change to one should check the other for drift rather than assuming they
// stay in sync automatically.
import type { SupabaseClient } from '@supabase/supabase-js';
import { registerHiddenTabPlatforms, resetHiddenTabPlatforms } from './tab-configs.ts';
import { fetchCustomTabs, fetchHiddenTabPlatforms, fetchArchivedTabs, fetchPausedTabs, fetchHardcodedTabRenames } from './queries.ts';
import { registerDynamicTabs, resetDynamicTabs } from './dynamicTabRegistry.ts';
import { applyArchivedTabs, resetArchivedTabs } from './archivedTabRegistry.ts';
import { applyPausedTabs, resetPausedTabs } from './pausedTabRegistry.ts';
import { registerHardcodedTabRenames, resetHardcodedTabRenames } from './hardcodedTabRenameRegistry.ts';
import { renameOperationalTab } from './tabs.ts';

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

  // Fail-open, same convention as hiddenPlatforms above: a failed fetch
  // leaves the resolver a no-op for this tick (every tab reads as its own
  // original name), never blocking the other four registries.
  const hardcodedTabRenames = await fetchHardcodedTabRenames(client).catch((err) => {
    console.error(`[${logPrefix}] failed to fetch hardcoded tab renames:`, err);
    return [];
  });
  resetHardcodedTabRenames();
  registerHardcodedTabRenames(hardcodedTabRenames);
  // registerHardcodedTabRenames only populates the resolver's own lookup
  // maps -- OPERATIONAL_TABS itself (the array every getTabPlatforms/
  // getActiveOperationalTabs caller actually iterates) needs its own,
  // separate splice per row, exactly like the live in-session rename flow
  // in EditBrandTabModal.tsx calls renameHardcodedTabLocally and
  // renameOperationalTab as two explicit steps. Found live: on a fresh
  // bootstrap this step was missing entirely, so a hardcoded tab renamed in
  // one session stayed unreachable by its new name/slug in every other
  // session until this loop was added.
  //
  // Known limitation, accepted: on a warm Edge Function isolate, if a
  // hardcoded tab is renamed a SECOND time while that isolate is still
  // warm, this splice can no longer find `original_name` in
  // OPERATIONAL_TABS (a prior invocation already renamed it away), so the
  // array is left showing the isolate's last-seen name until it cold-starts
  // -- narrow, self-correcting, and not reachable from the browser (which
  // never reuses this bootstrap across sessions).
  for (const row of hardcodedTabRenames) {
    renameOperationalTab(row.original_name, row.current_name);
  }
}
