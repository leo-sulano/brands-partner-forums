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

export const SCORE_SUMMARY_TABS = new Set<string>(['Revolution Casino']);

interface Props {
  tab: string;
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

export default function ScoreSummaryPanel({ tab, entries }: Props) {
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

  if (!SCORE_SUMMARY_TABS.has(tab)) return null;

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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {result.brands.map((b) => (
                <BrandCard key={b.brand} summary={b} />
              ))}
            </div>
          )}

          {result.excludedRows > 0 && (
            <p className="text-xs text-slate-400">
              {result.excludedRows} row{result.excludedRows !== 1 ? 's' : ''} excluded (missing or unreadable score/date).
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function BrandCard({ summary }: { summary: BrandSummary }) {
  const stars: (1 | 2 | 3 | 4 | 5)[] = [5, 4, 3, 2, 1];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-800 truncate" title={summary.brand}>
        {summary.brand}
      </h3>

      <div className="grid grid-cols-2 gap-x-4">
        <div className="space-y-1.5">
          {stars.map((s) => (
            <div key={s} className="flex items-center gap-2">
              <span className="flex w-12 shrink-0 items-center gap-1 text-xs font-medium text-slate-600">
                <span className="tabular-nums">{s}</span>
                <Star className={`size-3 fill-current ${STAR_COLOR[s]}`} />
              </span>
              <span className="text-sm tabular-nums text-slate-800">{summary.counts[s].toLocaleString()}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5 border-l border-slate-100 pl-4">
          <StatRow label="Total reviews" value={summary.total.toLocaleString()} />
          <StatRow label="Average" value={summary.average == null ? '—' : summary.average.toFixed(1)} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">Rating</span>
            {summary.label ? (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LABEL_PILL[summary.label]}`}>
                {summary.label}
              </span>
            ) : (
              <span className="text-xs text-slate-400">—</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-slate-800">{value}</span>
    </div>
  );
}
