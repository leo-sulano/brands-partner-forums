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
  'TP Brand Injection': [
    'Agent',
    'Account',
    'Brand / TP URL PAGE',
    'Removed / Not Published / stil published date',
    'Score added',
    'Trust Pilot',
    'Link to the profile',
    'Review Status',
  ],
  'Trybet': [
    'Account',
    'Account Name',
    'Agent',
    'Removed / Not Published / stil published date',
    'Score added',
    'Trust Pilot',
    'Link to the profile',
    'Trust pilot Review Status',
  ],
  'HazEmirates UAE': [
    'Account Name',
    'Removed / Not Published / stil published date',
    'Score added',
    'Trust Pilot',
    'Link to the profile',
    'Trust pilot Review Status',
  ],
  'SuprPlay Limited': [
    'Account Name',
    'Brand Name',
    'Removed / Not Published / stil published date',
    'Trust Pilot',
    'Link to the profile',
    'Review Status',
  ],
  'SilverPlay': [
    'Account',
    'Account Name',
    'Agent',
    'Removed / Not Published / stil published date',
    'Score added',
    'Trust Pilot',
    'Link to the profile',
    'Trust pilot Review Status',
  ],
  'Hanan': [
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
  'TP Review Status':                                 'Trust Pilot',
  'Trust Pilot Review Status':                        'Trust Pilot',
  'Trustpilot Review Status':                         'Trust Pilot',
  'Trust pilot Review Status':                        'Trust pilot',
  'AG Review Status':                                 'Ask Gambler',
  'CG Review Status':                                 'Casino Guru',
  'Ask Gambler review added':                         'AG Review Added',
  'Casino Guru review added':                         'CG Review Added',
  'Removed / Not Published / stil published date':    'Removed/ Not Pub./Published',
};

// Returns the ordered column list for a tab, or null if no config exists.
export function getTabColumns(tab: string): string[] | null {
  return TAB_COLUMN_CONFIGS[tab] ?? null;
}

// Returns the display label for a column header.
export function getColLabel(header: string): string {
  return COLUMN_LABELS[header] ?? header;
}

// Returns true if the tab has TP + AG + CG platform columns.
export function hasMultiPlatform(tab: string): boolean {
  const cols = TAB_COLUMN_CONFIGS[tab];
  if (!cols) return false;
  const set = new Set(cols);
  return set.has('AG Review Status') && set.has('CG Review Status');
}
