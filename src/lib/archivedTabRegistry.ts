// Brand Tab archive (reversible delete + reason)
// (docs/superpowers/specs/2026-08-19-brand-tab-archive-design.md): archiving
// a tab -- hardcoded or dynamic -- splices it out of OPERATIONAL_TABS in
// place, the same proven mechanism dynamicTabRegistry.ts's
// register/unregisterDynamicTab already use, which is what gives every one
// of OPERATIONAL_TABS' existing readers (Sidebar, Overview, Score Summary,
// Schedule Planner, both entry modals, BrandGroup) a live update with zero
// call-site changes.
//
// Same Deno-safety constraints as dynamicTabRegistry.ts/tab-configs.ts (no
// React/npm imports, no I/O) -- this module is also imported by the
// generate-weekly-schedule Edge Function.
import { OPERATIONAL_TABS } from './tabs.ts';

const archivedTabNames = new Set<string>();

// Own small private copy of the notify helper -- same event name as
// dynamicTabRegistry.ts's and tab-configs.ts's own copies, so Sidebar.tsx's
// one listener covers all three (see dynamicTabRegistry.ts's own comment on
// this pattern). Guarded the same way: Supabase's real Edge Runtime defines
// a bare `window` global, so `typeof window !== 'undefined'` alone isn't
// proof `dispatchEvent` is safe to call.
function notifyTabPlatformsChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('tab-platforms-changed'));
  }
}

export function archiveTabLocally(tab: string): void {
  archivedTabNames.add(tab);
  const idx = OPERATIONAL_TABS.indexOf(tab);
  if (idx !== -1) OPERATIONAL_TABS.splice(idx, 1);
  notifyTabPlatformsChanged();
}

export function unarchiveTabLocally(tab: string): void {
  archivedTabNames.delete(tab);
  if (!OPERATIONAL_TABS.includes(tab)) OPERATIONAL_TABS.push(tab);
  notifyTabPlatformsChanged();
}

export function applyArchivedTabs(rows: { tab: string }[]): void {
  for (const row of rows) archiveTabLocally(row.tab);
}

// Needed by generate-weekly-schedule, whose Edge isolate is reused across
// invocations -- without this, a tab unarchived since the last invocation
// would incorrectly stay excluded from that run's generation loop forever
// (the same isolate-state bug class as dynamicTabRegistry.ts's
// resetDynamicTabs already guards against).
export function resetArchivedTabs(): void {
  for (const tab of Array.from(archivedTabNames)) unarchiveTabLocally(tab);
}

export function isTabArchived(tab: string): boolean {
  return archivedTabNames.has(tab);
}
