import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Star, X } from 'lucide-react';
import DatePicker from './DatePicker';
import {
  computeScoreSummary,
  computeSuccessRates,
  computeTabSuccessRates,
  isoToDate,
  summarizeCounts,
  PLATFORM_MAX_SCORE,
  type BrandSummary,
  type Platform,
  type Star as StarRating,
  type SuccessRate,
} from '../lib/scoreSummary';
import { tabToSlug, tabDisplayName } from '../lib/tabs';
import type { Entry } from '../types/entry';

interface Props {
  entries: Entry[];
}

// 5 color tiers regardless of scale — a 1-10 score buckets 2 values per tier
// (9-10 emerald, 7-8 green, ...) so AG's wider table still reads as the same
// green-to-red gradient as TP/CG's 5-column one.
const STAR_TIER_COLOR = ['text-rose-500', 'text-orange-500', 'text-amber-500', 'text-green-500', 'text-emerald-500'];

function starColor(value: number, maxScore: number): string {
  const tier = Math.ceil(value / (maxScore / 5));
  return STAR_TIER_COLOR[tier - 1];
}

function starsFor(maxScore: number): StarRating[] {
  return Array.from({ length: maxScore }, (_, i) => maxScore - i);
}

// Displayed percentage shown to the user: floors instead of rounds, except
// when the rate is exactly 100, so a sub-100 rate (e.g. 199 live / 1 removed
// = 99.5%) never displays as "100%" — which would misleadingly read as
// flawless.
function successRatePct(rate: number | null): number | null {
  if (rate == null) return null;
  return rate === 100 ? 100 : Math.floor(rate);
}

// Color tier is based on the same displayed/rounded percentage as the text
// (via successRatePct), not the raw unrounded rate — otherwise a rate like
// 79.6% could display as "80%" while tinted amber (since 79.6 < 80), a
// visible mismatch between the number shown and its color.
function successRateColor(rate: number | null): string {
  const pct = successRatePct(rate);
  if (pct == null) return 'text-slate-300';
  if (pct >= 80) return 'text-emerald-600';
  if (pct >= 50) return 'text-amber-600';
  return 'text-rose-600';
}

// Cell shows only the percentage; the live/removed breakdown behind it is
// revealed via the title attribute (successRateTitle) on hover instead.
function formatSuccessRate(sr: SuccessRate | undefined): string {
  if (!sr || sr.rate == null) return '—';
  return `${successRatePct(sr.rate)}%`;
}

function successRateTitle(sr: SuccessRate | undefined): string {
  if (!sr || sr.rate == null) return 'No live or removed history yet';
  return `${successRatePct(sr.rate)}% = ${sr.live} live ÷ (${sr.live} live + ${sr.removed} removed)`;
}

