import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Star, X } from 'lucide-react';
import DatePicker from './DatePicker';
import {
  computeScoreSummary,
  isoToDate,
  ratingLabel,
  type BrandSummary,
  type RatingLabel,
  type Star as StarRating,
} from '../lib/scoreSummary';
import type { Entry } from '../types/entry';

interface Props {
  entries: Entry[];
}

const LABEL_PILL: Record<RatingLabel, string> = {
  Excellent: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  Great: 'bg-green-50 text-green-700 ring-1 ring-green-200',
  Average: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  Poor: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  Bad: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};

const STAR_COLOR: Record<1 | 2 | 3 | 4 | 5, string> = {
  5: 'text-emerald-500',
  4: 'text-green-500',
  3: 'text-amber-500',
  2: 'text-orange-500',
  1: 'text-rose-500',
};

export default function ScoreSummaryPanel({ entries }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [fromIso, setFromIso] = useState('');
  const [toIso, setToIso] = useState('');
  const [tabFilter, setTabFilter] = useState('');

  // Range is driven entirely by the From/To date pickers. Both empty = all time.
  const range = useMemo(
    () => ({ from: isoToDate(fromIso), to: isoToDate(toIso) }),
    [fromIso, toIso],
  );

  const result = useMemo(() => computeScoreSummary(entries, range), [entries, range]);

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
            TrustPilot · Published reviews
            {totalAcrossBrands > 0 ? ` · ${totalAcrossBrands.toLocaleString()} total` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
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
            <GroupedSummary rows={filteredBrands} />
          )}

          {result.excludedRows > 0 && (
            <p className="text-xs text-slate-400">
              {result.excludedRows} row{result.excludedRows !== 1 ? 's' : ''} excluded from the selected range (missing or unreadable Trust Pilot date).
            </p>
          )}
        </div>
      )}
    </section>
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
            ? 'border-violet-300 bg-violet-50 text-violet-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        {active && <span className="size-1.5 shrink-0 rounded-full bg-violet-500" />}
        <span className="max-w-[10rem] truncate">{active ? value : 'All brands'}</span>
        {active ? (
          <span
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="ml-0.5 text-violet-400 hover:text-violet-600 transition-colors"
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
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-slate-50 ${
                !value ? 'font-medium text-violet-700 bg-violet-50/60' : 'text-slate-600'
              }`}
            >
              <span className="flex-1">All brands</span>
              {!value && <Check className="size-3 text-violet-500" />}
            </button>
            {options.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">No brands available</div>
            )}
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-slate-50 ${
                  opt === value ? 'font-medium text-violet-700 bg-violet-50/60' : 'text-slate-600'
                }`}
              >
                <span className="flex-1 truncate">{opt}</span>
                {opt === value && <Check className="size-3 text-violet-500" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupedSummary({ rows }: { rows: BrandSummary[] }) {
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
                <h3 className="text-sm font-semibold text-slate-700">{tab || '(no tab)'}</h3>
                <span className="text-xs text-slate-400">
                  {brands.length} brand{brands.length !== 1 ? 's' : ''} · {groupTotal.toLocaleString()} review{groupTotal !== 1 ? 's' : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => toggle(tab)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                aria-label={isCollapsed ? `Expand ${tab}` : `Collapse ${tab}`}
              >
                <ChevronDown
                  className={`size-4 transition-transform duration-150 ${isCollapsed ? '-rotate-90' : ''}`}
                />
              </button>
            </header>
            {!isCollapsed && <SummaryTable rows={brands} />}
          </section>
        );
      })}
      {groups.length > 1 && <GrandTotal rows={rows} />}
    </div>
  );
}

