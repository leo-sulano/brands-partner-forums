import type { CustomPlatformConfig } from '../lib/customPlatforms.ts';

export interface BrandEntry {
  id: string;
  tab: string;
  source_row_id: string;
  casino: string;
  platform: string | null;
  status: string;
  date: string | null;
  notes: string | null;
}

export interface PlatformKpis {
  live: number;
  removed: number;
}

export interface CountBreakdown {
  label: string;
  live: number;
  removed: number;
}

// One cell of the Overview Country x Proxy matrix — carries both labels
// (unlike CountBreakdown's single label) since the composite key encodes
// two independent dimensions.
export interface CountBreakdownPair {
  countryLabel: string;
  proxyLabel: string;
  live: number;
  removed: number;
}

export interface TabKpis {
  total: number;
  live: number;
  removed: number;
  done: number;
  pending: number;
  onPause: number;
  notDone: number;
  tp: PlatformKpis;
  ag: PlatformKpis;
  cg: PlatformKpis;
  wo: PlatformKpis;
  activePlatforms: ('tp' | 'ag' | 'cg' | 'wo')[];
  customPlatforms: { platform: CustomPlatformConfig; total: number; live: number; removed: number; successRate: number | null }[];
  byCountry: Record<string, CountBreakdown>;
  byProxy: Record<string, CountBreakdown>;
  // Composite country+proxy breakdown for Overview's Country x Proxy matrix —
  // key is `${canonicalCountryKey}::${canonicalProxyKey}`. Built from the same
  // classification pass as byCountry/byProxy in computeTabKpisFromEntries, so
  // it can never disagree with those two maps for the same entries.
  byCountryProxy: Record<string, CountBreakdownPair>;
  countries: string[];
  proxies: string[];
}

// Same per-platform live/removed shape as TabKpis, scoped to one brand
// instead of a whole tab — deliberately omits byCountry/byProxy/countries/
// proxies since the per-brand "Brands" view has no use for them.
export interface BrandKpis {
  live: number;
  removed: number;
  tp: PlatformKpis;
  ag: PlatformKpis;
  cg: PlatformKpis;
  wo: PlatformKpis;
  activePlatforms: ('tp' | 'ag' | 'cg' | 'wo')[];
}
