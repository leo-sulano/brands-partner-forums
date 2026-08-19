// Self-service Brand Tab creation
// (docs/superpowers/specs/2026-08-18-self-service-brand-tab-creation-design.md):
// generates a standard, internally-consistent column schema for any tab
// created via the "+ Add Brand Tab" flow, and holds an in-memory registry
// that tab-configs.ts's getters fall back to for a tab that isn't one of
// the 11 hardcoded entries in TAB_COLUMN_CONFIGS.
//
// This module has the same import-safety constraints as tab-configs.ts —
// no React/npm-package imports, no I/O — because it's imported by the
// generate-weekly-schedule Deno Edge Function alongside tab-configs.ts.
import { OPERATIONAL_TABS } from './tabs.ts';
import { setDynamicColumnsResolver, TAB_COLUMN_CONFIGS } from './tab-configs.ts';

export type DynamicTabPlatform = 'tp' | 'ag' | 'cg' | 'wo';

// Single source of truth for the platform checkbox list shown by both
// AddBrandTabModal (create) and EditBrandTabPlatformsModal (edit) — kept here
// rather than duplicated per-component so the two can't drift the way
// BrandGroup.tsx's own separate tp/ag/cg-only card list did.
export const PLATFORM_LIST: { key: DynamicTabPlatform; label: string }[] = [
  { key: 'tp', label: 'Trust Pilot' },
  { key: 'ag', label: 'AskGamblers' },
  { key: 'cg', label: 'Casino Guru' },
  { key: 'wo', label: 'Wizard of Odds' },
];

// Generic fields every dynamic tab gets regardless of which platforms are
// selected. Platform-specific fields (including TP's) live in their own
// blocks below and are appended only when that platform is actually chosen
// — unlike the 11 legacy tabs, no platform is on by default here.
const BASE_COLUMNS = [
  'Account', 'Country', 'Proxy Used', 'Account Name', 'Agent',
  'Brand Name', 'Brand Link',
];

const TP_COLUMNS = ['Trust Pilot', 'Link to the profile', 'TP Review Status'];
const AG_COLUMNS = ['Ask Gambler review added', 'AG Review Status', 'AG Review Link', 'AG User'];
const CG_COLUMNS = ['Casino Guru review added', 'CG Review Status', 'CG Review Link', 'CG User'];
const WO_COLUMNS = ['Wizard of Odds', 'WoO Review Status', 'Wizard of OddsScore added', 'WO Review Link'];

// Deterministic: same platform set always produces the same column list, in
// the same order, so a dynamic tab's schema can never drift between the
// creator's session and a later reload — matches the Hanan/Rooster Partners
// shape for multi-platform tabs and GRG's shape for TP-only.
export function buildDynamicTabColumns(platforms: DynamicTabPlatform[]): string[] {
  const cols = [...BASE_COLUMNS];
  if (platforms.includes('tp')) cols.push(...TP_COLUMNS);
  if (platforms.includes('ag')) cols.push(...AG_COLUMNS);
  if (platforms.includes('cg')) cols.push(...CG_COLUMNS);
  if (platforms.includes('wo')) cols.push(...WO_COLUMNS);
  return cols;
}

const dynamicTabColumns: Record<string, string[]> = {};

// Notifies any mounted component that reads OPERATIONAL_TABS/dynamicTabColumns
// inline (e.g. Sidebar's platform-icon list) that the tab/platform registry
// changed, since mutating these module-level structures in place — by
// design, so every existing importer picks up a change with zero call-site
// changes — does NOT itself trigger a React re-render. Same event name as
// tab-configs.ts's own notifyTabPlatformsChanged (hidden hardcoded-tab
// platforms, docs/superpowers/specs/2026-08-18-hardcoded-tab-platform-visibility-design.md)
// so Sidebar.tsx's one listener covers both. Guarded the same way
// supabase.ts's SITE_URL learned to guard `window`: Supabase's real Edge
// Runtime defines a bare `window` global (so `typeof window !== 'undefined'`
// alone is not proof it's safe), but never a real `dispatchEvent`.
function notifyTabPlatformsChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('tab-platforms-changed'));
  }
}

