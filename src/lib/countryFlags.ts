// Maps a free-text Country value (as stored per-entry — see getEntryCountry
// in tab-configs.ts) to its flag emoji. Country is free text sourced from
// Account labels or manual entry, so this is deliberately permissive: it
// normalizes case/whitespace and recognizes common aliases (UK, USA, UAE)
// alongside full country names, and returns null for anything unrecognized
// so the caller can fall back to a generic icon rather than showing nothing.
const COUNTRY_NAME_TO_ISO2: Record<string, string> = {
  'afghanistan': 'AF', 'albania': 'AL', 'algeria': 'DZ', 'andorra': 'AD',
  'angola': 'AO', 'argentina': 'AR', 'armenia': 'AM', 'australia': 'AU',
  'austria': 'AT', 'azerbaijan': 'AZ', 'bahamas': 'BS', 'bahrain': 'BH',
  'bangladesh': 'BD', 'barbados': 'BB', 'belarus': 'BY', 'belgium': 'BE',
  'belize': 'BZ', 'benin': 'BJ', 'bhutan': 'BT', 'bolivia': 'BO',
  'bosnia': 'BA', 'bosnia and herzegovina': 'BA', 'botswana': 'BW',
  'brazil': 'BR', 'brunei': 'BN', 'bulgaria': 'BG', 'burkina faso': 'BF',
  'burundi': 'BI', 'cambodia': 'KH', 'cameroon': 'CM', 'canada': 'CA',
  'cape verde': 'CV', 'chad': 'TD', 'chile': 'CL', 'china': 'CN',
  'colombia': 'CO', 'comoros': 'KM', 'congo': 'CG',
  'democratic republic of the congo': 'CD', 'costa rica': 'CR',
  'croatia': 'HR', 'cuba': 'CU', 'cyprus': 'CY', 'czech republic': 'CZ',
  'czechia': 'CZ', 'denmark': 'DK', 'djibouti': 'DJ', 'dominica': 'DM',
  'dominican republic': 'DO', 'ecuador': 'EC', 'egypt': 'EG',
  'el salvador': 'SV', 'equatorial guinea': 'GQ', 'eritrea': 'ER',
  'estonia': 'EE', 'eswatini': 'SZ', 'swaziland': 'SZ', 'ethiopia': 'ET',
  'fiji': 'FJ', 'finland': 'FI', 'france': 'FR', 'gabon': 'GA',
  'gambia': 'GM', 'georgia': 'GE', 'germany': 'DE', 'ghana': 'GH',
  'greece': 'GR', 'grenada': 'GD', 'guatemala': 'GT', 'guinea': 'GN',
  'guinea-bissau': 'GW', 'guyana': 'GY', 'haiti': 'HT', 'honduras': 'HN',
  'hungary': 'HU', 'iceland': 'IS', 'india': 'IN', 'indonesia': 'ID',
  'iran': 'IR', 'iraq': 'IQ', 'ireland': 'IE', 'israel': 'IL',
  'italy': 'IT', 'ivory coast': 'CI', "cote d'ivoire": 'CI', 'jamaica': 'JM',
  'japan': 'JP', 'jordan': 'JO', 'kazakhstan': 'KZ', 'kenya': 'KE',
  'kiribati': 'KI', 'kosovo': 'XK', 'kuwait': 'KW', 'kyrgyzstan': 'KG',
  'laos': 'LA', 'latvia': 'LV', 'lebanon': 'LB', 'lesotho': 'LS',
  'liberia': 'LR', 'libya': 'LY', 'liechtenstein': 'LI', 'lithuania': 'LT',
  'luxembourg': 'LU', 'madagascar': 'MG', 'malawi': 'MW', 'malaysia': 'MY',
  'maldives': 'MV', 'mali': 'ML', 'malta': 'MT', 'marshall islands': 'MH',
  'mauritania': 'MR', 'mauritius': 'MU', 'mexico': 'MX', 'micronesia': 'FM',
  'moldova': 'MD', 'monaco': 'MC', 'mongolia': 'MN', 'montenegro': 'ME',
  'morocco': 'MA', 'mozambique': 'MZ', 'myanmar': 'MM', 'burma': 'MM',
  'namibia': 'NA', 'nauru': 'NR', 'nepal': 'NP', 'netherlands': 'NL',
  'holland': 'NL', 'new zealand': 'NZ', 'nicaragua': 'NI', 'niger': 'NE',
  'nigeria': 'NG', 'north korea': 'KP', 'north macedonia': 'MK',
  'macedonia': 'MK', 'norway': 'NO', 'oman': 'OM', 'pakistan': 'PK',
  'palau': 'PW', 'palestine': 'PS', 'panama': 'PA', 'papua new guinea': 'PG',
  'paraguay': 'PY', 'peru': 'PE', 'philippines': 'PH', 'poland': 'PL',
  'portugal': 'PT', 'qatar': 'QA', 'romania': 'RO', 'russia': 'RU',
  'rwanda': 'RW', 'saint lucia': 'LC', 'samoa': 'WS', 'san marino': 'SM',
  'saudi arabia': 'SA', 'senegal': 'SN', 'serbia': 'RS', 'seychelles': 'SC',
  'sierra leone': 'SL', 'singapore': 'SG', 'slovakia': 'SK',
  'slovenia': 'SI', 'solomon islands': 'SB', 'somalia': 'SO',
  'south africa': 'ZA', 'south korea': 'KR', 'korea': 'KR',
  'south sudan': 'SS', 'spain': 'ES', 'sri lanka': 'LK', 'sudan': 'SD',
  'suriname': 'SR', 'sweden': 'SE', 'switzerland': 'CH', 'syria': 'SY',
  'taiwan': 'TW', 'tajikistan': 'TJ', 'tanzania': 'TZ', 'thailand': 'TH',
  'timor-leste': 'TL', 'togo': 'TG', 'tonga': 'TO',
  'trinidad and tobago': 'TT', 'tunisia': 'TN', 'turkey': 'TR',
  'turkmenistan': 'TM', 'tuvalu': 'TV', 'uganda': 'UG', 'ukraine': 'UA',
  'uruguay': 'UY', 'uzbekistan': 'UZ', 'vanuatu': 'VU', 'vatican city': 'VA',
  'venezuela': 'VE', 'vietnam': 'VN', 'yemen': 'YE', 'zambia': 'ZM',
  'zimbabwe': 'ZW',
  // Common aliases seen in this dataset's free-text Account/Country values.
  'uk': 'GB', 'u.k.': 'GB', 'united kingdom': 'GB', 'great britain': 'GB',
  'england': 'GB', 'scotland': 'GB', 'wales': 'GB',
  'usa': 'US', 'u.s.a.': 'US', 'us': 'US', 'u.s.': 'US',
  'united states': 'US', 'united states of america': 'US', 'america': 'US',
  'uae': 'AE', 'u.a.e.': 'AE', 'united arab emirates': 'AE',
  'emirates': 'AE',
};

function isoToFlagEmoji(iso2: string): string {
  return String.fromCodePoint(
    ...iso2.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

export function countryFlagEmoji(rawCountry: string): string | null {
  const key = rawCountry.trim().toLowerCase();
  const iso2 = COUNTRY_NAME_TO_ISO2[key];
  return iso2 ? isoToFlagEmoji(iso2) : null;
}
