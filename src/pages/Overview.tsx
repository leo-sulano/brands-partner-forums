import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Users, CheckCircle2, XCircle, X,
  Syringe, Link2, Handshake, RotateCcw, Dices, Medal, Gamepad2, Plane, Heart, Star,
  type LucideIcon,
} from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import KpiCard from '../components/KpiCard';
import { fetchTabKpis } from '../lib/queries';
import { OPERATIONAL_TABS, tabToSlug, tabDisplayName } from '../lib/tabs';
import type { TabKpis } from '../types/brand-entry';


interface TabSummary {
  tab: string;
  kpis: TabKpis;
}

interface State {
  loading: boolean;
  error: string | null;
  tabs: TabSummary[];

}

const PLATFORM_COLORS = {
  Trustpilot:    '#3b82f6',
  AskGamblers:   '#10b981',
  CasinoGuru:    '#f59e0b',
  WizardOfOdds:  '#6366f1',
} as const;

const PLATFORM_ICON_BG: Record<string, string> = {
  Trustpilot:   'bg-emerald-50 ring-1 ring-emerald-200',
  AskGamblers:  'bg-red-50 ring-1 ring-red-200',
  CasinoGuru:   'bg-amber-50 ring-1 ring-amber-200',
  WizardOfOdds: 'bg-slate-100 ring-1 ring-slate-200',
};

const PLATFORM_LOGOS: Record<string, string> = {
  Trustpilot:   'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=32',
  AskGamblers:  'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=32',
  CasinoGuru:   'https://www.google.com/s2/favicons?domain=casino.guru&sz=32',
  WizardOfOdds: 'https://www.google.com/s2/favicons?domain=wizardofodds.com&sz=64',
};


const EMPTY_KPIS: TabKpis = {
  total: 0, live: 0, removed: 0, done: 0, pending: 0, onPause: 0, notDone: 0,
  tp: { live: 0, removed: 0 },
  ag: { live: 0, removed: 0 },
  cg: { live: 0, removed: 0 },
  wo: { live: 0, removed: 0 },
  activePlatforms: [],
};

