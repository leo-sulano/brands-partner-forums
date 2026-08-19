import { TAB_COLUMN_CONFIGS } from './tab-configs';
import { OPERATIONAL_TABS, tabToSlug } from './tabs';

// Shared by AddBrandTabModal (create) and EditBrandTabModal (rename) so the
// two can't drift on what makes a candidate Brand Tab name valid — both
// write into custom_tabs.name, which becomes a live URL slug and a literal
// key across a dozen other tables (see renameCustomTab / the
// rename_custom_tab RPC in queries.ts).
export function validateNewTabName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a tab name.';
  const collision = OPERATIONAL_TABS.includes(trimmed) || trimmed in TAB_COLUMN_CONFIGS;
  if (collision) return `A tab named "${trimmed}" already exists.`;
  // A tab's URL is /brands/<tabToSlug(name)>, and slugToTab resolves a slug
  // back to the *first* matching tab — so a name that only collides by slug
  // (e.g. "Gulf Recovery Group" → gulf-recovery-group, already claimed by
  // 'GRG - Gulf Recovery Group' via SLUG_OVERRIDES) would create a tab that
  // is permanently unreachable, silently landing on the other tab instead.
  if (OPERATIONAL_TABS.some((t) => tabToSlug(t) === tabToSlug(trimmed))) {
    return `"${trimmed}" produces the same URL as an existing tab. Pick a more distinct name.`;
  }
  // '/' would split the route, '?' and '#' would terminate the path — any of
  // them breaks /brands/:tab for the new tab.
  if (/[/?#]/.test(trimmed)) return 'A tab name cannot contain /, ? or #.';
  return null;
}
