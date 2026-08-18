import { getEntryCountry } from './tab-configs.ts';

// Country is free text sourced from Account labels or manual entry (see
// getEntryCountry in tab-configs.ts), so the same real country can appear
// under different spellings ("UK" vs "United Kingdom"). This module gives
// every recognized spelling one canonical identity — an ISO 3166-1 alpha-2
// code — used to merge them for filtering, breakdown bucketing, and display,
// plus a real flag icon and a single canonical display name.
//
// PRIMARY_COUNTRY_NAMES holds one entry per real country, keyed by its most
// common full English name. ALIASES maps every other recognized spelling to
// its primary key, so "UK", "England", and "Great Britain" all resolve to
// the same "United Kingdom" identity. Unrecognized input falls back to the
// raw trimmed/lowercased text (still deduped case-insensitively, just not
// merged with any other spelling — the best we can do for free text).
const PRIMARY_COUNTRY_NAMES: Record<string, string> = {
  'afghanistan': 'AF', 'albania': 'AL', 'algeria': 'DZ', 'andorra': 'AD',
  'angola': 'AO', 'argentina': 'AR', 'armenia': 'AM', 'australia': 'AU',
  'austria': 'AT', 'azerbaijan': 'AZ', 'bahamas': 'BS', 'bahrain': 'BH',
  'bangladesh': 'BD', 'barbados': 'BB', 'belarus': 'BY', 'belgium': 'BE',
  'belize': 'BZ', 'benin': 'BJ', 'bhutan': 'BT', 'bolivia': 'BO',
  'bosnia and herzegovina': 'BA', 'botswana': 'BW',
  'brazil': 'BR', 'brunei': 'BN', 'bulgaria': 'BG', 'burkina faso': 'BF',
  'burundi': 'BI', 'cambodia': 'KH', 'cameroon': 'CM', 'canada': 'CA',
  'cape verde': 'CV', 'chad': 'TD', 'chile': 'CL', 'china': 'CN',
  'colombia': 'CO', 'comoros': 'KM', 'congo': 'CG',
  'democratic republic of the congo': 'CD', 'costa rica': 'CR',
  'croatia': 'HR', 'cuba': 'CU', 'cyprus': 'CY', 'czech republic': 'CZ',
  'czechia': 'CZ', 'denmark': 'DK', 'djibouti': 'DJ', 'dominica': 'DM',
  'dominican republic': 'DO', 'ecuador': 'EC', 'egypt': 'EG',
  'el salvador': 'SV', 'equatorial guinea': 'GQ', 'eritrea': 'ER',
  'estonia': 'EE', 'eswatini': 'SZ', 'ethiopia': 'ET',
  'fiji': 'FJ', 'finland': 'FI', 'france': 'FR', 'gabon': 'GA',
  'gambia': 'GM', 'georgia': 'GE', 'germany': 'DE', 'ghana': 'GH',
  'greece': 'GR', 'grenada': 'GD', 'guatemala': 'GT', 'guinea': 'GN',
  'guinea-bissau': 'GW', 'guyana': 'GY', 'haiti': 'HT', 'honduras': 'HN',
  'hungary': 'HU', 'iceland': 'IS', 'india': 'IN', 'indonesia': 'ID',
  'iran': 'IR', 'iraq': 'IQ', 'ireland': 'IE', 'israel': 'IL',
  'italy': 'IT', 'ivory coast': 'CI', 'jamaica': 'JM',
  'japan': 'JP', 'jordan': 'JO', 'kazakhstan': 'KZ', 'kenya': 'KE',
  'kiribati': 'KI', 'kosovo': 'XK', 'kuwait': 'KW', 'kyrgyzstan': 'KG',
  'laos': 'LA', 'latvia': 'LV', 'lebanon': 'LB', 'lesotho': 'LS',
  'liberia': 'LR', 'libya': 'LY', 'liechtenstein': 'LI', 'lithuania': 'LT',
  'luxembourg': 'LU', 'madagascar': 'MG', 'malawi': 'MW', 'malaysia': 'MY',
  'maldives': 'MV', 'mali': 'ML', 'malta': 'MT', 'marshall islands': 'MH',
  'mauritania': 'MR', 'mauritius': 'MU', 'mexico': 'MX', 'micronesia': 'FM',
  'moldova': 'MD', 'monaco': 'MC', 'mongolia': 'MN', 'montenegro': 'ME',
  'morocco': 'MA', 'mozambique': 'MZ', 'myanmar': 'MM',
  'namibia': 'NA', 'nauru': 'NR', 'nepal': 'NP', 'netherlands': 'NL',
  'new zealand': 'NZ', 'nicaragua': 'NI', 'niger': 'NE',
  'nigeria': 'NG', 'north korea': 'KP', 'north macedonia': 'MK',
  'norway': 'NO', 'oman': 'OM', 'pakistan': 'PK',
  'palau': 'PW', 'palestine': 'PS', 'panama': 'PA', 'papua new guinea': 'PG',
  'paraguay': 'PY', 'peru': 'PE', 'philippines': 'PH', 'poland': 'PL',
  'portugal': 'PT', 'qatar': 'QA', 'romania': 'RO', 'russia': 'RU',
  'rwanda': 'RW', 'saint lucia': 'LC', 'samoa': 'WS', 'san marino': 'SM',
  'saudi arabia': 'SA', 'senegal': 'SN', 'serbia': 'RS', 'seychelles': 'SC',
  'sierra leone': 'SL', 'singapore': 'SG', 'slovakia': 'SK',
  'slovenia': 'SI', 'solomon islands': 'SB', 'somalia': 'SO',
  'south africa': 'ZA', 'south korea': 'KR',
  'south sudan': 'SS', 'spain': 'ES', 'sri lanka': 'LK', 'sudan': 'SD',
  'suriname': 'SR', 'sweden': 'SE', 'switzerland': 'CH', 'syria': 'SY',
  'taiwan': 'TW', 'tajikistan': 'TJ', 'tanzania': 'TZ', 'thailand': 'TH',
  'timor-leste': 'TL', 'togo': 'TG', 'tonga': 'TO',
  'trinidad and tobago': 'TT', 'tunisia': 'TN', 'turkey': 'TR',
  'turkmenistan': 'TM', 'tuvalu': 'TV', 'uganda': 'UG', 'ukraine': 'UA',
  'united arab emirates': 'AE', 'united kingdom': 'GB',
  'united states': 'US',
  'uruguay': 'UY', 'uzbekistan': 'UZ', 'vanuatu': 'VU', 'vatican city': 'VA',
  'venezuela': 'VE', 'vietnam': 'VN', 'yemen': 'YE', 'zambia': 'ZM',
  'zimbabwe': 'ZW',
};

