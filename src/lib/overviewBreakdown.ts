import type { CountBreakdown } from '../types/brand-entry';

export function mergeBreakdownMaps(maps: Record<string, CountBreakdown>[]): Record<string, CountBreakdown> {
  const merged: Record<string, CountBreakdown> = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      if (!merged[key]) merged[key] = { label: value.label, live: 0, removed: 0 };
      merged[key].live += value.live;
      merged[key].removed += value.removed;
    }
  }
  return merged;
}

export interface BreakdownCard {
  key: string;
  label: string;
  live: number;
  removed: number;
  isOther: boolean;
  // Only present on the synthetic "Other" card — the individual real cards
  // that were folded into it, so the UI can offer a way to see what's
  // actually inside "Other" rather than just an unexplained total.
  members?: BreakdownCard[];
}

export function topNWithOther(merged: Record<string, CountBreakdown>, topN: number): BreakdownCard[] {
  const all: BreakdownCard[] = Object.entries(merged)
    .map(([key, v]) => ({ key, label: v.label, live: v.live, removed: v.removed, isOther: false }))
    .sort((a, b) => (b.live + b.removed) - (a.live + a.removed));

  const top = all.slice(0, topN);
  const rest = all.slice(topN);
  if (rest.length === 0) return top;

  const other: BreakdownCard = {
    key: '__other__',
    label: 'Other',
    live: rest.reduce((s, r) => s + r.live, 0),
    removed: rest.reduce((s, r) => s + r.removed, 0),
    isOther: true,
    members: rest,
  };
  return [...top, other];
}

export function mergeDistinctValues(lists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const v of list) {
      const trimmed = v.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!seen.has(key)) seen.set(key, trimmed);
    }
  }
  return [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
