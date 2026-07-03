// Per-tab column whitelists — controls which columns are shown and in what order.
// Column names must match the exact header names in the Google Sheet.
// Tabs not listed here fall back to showing all columns from tab_schemas.

export const TAB_COLUMN_CONFIGS: Record<string, string[]> = {
  // 3-platform tabs
  'Rooster Partners': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Agent',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'AG Review Link',
    'AG User',
    'Casino Guru review added',
    'CG Review Status',
    'CG Review Link',
    'CG User',
  ],
  'Hanan': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'AG Review Link',
    'AG User',
    'Casino Guru review added',
    'CG Review Status',
    'CG Review Link',
    'CG User',
  ],
  'Revolution Casino': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'AG Review Link',
    'AG User',
    'Casino Guru review added',
    'CG Review Status',
    'CG Review Link',
    'CG User',
  ],
  // 1-platform tabs
  'TP Brand Injection': [
    'Account',
    'Country',
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
    'Country',
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
    'Country',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'Trust pilot Review Status',
  ],
  'HazEmirates UAE': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'Trust pilot Review Status',
  ],
  'SuprPlay Limited': [
    'Account',
    'Country',
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
    'Country',
    'Proxy Used',
    'Account Name',
    'Brands',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
    'Ask Gambler review added',
    'AG Review Status',
    'AG Review Link',
    'AG User',
    'Casino Guru review added',
    'CG Review Status',
    'CG Review Link',
    'CG User',
  ],
  'Wizard of Odds': [
    'Agent',
    'Account',
    'Country',
    'Proxy Used',
    'Brand Name',
    'Wizard of Odds',
    'WoO Review Status',
    'Wizard of OddsScore added',
    'Link to the profile',
    'User Name',
  ],
  // Dashboard-only tab, no Google Sheet backing — entries come from Add Review Account.
  'GRG - Gulf Recovery Group': [
    'Account',
    'Country',
    'Proxy Used',
    'Account Name',
    'Agent',
    'Brand Name',
    'Trust Pilot',
    'Link to the profile',
    'TP Review Status',
  ],
};

// Display label overrides — maps actual sheet column name → shorter UI label.
// Applied globally across all tabs.
export const COLUMN_LABELS: Record<string, string> = {
  'Account Name':                                     'Acc. Name',
  'Link to the profile':                              'TP Links',
  'Trust Pilot':                                      'TP Added',
  'TP Review Status':                                 'TP Status',
  'Trust Pilot Review Status':                        'TP Status',
  'Trustpilot Review Status':                         'TP Status',
  'Trust pilot Review Status':                        'TP Status',
  'Review Status':                                    'TP Status',
  'Ask Gambler review added':                         'AG Added',
  'AG Review Status':                                 'AG Status',
  'AG Review Link':                                   'AG Link',
  'Casino Guru review added':                         'CG Added',
  'CG Review Status':                                 'CG Status',
  'CG Review Link':                                   'CG Link',
  'AG Score added':                                   'AG Score',
  'CG Score added':                                   'CG Score',
  'Brand / TP URL PAGE':                              'Brands',
  'Brand Name':                                        'Brands',
  'URL PAGE__href':                                    'Brand Links',
  'Removed / Not Published / stil published date':    'Removed/ Not Pub./Published',
};

// Per-tab label overrides — take precedence over COLUMN_LABELS when tab matches.
const TAB_COLUMN_LABELS: Record<string, Record<string, string>> = {
  'TP Affiliate': {
    'URL PAGE': 'Brand',
  },
  'Wizard of Odds': {
    'Wizard of Odds':           'WO Date',
    'WoO Review Status':        'WO Status',
    'Wizard of OddsScore added':'WO Score',
    'Link to the profile':      'Profile Link',
    'User Name':                'WO User',
  },
};

// Returns the ordered column list for a tab, or null if no config exists.
export function getTabColumns(tab: string): string[] | null {
  return TAB_COLUMN_CONFIGS[tab] ?? null;
}

// Default brand name shown in the Brands column when the sheet value is empty.
export const TAB_DEFAULT_BRAND: Record<string, string> = {
  'Trybet': 'Trybet',
  'HazEmirates UAE': 'HazEmirates UAE',
  'SilverPlay': 'Silverplay',
  'GRG - Gulf Recovery Group': 'GRG - Gulf Recovery Group',
};

