// src/lib/tabIconOverrideRegistry.ts
// In-memory copy of the `tab_icon_overrides` table (src/lib/tabIcons.ts's
// resolveTabIconKind reads through this). Unlike dynamicTabRegistry.ts's
// per-dynamic-tab icon/favicon fields it replaced, this applies uniformly to
// ANY tab name — hardcoded (TAB_COLUMN_CONFIGS) or dynamic (custom_tabs) —
// since a hardcoded tab has no custom_tabs row to hold an override on.
//
// Plain/dependency-free like dynamicTabRegistry.ts, but not currently
// bootstrapped by any Edge Function (only the frontend renders tab icons —
// see tabIcons.ts's own file comment) — AuthContext.tsx is this registry's
// only writer today.
export interface TabIconOverride {
  icon: string | null;
  faviconDomain: string | null;
  imageUrl: string | null;
}

export interface TabIconOverrideRow {
  tab: string;
  icon: string | null;
  faviconDomain: string | null;
  imageUrl: string | null;
}

const overrides: Record<string, TabIconOverride> = {};

// A row with all three fields null/falsy is treated as "no override" —
// IconPicker never actually produces one (its three modes always carry a
// value), but this keeps the registry consistent with that invariant rather
// than assuming callers uphold it.
export function registerTabIconOverrides(rows: TabIconOverrideRow[]): void {
  for (const row of rows) {
    if (!row.icon && !row.faviconDomain && !row.imageUrl) {
      delete overrides[row.tab];
      continue;
    }
    overrides[row.tab] = { icon: row.icon, faviconDomain: row.faviconDomain, imageUrl: row.imageUrl };
  }
}

export function clearTabIconOverride(tab: string): void {
  delete overrides[tab];
}

// Mirrors renameDynamicTab's carry-over — a renamed dynamic tab's override
// (if any) should follow it. The rename_custom_tab RPC (queries.ts) already
// updates this table's own row server-side (it discovers every table with a
// `tab` text column), so this only needs to move the in-memory copy.
export function renameTabIconOverride(oldName: string, newName: string): void {
  if (!(oldName in overrides)) return;
  overrides[newName] = overrides[oldName];
  delete overrides[oldName];
}

export function getTabIconOverride(tab: string): TabIconOverride | null {
  return overrides[tab] ?? null;
}
