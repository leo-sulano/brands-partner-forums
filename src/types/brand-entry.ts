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
}
