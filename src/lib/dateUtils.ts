export const ENTRY_DATE_COLS = [
  'Trust Pilot',
  'Ask Gambler review added',
  'Casino Guru review added',
  'Removed / Not Published / stil published date',
  'Date', 'date', 'Posted At', 'posted_at',
];

export function parseCellDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d;
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  return null;
}

export function getEntryDate(data: Record<string, string | null>): Date | null {
  for (const col of ENTRY_DATE_COLS) {
    const raw = data[col];
    if (!raw) continue;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export function inDateRange(data: Record<string, string | null>, from: string, to: string): boolean {
  const d = getEntryDate(data);
  if (!d) return false;
  if (from && d < new Date(from)) return false;
  if (to && d > new Date(to + 'T23:59:59')) return false;
  return true;
}

export function isoToDisplay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
