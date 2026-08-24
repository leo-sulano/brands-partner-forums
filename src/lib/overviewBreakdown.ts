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

// Published rate for sort purposes only — a card with no accounts at all sorts last (-1),
// distinct from a real 0% rate (all-removed, still ranks above no-data).
function rateForSort(card: { live: number; removed: number }): number {
  const total = card.live + card.removed;
  return total > 0 ? card.live / total : -1;
}

// Highest published rate first; ties fall back to total volume descending for stability.
function byRateThenVolume(a: BreakdownCard, b: BreakdownCard): number {
  const rateDiff = rateForSort(b) - rateForSort(a);
  if (rateDiff !== 0) return rateDiff;
  return (b.live + b.removed) - (a.live + a.removed);
}

// Highest total volume first; ties fall back to published rate descending for stability.
function byVolumeThenRate(a: BreakdownCard, b: BreakdownCard): number {
  const volumeDiff = (b.live + b.removed) - (a.live + a.removed);
  if (volumeDiff !== 0) return volumeDiff;
  return rateForSort(b) - rateForSort(a);
}

export type BreakdownSortMode = 'rate' | 'volume';

// pinnedLastKey (e.g. Proxy Breakdown's "no proxy" key) is excluded from ranking/topN/"Other"
// entirely and appended as its own trailing card, so it always renders last regardless of sortMode
// instead of competing for a top-N slot or a sorted position like a real value. Omit it (Country
// Breakdown does) to let it take part in the sort like everything else. sortMode only changes the
// final display order — which values get their own card vs. fold into "Other" is always decided
// by volume, regardless of sortMode.
export function topNWithOther(
  merged: Record<string, CountBreakdown>,
  topN: number,
  pinnedLastKey?: string,
  sortMode: BreakdownSortMode = 'rate',
): BreakdownCard[] {
  const entries = Object.entries(merged);
  const pinnedEntry = pinnedLastKey ? entries.find(([key]) => key === pinnedLastKey) : undefined;
  const rankable = pinnedEntry ? entries.filter(([key]) => key !== pinnedLastKey) : entries;

  // Which values get their own card vs. fold into "Other" is still decided by volume — rate only
  // determines the final left-to-right position, not which cards are significant enough to show.
  const all: BreakdownCard[] = rankable
    .map(([key, v]) => ({ key, label: v.label, live: v.live, removed: v.removed, isOther: false }))
    .sort((a, b) => (b.live + b.removed) - (a.live + a.removed));

  const top = all.slice(0, topN);
  const rest = all.slice(topN);
  const cards = [...top];
  if (rest.length > 0) {
    cards.push({
      key: '__other__',
      label: 'Other',
      live: rest.reduce((s, r) => s + r.live, 0),
      removed: rest.reduce((s, r) => s + r.removed, 0),
      isOther: true,
      members: rest,
    });
  }
  cards.sort(sortMode === 'volume' ? byVolumeThenRate : byRateThenVolume);
  if (pinnedEntry) {
    const [key, v] = pinnedEntry;
    cards.push({ key, label: v.label, live: v.live, removed: v.removed, isOther: false });
  }
  return cards;
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