// Registers (or re-registers) one or more dynamic tabs — computes each
// one's column list via buildDynamicTabColumns and pushes any genuinely new
// name into OPERATIONAL_TABS *in place* (mutating the existing exported
// array, never reassigning the binding) so every one of its ~12 existing
// importers (Sidebar, Overview, Score Summary, Schedule Planner, both entry
// modals, BrandGroup) picks up the new tab with zero call-site changes.
export function registerDynamicTabs(rows: { name: string; platforms: DynamicTabPlatform[] }[]): void {
  for (const row of rows) {
    // Never shadow one of the hardcoded tabs. AddBrandTabModal's collision
    // check is only a client-side guard — RLS still lets an approved user
    // insert a custom_tabs row named e.g. 'Hanan' straight through the API,
    // and registering that would make isDynamicTab('Hanan') true (showing a
    // delete affordance on a real tab) and let unregisterDynamicTab splice a
    // hardcoded tab out of OPERATIONAL_TABS.
    if (row.name in TAB_COLUMN_CONFIGS) continue;
    dynamicTabColumns[row.name] = buildDynamicTabColumns(row.platforms);
    if (!OPERATIONAL_TABS.includes(row.name)) OPERATIONAL_TABS.push(row.name);
  }
  notifyTabPlatformsChanged();
}

// Inverse of registerDynamicTabs, for the delete flow — removes the tab
// from both the column registry and OPERATIONAL_TABS. A no-op if the name
// was never registered, or if it names a hardcoded tab (see the guard in
// registerDynamicTabs above).
export function unregisterDynamicTab(name: string): void {
  if (name in TAB_COLUMN_CONFIGS) return;
  delete dynamicTabColumns[name];
  const idx = OPERATIONAL_TABS.indexOf(name);
  if (idx !== -1) OPERATIONAL_TABS.splice(idx, 1);
  notifyTabPlatformsChanged();
}

// Renames a previously-registered dynamic tab in place: removes the old key
// from both dynamicTabColumns and OPERATIONAL_TABS and adds the new one
// with the same platform set, at the same array position, firing exactly
// one tab-platforms-changed event — doing this as a separate unregister
// then register would leave a window where neither name is registered,
// which a listener firing in between (e.g. Sidebar's tabsVersion bump)
// could render against.
export function renameDynamicTab(oldName: string, newName: string, platforms: DynamicTabPlatform[]): void {
  if (!(oldName in dynamicTabColumns)) return;
  if (newName in TAB_COLUMN_CONFIGS) return;
  delete dynamicTabColumns[oldName];
  dynamicTabColumns[newName] = buildDynamicTabColumns(platforms);
  const idx = OPERATIONAL_TABS.indexOf(oldName);
  if (idx !== -1) OPERATIONAL_TABS.splice(idx, 1, newName);
  else if (!OPERATIONAL_TABS.includes(newName)) OPERATIONAL_TABS.push(newName);
  notifyTabPlatformsChanged();
}

// Clears every registered dynamic tab, from both the column registry and
// OPERATIONAL_TABS. Needed by the generate-weekly-schedule Edge Function,
// which re-registers custom_tabs on every invocation: Deno isolates are
// reused across invocations, so without this a warm isolate would accumulate
// tabs forever and keep generating schedules for tabs that have since been
// deleted (the same isolate-state bug class as the per-invocation entry-cache
// growth fixed in Task 178).
export function resetDynamicTabs(): void {
  for (const name of Object.keys(dynamicTabColumns)) {
    unregisterDynamicTab(name);
  }
}

export function getDynamicTabColumns(tab: string): string[] | null {
  return dynamicTabColumns[tab] ?? null;
}

export function isDynamicTab(tab: string): boolean {
  return tab in dynamicTabColumns;
}

// Self-registers this module's getDynamicTabColumns with tab-configs.ts as
// soon as this module is first imported by anything (AuthContext.tsx,
// Sidebar.tsx, or the generate-weekly-schedule Edge Function all do this in
// later tasks) -- fully synchronous, no promises, no race window. If
// nothing has imported this module yet, no dynamic tab could have been
// registered yet either, so tab-configs.ts's resolver being unset in that
// window is correct, not a bug.
setDynamicColumnsResolver(getDynamicTabColumns);