const PLATFORM_BADGE: Record<'tp' | 'ag' | 'cg' | 'wo', { label: string; cls: string; icon: string }> = {
  tp: { label: 'TP', cls: 'bg-blue-50 text-blue-600 border border-blue-200',     icon: 'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=16' },
  ag: { label: 'AG', cls: 'bg-amber-50 text-amber-600 border border-amber-200',  icon: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=16' },
  cg: { label: 'CG', cls: 'bg-violet-50 text-violet-600 border border-violet-200', icon: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=16' },
  wo: { label: 'WO', cls: 'bg-indigo-50 text-indigo-600 border border-indigo-200', icon: 'https://www.google.com/s2/favicons?domain=wizardofodds.com&sz=16' },
};

const TAB_ICONS: Record<string, LucideIcon> = {
  'TP Brand Injection': Syringe,
  'TP Affiliate':       Link2,
  'Rooster Partners':   Handshake,
  'Revolution Casino':  RotateCcw,
  'Trybet':             Dices,
  'SilverPlay':         Medal,
  'SuprPlay Limited':   Gamepad2,
  'HazEmirates UAE':    Plane,
  'Hanan':              Heart,
  'Wizard of Odds':     Star,
};

type KpiModalKind = 'total' | 'live' | 'removed';

interface KpiModalState {
  kind: KpiModalKind;
  title: string;
  tagline: string;
  color: 'blue' | 'emerald' | 'rose';
}

type PlatformKey = 'tp' | 'ag' | 'cg' | 'wo';

const PLATFORM_KEY: Record<string, PlatformKey> = {
  Trustpilot:   'tp',
  AskGamblers:  'ag',
  CasinoGuru:   'cg',
  WizardOfOdds: 'wo',
};

interface PlatformSliceModalState {
  platform: string;
  platformKey: PlatformKey;
  kind: 'live' | 'removed';
}

function KpiBreakdownModal({
  modal,
  tabs,
  onClose,
}: {
  modal: KpiModalState;
  tabs: TabSummary[];
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function getCount(kpis: TabKpis): number {
    if (modal.kind === 'total') return kpis.total;
    if (modal.kind === 'live') return kpis.tp.live + kpis.ag.live + kpis.cg.live + kpis.wo.live;
    return kpis.tp.removed + kpis.ag.removed + kpis.cg.removed + kpis.wo.removed;
  }

  const rows = tabs
    .map((t) => ({ tab: t.tab, count: getCount(t.kpis) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const grandTotal = rows.reduce((s, r) => s + r.count, 0);

  const barColor =
    modal.color === 'blue' ? 'bg-blue-500' :
    modal.color === 'emerald' ? 'bg-emerald-500' : 'bg-rose-500';

  const valueColor =
    modal.color === 'blue' ? 'text-blue-600' :
    modal.color === 'emerald' ? 'text-emerald-600' : 'text-rose-600';

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl mx-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{modal.title}</p>
            <p className={`mt-0.5 text-2xl font-bold font-mono tabular-nums ${valueColor}`}>{grandTotal.toLocaleString()}</p>
            <p className="mt-1 text-xs text-slate-400">{modal.tagline}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Brand rows */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
          {rows.map((r) => {
            const pct = grandTotal > 0 ? (r.count / grandTotal) * 100 : 0;
            return (
              <Link
                key={r.tab}
                to={`/brands/${tabToSlug(r.tab)}`}
                onClick={onClose}
                className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-blue-50 transition-colors -mx-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-slate-700 group-hover:text-blue-700 transition-colors truncate">{tabDisplayName(r.tab)}</span>
                    <span className={`text-sm font-bold font-mono tabular-nums ml-2 shrink-0 ${valueColor}`}>{r.count.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100">
                    <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlatformBreakdownModal({
  modal,
  tabs,
  onClose,
}: {
  modal: PlatformSliceModalState;
  tabs: TabSummary[];
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = tabs
    .map((t) => ({ tab: t.tab, count: t.kpis[modal.platformKey][modal.kind] }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const grandTotal = rows.reduce((s, r) => s + r.count, 0);
  const isLive = modal.kind === 'live';
  const barColor = isLive ? 'bg-emerald-500' : 'bg-rose-500';
  const valueColor = isLive ? 'text-emerald-600' : 'text-rose-600';
  const kindLabel = isLive ? 'Published' : 'Removed';

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl mx-4">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <img
                src={PLATFORM_LOGOS[modal.platform]}
                alt={modal.platform}
                className="size-4 rounded"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                {modal.platform} — {kindLabel}
              </p>
            </div>
            <p className={`text-2xl font-bold font-mono tabular-nums ${valueColor}`}>{grandTotal.toLocaleString()}</p>
            <p className="mt-1 text-xs text-slate-400">{kindLabel} reviews by brand tab</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-slate-600 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
          {rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No data</p>
          ) : rows.map((r) => {
            const pct = grandTotal > 0 ? (r.count / grandTotal) * 100 : 0;
            return (
              <Link
                key={r.tab}
                to={`/brands/${tabToSlug(r.tab)}?platform=${modal.platformKey}&status=${modal.kind}`}
                onClick={onClose}
                className="group -mx-3 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-blue-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <img
                        src={PLATFORM_LOGOS[modal.platform]}
                        alt={modal.platform}
                        className="size-3.5 shrink-0 rounded-sm"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <span className="truncate text-sm font-medium text-slate-700 transition-colors group-hover:text-blue-700">{tabDisplayName(r.tab)}</span>
                    </span>
                    <span className={`ml-2 shrink-0 text-sm font-bold font-mono tabular-nums ${valueColor}`}>{r.count.toLocaleString()}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100">
                    <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const initial: State = { loading: true, error: null, tabs: [] };



export default function Overview() {
  const [state, setState] = useState<State>(initial);
  const [kpiModal, setKpiModal] = useState<KpiModalState | null>(null);
  const [platformSliceModal, setPlatformSliceModal] = useState<PlatformSliceModalState | null>(null);
  const [searchParams] = useSearchParams();
  const dateFrom = searchParams.get('from') ?? '';
  const dateTo   = searchParams.get('to')   ?? '';

  const loadData = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const tabResults = await Promise.all(
        OPERATIONAL_TABS.map((tab) =>
          fetchTabKpis(tab, dateFrom || undefined, dateTo || undefined)
            .then((kpis): TabSummary => ({ tab, kpis }))
            .catch((): TabSummary => ({ tab, kpis: EMPTY_KPIS }))
        )
      );
      setState({ loading: false, error: null, tabs: tabResults });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, [dateFrom, dateTo]);

  useEffect(() => { loadData(); }, [loadData]);

  if (state.error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {state.error}
      </div>
    );
  }

  const totalAccounts = state.tabs.reduce((s, t) => s + t.kpis.live + t.kpis.removed, 0);
  const totalLive     = state.tabs.reduce((s, t) => s + t.kpis.live,    0);
  const totalRemoved  = state.tabs.reduce((s, t) => s + t.kpis.removed, 0);


  const platformData = [
    {
      name: 'Trustpilot',
      Live:    state.tabs.reduce((s, t) => s + t.kpis.tp.live,    0),
      Removed: state.tabs.reduce((s, t) => s + t.kpis.tp.removed, 0),
    },
    {
      name: 'AskGamblers',
      Live:    state.tabs.reduce((s, t) => s + t.kpis.ag.live,    0),
      Removed: state.tabs.reduce((s, t) => s + t.kpis.ag.removed, 0),
    },
    {
      name: 'CasinoGuru',
      Live:    state.tabs.reduce((s, t) => s + t.kpis.cg.live,    0),
      Removed: state.tabs.reduce((s, t) => s + t.kpis.cg.removed, 0),
    },
    {
      name: 'WizardOfOdds',
      Live:    state.tabs.reduce((s, t) => s + t.kpis.wo.live,    0),
      Removed: state.tabs.reduce((s, t) => s + t.kpis.wo.removed, 0),
    },
  ];

  return (
    <div className="space-y-8">

      {/* Global KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <button
          type="button"
          disabled={state.loading}
          onClick={() => setKpiModal({ kind: 'total', title: 'Total Accounts', tagline: 'All registered review accounts across every brand tab', color: 'blue' })}
          className="text-left disabled:cursor-default"
        >
          <KpiCard
            label="Total Accounts"
            value={state.loading ? '…' : totalAccounts.toLocaleString()}
            icon={<Users className="size-5" />}
            hint="across all brand tabs"
            color="blue"
          />
        </button>
        <button
          type="button"
          disabled={state.loading}
          onClick={() => setKpiModal({ kind: 'live', title: 'Live', tagline: 'Live or published reviews across Trustpilot, AskGamblers, Casino Guru & Wizard of Odds', color: 'emerald' })}
          className="text-left disabled:cursor-default"
        >
          <KpiCard
            label="Live"
            value={state.loading ? '…' : totalLive.toLocaleString()}
            icon={<CheckCircle2 className="size-5" />}
            hint="active across TP / AG / CG / WO"
            color="emerald"
          />
        </button>
        <button
          type="button"
          disabled={state.loading}
          onClick={() => setKpiModal({ kind: 'removed', title: 'Removed', tagline: 'Reviews removed, rejected, or refused across all brand tabs and platforms', color: 'rose' })}
          className="text-left disabled:cursor-default"
        >
          <KpiCard
            label="Removed"
            value={state.loading ? '…' : totalRemoved.toLocaleString()}
            icon={<XCircle className="size-5" />}
            hint="across all tabs"
            color="rose"
          />
        </button>
      </div>

      {/* Tab summary grid */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Brands Performance</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {state.loading
            ? Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-lg bg-slate-100" style={{ height: 80 }} />
              ))
            : state.tabs.map(({ tab, kpis }) => {
                const displayLive    = kpis.live;
                const displayRemoved = kpis.removed;
                const statusItems = [
                  { count: displayLive,    label: 'live',    bar: 'bg-emerald-500', text: 'text-emerald-600' },
                  { count: displayRemoved, label: 'removed', bar: 'bg-rose-400',    text: 'text-rose-500'    },
                ].filter((s) => s.count >= 1);
                const barTotal = statusItems.reduce((s, i) => s + i.count, 0);
                const pct = (n: number) => barTotal > 0 ? (n / barTotal) * 100 : 0;
                const TabIcon = TAB_ICONS[tab] ?? Syringe;
                return (
                  <Link
                    key={tab}
                    to={`/brands/${tabToSlug(tab)}`}
                    style={{ height: 80 }}
                    className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-100">
                          <TabIcon className="size-3.5 text-blue-500" />
                        </div>
                        <p className="truncate text-sm font-semibold text-slate-800">{tabDisplayName(tab)}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {kpis.activePlatforms.map((p) => (
                          <span key={p} className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold leading-none ${PLATFORM_BADGE[p].cls}`}>
                            <img src={PLATFORM_BADGE[p].icon} alt={PLATFORM_BADGE[p].label} className="size-2.5 rounded-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            {PLATFORM_BADGE[p].label}
                          </span>
                        ))}
                        <span className="text-xs text-slate-500">
                          <span className="font-medium text-slate-900">{kpis.live + kpis.removed}</span> total
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
                      {statusItems.map((s) => (
                        <span key={s.label}>
                          <span className={`font-medium ${s.text}`}>{s.count}</span> {s.label}
                        </span>
                      ))}
                    </div>
                    <div className="flex h-1 w-full overflow-hidden rounded-full bg-slate-100">
                      {statusItems.map((s) => (
                        <div key={s.label} className={`${s.bar} transition-all`} style={{ width: `${pct(s.count)}%` }} />
                      ))}
                    </div>
                  </Link>
                );
              })}
        </div>
      </section>

      {/* Platform breakdown chart */}
      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-800">Platform Breakdown</h2>
          <p className="mt-0.5 text-xs text-slate-400">Published vs. removed per platform</p>
        </div>
        {state.loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {platformData.map((p) => {
              const total = p.Live + p.Removed;
              const color = PLATFORM_COLORS[p.name as keyof typeof PLATFORM_COLORS];
              const slices = total > 0
                ? [
                    { label: 'Published', value: p.Live,    fill: '#10b981' },
                    { label: 'Removed',   value: p.Removed, fill: '#f43f5e' },
                  ]
                : [{ label: 'No data', value: 1, fill: '#e2e8f0' }];
              const livePct    = total > 0 ? ((p.Live    / total) * 100).toFixed(1) : '0.0';
              const removedPct = total > 0 ? ((p.Removed / total) * 100).toFixed(1) : '0.0';
              return (
                <div key={p.name} className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                  {/* Platform header */}
                  <div className="mb-4 flex items-center gap-2.5">
                    <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${PLATFORM_ICON_BG[p.name] ?? 'bg-slate-100 ring-1 ring-slate-200'}`}>
                      <img
                        src={PLATFORM_LOGOS[p.name]}
                        alt={p.name}
                        className="size-5 rounded-sm object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-slate-800">
                      {p.name === 'WizardOfOdds' ? 'Wizard of Odds' : p.name}
                    </span>
                  </div>

                  {/* Body: donut + legend */}
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <ResponsiveContainer width={120} height={120}>
                        <PieChart>
                          <Pie
                            data={slices}
                            cx="50%"
                            cy="50%"
                            innerRadius={38}
                            outerRadius={56}
                            dataKey="value"
                            startAngle={90}
                            endAngle={-270}
                            stroke="#fff"
                            strokeWidth={2}
                            labelLine={false}
                            style={{ cursor: total > 0 ? 'pointer' : 'default' }}
                            onClick={(data) => {
                              if (total === 0 || data.label === 'No data') return;
                              const platformKey = PLATFORM_KEY[p.name];
                              const kind: 'live' | 'removed' = data.label === 'Published' ? 'live' : 'removed';
                              setPlatformSliceModal({ platform: p.name, platformKey, kind });
                            }}
                          >
                            {slices.map((s) => (
                              <Cell key={s.label} fill={s.fill} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number, name: string) => [value.toLocaleString(), name]}
                            contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-base font-bold font-mono tabular-nums leading-tight" style={{ color }}>{livePct}%</span>
                        <span className="text-[10px] font-medium text-slate-400">published</span>
                      </div>
                    </div>

                    {/* Legend */}
                    <div className="flex flex-1 flex-col gap-2.5 text-xs">
                      <button
                        type="button"
                        disabled={total === 0}
                        onClick={() => setPlatformSliceModal({ platform: p.name, platformKey: PLATFORM_KEY[p.name], kind: 'live' })}
                        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-blue-50 disabled:cursor-default"
                      >
                        <span className="size-2.5 shrink-0 rounded-full bg-emerald-500" />
                        <span className="text-slate-500">Published</span>
                        <span className="ml-auto font-semibold text-slate-800">{livePct}%</span>
                      </button>
                      <button
                        type="button"
                        disabled={total === 0}
                        onClick={() => setPlatformSliceModal({ platform: p.name, platformKey: PLATFORM_KEY[p.name], kind: 'removed' })}
                        className="flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-blue-50 disabled:cursor-default"
                      >
                        <span className="size-2.5 shrink-0 rounded-full bg-rose-400" />
                        <span className="text-slate-500">Removed</span>
                        <span className="ml-auto font-semibold text-slate-800">{removedPct}%</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {kpiModal && (
        <KpiBreakdownModal
          modal={kpiModal}
          tabs={state.tabs}
          onClose={() => setKpiModal(null)}
        />
      )}

      {platformSliceModal && (
        <PlatformBreakdownModal
          modal={platformSliceModal}
          tabs={state.tabs}
          onClose={() => setPlatformSliceModal(null)}
        />
      )}
    </div>
  );
}
