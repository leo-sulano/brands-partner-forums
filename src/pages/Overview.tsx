import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Users, CheckCircle2, XCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList, Cell } from 'recharts';
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {state.loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-lg bg-slate-100" />
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
                    className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-800">{tab}</p>
                      <span className="shrink-0 text-xs text-slate-500">
                        <span className="font-medium text-slate-900">{kpis.total}</span> total
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                      {statusItems.map((s) => (
                        <span key={s.label}>
                          <span className={`font-medium ${s.text}`}>{s.count}</span> {s.label}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
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
        <div className="mb-4 flex items-baseline justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Platform Breakdown</h2>
            <p className="mt-0.5 text-xs text-slate-400">Live vs. removed reviews per platform</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm bg-emerald-500" />Live
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm bg-rose-400" />Removed
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {state.loading ? (
            <div className="h-72 animate-pulse rounded-lg bg-slate-100" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={platformData} barCategoryGap="40%" barGap={6} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradLive" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0.7} />
                  </linearGradient>
                  <linearGradient id="gradRemoved" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity={1} />
                    <stop offset="100%" stopColor="#fb7185" stopOpacity={0.7} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 13, fill: '#64748b', fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#cbd5e1' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                />
                <Tooltip
                  cursor={{ fill: '#f1f5f9', radius: 6 } as object}
                  contentStyle={{
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                    fontSize: '13px',
                    padding: '10px 14px',
                  }}
                  labelStyle={{ fontWeight: 600, color: '#1e293b', marginBottom: 4 }}
                  itemStyle={{ color: '#475569' }}
                />
                <Bar dataKey="Live" fill="url(#gradLive)" radius={[6, 6, 0, 0]}>
                  <LabelList dataKey="Live" position="top" style={{ fontSize: 11, fill: '#10b981', fontWeight: 600 }} formatter={(v: number) => v.toLocaleString()} />
                  {platformData.map((_, i) => <Cell key={i} />)}
                </Bar>
                <Bar dataKey="Removed" fill="url(#gradRemoved)" radius={[6, 6, 0, 0]}>
                  <LabelList dataKey="Removed" position="top" style={{ fontSize: 11, fill: '#f43f5e', fontWeight: 600 }} formatter={(v: number) => v.toLocaleString()} />
                  {platformData.map((_, i) => <Cell key={i} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

    </div>
  );
}