const PLATFORM_OPTS: { value: Platform; label: string; icon: string }[] = [
  { value: 'tp', label: 'TrustPilot',  icon: 'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=32' },
  { value: 'ag', label: 'AskGamblers', icon: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=32' },
  { value: 'cg', label: 'CasinoGuru',  icon: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=32' },
  { value: 'wo', label: 'Wizard of Odds', icon: 'https://www.google.com/s2/favicons?domain=wizardofodds.com&sz=32' },
];

const PLATFORM_DATE_LABEL: Record<Platform, string> = {
  tp: 'Trust Pilot date',
  ag: 'AskGamblers date',
  cg: 'CasinoGuru date',
  wo: 'Wizard of Odds date',
};

export default function ScoreSummaryPanel({ entries }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [fromIso, setFromIso] = useState('');
  const [toIso, setToIso] = useState('');
  const [tabFilter, setTabFilter] = useState('');
  const [platform, setPlatform] = useState<Platform>('tp');

  // Range is driven entirely by the From/To date pickers. Both empty = all time.
  const range = useMemo(
    () => ({ from: isoToDate(fromIso), to: isoToDate(toIso) }),
    [fromIso, toIso],
  );

  const result = useMemo(
    () => computeScoreSummary(entries, range, [], platform),
    [entries, range, platform],
  );

  const successRates = useMemo(
    () => computeSuccessRates(entries, platform),
    [entries, platform],
  );

  const tabSuccessRates = useMemo(
    () => computeTabSuccessRates(entries, platform),
    [entries, platform],
  );

  const maxScore = PLATFORM_MAX_SCORE[platform];

  // Tab options come from the raw entries so the dropdown lists every tab that
  // has data, not just those that survived the active date filter.
  const tabOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.tab) set.add(e.tab);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const filteredBrands = useMemo(
    () => (tabFilter ? result.brands.filter((b) => b.tab === tabFilter) : result.brands),
    [result.brands, tabFilter],
  );

  const totalAcrossBrands = filteredBrands.reduce((s, b) => s + b.total, 0);

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Score Summary</h2>
          <span className="text-xs text-slate-400">
            {PLATFORM_OPTS.find((o) => o.value === platform)?.label} · Published reviews
            {totalAcrossBrands > 0 ? ` · ${totalAcrossBrands.toLocaleString()} total` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded-md p-1 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          aria-label={collapsed ? 'Expand score summary' : 'Collapse score summary'}
        >
          <ChevronDown
            className={`size-4 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}
          />
        </button>
      </header>

      {!collapsed && (
        <div className="px-4 py-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <PlatformFilter value={platform} onChange={setPlatform} />
            <div className="h-4 w-px bg-slate-200 mx-1" />
            <DatePicker
              value={fromIso}
              onChange={setFromIso}
              placeholder="From date"
              max={toIso || undefined}
              align="left"
            />
            <span className="text-xs text-slate-400">→</span>
            <DatePicker
              value={toIso}
              onChange={setToIso}
              placeholder="To date"
              min={fromIso || undefined}
            />
            <div className="h-4 w-px bg-slate-200 mx-1" />
            <TabFilterDropdown value={tabFilter} onChange={setTabFilter} options={tabOptions} />
          </div>

          {filteredBrands.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              {result.brands.length === 0
                ? 'No published reviews in this range.'
                : `No published reviews for ${tabFilter || 'this filter'} in this range.`}
            </div>
          ) : (
            <GroupedSummary rows={filteredBrands} maxScore={maxScore} platform={platform} successRates={successRates} tabSuccessRates={tabSuccessRates} />
          )}

          {result.excludedRows > 0 && (
            <p className="text-xs text-slate-400">
              {result.excludedRows} row{result.excludedRows !== 1 ? 's' : ''} excluded from the selected range (missing or unreadable {PLATFORM_DATE_LABEL[platform]}).
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function PlatformFilter({
  value,
  onChange,
}: {
  value: Platform;
  onChange: (v: Platform) => void;
}) {
  return (
    <div className="inline-flex rounded-md overflow-hidden">
      {PLATFORM_OPTS.map((opt, i) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors ${
            i > 0 && opt.value !== value && PLATFORM_OPTS[i - 1].value !== value ? 'border-l border-slate-200' : ''
          } ${
            opt.value === value
              ? 'bg-[#2D5FED] text-white'
              : 'text-slate-600 hover:bg-blue-50'
          }`}
        >
          <img
            src={opt.icon}
            alt=""
            className="size-3 shrink-0 rounded-sm"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function TabFilterDropdown({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const active = !!value;
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors ${
          active
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50'
        }`}
      >
        {active && <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />}
        <span className="max-w-[10rem] truncate">{active ? tabDisplayName(value) : 'All brands'}</span>
        {active ? (
          <span
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="ml-0.5 text-blue-400 hover:text-blue-600 transition-colors"
            role="button"
            aria-label="Clear brand filter"
          >
            <X className="size-3" />
          </span>
        ) : (
          <ChevronDown className={`size-3 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="max-h-72 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${
                !value ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-600'
              }`}
            >
              <span className="flex-1">All brands</span>
              {!value && <Check className="size-3 text-blue-500" />}
            </button>
            {options.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">No brands available</div>
            )}
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-blue-50 ${
                  opt === value ? 'font-medium text-blue-700 bg-blue-50/60' : 'text-slate-600'
                }`}
              >
                <span className="flex-1 truncate">{tabDisplayName(opt)}</span>
                {opt === value && <Check className="size-3 text-blue-500" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupedSummary({ rows, maxScore, platform, successRates, tabSuccessRates }: { rows: BrandSummary[]; maxScore: number; platform: Platform; successRates: Map<string, SuccessRate>; tabSuccessRates: Map<string, SuccessRate> }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const map = new Map<string, BrandSummary[]>();
    for (const r of rows) {
      const list = map.get(r.tab);
      if (list) list.push(r);
      else map.set(r.tab, [r]);
    }
    return [...map.entries()]
      .map(([tab, brands]) => ({ tab, brands }))
      .sort((a, b) => a.tab.localeCompare(b.tab));
  }, [rows]);

  function toggle(tab: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(tab)) next.delete(tab);
      else next.add(tab);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {groups.map(({ tab, brands }) => {
        const isCollapsed = collapsed.has(tab);
        const groupTotal = brands.reduce((s, b) => s + b.total, 0);
        return (
          <section key={tab} className="rounded-md border border-slate-200">
            <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-700">{tab ? tabDisplayName(tab) : '(no tab)'}</h3>
                <span className="text-xs text-slate-400">
                  {brands.length} brand{brands.length !== 1 ? 's' : ''} · {groupTotal.toLocaleString()} review{groupTotal !== 1 ? 's' : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => toggle(tab)}
                className="rounded-md p-1 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
                aria-label={isCollapsed ? `Expand ${tabDisplayName(tab)}` : `Collapse ${tabDisplayName(tab)}`}
              >
                <ChevronDown
                  className={`size-4 transition-transform duration-150 ${isCollapsed ? '-rotate-90' : ''}`}
                />
              </button>
            </header>
            {!isCollapsed && <SummaryTable rows={brands} maxScore={maxScore} platform={platform} successRates={successRates} tabSuccessRates={tabSuccessRates} />}
          </section>
        );
      })}
    </div>
  );
}

interface ColumnTotals {
  counts: Record<StarRating, number>;
  unrated: number;
  total: number;
}

// Sums every column across a set of brand rows. Used by both the per-group
// Total row and the all-brands grand total.
function computeColumnTotals(rows: BrandSummary[], maxScore: number): ColumnTotals {
  const stars = starsFor(maxScore);
  const counts: Record<StarRating, number> = {};
  for (const s of stars) counts[s] = 0;
  let unrated = 0;
  for (const r of rows) {
    for (const s of stars) counts[s] += r.counts[s] ?? 0;
    unrated += r.unrated;
  }
  const { total } = summarizeCounts(counts, unrated, maxScore);
  return { counts, unrated, total };
}

// Shared fixed column widths so every group table (and the grand total) lines
// up vertically. Brand column flexes; numeric/rating columns are fixed. The
// number of star columns varies by platform (5 for TP/CG, 10 for AG).
function SummaryColgroup({ showGroup = false, maxScore }: { showGroup?: boolean; maxScore: number }) {
  return (
    <colgroup>
      {showGroup && <col className="w-32" />}
      <col />
      {Array.from({ length: maxScore }, (_, i) => (
        <col key={i} className="w-16" />
      ))}
      <col className="w-20" />
      <col className="w-20" />
      <col className="w-20" />
      <col className="w-20" />
      <col className="w-20" />
      <col className="w-28" />
    </colgroup>
  );
}

function SummaryTable({ rows, maxScore, platform, successRates, tabSuccessRates }: { rows: BrandSummary[]; maxScore: number; platform: Platform; successRates: Map<string, SuccessRate>; tabSuccessRates: Map<string, SuccessRate> }) {
  const stars = starsFor(maxScore);
  const showGroup = new Set(rows.map((r) => r.tab)).size > 1;
  const totals = useMemo(() => computeColumnTotals(rows, maxScore), [rows, maxScore]);
  // All rows in a single SummaryTable share one tab (GroupedSummary groups by
  // r.tab before rendering each table), so a direct lookup by rows[0].tab is
  // the whole tab's rate — not a sum over only the brands that happen to have
  // a row (which would exclude brands with 0 Published entries).
  const groupSuccess = tabSuccessRates.get(rows[0]?.tab ?? '') ?? { live: 0, removed: 0, rate: null };

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm">
        <SummaryColgroup showGroup={showGroup} maxScore={maxScore} />
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-200">
            {showGroup && <th className="px-3 py-1" />}
            <th className="px-3 py-1" />
            <th colSpan={stars.length + 2} className="border-l border-slate-200 px-2 py-1 text-center font-medium text-slate-400">
              Star Rating
            </th>
            <th colSpan={4} className="border-l-2 border-blue-200 px-2 py-1 text-center font-medium text-slate-400">
              Success Rate
            </th>
          </tr>
          <tr>
            {showGroup && <th scope="col" className="px-3 py-2 text-left font-medium">Group</th>}
            <th scope="col" className="px-3 py-2 text-left font-medium">Brand</th>
            {stars.map((s, i) => (
              <th key={s} scope="col" className={`px-2 py-2 text-right font-medium ${i === 0 ? 'border-l border-slate-200' : ''}`}>
                <span className="inline-flex items-center justify-end gap-0.5">
                  <span className="font-mono tabular-nums">{s}</span>
                  <Star className={`size-3 fill-current ${starColor(s, maxScore)}`} />
                </span>
              </th>
            ))}
            <th
              scope="col"
              className="px-2 py-2 text-right font-medium"
              title="Published reviews with no Score added value yet"
            >
              Unrtd
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Total</th>
            <th
              scope="col"
              className="border-l-2 border-blue-200 px-2 py-2 text-right font-medium"
              title="Reviews still live on the platform"
            >
              Published
            </th>
            <th
              scope="col"
              className="px-2 py-2 text-right font-medium"
              title="Reviews removed from the platform"
            >
              Removed
            </th>
            <th
              scope="col"
              className="px-2 py-2 text-right font-medium"
              title="Published + Removed — reviews with a decided outcome, across all history on this platform"
            >
              Total
            </th>
            <th
              scope="col"
              className="px-2 py-2 text-right font-medium"
              title="Success Rate: Live ÷ (Live + Removed) across all history on this platform — not affected by the date range"
            >
              SR (%)
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const sr = successRates.get(`${r.tab} ${r.brand}`);
            return (
            <tr key={`${r.tab}|${r.brand}`} className="hover:bg-blue-50/60">
              {showGroup && (
                <td className="px-3 py-1.5 text-xs text-slate-500 truncate" title={tabDisplayName(r.tab)}>{tabDisplayName(r.tab)}</td>
              )}
              <td className="px-3 py-1.5 truncate" title={r.brand}>
                <Link
                  to={`/brands/${tabToSlug(r.tab)}?platform=${platform}&brand=${encodeURIComponent(r.brand)}`}
                  className="font-medium text-slate-800 hover:text-blue-600 hover:underline"
                >
                  {r.brand}
                </Link>
              </td>
              {stars.map((s, i) => (
                <td
                  key={s}
                  className={`px-2 py-1.5 text-right font-mono tabular-nums ${i === 0 ? 'border-l border-slate-200' : ''} ${
                    r.counts[s] > 0 ? 'text-slate-800' : 'text-slate-300'
                  }`}
                >
                  {r.counts[s] > 0 ? (
                    <Link
                      to={`/brands/${tabToSlug(r.tab)}?platform=${platform}&brand=${encodeURIComponent(r.brand)}&rating=${s}`}
                      className="hover:text-blue-600 hover:underline"
                    >
                      {r.counts[s].toLocaleString()}
                    </Link>
                  ) : (
                    r.counts[s].toLocaleString()
                  )}
                </td>
              ))}
              <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${r.unrated > 0 ? 'text-slate-500' : 'text-slate-300'}`}>
                {r.unrated > 0 ? (
                  <Link
                    to={`/brands/${tabToSlug(r.tab)}?platform=${platform}&brand=${encodeURIComponent(r.brand)}&rating=unrated`}
                    className="hover:text-blue-600 hover:underline"
                  >
                    {r.unrated.toLocaleString()}
                  </Link>
                ) : (
                  r.unrated.toLocaleString()
                )}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold font-mono tabular-nums text-slate-800">
                {r.total > 0 ? (
                  <Link
                    to={`/brands/${tabToSlug(r.tab)}?platform=${platform}&brand=${encodeURIComponent(r.brand)}&rating=any`}
                    className="hover:text-blue-600 hover:underline"
                  >
                    {r.total.toLocaleString()}
                  </Link>
                ) : (
                  r.total.toLocaleString()
                )}
              </td>
              <td className="border-l-2 border-blue-200 px-2 py-1.5 text-right font-mono tabular-nums text-slate-600">
                {(sr?.live ?? 0).toLocaleString()}
              </td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-600">
                {(sr?.removed ?? 0).toLocaleString()}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold font-mono tabular-nums text-slate-800">
                {((sr?.live ?? 0) + (sr?.removed ?? 0)).toLocaleString()}
              </td>
              <td
                className={`px-2 py-1.5 text-right font-mono tabular-nums ${successRateColor(sr?.rate ?? null)}`}
                title={successRateTitle(sr)}
              >
                {formatSuccessRate(sr)}
              </td>
            </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-slate-200 bg-slate-50/80">
          <tr className="font-semibold text-slate-800">
            {showGroup && <td className="px-3 py-2" />}
            <td className="px-3 py-2 text-left">
              <Link
                to={
                  rows.length === 1
                    ? `/brands/${tabToSlug(rows[0].tab)}?platform=${platform}&brand=${encodeURIComponent(rows[0].brand)}&rating=any`
                    : `/brands/${tabToSlug(rows[0].tab)}?platform=${platform}&rating=any`
                }
                className="font-medium text-slate-800 hover:text-blue-600 hover:underline"
              >
                Total
              </Link>
            </td>
            {stars.map((s, i) => (
              <td
                key={s}
                className={`px-2 py-2 text-right font-mono tabular-nums ${i === 0 ? 'border-l border-slate-200' : ''} ${
                  totals.counts[s] > 0 ? 'text-slate-800' : 'text-slate-400'
                }`}
              >
                {totals.counts[s] > 0 ? (
                  <Link
                    to={`/brands/${tabToSlug(rows[0].tab)}?platform=${platform}&rating=${s}`}
                    className="hover:text-blue-600 hover:underline"
                  >
                    {totals.counts[s].toLocaleString()}
                  </Link>
                ) : (
                  totals.counts[s].toLocaleString()
                )}
              </td>
            ))}
            <td className={`px-2 py-2 text-right font-mono tabular-nums ${totals.unrated > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
              {totals.unrated > 0 ? (
                <Link
                  to={`/brands/${tabToSlug(rows[0].tab)}?platform=${platform}&rating=unrated`}
                  className="hover:text-blue-600 hover:underline"
                >
                  {totals.unrated.toLocaleString()}
                </Link>
              ) : (
                totals.unrated.toLocaleString()
              )}
            </td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">
              {totals.total > 0 ? (
                <Link
                  to={`/brands/${tabToSlug(rows[0].tab)}?platform=${platform}&rating=any`}
                  className="hover:text-blue-600 hover:underline"
                >
                  {totals.total.toLocaleString()}
                </Link>
              ) : (
                totals.total.toLocaleString()
              )}
            </td>
            <td className="border-l-2 border-blue-200 px-2 py-2 text-right font-mono tabular-nums">
              {groupSuccess.live.toLocaleString()}
            </td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">
              {groupSuccess.removed.toLocaleString()}
            </td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">
              {(groupSuccess.live + groupSuccess.removed).toLocaleString()}
            </td>
            <td
              className={`px-2 py-2 text-right font-mono tabular-nums ${successRateColor(groupSuccess.rate)}`}
              title={successRateTitle(groupSuccess)}
            >
              {formatSuccessRate(groupSuccess)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
