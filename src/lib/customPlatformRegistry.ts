// In-memory registry for custom platforms
// (docs/superpowers/specs/2026-09-07-custom-platforms-design.md), mirroring
// dynamicTabRegistry.ts's resolver-injection shape exactly: this module
// self-registers a resolver with tab-configs.ts so getTabColumns can append
// a custom platform's columns onto ANY tab (hardcoded or dynamic) with zero
// changes at tab-configs.ts's other call sites.
//
// Deno-safe (no React/npm imports) even though nothing in v1 actually
// imports it from a Deno context -- Schedule Planner/generate-weekly-schedule
// are explicit non-goals -- kept safe for a possible future Phase 2, matching
// every sibling registry module in src/lib.
import { setCustomPlatformColumnsResolver } from './tab-configs.ts';
import { DATE_ENTRY_HEADERS } from './dateUtils.ts';
import type { CustomPlatformConfig } from './customPlatforms.ts';

export type { CustomPlatformConfig };

const byTab: Record<string, CustomPlatformConfig[]> = {};

export function registerTabCustomPlatforms(rows: CustomPlatformConfig[]): void {
  for (const row of rows) {
    if (!byTab[row.tab]) byTab[row.tab] = [];
    // Idempotent on (tab, id) -- a sign-out/sign-in cycle without a full page
    // reload re-runs the whole AuthContext bootstrap, which would otherwise
    // re-push every row and duplicate columns/KPI cards/React keys. Matches
    // every sibling registry in the bootstrap block (e.g.
    // registerHiddenTabPlatforms), which are all idempotent the same way.
    if (byTab[row.tab].some((r) => r.id === row.id)) continue;
    byTab[row.tab].push(row);
    // Registers the date column for DD/MM/YYYY validation the same way the 4
    // built-in date columns already get it (dateUtils.ts) -- an in-place Set
    // mutation, same pattern as OPERATIONAL_TABS.push elsewhere in this
    // project, so every existing importer of DATE_ENTRY_HEADERS picks this up
    // with zero call-site changes.
    DATE_ENTRY_HEADERS.add(row.dateColumn);
  }
}

export function resetTabCustomPlatforms(): void {
  for (const tab of Object.keys(byTab)) delete byTab[tab];
}

export function getTabCustomPlatforms(tab: string): CustomPlatformConfig[] {
  return byTab[tab] ?? [];
}

// A custom platform's id is globally unique (custom_platforms.id, a uuid
// primary key) even though `byTab` is organized per tab a platform is
// enabled on -- the same custom platform can be enabled on more than one
// tab, so this searches every tab's list rather than assuming a 1:1 mapping.
// Used by scheduler code that only has an id (from a DB row's `platform`
// column) and needs the platform's name/shortLabel for display, without
// needing to also know which tab context it's being rendered in.
export function getCustomPlatformById(id: string): CustomPlatformConfig | undefined {
  for (const rows of Object.values(byTab)) {
    const found = rows.find((r) => r.id === id);
    if (found) return found;
  }
  return undefined;
}

// The scheduler's chokepoint helper -- getTabPlatforms (tab-configs.ts) calls
// this via the resolver-injection pattern below to append a tab's custom
// platform ids to its built-in platform list, without tab-configs.ts ever
// importing this module directly (see the circular-import note at the
// bottom of this file).
export function getCustomPlatformIds(tab: string): string[] {
  return getTabCustomPlatforms(tab).map((p) => p.id);
}

export function getCustomPlatformColumns(tab: string): string[] {
  return getTabCustomPlatforms(tab).flatMap((p) => [p.statusColumn, p.dateColumn]);
}

setCustomPlatformColumnsResolver(getCustomPlatformColumns);
