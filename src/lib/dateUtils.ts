export const ENTRY_DATE_COLS = [
  'Trust Pilot',
  'Ask Gambler review added',
  'Casino Guru review added',
  'Removed / Not Published / stil published date',
  'Date', 'date', 'Posted At', 'posted_at',
];

export function parseCellDate(value: string): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d;
  return null;
}

export function getEntryDate(data: Record<string, string | null>): Date | null {
  for (const col of ENTRY_DATE_COLS) {
    const raw = data[col];
    if (!raw) continue;
    const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) return new Date(+slash[3], +slash[2] - 1, +slash[1]);
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export function inDateRange(data: Record<string, string | null>, from: string, to: string): boolean {
  const d = getEntryDate(data);
  if (!d) return false;
  if (from && d < new Date(from + 'T00:00:00')) return false;
  if (to && d > new Date(to + 'T23:59:59')) return false;
  return true;
}

export function isoToDisplay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// The raw sheet-import headers that hold a review's "added"/removal date and
// nothing else — Add/Edit Entry guard these against free text (see
// isValidDateText below) so a date column can't silently collect values like
// "TBD" or "pending" that every date-range filter/sort in this app would then
// just skip as unparseable.
export const DATE_ENTRY_HEADERS = new Set([
  'Trust Pilot',
  'Ask Gambler review added',
  'Casino Guru review added',
  'Wizard of Odds',
  'Removed / Not Published / stil published date',
]);

// Real-calendar-date check for DD/MM/YYYY or YYYY-MM-DD text, used to gate
// what Add/Edit Entry will save into DATE_ENTRY_HEADERS columns. Deliberately
// stricter than parseCellDate/`new Date(...)`: JS's native parser rolls
// invalid dates over into the next month (e.g. "2026-02-30" silently becomes
// March 2) and accepts a wide range of non-date text as a timestamp, neither
// of which is "a valid date" in the sense a data-entry guardrail needs.
// Blank is valid — every one of these columns is optional.
//
// Two case-insensitive status sentinels are also accepted alongside real
// dates: "No Review" and "On Pause" (optionally "on pause as from
// D/M/YYYY"). A live-data audit (2026-08-14) found these are deliberate,
// heavily-used vocabulary — 4,805 and 346 rows respectively across every
// multi-platform tab — not typos; an earlier version of this guardrail
// rejected them outright and would have blocked legitimate saves. The "as
// from" date is checked leniently in either D/M or M/D order since the
// handful of real examples use both.
export function isValidDateText(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^no review$/i.test(trimmed)) return true;

  const pause = trimmed.match(/^on pause(?:\s+as from\s+(\d{1,2})\/(\d{1,2})\/(\d{4}))?$/i);
  if (pause) {
    if (!pause[1]) return true;
    const a = +pause[1], b = +pause[2], y = +pause[3];
    return isRealCalendarDate(y, a, b) || isRealCalendarDate(y, b, a);
  }

  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return isRealCalendarDate(+slash[3], +slash[2], +slash[1]);

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isRealCalendarDate(+iso[1], +iso[2], +iso[3]);

  return false;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}