// Bottom bar summing every column across all brands in every group shown.
function GrandTotal({ rows }: { rows: BrandSummary[] }) {
  const t = useMemo(() => computeColumnTotals(rows), [rows]);
  return (
    <section className="overflow-x-auto rounded-md border-2 border-violet-200 bg-violet-50/40">
      <table className="w-full table-fixed text-sm">
        <SummaryColgroup />
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">All brands</th>
            {STARS.map((s) => (
              <th key={s} scope="col" className="px-2 py-2 text-right font-medium">
                <span className="inline-flex items-center justify-end gap-0.5">
                  <span className="tabular-nums">{s}</span>
                  <Star className={`size-3 fill-current ${STAR_COLOR[s]}`} />
                </span>
              </th>
            ))}
            <th scope="col" className="px-2 py-2 text-right font-medium">Unrtd</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Total</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Avg</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Rating</th>
          </tr>
        </thead>
        <tbody>
          <tr className="font-semibold text-slate-800">
            <td className="px-3 py-2 text-left text-slate-600">
              {rows.length} brand{rows.length !== 1 ? 's' : ''}
            </td>
            {STARS.map((s) => (
              <td
                key={s}
                className={`px-2 py-2 text-right tabular-nums ${t.counts[s] > 0 ? 'text-slate-800' : 'text-slate-400'}`}
              >
                {t.counts[s].toLocaleString()}
              </td>
            ))}
            <td className={`px-2 py-2 text-right tabular-nums ${t.unrated > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
              {t.unrated.toLocaleString()}
            </td>
            <td className="px-2 py-2 text-right tabular-nums">{t.total.toLocaleString()}</td>
            <td className="px-2 py-2 text-right tabular-nums">
              {t.average == null ? (
                <span className="text-slate-400">—</span>
              ) : (
                <span className="inline-flex items-baseline gap-1">
                  {t.rated > 0 && t.rated < t.total && (
                    <span className="text-[10px] font-normal text-slate-400">/{t.rated}</span>
                  )}
                  <span>{t.average.toFixed(1)}</span>
                </span>
              )}
            </td>
            <td className="px-3 py-2">
              {t.label ? (
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${LABEL_PILL[t.label]}`}>
                  {t.label}
                </span>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

const STARS: StarRating[] = [5, 4, 3, 2, 1];

interface ColumnTotals {
  counts: Record<StarRating, number>;
  unrated: number;
  rated: number;
  total: number;
  average: number | null;
  label: RatingLabel | null;
}

// Sums every column across a set of brand rows. Used by both the per-group
// Total row and the all-brands grand total.
function computeColumnTotals(rows: BrandSummary[]): ColumnTotals {
  const counts: Record<StarRating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let unrated = 0;
  for (const r of rows) {
    for (const s of STARS) counts[s] += r.counts[s];
    unrated += r.unrated;
  }
  const rated = counts[1] + counts[2] + counts[3] + counts[4] + counts[5];
  const total = rated + unrated;
  const average =
    rated === 0
      ? null
      : Math.round(((counts[1] + 2 * counts[2] + 3 * counts[3] + 4 * counts[4] + 5 * counts[5]) / rated) * 10) / 10;
  return { counts, unrated, rated, total, average, label: ratingLabel(average) };
}

// Shared fixed column widths so every group table (and the grand total) lines
// up vertically. Brand column flexes; numeric/rating columns are fixed.
function SummaryColgroup({ showGroup = false }: { showGroup?: boolean }) {
  return (
    <colgroup>
      {showGroup && <col className="w-32" />}
      <col />
      <col className="w-16" />
      <col className="w-16" />
      <col className="w-16" />
      <col className="w-16" />
      <col className="w-16" />
      <col className="w-20" />
      <col className="w-20" />
      <col className="w-24" />
      <col className="w-32" />
    </colgroup>
  );
}

function SummaryTable({ rows }: { rows: BrandSummary[] }) {
  const stars = STARS;
  const showGroup = new Set(rows.map((r) => r.tab)).size > 1;
  const totals = useMemo(() => computeColumnTotals(rows), [rows]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm">
        <SummaryColgroup showGroup={showGroup} />
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {showGroup && <th scope="col" className="px-3 py-2 text-left font-medium">Group</th>}
            <th scope="col" className="px-3 py-2 text-left font-medium">Brand</th>
            {stars.map((s) => (
              <th key={s} scope="col" className="px-2 py-2 text-right font-medium">
                <span className="inline-flex items-center justify-end gap-0.5">
                  <span className="tabular-nums">{s}</span>
                  <Star className={`size-3 fill-current ${STAR_COLOR[s]}`} />
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
            <th scope="col" className="px-2 py-2 text-right font-medium">Avg</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Rating</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={`${r.tab}|${r.brand}`} className="hover:bg-slate-50/60">
              {showGroup && (
                <td className="px-3 py-1.5 text-xs text-slate-500 truncate" title={r.tab}>{r.tab}</td>
              )}
              <td className="px-3 py-1.5 font-medium text-slate-800 truncate" title={r.brand}>{r.brand}</td>
              {stars.map((s) => (
                <td
                  key={s}
                  className={`px-2 py-1.5 text-right tabular-nums ${
                    r.counts[s] > 0 ? 'text-slate-800' : 'text-slate-300'
                  }`}
                >
                  {r.counts[s].toLocaleString()}
                </td>
              ))}
              <td className={`px-2 py-1.5 text-right tabular-nums ${r.unrated > 0 ? 'text-slate-500' : 'text-slate-300'}`}>
                {r.unrated.toLocaleString()}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-slate-800">
                {r.total.toLocaleString()}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">
                {r.average == null ? (
                  <span className="text-slate-300">—</span>
                ) : (
                  <span className="inline-flex items-baseline gap-1">
                    {r.rated > 0 && r.rated < r.total && (
                      <span className="text-[10px] text-slate-400">/{r.rated}</span>
                    )}
                    <span className="font-semibold text-slate-800">{r.average.toFixed(1)}</span>
                  </span>
                )}
              </td>
              <td className="px-3 py-1.5">
                {r.label ? (
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${LABEL_PILL[r.label]}`}>
                    {r.label}
                  </span>
                ) : (
                  <span className="text-xs text-slate-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-slate-200 bg-slate-50/80">
          <tr className="font-semibold text-slate-800">
            {showGroup && <td className="px-3 py-2" />}
            <td className="px-3 py-2 text-left">Total</td>
            {stars.map((s) => (
              <td
                key={s}
                className={`px-2 py-2 text-right tabular-nums ${
                  totals.counts[s] > 0 ? 'text-slate-800' : 'text-slate-400'
                }`}
              >
                {totals.counts[s].toLocaleString()}
              </td>
            ))}
            <td className={`px-2 py-2 text-right tabular-nums ${totals.unrated > 0 ? 'text-slate-600' : 'text-slate-400'}`}>
              {totals.unrated.toLocaleString()}
            </td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.total.toLocaleString()}</td>
            <td className="px-2 py-2 text-right tabular-nums">
              {totals.average == null ? (
                <span className="text-slate-400">—</span>
              ) : (
                <span className="inline-flex items-baseline gap-1">
                  {totals.rated > 0 && totals.rated < totals.total && (
                    <span className="text-[10px] font-normal text-slate-400">/{totals.rated}</span>
                  )}
                  <span>{totals.average.toFixed(1)}</span>
                </span>
              )}
            </td>
            <td className="px-3 py-2">
              {totals.label ? (
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${LABEL_PILL[totals.label]}`}>
                  {totals.label}
                </span>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
