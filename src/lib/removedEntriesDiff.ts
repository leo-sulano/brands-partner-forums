export type Platform = 'TP' | 'AG' | 'CG';

export interface RemovedEntryRow {
  id: string;
  run_id: string;
  entry_id: string | null;
  tab: string;
  brand: string | null;
  account_name: string | null;
  platform: Platform;
  link: string | null;
  created_at: string;
}

function rowKey(row: RemovedEntryRow): string {
  return row.entry_id
    ? `${row.entry_id}::${row.platform}`
    : `${row.account_name ?? ''}::${row.platform}`;
}

// Returns rows present in `current` with no matching key in `previous`,
// grouped by `${tab}::${brand ?? ''}`. A brand-less tab groups under the
// empty-string brand key.
export function diffRemovedEntries(
  current: RemovedEntryRow[],
  previous: RemovedEntryRow[],
): Record<string, RemovedEntryRow[]> {
  const previousKeys = new Set(previous.map(rowKey));
  const groups: Record<string, RemovedEntryRow[]> = {};
  for (const row of current) {
    if (previousKeys.has(rowKey(row))) continue;
    const groupKey = `${row.tab}::${row.brand ?? ''}`;
    (groups[groupKey] ??= []).push(row);
  }
  return groups;
}
