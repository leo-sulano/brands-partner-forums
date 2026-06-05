import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Users, CheckCircle2, XCircle } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import KpiCard from '../components/KpiCard';
import { fetchTabKpis } from '../lib/queries';
import { OPERATIONAL_TABS, tabToSlug } from '../lib/tabs';
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
  Trustpilot:  '#3b82f6',
  AskGamblers: '#10b981',
  CasinoGuru:  '#f59e0b',
} as const;

const PLATFORM_LOGOS: Record<string, string> = {
  Trustpilot:  'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=32',
  AskGamblers: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=32',
  CasinoGuru:  'https://www.google.com/s2/favicons?domain=casino.guru&sz=32',
};


const EMPTY_KPIS: TabKpis = {
  total: 0, live: 0, removed: 0, done: 0, pending: 0, onPause: 0, notDone: 0,
  tp: { live: 0, removed: 0 },
  ag: { live: 0, removed: 0 },
  cg: { live: 0, removed: 0 },
  activePlatforms: [],
};

const PLATFORM_BADGE: Record<'tp' | 'ag' | 'cg', { label: string; cls: string; icon: string }> = {
  tp: { label: 'TP', cls: 'bg-blue-50 text-blue-600 border border-blue-200',   icon: 'https://www.google.com/s2/favicons?domain=trustpilot.com&sz=16' },
  ag: { label: 'AG', cls: 'bg-amber-50 text-amber-600 border border-amber-200', icon: 'https://www.google.com/s2/favicons?domain=askgamblers.com&sz=16' },
  cg: { label: 'CG', cls: 'bg-violet-50 text-violet-600 border border-violet-200', icon: 'https://www.google.com/s2/favicons?domain=casino.guru&sz=16' },
};

const initial: State = { loading: true, error: null, tabs: [] };



export default function Overview() {
  const [state, setState] = useState<State>(initial);
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

  const totalAccounts = state.tabs.reduce((s, t) => s + t.kpis.total, 0);
  const totalLive     = state.tabs.reduce((s, t) => s + t.kpis.tp.live    + t.kpis.ag.live    + t.kpis.cg.live,    0);
  const totalRemoved  = state.tabs.reduce((s, t) => s + t.kpis.tp.removed + t.kpis.ag.removed + t.kpis.cg.removed, 0);


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
  ];

  return (
    <div className="space-y-8">

      {/* Global KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total Accounts"
          value={state.loading ? '…' : totalAccounts.toLocaleString()}
          icon={<Users className="size-5" />}
          hint="across all brand tabs"
          color="blue"
        />
        <KpiCard
          label="Live Reviews"
          value={state.loading ? '…' : totalLive.toLocaleString()}
          icon={<CheckCircle2 className="size-5" />}
          hint="active across TP / AG / CG"
          color="emerald"
        />
        <KpiCard
          label="Removed"
          value={state.loading ? '…' : totalRemoved.toLocaleString()}
          icon={<XCircle className="size-5" />}
          hint="across all tabs"
          color="rose"
        />
      </div>

      {/* Tab summary grid */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Brand Tabs</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {state.loading
            ? Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-lg bg-slate-100" style={{ height: 80 }} />
              ))
            : state.tabs.map(({ tab, kpis }) => {
                const displayLive    = kpis.tp.live    + kpis.ag.live    + kpis.cg.live;
                const displayRemoved = kpis.tp.removed + kpis.ag.removed + kpis.cg.removed;
                const statusItems = [
                  { count: displayLive,    label: 'live',     bar: 'bg-emerald-500', text: 'text-emerald-600' },
                  { count: displayRemoved, label: 'removed',  bar: 'bg-rose-400',    text: 'text-rose-500'    },
                  { count: kpis.done,      label: 'done',     bar: 'bg-teal-500',    text: 'text-teal-600'    },
                  { count: kpis.pending,   label: 'pending',  bar: 'bg-amber-400',   text: 'text-amber-500'   },
                  { count: kpis.onPause,   label: 'on pause', bar: 'bg-slate-400',   text: 'text-slate-500'   },
                  { count: kpis.notDone,   label: 'not done', bar: 'bg-orange-400',  text: 'text-orange-500'  },
                ].filter((s) => s.count >= 1);
                const barTotal = statusItems.reduce((s, i) => s + i.count, 0);
                const pct = (n: number) => barTotal > 0 ? (n / barTotal) * 100 : 0;
                return (
                  <Link
                    key={tab}
                    to={`/brands/${tabToSlug(tab)}`}
                    style={{ height: 80 }}
                    className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-800">{tab}</p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {kpis.activePlatforms.map((p) => (
                          <span key={p} className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold leading-none ${PLATFORM_BADGE[p].cls}`}>
                            <img src={PLATFORM_BADGE[p].icon} alt={PLATFORM_BADGE[p].label} className="size-2.5 rounded-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            {PLATFORM_BADGE[p].label}
                          </span>
                        ))}
                        <span className="text-xs text-slate-500">
                          <span className="font-medium text-slate-900">{kpis.total}</span> total
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {platformData.map((p) => {
              const total = p.Live + p.Removed;
              const color = PLATFORM_COLORS[p.name as keyof typeof PLATFORM_COLORS];
              const slices = total > 0
                ? [
                    { label: 'Published', value: p.Live,    fill: '#10b981' },
                    { label: 'Removed',   value: p.Removed, fill: '#f43f5e' },
                  ]
                : [{ label: 'No data', value: 1, fill: '#e2e8f0' }];
              const livePct = total > 0 ? ((p.Live / total) * 100).toFixed(1) : '0';
              return (
                <div key={p.name} className="flex flex-col items-center rounded-xl border border-slate-200 bg-white py-5 px-4 shadow-sm">
                  {/* Platform header */}
                  <div className="flex items-center gap-2 mb-1">
                    <img
                      src={PLATFORM_LOGOS[p.name]}
                      alt={p.name}
                      className="size-5 rounded"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <span className="text-sm font-semibold text-slate-700">{p.name}</span>
                  </div>

                  {/* Donut */}
                  <div className="relative">
                    <ResponsiveContainer width={180} height={180}>
                      <PieChart>
                        <Pie
                          data={slices}
                          cx="50%"
                          cy="50%"
                          innerRadius={58}
                          outerRadius={82}
                          dataKey="value"
                          startAngle={90}
                          endAngle={-270}
                          stroke="#fff"
                          strokeWidth={2}
                          labelLine={false}
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
                    {/* Center label */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xl font-bold tabular-nums" style={{ color }}>{livePct}%</span>
                      <span className="text-[10px] text-slate-400 font-medium">published</span>
                    </div>
                  </div>

                  {/* Counts */}
                  <div className="mt-2 flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
                      <span className="font-semibold text-emerald-600">{p.Live.toLocaleString()}</span>
                      <span className="text-slate-400">published</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-rose-400 shrink-0" />
                      <span className="font-semibold text-rose-500">{p.Removed.toLocaleString()}</span>
                      <span className="text-slate-400">removed</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

    </div>
  );
}
