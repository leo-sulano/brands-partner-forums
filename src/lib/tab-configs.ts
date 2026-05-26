// Per-tab column whitelists — controls which columns are shown and in what order.
// Column names must match the exact header names in the Google Sheet.
// Tabs not listed here fall back to showing all columns from tab_schemas.

export const TAB_COLUMN_CONFIGS: Record<string, string[]> = {
  // 3-platform tabs
  'Rooster Partners': [
    'Account',
    'Proxy Used',
    'Account Name',
    'Agent',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'Casino Guru review added',
    'CG Review Status',
  ],
  'Hanan': [
    'Account',
    'Proxy Used',
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
    'Proxy Used',
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
  // 1-platform tabs
  'TP Brand Injection': [
    'Account',
    'Proxy Used',
    'Account Name',
    'Agent',
    'Brand / TP URL PAGE',
    'Trust Pilot',
    'Link to the profile',
    'Review Status',
  ],
  'TP Affiliate': [
    'Account',
    'Proxy Used',
    'Account Name',
    'Agent',
    'URL PAGE',
    'Trust Pilot',
    'Link to the profile',
    'Review Status',
  ],
  'Trybet': [
    'Account',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'Trust pilot Review Status',
  ],
  'HazEmirates UAE': [
    'Account',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'Trust pilot Review Status',
  ],
  'SuprPlay Limited': [
    'Account',
    'Proxy Used',
    'Account Name',
    'Agent',
    'Brand Name',
    'Trust Pilot',
    'Link to the profile',
    'Review Status',
  ],
  'SilverPlay': [
    'Account',
    'Proxy Used',
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
  'Account Name':                                     'Acc. Name',
  'Link to the profile':                              'TP Profile Links',
  'Trust Pilot':                                      'TP Added',
  'TP Review Status':                                 'TP Status',
  'Trust Pilot Review Status':                        'TP Status',
  'Trustpilot Review Status':                         'TP Status',
  'Trust pilot Review Status':                        'TP Status',
  'Review Status':                                    'TP Status',
  'Ask Gambler review added':                         'AG Added',
  'AG Review Status':                                 'AG Status',
  'Casino Guru review added':                         'CG Added',
  'CG Review Status':                                 'CG Status',
  'Brand / TP URL PAGE':                              'Brands',
  'Removed / Not Published / stil published date':    'Removed/ Not Pub./Published',
};

// Per-tab label overrides — take precedence over COLUMN_LABELS when tab matches.
const TAB_COLUMN_LABELS: Record<string, Record<string, string>> = {
  'TP Affiliate': {
    'URL PAGE': 'URL Page',
  },
};

// Returns the ordered column list for a tab, or null if no config exists.
export function getTabColumns(tab: string): string[] | null {
  return TAB_COLUMN_CONFIGS[tab] ?? null;
}

// Returns the display label for a column header, with optional tab-specific override.
export function getColLabel(header: string, tab?: string): string {
  if (tab && TAB_COLUMN_LABELS[tab]?.[header]) {
    return TAB_COLUMN_LABELS[tab][header];
  }
  return COLUMN_LABELS[header] ?? header;
}

// Returns true if the tab has TP + AG + CG platform columns.
export function hasMultiPlatform(tab: string): boolean {
  const cols = TAB_COLUMN_CONFIGS[tab];
  if (!cols) return false;
  const set = new Set(cols);
  return set.has('AG Review Status') && set.has('CG Review Status');
}
