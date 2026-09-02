import { TAB_COLUMN_CONFIGS } from './tab-configs.ts';
import { isRenamedHardcodedTab } from './hardcodedTabRenameRegistry.ts';

// The canonical list of registered Brand Tabs — derived from TAB_COLUMN_CONFIGS
// (src/lib/tab-configs.ts) so a tab only has to be added in one place to be
// registered everywhere (sidebar nav, routing, both entry modals, Overview,
// Score Summary, Schedule Planner). Order matches that file's key order, which
// is also sidebar nav order.
export const OPERATIONAL_TABS: string[] = Object.keys(TAB_COLUMN_CONFIGS);

export type OperationalTab = string;

export function isOperationalTab(s: string): s is OperationalTab {
  return (OPERATIONAL_TABS as readonly string[]).includes(s);
}

// Slug helpers for URL routing. Spaces → '-', lowercase. Reversible via direct lookup.
// Manual overrides for tabs whose display name doesn't map to a clean slug (e.g. " - " separators).
const SLUG_OVERRIDES: Partial<Record<OperationalTab, string>> = {
  'GRG - Gulf Recovery Group': 'gulf-recovery-group',
};

export function tabToSlug(tab: string): string {
  // A true rename (src/lib/hardcodedTabRenameRegistry.ts) supersedes a
  // SLUG_OVERRIDES entry -- same "true rename wins" policy tabDisplayName
  // uses above. Otherwise a tab renamed away from e.g. 'GRG - Gulf Recovery
  // Group' would silently keep the old 'gulf-recovery-group' slug forever
  // (contradicting the feature's own promise that the URL slug changes), and
  // renaming it back to its original name would wrongly self-collide in
  // validateNewTabName's slug-uniqueness check.
  if (isRenamedHardcodedTab(tab)) return tab.toLowerCase().replace(/\s+/g, '-');
  return SLUG_OVERRIDES[tab as OperationalTab] ?? tab.toLowerCase().replace(/\s+/g, '-');
}

export function slugToTab(slug: string): OperationalTab | null {
  const decoded = decodeURIComponent(slug).toLowerCase();
  return OPERATIONAL_TABS.find((t) => tabToSlug(t) === decoded) ?? null;
}

// Sensitive-field heuristic for masked rendering.
const SENSITIVE_PATTERNS = /password|backup|authenticator|secret|token|2fa|otp/i;
export function isSensitiveHeader(header: string): boolean {
  return SENSITIVE_PATTERNS.test(header);
}

// Headers that are bookkeeping, not data — never rendered in the form.
const SKIP_HEADERS = new Set(['id', 'last_sync_tag', '']);
export function isEditableHeader(header: string): boolean {
  return !SKIP_HEADERS.has(header.trim());
}

// Display-only rename: what a user reads on screen for these two tabs. The
// canonical identifier itself (DB `tab` column, URL slug, OPERATIONAL_TABS
// entry, tab-configs.ts keys) stays the original string everywhere else —
// this is purely a rendering lookup.
const TAB_DISPLAY_NAMES: Partial<Record<OperationalTab, string>> = {
  'TP Affiliate': 'FTP',
  'TP Brand Injection': 'BITP',
};

export function tabDisplayName(tab: string): string {
  // A true rename (src/lib/hardcodedTabRenameRegistry.ts) always supersedes
  // the older TAB_DISPLAY_NAMES cosmetic alias below -- otherwise renaming
  // 'TP Brand Injection' would keep silently redisplaying it as "BITP"
  // everywhere, hiding the very rename the user just made.
  if (isRenamedHardcodedTab(tab)) return tab;
  return TAB_DISPLAY_NAMES[tab as OperationalTab] ?? tab;
}

// In-place OPERATIONAL_TABS splice for a hardcoded tab rename, mirroring
// dynamicTabRegistry.ts's renameDynamicTab splice exactly -- this is what
// lets every one of OPERATIONAL_TABS' ~12 existing importers (Sidebar,
// Overview, Score Summary, Schedule Planner, both entry modals, BrandGroup)
// pick up a hardcoded-tab rename with zero call-site changes.
export function renameOperationalTab(oldName: string, newName: string): void {
  const idx = OPERATIONAL_TABS.indexOf(oldName);
  if (idx !== -1) OPERATIONAL_TABS.splice(idx, 1, newName);
}
