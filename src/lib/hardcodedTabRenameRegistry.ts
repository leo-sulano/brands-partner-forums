// Maps a hardcoded tab's permanent TAB_COLUMN_CONFIGS key ("original name")
// to its current live name (docs/superpowers/specs/2026-09-01-hardcoded-tab-rename-design.md).
// Dependency-free, like tabIconOverrideRegistry.ts, so tab-configs.ts,
// tabs.ts, and tabIcons.ts can all import this module directly without
// creating an import cycle, and Deno Edge Functions can import it safely.
//
// Every hardcoded-name-keyed map lookup in the codebase (TAB_COLUMN_LABELS,
// TAB_BRAND_SEQUENCE, TAB_ICONS, SLUG_OVERRIDES, etc.) must resolve its `tab`
// argument through resolveHardcodedTabKey() before indexing -- those maps
// are still keyed by each tab's permanent original name, never its
// possibly-renamed current name.
const originalToCurrentMap: Record<string, string> = {};
const currentToOriginalMap: Record<string, string> = {};

export function registerHardcodedTabRenames(
  rows: { original_name: string; current_name: string }[],
): void {
  for (const row of rows) {
    originalToCurrentMap[row.original_name] = row.current_name;
    currentToOriginalMap[row.current_name] = row.original_name;
  }
}

// Called locally right after a successful rename_hardcoded_tab RPC call --
// the same "server call, then local registry update" two-step every other
// tab-scoped registry in this codebase already uses (e.g.
// renameTabIconOverride alongside upsertTabIconOverride).
export function renameHardcodedTabLocally(oldCurrentName: string, newCurrentName: string): void {
  const original = currentToOriginalMap[oldCurrentName] ?? oldCurrentName;
  delete currentToOriginalMap[oldCurrentName];
  delete originalToCurrentMap[original];
  currentToOriginalMap[newCurrentName] = original;
  originalToCurrentMap[original] = newCurrentName;
}

// The one function every hardcoded-name-keyed map lookup in the codebase
// must resolve `tab` through before indexing. A no-op passthrough for any
// tab never renamed (the common case for 9 of the 11 hardcoded tabs, and
// every dynamic tab, which has no row here at all).
export function resolveHardcodedTabKey(tab: string): string {
  return currentToOriginalMap[tab] ?? tab;
}

// True when `tab` (a live/current name) is CURRENTLY different from its own
// permanent original key -- used by tabDisplayName() in tabs.ts to let a
// true rename supersede the older TAB_DISPLAY_NAMES cosmetic-alias
// mechanism. Deliberately NOT "does a row exist for this tab" (a bare `tab
// in currentToOriginalMap` check): the rename_hardcoded_tab RPC never
// deletes a hardcoded_tab_renames row, only updates current_name -- so a
// tab renamed and then renamed straight back to its own original spelling
// still has a row (original_name === current_name). Found live while
// verifying the hardcoded-tab-rename feature: without this distinction,
// reverting 'BITP Team' back to 'TP Brand Injection' left the old cosmetic
// 'BITP' alias permanently suppressed even though the tab was, at that
// point, genuinely unrenamed.
export function isRenamedHardcodedTab(tab: string): boolean {
  const original = currentToOriginalMap[tab];
  return original !== undefined && original !== tab;
}

export function resetHardcodedTabRenames(): void {
  for (const key of Object.keys(originalToCurrentMap)) delete originalToCurrentMap[key];
  for (const key of Object.keys(currentToOriginalMap)) delete currentToOriginalMap[key];
}
