import React, { useEffect, useReducer, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { fetchSyncRuns, triggerSync, triggerStatusCheck, fetchAllTabsStatusSummary, type TabStatusRow } from '../lib/queries';
import { tabToSlug } from '../lib/tabs';
import type { SyncRun, SyncRunStatus } from '../types/sync';
import { subscribeSyncRuns } from '../lib/realtime';
import Toast, { type ToastKind } from '../components/Toast';
import { formatRelative } from '../lib/format';
import { TAB_COLUMN_CONFIGS } from '../lib/tab-configs';

// Module-level singleton — survives React unmount/remount during navigation
let _fullCheckRunning = false;
let _fullCheckProgress = '';
const _fullCheckListeners = new Set<() => void>();
function setFullCheckRunning(v: boolean) {
  _fullCheckRunning = v;
  if (!v) _fullCheckProgress = '';
  _fullCheckListeners.forEach(fn => fn());
}
function setFullCheckProgress(v: string) {
  _fullCheckProgress = v;
  _fullCheckListeners.forEach(fn => fn());
}

const ALL_TABS = Object.keys(TAB_COLUMN_CONFIGS);

const HISTORY_KEY = 'fullCheckHistory';
const MAX_HISTORY = 30;

interface FullCheckSnapshot {
  runAt: string;
  summary: TabStatusRow[];
}

function loadHistory(): FullCheckSnapshot[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

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

  const [checkHistory, setCheckHistory]     = useState<FullCheckSnapshot[]>(() => loadHistory());
  const [expandedRun, setExpandedRun]       = useState<Set<string>>(new Set());

  // Mirror module-level singleton into render via forceUpdate
  const [, tick] = useReducer(x => x + 1, 0);
  useEffect(() => {
    _fullCheckListeners.add(tick);
    return () => { _fullCheckListeners.delete(tick); };
  }, []);
  const checkingAll    = _fullCheckRunning;
  const checkProgress  = _fullCheckProgress;

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

  async function loadSummary(): Promise<TabStatusRow[]> {
    return fetchAllTabsStatusSummary(ALL_TABS);
  }

  useEffect(() => { load(); loadSummary(); }, []);
  useEffect(() => { return subscribeSyncRuns(() => { load(); }); }, []);

  async function handleFullCheck() {
    setFullCheckRunning(true);
    let succeeded = 0, failed = 0;
    for (let i = 0; i < ALL_TABS.length; i++) {
      const tab = ALL_TABS[i];
      setFullCheckProgress(`Checking "${tab}" (${i + 1}/${ALL_TABS.length})…`);
      try {
        await triggerStatusCheck(tab, true);
        succeeded++;
      } catch {
        failed++;
      }
    }
    setFullCheckRunning(false);
    setToast({
      message: failed > 0
        ? `${succeeded} tab${succeeded !== 1 ? 's' : ''} checked, ${failed} failed`
        : `All ${succeeded} tabs checked successfully`,
      kind: failed > 0 ? 'error' : 'success',
    });
    const latest = await loadSummary();
    const snapshot: FullCheckSnapshot = { runAt: new Date().toISOString(), summary: latest };
    const updated = [snapshot, ...checkHistory].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    setCheckHistory(updated);
  }

  function toggleRun(runAt: string) {
    setExpandedRun((prev) => {
      const next = new Set(prev);
      next.has(runAt) ? next.delete(runAt) : next.add(runAt);
      return next;
    });
  }

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
                                <th className="pb-1.5 pr-4 pt-2 font-medium">Type</th>
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
                                  <td className="py-1.5 pr-4">
                                    {r.direction === 'status_check'
                                      ? <span className="inline-flex rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">Status Check</span>
                                      : r.direction === 'db_to_sheet'
                                        ? <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">DB → Sheet</span>
                                        : <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Sheet → DB</span>}
                                  </td>
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

      {/* ── Full Check Status ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Full Check Status</h2>
            <p className="mt-1 text-sm text-slate-500">Checks all TP links including Published — detects reviews that have been removed</p>
          </div>
          <div className="flex items-center gap-3">
            {checkProgress && (
              <span className="text-sm text-slate-500 tabular-nums">{checkProgress}</span>
            )}
            <button
              onClick={handleFullCheck}
              disabled={checkingAll}
              className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${checkingAll ? 'animate-spin' : ''}`} />
              {checkingAll ? 'Checking…' : 'Run Full Check'}
            </button>
          </div>
        </div>

        {/* Delta message */}
        {checkHistory.length > 0 && (() => {
          const latest = checkHistory[0];
          const prev = checkHistory[1];
          const latestRem = latest.summary.reduce((s, r) => s + r.removed, 0);
          if (!prev) {
            return (
              <p className="text-sm text-slate-500">
                <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 tabular-nums mr-1.5">{latestRem}</span>
                removed reviews detected in the last check.
              </p>
            );
          }
          const prevRem = prev.summary.reduce((s, r) => s + r.removed, 0);
          const delta = latestRem - prevRem;
          if (delta === 0) {
            return <p className="text-sm text-slate-500">No new removed reviews since last check.</p>;
          }
          if (delta > 0) {
            return (
              <p className="text-sm text-slate-700">
                <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700 tabular-nums mr-1.5">↑ {delta}</span>
                new removed review{delta !== 1 ? 's' : ''} detected since last check.
              </p>
            );
          }
          return (
            <p className="text-sm text-slate-700">
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 tabular-nums mr-1.5">↓ {Math.abs(delta)}</span>
              fewer removed reviews since last check.
            </p>
          );
        })()}

        {/* Run History */}
        {checkHistory.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="rounded-tl-lg px-4 py-3">Run</th>
                  <th className="rounded-tr-lg px-4 py-3">Summary</th>
                </tr>
              </thead>
              <tbody>
                {checkHistory.map((snap, si) => {
                  const isOpen = expandedRun.has(snap.runAt);
                  const isLast = si === checkHistory.length - 1;
                  const label = new Date(snap.runAt).toLocaleString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  });

                  const totRem = snap.summary.reduce((s, r) => s + r.removed, 0);
                  const prev = checkHistory[si + 1];
                  const hasPrev = !!prev;
                  const prevRem = prev ? prev.summary.reduce((s, r) => s + r.removed, 0) : 0;
                  const newlyRemoved = totRem - prevRem;

                  return (
                    <React.Fragment key={snap.runAt}>
                      <tr
                        onClick={() => toggleRun(snap.runAt)}
                        className={`cursor-pointer select-none hover:bg-slate-50 ${!isOpen && !isLast ? 'border-b border-slate-100' : ''} ${isOpen ? 'bg-slate-50' : ''}`}
                      >
                        <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                          <span className="inline-flex items-center gap-2">
                            {isOpen
                              ? <ChevronDown className="size-4 text-slate-400" />
                              : <ChevronRight className="size-4 text-slate-400" />}
                            {label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {!hasPrev ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 font-medium text-rose-700 tabular-nums">{totRem} removed</span>
                              <span className="text-slate-400">(baseline)</span>
                            </span>
                          ) : newlyRemoved > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 font-medium text-rose-700 tabular-nums">
                              +{newlyRemoved} newly removed from Published
                            </span>
                          ) : (
                            <span className="text-slate-400">No new removals</span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className={!isLast ? 'border-b border-slate-100' : ''}>
                          <td colSpan={2} className="bg-slate-50 px-6 pb-3 pt-1">
                            <div className="space-y-1">
                              {(() => {
                                const prevSnap = checkHistory[si + 1];
                                const rows = snap.summary.filter((row) => {
                                  if (row.removed <= 0) return false;
                                  if (!prevSnap) return true;
                                  const prevRow = prevSnap.summary.find((r) => r.tab === row.tab);
                                  return row.removed > (prevRow?.removed ?? 0);
                                });
                                if (rows.length === 0) return (
                                  <p className="py-2 text-xs text-slate-400">No newly removed entries in this run.</p>
                                );
                                return rows.map((row) => {
                                  const rb = row.removedBrands ?? [];
                                  const counts = row.removedBrandCounts ?? {};
                                  const prevRow = prevSnap?.summary.find((r) => r.tab === row.tab);
                                  const newlyRem = row.removed - (prevRow?.removed ?? 0);
                                  return (
                                    <div key={row.tab} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-xs">
                                      <Link
                                        to={`/brands/${tabToSlug(row.tab)}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="min-w-[130px] font-medium text-slate-700 whitespace-nowrap hover:text-brand-600 hover:underline"
                                      >{row.tab}</Link>
                                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 tabular-nums">{row.published} pub</span>
                                      <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700 tabular-nums">{row.removed} rem</span>
                                      {newlyRem > 0 && (
                                        <span className="rounded-full bg-rose-600 px-2 py-0.5 font-semibold text-white tabular-nums">+{newlyRem} new</span>
                                      )}
                                      {rb.length > 0 && (
                                        <>
                                          <span className="text-slate-300">→</span>
                                          {rb.map((b) => (
                                            <span key={b} className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
                                              {b}
                                              {counts[b] != null && (
                                                <span className="rounded-full bg-rose-200 px-1.5 py-px font-semibold tabular-nums">{counts[b]}</span>
                                              )}
                                            </span>
                                          ))}
                                        </>
                                      )}
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast ? <Toast message={toast.message} kind={toast.kind} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
