import type { Entry } from '../types/entry';

export type Star = 1 | 2 | 3 | 4 | 5;
export type RatingLabel = 'Excellent' | 'Great' | 'Average' | 'Poor' | 'Bad';

export interface BrandSummary {
  brand: string;
  counts: Record<Star, number>;
  total: number;
  average: number | null;
  label: RatingLabel | null;
}

export interface ScoreSummaryResult {
  brands: BrandSummary[];
  excludedRows: number;
}

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

const BRAND_KEYS = ['Brands'] as const;
const STATUS_KEYS = ['TP Review Status', 'Review Status'] as const;
const SCORE_KEYS = ['Score added', 'Score Added', 'Score'] as const;
const DATE_KEYS = ['Trust Pilot'] as const;

function pick(data: Record<string, string | null>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = data[k];
    if (v != null && v !== '') return v;
  }
  return null;
}

export function parseScore(raw: string | null | undefined): Star | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^[1-5]$/.test(s)) return null;
  return Number(s) as Star;
}

export function parsePostDate(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // YYYY-MM-DD
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return buildDate(y, mo, d);
  }
  // MM/DD/YYYY or M/D/YYYY
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const mo = +m[1], d = +m[2], y = +m[3];
    return buildDate(y, mo, d);
  }
  return null;
}

function buildDate(y: number, mo: number, d: number): Date | null {
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

export function ratingLabel(avg: number | null): RatingLabel | null {
  if (avg == null) return null;
  if (avg >= 4.5) return 'Excellent';
  if (avg >= 4.0) return 'Great';
  if (avg >= 3.0) return 'Average';
  if (avg >= 2.0) return 'Poor';
  if (avg >= 1.0) return 'Bad';
  return null;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function computeScoreSummary(
  entries: Entry[],
  range: DateRange,
  pinnedFirst: string[] = ['Revolution Casino'],
): ScoreSummaryResult {
  const fromBound = range.from ? startOfDay(range.from) : null;
  const toBound = range.to ? endOfDay(range.to) : null;

  const buckets = new Map<string, Record<Star, number>>();
  let excludedRows = 0;

  for (const e of entries) {
    const d = e.data ?? {};

    const brand = (pick(d, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;

    const status = (pick(d, STATUS_KEYS) ?? '').trim().toLowerCase();
    if (status !== 'published') continue;

    const score = parseScore(pick(d, SCORE_KEYS));
    const date = parsePostDate(pick(d, DATE_KEYS));

    if (score == null || date == null) {
      excludedRows++;
      continue;
    }
    if (fromBound && date < fromBound) continue;
    if (toBound && date > toBound) continue;

    let bucket = buckets.get(brand);
    if (!bucket) {
      bucket = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      buckets.set(brand, bucket);
    }
    bucket[score] += 1;
  }

  const summaries: BrandSummary[] = [...buckets.entries()].map(([brand, counts]) => {
    const total = counts[1] + counts[2] + counts[3] + counts[4] + counts[5];
    const average =
      total === 0
        ? null
        : Math.round(((counts[1] + 2 * counts[2] + 3 * counts[3] + 4 * counts[4] + 5 * counts[5]) / total) * 10) / 10;
    return {
      brand,
      counts,
      total,
      average,
      label: ratingLabel(average),
    };
  });

  const pinnedSet = new Set(pinnedFirst);
  summaries.sort((a, b) => {
    const aPinned = pinnedSet.has(a.brand);
    const bPinned = pinnedSet.has(b.brand);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    if (aPinned && bPinned) {
      return pinnedFirst.indexOf(a.brand) - pinnedFirst.indexOf(b.brand);
    }
    return a.brand.localeCompare(b.brand);
  });

  return { brands: summaries, excludedRows };
}

export type PresetKey = 'today' | 'this-week' | 'this-month' | 'last-7' | 'last-30' | 'all';

export function resolvePreset(key: PresetKey, now: Date = new Date()): DateRange {
  const today = startOfDay(now);
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'this-week': {
      const dow = today.getDay();
      const offsetToMonday = (dow + 6) % 7;
      const monday = new Date(today);
      monday.setDate(today.getDate() - offsetToMonday);
      return { from: monday, to: today };
    }
    case 'this-month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: first, to: today };
    }
    case 'last-7': {
      const from = new Date(today);
      from.setDate(today.getDate() - 6);
      return { from, to: today };
    }
    case 'last-30': {
      const from = new Date(today);
      from.setDate(today.getDate() - 29);
      return { from, to: today };
    }
    case 'all':
    default:
      return { from: null, to: null };
  }
}

export function dateToIso(d: Date | null): string {
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isoToDate(s: string): Date | null {
  if (!s) return null;
  return parsePostDate(s);
}
