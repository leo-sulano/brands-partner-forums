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
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'Casino Guru review added',
    'CG Review Status',
  ],
  'Revolution Casino': [
    'Account',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'Casino Guru review added',
    'CG Review Status',
  ],
};

// Display label overrides — maps actual sheet column name → shorter UI label.
// Applied globally across all tabs.
export const COLUMN_LABELS: Record<string, string> = {
  'Trust Pilot Review Status':   'TP Review Status',
  'Trustpilot Review Status':    'TP Review Status',
  'Trust pilot Review Status':   'TP Review Status',
  'Score added':                 'Score Added',
  'Ask Gambler review added':    'AG Review Added',
  'Casino Guru review added':    'CG Review Added',
};

// Returns the ordered column list for a tab, or null if no config exists.
export function getTabColumns(tab: string): string[] | null {
  return TAB_COLUMN_CONFIGS[tab] ?? null;
}

// Returns the display label for a column header.
export function getColLabel(header: string): string {
  return COLUMN_LABELS[header] ?? header;
}
