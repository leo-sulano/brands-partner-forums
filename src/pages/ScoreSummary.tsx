import { useEffect, useState } from 'react';
import ScoreSummaryPanel from '../components/ScoreSummaryPanel';
import { fetchAllEntries } from '../lib/queries';
import { OPERATIONAL_TABS } from '../lib/tabs';
import type { Entry } from '../types/entry';

export default function ScoreSummary() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAllEntries(OPERATIONAL_TABS)
      .then((data) => { if (!cancelled) setEntries(data); })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        Failed to load: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ScoreSummaryPanel entries={entries} />
    </div>
  );
}