// Country to use when a tab's Google Sheet has no Country column at all and no
// per-row value can be derived from Account text (e.g. every row is the same country).
const TAB_DEFAULT_COUNTRY: Record<string, string> = {
  'SuprPlay Limited': 'UK',
};

// Account values are formatted "<id> | <label> | <Country>" (or, for rows copied
// from Hanan-sourced accounts, "<id> l <label> l <Country>" using a literal "l").
// Duplicate Account appends one or more " dup" suffixes (see handleDuplicate in
// BrandGroup.tsx), which is stripped first so it isn't mistaken for the country.
// Returns '' if the value doesn't match either delimited shape.
function deriveCountryFromAccount(account: string | null | undefined): string {
  if (!account) return '';
  const cleaned = account.replace(/(?:\s+dup)+$/i, '');
  const parts = cleaned.split(/\s*\|\s*|\s+l\s+/);
  if (parts.length < 3) return '';
  return parts[parts.length - 1].trim();
}

// Returns the country to display/sort/filter by for an entry: the real value synced
// from the Sheet, else one derived from Account text, else a per-tab default.
export function getEntryCountry(data: Record<string, string | null>, tab: string): string {
  const raw = data['Country'];
  if (raw && raw.trim()) return raw.trim();
  const derived = deriveCountryFromAccount(data['Account']);
  if (derived) return derived;
  return TAB_DEFAULT_COUNTRY[tab] ?? '';
}

// Returns the display label for a column header, with optional tab-specific override.
export function getColLabel(header: string, tab?: string): string {
  if (tab && TAB_COLUMN_LABELS[tab]?.[header]) {
    return TAB_COLUMN_LABELS[tab][header];
  }
  return COLUMN_LABELS[header] ?? header;
}

// Fixed brand display sequence for specific tabs.
// When defined, overrides column-based sorting and always shows brands in this order.
const TAB_BRAND_SEQUENCE: Record<string, string[]> = {
  'TP Brand Injection': [
    '7Bit Casino crypto',
    'Boho Casino',
    'Amonbet Casino',
    'Casino WestAce',
    'NovaJackpot Casino',
    'Lapalingo Casino',
    'Casino Magius',
    'Nomini Kasino',
    'Prive Casino',
    'Rabona Casino',
    'RollingSlots Casino',
    'Monsterwin Casino',
    'Funrize Casino',
    'Crowncoins Casino',
    'Cazeus Casino',
    'NoLimitCoins Casino',
    'Alf Casino',
    'Big Pirate Casino',
    'VIP Luck Casino',
    'Melbet Casino',
    'Casea Casino',
  ],
  'TP Affiliate': [
    'Aussie Online Pokies',
    'Top10 Casinos Online Ca',
    'Best Online Casino in Canada 2026 | Top Rated Online Casinos',
  ],
};

// The column that holds the brand name for sequence-sorted tabs.
const TAB_SEQUENCE_COL: Record<string, string> = {
  'TP Brand Injection': 'Brand / TP URL PAGE',
  'TP Affiliate': 'URL PAGE',
};

// Returns the fixed brand sequence for a tab, or null if none is defined.
export function getTabSequence(tab: string): string[] | null {
  return TAB_BRAND_SEQUENCE[tab] ?? null;
}

// Returns the column used for brand name matching in sequence-sorted tabs.
export function getTabSequenceCol(tab: string): string | null {
  return TAB_SEQUENCE_COL[tab] ?? null;
}

