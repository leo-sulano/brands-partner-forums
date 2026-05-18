import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, CalendarDays, Flame, Hash } from 'lucide-react';
import KpiCard from '../components/KpiCard';
import MentionsTable from '../components/MentionsTable';
import TopList from '../components/TopList';
import TimeSeriesChart from '../components/TimeSeriesChart';
import {
  fetchMentionCounts,
  fetchMentionsPerDay,
  fetchRecentMentions,
  fetchTopForums,
  fetchTrendingKeywords,
  type DailyCount,
  type MentionCounts,
  type TopItem,
} from '../lib/queries';
import { subscribeEntries } from '../lib/realtime';
import type { Mention } from '../types/mention';

interface State {
  loading: boolean;
  error: string | null;
  counts: MentionCounts;
  perDay: DailyCount[];
  topForums: TopItem[];
  trendingKeywords: TopItem[];
  recent: Mention[];
}

const initial: State = {
  loading: true,
  error: null,
  counts: { total: 0, last7d: 0 },
  perDay: [],
  topForums: [],
  trendingKeywords: [],
  recent: [],
};

export default function Overview() {
  const [state, setState] = useState<State>(initial);

  const loadData = useCallback(async () => {
    try {
      const [counts, perDay, topForums, trendingKeywords, recent] = await Promise.all([
        fetchMentionCounts(),
        fetchMentionsPerDay(30),
        fetchTopForums(5),
        fetchTrendingKeywords(5),
        fetchRecentMentions(20),
      ]);
      setState({
        loading: false,
        error: null,
        counts,
        perDay,
        topForums,
        trendingKeywords,
        recent,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime: re-fetch when any entry changes; debounced to coalesce bulk upsert events
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    return subscribeEntries(() => {
      clearTimeout(timer);
      timer = setTimeout(() => loadData(), 400);
    });
  }, [loadData]);

  if (state.error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {state.error}
      </div>
    );
  }

  const topForumLabel = state.topForums[0]?.label ?? '—';
  const trendingKeyword = state.trendingKeywords[0]?.label ?? '—';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total mentions"
          value={state.loading ? '…' : state.counts.total.toLocaleString()}
          icon={<MessageCircle className="size-4" />}
        />
        <KpiCard
          label="Last 7 days"
          value={state.loading ? '…' : state.counts.last7d.toLocaleString()}
          icon={<CalendarDays className="size-4" />}
        />
        <KpiCard
          label="Top forum (30d)"
          value={state.loading ? '…' : topForumLabel}
          icon={<Flame className="size-4" />}
        />
        <KpiCard
          label="Trending keyword (7d)"
          value={state.loading ? '…' : trendingKeyword}
          icon={<Hash className="size-4" />}
        />
      </div>

      <TimeSeriesChart data={state.perDay} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TopList title="Top forums (30d)" items={state.topForums} />
        <TopList title="Trending keywords (7d)" items={state.trendingKeywords} />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Recent mentions</h2>
        <MentionsTable mentions={state.recent} emptyLabel="No mentions yet — sync from the Sync Status page." />
      </section>
    </div>
  );
}
