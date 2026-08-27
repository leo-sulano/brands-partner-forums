// Brand Tab Pause (lightweight, reversible aggregation exclusion)
// (docs/superpowers/specs/2026-08-20-brand-tab-pause-design.md): unlike
// archivedTabRegistry.ts, pausing a tab deliberately does NOT splice it out
// of OPERATIONAL_TABS -- a paused tab must keep showing in the Sidebar
// (marked "Paused") and keep working normally on its own BrandGroup.tsx
// page. Instead, this module tracks paused state in its own Set and
// exposes getActiveOperationalTabs() as the one thing every cross-dashboard
// aggregation surface (Overview, Score Summary, Schedule Planner, the
// weekly cron) switches to in place of reading OPERATIONAL_TABS directly.
//
// Same Deno-safety constraints as archivedTabRegistry.ts/dynamicTabRegistry.ts
// (no React/npm imports, no I/O) -- this module is also imported by the
// generate-weekly-schedule Edge Function.
import { OPERATIONAL_TABS } from './tabs.ts';

const pausedTabNames = new Set<string>();

// Own small private copy of the notify helper -- same event name
// archivedTabRegistry.ts/dynamicTabRegistry.ts/tab-configs.ts already use,
// so Sidebar.tsx's and Topbar.tsx's one listener each picks up a
// pause/unpause immediately with no new listener code.
function notifyTabPlatformsChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('tab-platforms-changed'));
  }
}

export function pauseTabLocally(tab: string): void {
  pausedTabNames.add(tab);
  notifyTabPlatformsChanged();
}

export function unpauseTabLocally(tab: string): void {
  pausedTabNames.delete(tab);
  notifyTabPlatformsChanged();
}

export function applyPausedTabs(rows: { tab: string }[]): void {
  for (const row of rows) pauseTabLocally(row.tab);
}

// Needed by generate-weekly-schedule, whose Edge isolate is reused across
// invocations -- without this, a tab unpaused since the last invocation
// would incorrectly stay excluded from that run's generation loop forever
// (the same isolate-state bug class resetDynamicTabs/resetArchivedTabs
// already guard against).
export function resetPausedTabs(): void {
  for (const tab of Array.from(pausedTabNames)) unpauseTabLocally(tab);
}

export function isTabPaused(tab: string): boolean {
  return pausedTabNames.has(tab);
}

// The one export every cross-dashboard aggregation surface switches to in
// place of reading OPERATIONAL_TABS directly. A paused tab's own page, its
// tab-switcher dropdown, and both entry-creation/edit modals deliberately
// keep reading OPERATIONAL_TABS unfiltered instead (see the design spec's
// "Deliberately NOT filtered" section).
export function getActiveOperationalTabs(): string[] {
  return OPERATIONAL_TABS.filter((t) => !isTabPaused(t));
}

// The complement of getActiveOperationalTabs -- used by the PMS status-sync
// cron to also force-pause a whole-tab-paused tab's already-linked PMS tasks
// (see resolveAndSyncTabStatuses's isTabPaused param in scheduler/pmsSync.ts),
// since those tabs are otherwise excluded from every normal sync pass.
export function getPausedOperationalTabs(): string[] {
  return OPERATIONAL_TABS.filter((t) => isTabPaused(t));
}
