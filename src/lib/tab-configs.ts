// Per-tab column whitelists — controls which columns are shown and in what order.
// Column names must match the exact header names in the Google Sheet.
// Tabs not listed here fall back to showing all columns from tab_schemas.

export const TAB_COLUMN_CONFIGS: Record<string, string[]> = {
  'Rooster Partners': [
    'Account',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'Trustpilot Review Status',
    'Ask Gambler review added',
    'Ask Gambler Review Status',
    'Casino Guru review added',
    'Casino Guru Review Status',
  ],
};

// Returns the ordered column list for a tab, or null if no config exists.
export function getTabColumns(tab: string): string[] | null {
  return TAB_COLUMN_CONFIGS[tab] ?? null;
}