// Brand name → Trustpilot review page URL. Keys are lowercase for case-insensitive lookup.
// Includes common spelling variants (with/without space) that appear in the DB.
export const BRAND_TP_URLS: Record<string, string> = {
  '7bit casino crypto':    'https://www.trustpilot.com/review/7bitcasino.digital',
  'amonbetcasino':         'https://www.trustpilot.com/review/amonbet.digital',
  'amonbet casino':        'https://www.trustpilot.com/review/amonbet.digital',
  'bohocasino':            'https://www.trustpilot.com/review/bohocasino.digital',
  'boho casino':           'https://www.trustpilot.com/review/bohocasino.digital',
  'cazimbo casino':        'https://www.trustpilot.com/review/cazimbo.bet',
  'lapalingo casino':      'https://www.trustpilot.com/review/lapalingo.live',
  'casino magius':         'https://www.trustpilot.com/review/magiuscasino24.com',
  'novajackpot casino':    'https://www.trustpilot.com/review/novajackpot.live',
  'casino westace':        'https://www.trustpilot.com/review/westacecasino.info',
  'cazeus casino':         'https://www.trustpilot.com/review/cazeus.club',
  'crowncoins casino':     'https://www.trustpilot.com/review/crowncoins.one',
  'funrize casino':        'https://www.trustpilot.com/review/funrize.pro',
  'monsterwin casino':     'https://www.trustpilot.com/review/monsterwin.digital',
  'nomini kasino':         'https://www.trustpilot.com/review/nomini.pro',
  'prive casino':          'https://www.trustpilot.com/review/privecasino.bet',
  'rabona casino':         'https://www.trustpilot.com/review/rabona-casino.live',
  'rollingslots casino':   'https://www.trustpilot.com/review/rollingslots.live',
  'nolimitcoins casino':   'https://www.trustpilot.com/review/nolimitcoins.pro',
  'alf casino':            'https://www.trustpilot.com/review/alfcasino.pro',
  'big pirate casino':     'https://www.trustpilot.com/review/bigpirate.live',
  'vip luck casino':       'https://www.trustpilot.com/review/vipluck.digital',
  'melbet casino':         'https://www.trustpilot.com/review/melbetcasino.pro',
  'casea casino':          'https://www.trustpilot.com/review/casea.digital',

  // Rooster Partners brands
  'lucky7even':            'https://www.trustpilot.com/review/www.lucky7even.com',
  'rooster.bet':           'https://www.trustpilot.com/review/rooster.bet',
  'fortune play':          'https://www.trustpilot.com/review/www.fortuneplay.com',
  'fortuneplay':           'https://www.trustpilot.com/review/www.fortuneplay.com',
  'spinjo':                'https://www.trustpilot.com/review/spinjo.com',
  'spinsup':               'https://www.trustpilot.com/review/spinsup.com',
  'rocketspin':            'https://www.trustpilot.com/review/rocketspin.com',
  'rocket spin':           'https://www.trustpilot.com/review/rocketspin.com',
  'play mojo':             'https://www.trustpilot.com/review/playmojo.com',
  'lucky vibe':            'https://www.trustpilot.com/review/luckyvibe.com',
  'luckyvibe':             'https://www.trustpilot.com/review/luckyvibe.com',
  'nova dreams':           'https://www.trustpilot.com/review/novadreams.com',
  'novadreams':            'https://www.trustpilot.com/review/novadreams.com',
  'rollero':               'https://www.trustpilot.com/review/www.rollero.com',
  'revolution':            'https://www.trustpilot.com/review/revolutioncasino.com',
  'revolution casino':     'https://www.trustpilot.com/review/revolutioncasino.com',
  'revolution 1':          'https://www.trustpilot.com/review/revolutioncasino1.com',
  'midarion':              'https://www.trustpilot.com/review/midasluck.com',

  // SuprPlay Limited brands
  'duelz':                 'https://www.trustpilot.com/review/www.duelz.com',
  'duelz.com':             'https://www.trustpilot.com/review/www.duelz.com',
  'voodoo dreams':         'https://www.trustpilot.com/review/voodoodreams.com',
  'voodoodreams':          'https://www.trustpilot.com/review/voodoodreams.com',
  'nyspins':               'https://www.trustpilot.com/review/www.nyspins.com',
  'ny spins':              'https://www.trustpilot.com/review/www.nyspins.com',

  // Trybet brands
  'trybet':                'https://nz.trustpilot.com/review/trybet.com',
  'trybet.com':            'https://nz.trustpilot.com/review/trybet.com',

  // HazEmirates UAE brands
  'hazemirates':           'https://www.trustpilot.com/review/hazemirates.com',

  // SilverPlay brands
  'silverplay':            'https://www.trustpilot.com/review/silverplay.com',
  'silver play':           'https://www.trustpilot.com/review/silverplay.com',

  // Hanan brands (with and without .com suffix variants)
  'zodiacbet.com':         'https://www.trustpilot.com/review/zodiacbet.com',
  'zodiacbet':             'https://www.trustpilot.com/review/zodiacbet.com',
  'pribet.com':            'https://www.trustpilot.com/review/pribet.com',
  'pribet':                'https://www.trustpilot.com/review/pribet.com',
  'emirbet.com':           'https://www.trustpilot.com/review/emirbet.com',
  'emirbet':               'https://www.trustpilot.com/review/emirbet.com',
  'cryptoroyal.com':       'https://www.trustpilot.com/review/cryptoroyal.com',
  'cryptoroyal':           'https://www.trustpilot.com/review/cryptoroyal.com',
  'dachbet.com':           'https://www.trustpilot.com/review/dachbet.com',
  'dachbet':               'https://www.trustpilot.com/review/dachbet.com',
  'winmega.com':           'https://www.trustpilot.com/review/winmega.com',
  'winmega':               'https://www.trustpilot.com/review/winmega.com',
  'olympusbet.com':        'https://www.trustpilot.com/review/olympusbet.com',
  'olympusbet':            'https://www.trustpilot.com/review/olympusbet.com',
  'realspin.com':          'https://www.trustpilot.com/review/realspin.com',
  'realspin':              'https://www.trustpilot.com/review/realspin.com',
  'lucknation.com':        'https://au.trustpilot.com/review/lucknation.com',
  'lucknation':            'https://au.trustpilot.com/review/lucknation.com',
};

