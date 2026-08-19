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
import { OPERATIONAL_TABS, tabToSlug } from './tabs.ts';
import { TAB_COLUMN_CONFIGS } from './tab-configs.ts';
import { isDynamicTab } from './dynamicTabRegistry.ts';

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

// Legitimacy guard mirrors registerDynamicTabs' own `row.name in
// TAB_COLUMN_CONFIGS` check: only a name that is currently a real tab -- one
// of the 11 hardcoded entries, or a registered dynamic tab -- may be pushed
// back into OPERATIONAL_TABS. Without it, a tab archived and then had its
// custom_tabs row deleted (this feature's own documented cleanup path for a
// throwaway test tab) would resurrect as a ghost sidebar entry on unarchive,
// and generate-weekly-schedule's warm isolate could push a stale name from a
// prior invocation into the generation loop. The archivedTabNames delete is
// unconditional either way, so a bogus name can always be cleared.
export function unarchiveTabLocally(tab: string): void {
  archivedTabNames.delete(tab);
  const isLegitimateTab = tab in TAB_COLUMN_CONFIGS || isDynamicTab(tab);
  if (isLegitimateTab && !OPERATIONAL_TABS.includes(tab)) OPERATIONAL_TABS.push(tab);
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

// Resolves a URL slug against currently-archived tab names, mirroring
// tabs.ts's slugToTab matching logic but searching archivedTabNames instead
// of OPERATIONAL_TABS -- needed because archiving a tab, by design, splices
// it OUT of OPERATIONAL_TABS, so slugToTab alone can never resolve its real
// name once archived, leaving the archived-tab guard in BrandGroup.tsx
// permanently unreachable for a real bookmarked URL.
export function archivedTabForSlug(slug: string): string | null {
  const decoded = decodeURIComponent(slug).toLowerCase();
  for (const tab of archivedTabNames) {
    if (tabToSlug(tab) === decoded) return tab;
  }
  return null;
}
