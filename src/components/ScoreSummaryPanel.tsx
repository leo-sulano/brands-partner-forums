import { useMemo, useState } from 'react';
import { ChevronDown, Star } from 'lucide-react';
import DatePicker from './DatePicker';
import {
  computeScoreSummary,
  resolvePreset,
  dateToIso,
  isoToDate,
  type BrandSummary,
  type PresetKey,
  type RatingLabel,
} from '../lib/scoreSummary';
import type { Entry } from '../types/entry';

interface Props {
  entries: Entry[];
}

interface Preset { key: PresetKey | 'custom'; label: string; }

const PRESETS: Preset[] = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: 'this-week', label: 'This week' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-7', label: 'Last 7 days' },
  { key: 'last-30', label: 'Last 30 days' },
];

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
  const [preset, setPreset] = useState<PresetKey | 'custom'>('all');
  const [fromIso, setFromIso] = useState('');
  const [toIso, setToIso] = useState('');

  const range = useMemo(() => {
    if (preset === 'custom') {
      return { from: isoToDate(fromIso), to: isoToDate(toIso) };
    }
    return resolvePreset(preset);
  }, [preset, fromIso, toIso]);

  const result = useMemo(() => computeScoreSummary(entries, range), [entries, range]);

  function applyPreset(key: PresetKey) {
    setPreset(key);
    const r = resolvePreset(key);
    setFromIso(dateToIso(r.from));
    setToIso(dateToIso(r.to));
  }

  function onFromChange(v: string) {
    setFromIso(v);
    setPreset('custom');
  }
  function onToChange(v: string) {
    setToIso(v);
    setPreset('custom');
  }
  function reset() {
    setPreset('all');
    setFromIso('');
    setToIso('');
  }

  const hasNonDefault = preset !== 'all';
  const totalAcrossBrands = result.brands.reduce((s, b) => s + b.total, 0);

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
              onChange={onFromChange}
              placeholder="From date"
              max={toIso || undefined}
            />
            <span className="text-xs text-slate-400">→</span>
            <DatePicker
              value={toIso}
              onChange={onToChange}
              placeholder="To date"
              min={fromIso || undefined}
            />
            <div className="h-4 w-px bg-slate-200 mx-1" />
            {PRESETS.map((p) => {
              const active = preset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key as PresetKey)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
            {hasNonDefault && (
              <button
                type="button"
                onClick={reset}
                className="ml-1 text-xs font-medium text-violet-600 hover:text-violet-700"
              >
                Reset
              </button>
            )}
          </div>

          {result.brands.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              No published reviews in this range.
            </div>
          ) : (
            <SummaryTable rows={result.brands} />
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

function SummaryTable({ rows }: { rows: BrandSummary[] }) {
  const stars: (5 | 4 | 3 | 2 | 1)[] = [5, 4, 3, 2, 1];
  const showGroup = new Set(rows.map((r) => r.tab)).size > 1;
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="w-full text-sm">
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
      </table>
    </div>
  );
}