const ALIASES: Record<string, string> = {
  'bosnia': 'bosnia and herzegovina',
  'swaziland': 'eswatini',
  "cote d'ivoire": 'ivory coast',
  'burma': 'myanmar',
  'holland': 'netherlands',
  'macedonia': 'north macedonia',
  'korea': 'south korea',
  'uk': 'united kingdom', 'u.k.': 'united kingdom',
  'great britain': 'united kingdom', 'england': 'united kingdom',
  'scotland': 'united kingdom', 'wales': 'united kingdom',
  'usa': 'united states', 'u.s.a.': 'united states', 'us': 'united states',
  'u.s.': 'united states', 'united states of america': 'united states',
  'america': 'united states',
  'uae': 'united arab emirates', 'u.a.e.': 'united arab emirates',
  'emirates': 'united arab emirates',
};

function resolvePrimaryKey(rawCountry: string): string | null {
  const key = rawCountry.trim().toLowerCase();
  if (!key) return null;
  if (PRIMARY_COUNTRY_NAMES[key]) return key;
  if (ALIASES[key]) return ALIASES[key];
  return null;
}

const TITLE_CASE_LOWERCASE_WORDS = new Set(['and', 'of', 'the']);

function titleCase(name: string): string {
  return name.replace(/[a-z]+/gi, (word, offset: number) => {
    if (offset !== 0 && TITLE_CASE_LOWERCASE_WORDS.has(word.toLowerCase())) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

// The key every "same real country" merges on — an ISO2 code for anything
// recognized, else the raw trimmed/lowercased text (unrecognized values
// still dedupe against themselves, just can't merge with other spellings).
export function canonicalCountryKey(rawCountry: string): string {
  const primary = resolvePrimaryKey(rawCountry);
  return primary ? PRIMARY_COUNTRY_NAMES[primary] : rawCountry.trim().toLowerCase();
}

// The display name to show for a country — always the canonical full name
// for anything recognized (so "UK" and "United Kingdom" both display as
// "United Kingdom"), else the raw value as typed (trimmed only).
export function canonicalCountryName(rawCountry: string): string {
  const primary = resolvePrimaryKey(rawCountry);
  return primary ? titleCase(primary) : rawCountry.trim();
}

// A real flag image URL (flagcdn.com, SVG) for a recognized country, else
// null so the caller can fall back to a generic icon.
export function countryFlagImageUrl(rawCountry: string): string | null {
  const primary = resolvePrimaryKey(rawCountry);
  return primary ? `https://flagcdn.com/${PRIMARY_COUNTRY_NAMES[primary].toLowerCase()}.svg` : null;
}

// getEntryCountry returns '' when an entry has neither a raw Country value
// nor one derivable from its Account text. Folding that into a literal
// "Unknown" label — rather than leaving it blank — turns "no country" into
// a real, filterable, canonicalizable identity instead of a value every
// country-identity consumer (breakdown buckets, dropdown options, filter
// matching) has to separately remember to skip or fall silent on.
export function resolveCountryLabel(data: Record<string, string | null>, tab: string): string {
  return getEntryCountry(data, tab) || 'Unknown';
}
