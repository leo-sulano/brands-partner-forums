import type { Entry } from '../types/entry';

export type Star = 1 | 2 | 3 | 4 | 5;
export type RatingLabel = 'Excellent' | 'Great' | 'Average' | 'Poor' | 'Bad';

export interface BrandSummary {
  brand: string;
  counts: Record<Star, number>;
  unrated: number;
  total: number;
  rated: number;
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

// Kept aligned with BRAND_COLS / TP_STATUS_VARIANTS in BrandGroup.tsx so the
// summary works on any brand-group tab. 'Account Name' is intentionally NOT
// here — it would bucket one row per account, which isn't a useful summary.
const BRAND_KEYS = ['Brands', 'Brand Name', 'Brand', 'Brand / TP URL PAGE', 'URL PAGE'] as const;
const STATUS_KEYS = [
  'TP Review Status',
  'Trust Pilot Review Status',
  'Trustpilot Review Status',
  'Trust pilot Review Status',
  'Review Status',
] as const;
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

// Date format used in the sheet/dashboard is DD/MM/YYYY (European, matches
// parseCellDate in src/lib/dateUtils.ts). The DatePicker emits YYYY-MM-DD.
export function parsePostDate(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // YYYY-MM-DD (DatePicker output, or ISO from elsewhere)
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return buildDate(y, mo, d);
  }
  // DD/MM/YYYY or D/M/YYYY (sheet format)
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const d = +m[1], mo = +m[2], y = +m[3];
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
  pinnedFirst: string[] = [],
): ScoreSummaryResult {
  const fromBound = range.from ? startOfDay(range.from) : null;
  const toBound = range.to ? endOfDay(range.to) : null;

  interface Bucket {
    counts: Record<Star, number>;
    unrated: number;
  }

  const buckets = new Map<string, Bucket>();
  let excludedRows = 0;
  const dateFilterActive = fromBound !== null || toBound !== null;

  for (const e of entries) {
    const d = e.data ?? {};

    const brand = (pick(d, BRAND_KEYS) ?? '').trim();
    if (!brand) continue;

    const status = (pick(d, STATUS_KEYS) ?? '').trim().toLowerCase();
    if (status !== 'published') continue;

    const date = parsePostDate(pick(d, DATE_KEYS));

    if (dateFilterActive) {
      if (date == null) {
        excludedRows++;
        continue;
      }
      if (fromBound && date < fromBound) continue;
      if (toBound && date > toBound) continue;
    }

    let bucket = buckets.get(brand);
    if (!bucket) {
      bucket = { counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, unrated: 0 };
      buckets.set(brand, bucket);
    }

    const score = parseScore(pick(d, SCORE_KEYS));
    if (score == null) {
      bucket.unrated += 1;
    } else {
      bucket.counts[score] += 1;
    }
  }

  const summaries: BrandSummary[] = [...buckets.entries()].map(([brand, b]) => {
    const counts = b.counts;
    const rated = counts[1] + counts[2] + counts[3] + counts[4] + counts[5];
    const total = rated + b.unrated;
    const average =
      rated === 0
        ? null
        : Math.round(((counts[1] + 2 * counts[2] + 3 * counts[3] + 4 * counts[4] + 5 * counts[5]) / rated) * 10) / 10;
    return {
      brand,
      counts,
      unrated: b.unrated,
      total,
      rated,
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
