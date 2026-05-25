import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { fetchSyncRuns, triggerSync } from '../lib/queries';
import type { SyncRun, SyncRunStatus } from '../types/sync';
import { subscribeSyncRuns } from '../lib/realtime';
import Toast, { type ToastKind } from '../components/Toast';
import { formatRelative } from '../lib/format';

interface DaySummary {
  dateKey: string;
  label: string;
  total: number;
  success: number;
  running: number;
  error: number;
  skipped: number;
  errorMessages: string[];
  runs: SyncRun[];
}

function stripHtml(msg: string): string {
  return msg
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function groupByDate(runs: SyncRun[]): DaySummary[] {
  const map = new Map<string, DaySummary>();
  for (const r of runs) {
    const d = new Date(r.started_at);
    const dateKey = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (!map.has(dateKey)) {
      map.set(dateKey, { dateKey, label, total: 0, success: 0, running: 0, error: 0, skipped: 0, errorMessages: [], runs: [] });
    }
    const s = map.get(dateKey)!;
    s.total++;
    s[r.status as SyncRunStatus]++;
    s.runs.push(r);
    if (r.status === 'error' && r.error_message) {
      s.errorMessages.push(stripHtml(r.error_message));
    }
  }
  return Array.from(map.values()).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const STATUS_PILL: Record<SyncRunStatus, string> = {
  running: 'bg-amber-100 text-amber-700',
  success: 'bg-emerald-100 text-emerald-700',
  error:   'bg-rose-100 text-rose-700',
  skipped: 'bg-slate-100 text-slate-600',
};

export default function SyncStatus() {
  const [runs, setRuns]       = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [toast, setToast]     = useState<{ message: string; kind: ToastKind } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    try {
      const data = await fetchSyncRuns();
      setRuns(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { return subscribeSyncRuns(() => { load(); }); }, []);

  function toggleDate(dateKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(dateKey) ? next.delete(dateKey) : next.add(dateKey);
      return next;
    });
  }

  async function handleRunNow() {
    setRunning(true);
    try {
      await triggerSync();
      setToast({ message: 'Sync triggered', kind: 'success' });
      await load();
    } catch (err) {
      setToast({ message: (err as Error).message, kind: 'error' });
    } finally {
      setRunning(false);
    }
  }

  const lastSuccess = runs.find((r) => r.status === 'success');
  const days = groupByDate(runs);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Sheet → Supabase sync</h2>
          <p className="mt-1 text-sm text-slate-500">
            Last successful run:{' '}
            {lastSuccess ? formatRelative(lastSuccess.finished_at ?? lastSuccess.started_at) : '—'}
          </p>
        </div>
        <button
          onClick={handleRunNow}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          <RefreshCw className={`size-4 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Running…' : 'Run sync now'}
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : null}

      {/* Accordion table */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="rounded-tl-lg px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Success</th>
              <th className="px-4 py-3 text-right">Running</th>
              <th className="px-4 py-3 text-right">Error</th>
              <th className="rounded-tr-lg px-4 py-3 text-right">Skipped</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td>
              </tr>
            ) : days.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">No sync runs yet.</td>
              </tr>
            ) : (
              days.map((d, di) => {
                const isOpen = expanded.has(d.dateKey);
                const isLast = di === days.length - 1;
                return (
                  <>
                    {/* ── Date summary row ── */}
                    <tr
                      key={d.dateKey}
                      onClick={() => toggleDate(d.dateKey)}
                      className={`cursor-pointer select-none hover:bg-slate-50 ${!isOpen && !isLast ? 'border-b border-slate-100' : ''} ${isOpen ? 'bg-slate-50' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-800">
                        <span className="inline-flex items-center gap-2">
                          {isOpen
                            ? <ChevronDown className="size-4 text-slate-400" />
                            : <ChevronRight className="size-4 text-slate-400" />}
                          {d.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{d.total}</td>
                      <td className="px-4 py-3 text-right">
                        {d.success > 0
                          ? <span className="inline-flex items-center justify-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 tabular-nums">{d.success}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {d.running > 0
                          ? <span className="inline-flex items-center justify-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 tabular-nums">{d.running}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {d.error > 0 ? (
                          <div className="group relative inline-flex justify-end">
                            <span className="inline-flex cursor-default items-center justify-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 tabular-nums">
                              {d.error}
                            </span>
                            <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 hidden w-80 rounded-md border border-rose-200 bg-white p-3 shadow-xl group-hover:block">
                              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-rose-600">Error reasons</p>
                              <ul className="max-h-48 space-y-2 overflow-y-auto">
                                {d.errorMessages.map((msg, i) => {
                                  const match = msg.match(/^\[([^\]]+)\]\s*(.*)/s);
                                  const context = match?.[1] ?? null;
                                  const detail  = match?.[2] ?? msg;
                                  return (
                                    <li key={i} className="break-words text-xs">
                                      {context && <span className="mb-0.5 block font-semibold text-rose-600">{context}</span>}
                                      <span className="text-slate-700">{detail}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {d.skipped > 0
                          ? <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 tabular-nums">{d.skipped}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>

                    {/* ── Expanded individual runs ── */}
                    {isOpen && (
                      <tr key={`${d.dateKey}-detail`} className={!isLast ? 'border-b border-slate-100' : ''}>
                        <td colSpan={6} className="bg-slate-50 px-6 pb-3 pt-0">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-slate-400 uppercase tracking-wide">
                                <th className="pb-1.5 pr-4 pt-2 font-medium">Time</th>
                                <th className="pb-1.5 pr-4 pt-2 font-medium">Duration</th>
                                <th className="pb-1.5 pr-4 pt-2 font-medium">Status</th>
                                <th className="pb-1.5 pr-4 pt-2 text-right font-medium">Seen</th>
                                <th className="pb-1.5 pr-4 pt-2 text-right font-medium">Upserted</th>
                                <th className="pb-1.5 pr-4 pt-2 text-right font-medium">Skipped</th>
                                <th className="pb-1.5 pt-2 font-medium">Error</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {d.runs.map((r) => (
                                <tr key={r.id}>
                                  <td className="py-1.5 pr-4 tabular-nums text-slate-600">{formatTime(r.started_at)}</td>
                                  <td className="py-1.5 pr-4 tabular-nums text-slate-500">{formatDuration(r.started_at, r.finished_at)}</td>
                                  <td className="py-1.5 pr-4">
                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[r.status]}`}>
                                      {r.status}
                                    </span>
                                  </td>
                                  <td className="py-1.5 pr-4 text-right tabular-nums text-slate-600">{r.rows_seen ?? '—'}</td>
                                  <td className="py-1.5 pr-4 text-right tabular-nums text-slate-600">{r.rows_upserted ?? '—'}</td>
                                  <td className="py-1.5 pr-4 text-right tabular-nums text-slate-600">{r.rows_skipped ?? '—'}</td>
                                  <td className="max-w-xs py-1.5 text-rose-600">
                                    {r.error_message ? (
                                      <span className="line-clamp-2 break-words">{stripHtml(r.error_message)}</span>
                                    ) : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {toast ? <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
