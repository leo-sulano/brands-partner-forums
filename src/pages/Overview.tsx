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

const RADIAN = Math.PI / 180;
function renderPieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: {
  cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number;
}) {
  if (percent < 0.04) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={600}>
      {`${(percent * 100).toFixed(1)}%`}
    </text>
  );
}

const EMPTY_KPIS: TabKpis = {
  total: 0, live: 0, removed: 0, done: 0, pending: 0, onPause: 0, notDone: 0,
  tp: { live: 0, removed: 0 },
  ag: { live: 0, removed: 0 },
  cg: { live: 0, removed: 0 },
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

  const totalAccounts = state.tabs.reduce((s, t) => s + t.kpis.total,   0);
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
  ];

  const pieData = platformData
    .map(p => ({ name: p.name, value: p.Live, live: p.Live, removed: p.Removed }))
    .filter(p => p.value > 0);

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
                const pct = (n: number) => kpis.total > 0 ? (n / kpis.total) * 100 : 0;
                const statusItems = [
                  { count: kpis.live,    label: 'live',     bar: 'bg-emerald-500', text: 'text-emerald-600' },
                  { count: kpis.removed, label: 'removed',  bar: 'bg-rose-400',    text: 'text-rose-500'    },
                  { count: kpis.done,    label: 'done',     bar: 'bg-teal-500',    text: 'text-teal-600'    },
                  { count: kpis.pending, label: 'pending',  bar: 'bg-amber-400',   text: 'text-amber-500'   },
                  { count: kpis.onPause, label: 'on pause', bar: 'bg-slate-400',   text: 'text-slate-500'   },
                  { count: kpis.notDone, label: 'not done', bar: 'bg-orange-400',  text: 'text-orange-500'  },
                ].filter((s) => s.count >= 1);
                return (
                  <Link
                    key={tab}
                    to={`/brands/${tabToSlug(tab)}`}
                    style={{ height: 80 }}
                    className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-800">{tab}</p>
                      <span className="shrink-0 text-xs text-slate-500">
                        <span className="font-medium text-slate-900">{kpis.total}</span> total
                      </span>
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
          <p className="mt-0.5 text-xs text-slate-400">Live review distribution across platforms</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {state.loading ? (
            <div className="h-72 animate-pulse rounded-lg bg-slate-100" />
          ) : pieData.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-slate-400">No live reviews yet</div>
          ) : (
            <div className="flex flex-col items-center gap-6">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={85}
                    outerRadius={130}
                    dataKey="value"
                    labelLine={false}
                    label={renderPieLabel}
                    stroke="#fff"
                    strokeWidth={2}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={PLATFORM_COLORS[entry.name as keyof typeof PLATFORM_COLORS]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => [value.toLocaleString(), 'Live']}
                    contentStyle={{
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                      fontSize: '13px',
                      padding: '10px 14px',
                    }}
                    labelStyle={{ fontWeight: 600, color: '#1e293b', marginBottom: 4 }}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Platform legend with logos */}
              <div className="flex flex-wrap items-center justify-center gap-6">
                {pieData.map((p) => (
                  <div key={p.name} className="flex items-center gap-2.5">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ background: PLATFORM_COLORS[p.name as keyof typeof PLATFORM_COLORS] }}
                    />
                    <img
                      src={PLATFORM_LOGOS[p.name]}
                      alt={p.name}
                      className="size-5 rounded"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <div className="text-xs text-slate-600">
                      <span className="font-semibold text-emerald-600">{p.live.toLocaleString()}</span>
                      <span className="mx-1 text-slate-300">·</span>
                      <span className="font-semibold text-rose-500">{p.removed.toLocaleString()}</span>
                      <span className="ml-1 text-slate-400">removed</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
