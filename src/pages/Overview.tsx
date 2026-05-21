import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import KpiCard from '../components/KpiCard';
import { fetchTabKpis, fetchSyncRuns } from '../lib/queries';
import { OPERATIONAL_TABS, tabToSlug } from '../lib/tabs';
import type { TabKpis } from '../types/brand-entry';
import type { SyncRun } from '../types/sync';

interface TabSummary {
  tab: string;
  kpis: TabKpis;
}

interface State {
  loading: boolean;
  error: string | null;
  tabs: TabSummary[];
  recentSyncs: SyncRun[];
}

const EMPTY_KPIS: TabKpis = {
  total: 0, live: 0, removed: 0,
  tp: { live: 0, removed: 0 },
  ag: { live: 0, removed: 0 },
  cg: { live: 0, removed: 0 },
};

const initial: State = { loading: true, error: null, tabs: [], recentSyncs: [] };

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const DIRECTION_LABELS: Record<string, string> = {
  sheet_to_db: 'Sheet → DB',
  db_to_sheet: 'DB → Sheet',
  initial_import: 'Initial Import',
};

const STATUS_CLASSES: Record<string, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  error:   'bg-rose-100 text-rose-700',
  running: 'bg-amber-100 text-amber-700',
  skipped: 'bg-slate-100 text-slate-600',
};

export default function Overview() {
  const [state, setState] = useState<State>(initial);

  const loadData = useCallback(async () => {
    try {
      const [tabResults, recentSyncs] = await Promise.all([
        Promise.all(
          OPERATIONAL_TABS.map((tab) =>
            fetchTabKpis(tab)
              .then((kpis): TabSummary => ({ tab, kpis }))
              .catch((): TabSummary => ({ tab, kpis: EMPTY_KPIS }))
          )
        ),
        fetchSyncRuns(5),
      ]);
      setState({ loading: false, error: null, tabs: tabResults, recentSyncs });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, []);

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
  const lastSync      = state.recentSyncs[0] ?? null;

  return (
    <div className="space-y-8">

      {/* Global KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Accounts"
          value={state.loading ? '…' : totalAccounts.toLocaleString()}
          icon={<Users className="size-4" />}
          hint="across all brand tabs"
        />
        <KpiCard
          label="Live Reviews"
          value={state.loading ? '…' : totalLive.toLocaleString()}
          icon={<CheckCircle2 className="size-4" />}
          hint="active across TP / AG / CG"
        />
        <KpiCard
          label="Removed"
          value={state.loading ? '…' : totalRemoved.toLocaleString()}
          icon={<XCircle className="size-4" />}
          hint="across all tabs"
        />
        <KpiCard
          label="Last Sync"
          value={state.loading ? '…' : lastSync ? timeAgo(lastSync.started_at) : '—'}
          icon={<RefreshCw className="size-4" />}
          hint={lastSync ? `last run: ${lastSync.status}` : 'no syncs yet'}
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
                const livePct    = kpis.total > 0 ? (kpis.live    / kpis.total) * 100 : 0;
                const removedPct = kpis.total > 0 ? (kpis.removed / kpis.total) * 100 : 0;
                return (
                  <Link
                    key={tab}
                    to={`/brands/${tabToSlug(tab)}`}
                    className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <p className="truncate text-sm font-semibold text-slate-800">{tab}</p>
                    <div className="mt-3 flex gap-4 text-xs text-slate-600">
                      <span>
                        <span className="font-medium text-slate-900">{kpis.total}</span> total
                      </span>
                      <span>
                        <span className="font-medium text-emerald-600">{kpis.live}</span> live
                      </span>
                      <span>
                        <span className="font-medium text-rose-500">{kpis.removed}</span> removed
                      </span>
                    </div>
                    <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="bg-emerald-500 transition-all" style={{ width: `${livePct}%` }} />
                      <div className="bg-rose-400 transition-all"    style={{ width: `${removedPct}%` }} />
                    </div>
                  </Link>
                );
              })}
        </div>
      </section>

      {/* Recent sync runs */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Recent Syncs</h2>
        {!state.loading && state.recentSyncs.length === 0 ? (
          <p className="text-sm text-slate-500">No syncs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Tab</th>
                  <th className="px-4 py-2 text-left">Direction</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Rows Upserted</th>
                  <th className="px-4 py-2 text-left">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {state.recentSyncs.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-slate-700">{run.tab ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {DIRECTION_LABELS[run.direction] ?? run.direction}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[run.status] ?? 'bg-slate-100 text-slate-600'}`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {run.rows_upserted ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{timeAgo(run.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}
