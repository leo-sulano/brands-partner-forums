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
  byCountry: Record<string, CountBreakdown>;
  byProxy: Record<string, CountBreakdown>;
  countries: string[];
  proxies: string[];
}
