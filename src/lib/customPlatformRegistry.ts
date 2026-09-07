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

export function getCustomPlatformColumns(tab: string): string[] {
  return getTabCustomPlatforms(tab).flatMap((p) => [p.statusColumn, p.dateColumn]);
}

setCustomPlatformColumnsResolver(getCustomPlatformColumns);
