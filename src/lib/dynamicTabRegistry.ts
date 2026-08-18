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
import { setDynamicColumnsResolver } from './tab-configs.ts';

export type DynamicTabPlatform = 'tp' | 'ag' | 'cg';

const BASE_COLUMNS = [
  'Account', 'Country', 'Proxy Used', 'Account Name', 'Agent',
  'Brand Name', 'Brand Link', 'Trust Pilot', 'Link to the profile',
  'TP Review Status',
];

const AG_COLUMNS = ['Ask Gambler review added', 'AG Review Status', 'AG Review Link', 'AG User'];
const CG_COLUMNS = ['Casino Guru review added', 'CG Review Status', 'CG Review Link', 'CG User'];

// Deterministic: same platform set always produces the same column list, in
// the same order, so a dynamic tab's schema can never drift between the
// creator's session and a later reload — matches the Hanan/Rooster Partners
// shape for multi-platform tabs and GRG's shape for TP-only.
export function buildDynamicTabColumns(platforms: DynamicTabPlatform[]): string[] {
  const cols = [...BASE_COLUMNS];
  if (platforms.includes('ag')) cols.push(...AG_COLUMNS);
  if (platforms.includes('cg')) cols.push(...CG_COLUMNS);
  return cols;
}

const dynamicTabColumns: Record<string, string[]> = {};

// Registers (or re-registers) one or more dynamic tabs — computes each
// one's column list via buildDynamicTabColumns and pushes any genuinely new
// name into OPERATIONAL_TABS *in place* (mutating the existing exported
// array, never reassigning the binding) so every one of its ~12 existing
// importers (Sidebar, Overview, Score Summary, Schedule Planner, both entry
// modals, BrandGroup) picks up the new tab with zero call-site changes.
export function registerDynamicTabs(rows: { name: string; platforms: DynamicTabPlatform[] }[]): void {
  for (const row of rows) {
    dynamicTabColumns[row.name] = buildDynamicTabColumns(row.platforms);
    if (!OPERATIONAL_TABS.includes(row.name)) OPERATIONAL_TABS.push(row.name);
  }
}

// Inverse of registerDynamicTabs, for the delete flow — removes the tab
// from both the column registry and OPERATIONAL_TABS. A no-op if the name
// was never registered.
export function unregisterDynamicTab(name: string): void {
  delete dynamicTabColumns[name];
  const idx = OPERATIONAL_TABS.indexOf(name);
  if (idx !== -1) OPERATIONAL_TABS.splice(idx, 1);
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