// Per-tab brand URL overrides — take precedence over BRAND_TP_URLS when tab matches.
const TAB_BRAND_URLS: Record<string, Record<string, string>> = {
  'Wizard of Odds': {
    'roosterbet':      'https://wizardofodds.com/online-casinos/reviews/roosterbet-casino/',
    'lucky7even':      'https://wizardofodds.com/online-casinos/reviews/lucky7even-casino/',
    'fortuneplay':     'https://wizardofodds.com/online-casinos/reviews/fortuneplay-casino/',
    'fortune play':    'https://wizardofodds.com/online-casinos/reviews/fortuneplay-casino/',
    'rocketspin':      'https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/',
    'rocket spin':     'https://wizardofodds.com/online-casinos/reviews/rocketspin-casino/',
    'luckyvibe':       'https://wizardofodds.com/online-casinos/reviews/luckyvibe/',
    'lucky vibe':      'https://wizardofodds.com/online-casinos/reviews/luckyvibe/',
    'playmojo':        'https://wizardofodds.com/online-casinos/reviews/playmojo-casino/',
    'play mojo':       'https://wizardofodds.com/online-casinos/reviews/playmojo-casino/',
    'rollero':         'https://wizardofodds.com/online-casinos/reviews/rollero-casino/',
  },
  'GRG - Gulf Recovery Group': {
    'grg - gulf recovery group': 'https://www.trustpilot.com/review/gulfrecoverygroup.com',
    'gulf recovery group':       'https://www.trustpilot.com/review/gulfrecoverygroup.com',
  },
};

export function getBrandTpUrl(brandName: string, tab?: string): string | undefined {
  const key = brandName.toLowerCase().trim();
  if (tab && TAB_BRAND_URLS[tab]?.[key]) return TAB_BRAND_URLS[tab][key];
  return BRAND_TP_URLS[key];
}

// Returns true if the tab has TP + AG + CG platform columns.
export function hasMultiPlatform(tab: string): boolean {
  const cols = TAB_COLUMN_CONFIGS[tab];
  if (!cols) return false;
  const set = new Set(cols);
  return set.has('AG Review Status') && set.has('CG Review Status');
}

// Returns the platforms active for a given tab. All tabs default to TP; WO/AG/CG are opt-in via column presence.
export function getTabPlatforms(tab: string): ('tp' | 'ag' | 'cg' | 'wo')[] {
  const cols = TAB_COLUMN_CONFIGS[tab];
  if (tab === 'Wizard of Odds') return ['wo'];
  const platforms: ('tp' | 'ag' | 'cg' | 'wo')[] = ['tp'];
  if (cols) {
    const set = new Set(cols);
    if (set.has('AG Review Status')) platforms.push('ag');
    if (set.has('CG Review Status')) platforms.push('cg');
  }
  return platforms;
}
